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

// ── Mock data for browser dev mode ──────────────────────────────

const MOCK_LOCAL_FILES: Record<string, FileEntry[]> = {
  '/': [
    { name: 'Documents', isDirectory: true, size: 0, modified: new Date('2026-04-01'), permissions: 'drwxr-xr-x' },
    { name: 'Downloads', isDirectory: true, size: 0, modified: new Date('2026-04-07'), permissions: 'drwxr-xr-x' },
    { name: 'Desktop', isDirectory: true, size: 0, modified: new Date('2026-04-08'), permissions: 'drwxr-xr-x' },
    { name: 'Pictures', isDirectory: true, size: 0, modified: new Date('2026-03-20'), permissions: 'drwxr-xr-x' },
    { name: 'Projects', isDirectory: true, size: 0, modified: new Date('2026-04-08'), permissions: 'drwxr-xr-x' },
    { name: '.bashrc', isDirectory: false, size: 3771, modified: new Date('2026-01-15'), permissions: '-rw-r--r--' },
    { name: 'notes.txt', isDirectory: false, size: 1240, modified: new Date('2026-04-06'), permissions: '-rw-r--r--' },
  ],
  '/Documents': [
    { name: 'report-q1.pdf', isDirectory: false, size: 2457600, modified: new Date('2026-03-31'), permissions: '-rw-r--r--' },
    { name: 'budget-2026.xlsx', isDirectory: false, size: 184320, modified: new Date('2026-02-14'), permissions: '-rw-r--r--' },
    { name: 'meeting-notes.md', isDirectory: false, size: 8942, modified: new Date('2026-04-05'), permissions: '-rw-r--r--' },
    { name: 'Contracts', isDirectory: true, size: 0, modified: new Date('2026-01-20'), permissions: 'drwxr-xr-x' },
  ],
  '/Downloads': [
    { name: 'node-v24.13.0.tar.gz', isDirectory: false, size: 42893312, modified: new Date('2026-04-07'), permissions: '-rw-r--r--' },
    { name: 'design-mockup.fig', isDirectory: false, size: 15728640, modified: new Date('2026-04-03'), permissions: '-rw-r--r--' },
    { name: 'invoice-0042.pdf', isDirectory: false, size: 524288, modified: new Date('2026-04-01'), permissions: '-rw-r--r--' },
  ],
  '/Desktop': [
    { name: 'screenshot-2026-04-08.png', isDirectory: false, size: 1048576, modified: new Date('2026-04-08'), permissions: '-rw-r--r--' },
    { name: 'todo.txt', isDirectory: false, size: 256, modified: new Date('2026-04-08'), permissions: '-rw-r--r--' },
  ],
  '/Pictures': [
    { name: 'vacation-2026', isDirectory: true, size: 0, modified: new Date('2026-03-15'), permissions: 'drwxr-xr-x' },
    { name: 'wallpaper.jpg', isDirectory: false, size: 3145728, modified: new Date('2026-02-01'), permissions: '-rw-r--r--' },
  ],
  '/Projects': [
    { name: 'bridgefile', isDirectory: true, size: 0, modified: new Date('2026-04-08'), permissions: 'drwxr-xr-x' },
    { name: 'website', isDirectory: true, size: 0, modified: new Date('2026-03-28'), permissions: 'drwxr-xr-x' },
    { name: 'README.md', isDirectory: false, size: 1420, modified: new Date('2026-04-08'), permissions: '-rw-r--r--' },
  ],
};

const MOCK_REMOTE_FILES: Record<string, FileEntry[]> = {
  '/': [
    { name: 'var', isDirectory: true, size: 0, modified: new Date('2026-04-01'), permissions: 'drwxr-xr-x' },
    { name: 'home', isDirectory: true, size: 0, modified: new Date('2026-04-07'), permissions: 'drwxr-xr-x' },
    { name: 'etc', isDirectory: true, size: 0, modified: new Date('2026-03-10'), permissions: 'drwxr-xr-x' },
    { name: 'opt', isDirectory: true, size: 0, modified: new Date('2026-02-20'), permissions: 'drwxr-xr-x' },
    { name: 'tmp', isDirectory: true, size: 0, modified: new Date('2026-04-08'), permissions: 'drwxrwxrwt' },
  ],
  '/home': [
    { name: 'ubuntu', isDirectory: true, size: 0, modified: new Date('2026-04-08'), permissions: 'drwxr-xr-x' },
    { name: 'deploy', isDirectory: true, size: 0, modified: new Date('2026-03-15'), permissions: 'drwxr-xr-x' },
  ],
  '/var': [
    { name: 'www', isDirectory: true, size: 0, modified: new Date('2026-04-06'), permissions: 'drwxr-xr-x' },
    { name: 'log', isDirectory: true, size: 0, modified: new Date('2026-04-08'), permissions: 'drwxr-xr-x' },
    { name: 'backups', isDirectory: true, size: 0, modified: new Date('2026-04-07'), permissions: 'drwxr-xr-x' },
  ],
  '/var/www': [
    { name: 'html', isDirectory: true, size: 0, modified: new Date('2026-04-06'), permissions: 'drwxr-xr-x' },
    { name: 'app', isDirectory: true, size: 0, modified: new Date('2026-04-05'), permissions: 'drwxr-xr-x' },
  ],
  '/var/log': [
    { name: 'syslog', isDirectory: false, size: 10485760, modified: new Date('2026-04-08'), permissions: '-rw-r-----' },
    { name: 'nginx', isDirectory: true, size: 0, modified: new Date('2026-04-08'), permissions: 'drwxr-xr-x' },
    { name: 'auth.log', isDirectory: false, size: 2097152, modified: new Date('2026-04-08'), permissions: '-rw-r-----' },
  ],
  '/var/backups': [
    { name: 'db-2026-04-07.sql.gz', isDirectory: false, size: 52428800, modified: new Date('2026-04-07'), permissions: '-rw-r--r--' },
    { name: 'db-2026-04-06.sql.gz', isDirectory: false, size: 51380224, modified: new Date('2026-04-06'), permissions: '-rw-r--r--' },
    { name: 'site-backup-2026-04.tar.gz', isDirectory: false, size: 104857600, modified: new Date('2026-04-01'), permissions: '-rw-r--r--' },
  ],
};

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

  const useMock = !isElectron();
  const mockData = side === 'local' ? MOCK_LOCAL_FILES : MOCK_REMOTE_FILES;

  const [currentPath, setCurrentPath] = useState('/');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>(useMock ? (mockData['/'] || []) : []);

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

  // ── Mock listing ────────────────────────────────────────────

  const listViaMock = useCallback((path: string) => {
    setLoading(true);
    setError(null);
    setTimeout(() => {
      const entries = mockData[path];
      setFiles(entries || []);
      setCurrentPath(path);
      setLoading(false);
    }, 150);
  }, [mockData]);

  // ── Combined loadFiles ──────────────────────────────────────

  const loadFiles = useCallback((path: string) => {
    if (useMock) {
      listViaMock(path);
    } else {
      listViaIPC(path);
    }
  }, [useMock, listViaMock, listViaIPC]);

  // Load initial directory on mount or when connection changes
  const prevConnId = useRef(connectionId);
  useEffect(() => {
    if (side === 'local') {
      loadFiles('/');
    } else if (connectionId && connectionId !== prevConnId.current) {
      // New connection -- load root
      loadFiles('/');
    } else if (!connectionId && !useMock) {
      // Disconnected
      setFiles([]);
      setCurrentPath('/');
      setError(null);
    }
    prevConnId.current = connectionId;
  }, [connectionId, side, loadFiles, useMock]);

  // ── navigate ────────────────────────────────────────────────

  const navigate = useCallback((path: string) => {
    loadFiles(path);
  }, [loadFiles]);

  // ── upload ──────────────────────────────────────────────────

  const upload = useCallback((fileEntries: FileEntry[]) => {
    if (!isElectron()) {
      console.log('[mock] upload', fileEntries);
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
      console.log('[mock] download', fileEntries);
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
      // Mock: add the folder locally
      setFiles(prev => [
        ...prev,
        {
          name,
          isDirectory: true,
          size: 0,
          modified: new Date(),
          permissions: 'drwxr-xr-x',
        },
      ]);
      return;
    }

    const fullPath = joinPath(currentPath, name);

    (async () => {
      try {
        if (side === 'local') {
          // No local mkdir in API -- fall back to a mock-style local add
          setFiles(prev => [
            ...prev,
            { name, isDirectory: true, size: 0, modified: new Date(), permissions: 'drwxr-xr-x' },
          ]);
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
      setFiles(prev =>
        prev.map(f => (f.name === oldName ? { ...f, name: newName } : f))
      );
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
      const names = new Set(toDelete.map(f => f.name));
      setFiles(prev => prev.filter(f => !names.has(f.name)));
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
