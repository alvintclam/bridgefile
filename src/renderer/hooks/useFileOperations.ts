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
  upload: (files: FileEntry[]) => void;
  download: (files: FileEntry[]) => void;
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
      loadFiles('/');
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

  // ── upload ──────────────────────────────────────────────────

  const upload = useCallback((fileEntries: FileEntry[]) => {
    if (!isElectron()) {
      setError('Not in Electron environment');
      return;
    }

    const { connectionId: cid, protocol: proto } = connRef.current;
    if (!cid || !proto) return;

    const api = getProtocolApi(proto);

    (async () => {
      try {
        for (const f of fileEntries) {
          const localPath = joinPath(currentPath, f.name);
          // For upload, local file at currentPath (local pane) -> remote currentPath
          await api.upload(cid, localPath, joinPath(currentPath, f.name));
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      }
    })();
  }, [currentPath]);

  // ── download ────────────────────────────────────────────────

  const download = useCallback((fileEntries: FileEntry[]) => {
    if (!isElectron()) {
      setError('Not in Electron environment');
      return;
    }

    const { connectionId: cid, protocol: proto } = connRef.current;
    if (!cid || !proto) return;

    const api = getProtocolApi(proto);

    (async () => {
      try {
        for (const f of fileEntries) {
          const remotePath = joinPath(currentPath, f.name);
          await api.download(cid, remotePath, joinPath(currentPath, f.name));
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      }
    })();
  }, [currentPath]);

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
          // No local rename in API
          setFiles(prev =>
            prev.map(f => (f.name === oldName ? { ...f, name: newName } : f))
          );
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

    (async () => {
      try {
        if (side === 'local') {
          // No local delete in API
          const names = new Set(toDelete.map(f => f.name));
          setFiles(prev => prev.filter(f => !names.has(f.name)));
          return;
        }

        const { connectionId: cid, protocol: proto } = connRef.current;
        if (!cid || !proto) return;
        const api = getProtocolApi(proto);
        for (const f of toDelete) {
          await api.delete(cid, joinPath(currentPath, f.name));
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
    upload,
    download,
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
