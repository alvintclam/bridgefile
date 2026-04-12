import { useState, useCallback, useEffect, useRef } from 'react';

export interface FileEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  modified: Date;
  permissions: string;
}

export interface FileOperationsParams {
  side: 'local' | 'remote';
  protocol?: 'sftp' | 's3' | 'ftp';
  connectionId?: string;
}

export interface FileOperations {
  files: FileEntry[];
  currentPath: string;
  loading: boolean;
  error: string | null;
  navigate: (path: string) => void;
  mkdir: (name: string) => void;
  rename: (oldName: string, newName: string) => void;
  deleteFiles: (files: FileEntry[]) => void;
  refresh: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────

function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof window.bridgefile !== 'undefined';
}

/** Convert IPC FileEntry (modifiedAt: number) to renderer FileEntry (modified: Date) */
function toRendererEntry(raw: {
  name: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: number;
  permissions?: string;
}): FileEntry {
  return {
    name: raw.name,
    isDirectory: raw.isDirectory,
    size: raw.size,
    modified: new Date(raw.modifiedAt),
    permissions: raw.permissions ?? (raw.isDirectory ? 'drwxr-xr-x' : '-rw-r--r--'),
  };
}

function getProtocolApi(protocol: 'sftp' | 's3' | 'ftp') {
  const api = window.bridgefile;
  if (protocol === 'sftp') return api.sftp;
  if (protocol === 's3') return api.s3;
  return api.ftp;
}

function joinPath(base: string, name: string): string {
  if (base === '/') return '/' + name;
  return base + '/' + name;
}

// ── Hook ────────────────────────────────────────────────────────

export function useFileOperations(params: FileOperationsParams): FileOperations {
  const { side, protocol, connectionId } = params;

  const [currentPath, setCurrentPath] = useState('/');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(!isElectron() ? 'Desktop app required' : null);
  const [files, setFiles] = useState<FileEntry[]>([]);

  // Keep a ref to the latest connectionId / protocol to avoid stale closures
  const connRef = useRef({ connectionId, protocol });
  connRef.current = { connectionId, protocol };

  // ── List files via IPC ──────────────────────────────────────

  const listViaIPC = useCallback(async (path: string) => {
    try {
      setLoading(true);
      setError(null);

      if (side === 'local') {
        const rawEntries = await window.bridgefile.fs.listLocal(path);
        setFiles(rawEntries.map(toRendererEntry));
      } else {
        const { connectionId: cid, protocol: proto } = connRef.current;
        if (!cid || !proto) {
          setFiles([]);
          setError('Not connected');
          return;
        }
        const api = getProtocolApi(proto);
        const rawEntries = await api.list(cid, path);
        setFiles(rawEntries.map(toRendererEntry));
      }
      setCurrentPath(path);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setFiles([]);
      setCurrentPath(path);
    } finally {
      setLoading(false);
    }
  }, [side]);

  // ── Combined loadFiles ──────────────────────────────────────

  const loadFiles = useCallback((path: string) => {
    if (!isElectron()) {
      setFiles([]);
      setError('Not in Electron environment');
      return;
    }
    listViaIPC(path);
  }, [listViaIPC]);

  // Load initial directory on mount or when connection changes
  const prevConnId = useRef(connectionId);
  useEffect(() => {
    if (!isElectron()) return;
    if (side === 'local') {
      window.bridgefile.fs
        .getHomeDir()
        .then((homeDir: string) => loadFiles(homeDir))
        .catch(() => loadFiles('/'));
    } else if (connectionId && connectionId !== prevConnId.current) {
      // New connection -- load root
      loadFiles('/');
    } else if (!connectionId) {
      // Disconnected
      setFiles([]);
      setCurrentPath('/');
      setError(null);
    }
    prevConnId.current = connectionId;
  }, [connectionId, side, loadFiles]);

  // ── navigate ────────────────────────────────────────────────

  const navigate = useCallback((path: string) => {
    loadFiles(path);
  }, [loadFiles]);

  // ── mkdir ───────────────────────────────────────────────────

  const mkdirOp = useCallback((name: string) => {
    if (!isElectron()) {
      setError('Not in Electron environment');
      return;
    }

    const fullPath = joinPath(currentPath, name);

    (async () => {
      try {
        if (side === 'local') {
          await window.bridgefile.fs.mkdir(fullPath);
          loadFiles(currentPath);
          return;
        }

        const { connectionId: cid, protocol: proto } = connRef.current;
        if (!cid || !proto) return;
        const api = getProtocolApi(proto);
        await api.mkdir(cid, fullPath);
        // Refresh to show the new folder
        loadFiles(currentPath);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      }
    })();
  }, [currentPath, side, loadFiles]);

  // ── rename ──────────────────────────────────────────────────

  const renameOp = useCallback((oldName: string, newName: string) => {
    if (!isElectron()) {
      setError('Not in Electron environment');
      return;
    }

    (async () => {
      try {
        if (side === 'local') {
          const oldPath = joinPath(currentPath, oldName);
          const newPath = joinPath(currentPath, newName);
          await window.bridgefile.fs.rename(oldPath, newPath);
          loadFiles(currentPath);
          return;
        }

        const { connectionId: cid, protocol: proto } = connRef.current;
        if (!cid || !proto) return;
        const api = getProtocolApi(proto);
        const oldPath = joinPath(currentPath, oldName);
        const newPath = joinPath(currentPath, newName);
        await api.rename(cid, oldPath, newPath);
        loadFiles(currentPath);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      }
    })();
  }, [currentPath, side, loadFiles]);

  // ── deleteFiles ─────────────────────────────────────────────

  const deleteFilesOp = useCallback((toDelete: FileEntry[]) => {
    if (!isElectron()) {
      setError('Not in Electron environment');
      return;
    }

    if (toDelete.length === 0) {
      return;
    }

    const selectionLabel =
      toDelete.length === 1
        ? `${toDelete[0].isDirectory ? 'folder' : 'file'} "${toDelete[0].name}"`
        : `${toDelete.length} selected items`;
    const locationLabel = side === 'local' ? 'local disk' : 'remote server';
    const confirmed =
      typeof window === 'undefined' || typeof window.confirm !== 'function'
        ? true
        : window.confirm(`Delete ${selectionLabel} from the ${locationLabel}?\n\nThis cannot be undone.`);

    if (!confirmed) {
      return;
    }

    (async () => {
      try {
        if (side === 'local') {
          for (const file of toDelete) {
            await window.bridgefile.fs.delete(joinPath(currentPath, file.name));
          }
          loadFiles(currentPath);
          return;
        }

        const { connectionId: cid, protocol: proto } = connRef.current;
        if (!cid || !proto) return;
        const api = getProtocolApi(proto);
        for (const f of toDelete) {
          const targetPath = joinPath(currentPath, f.name);
          if (f.isDirectory) {
            await api.deleteDir(cid, targetPath);
          } else {
            await api.delete(cid, targetPath);
          }
        }
        loadFiles(currentPath);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      }
    })();
  }, [currentPath, side, loadFiles]);

  // ── refresh ─────────────────────────────────────────────────

  const refresh = useCallback(() => {
    loadFiles(currentPath);
  }, [loadFiles, currentPath]);

  return {
    files,
    currentPath,
    loading,
    error,
    navigate,
    mkdir: mkdirOp,
    rename: renameOp,
    deleteFiles: deleteFilesOp,
    refresh,
  };
}

// ── Utility exports ─────────────────────────────────────────────

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
