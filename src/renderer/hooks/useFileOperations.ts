import { useState, useCallback } from 'react';

export interface FileEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  modified: Date;
  permissions: string;
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

export function useFileOperations(side: 'local' | 'remote'): FileOperations {
  const mockData = side === 'local' ? MOCK_LOCAL_FILES : MOCK_REMOTE_FILES;
  const [currentPath, setCurrentPath] = useState('/');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>(mockData['/'] || []);

  const loadFiles = useCallback((path: string) => {
    setLoading(true);
    setError(null);
    // Simulate async IPC call
    setTimeout(() => {
      const entries = mockData[path];
      if (entries) {
        setFiles(entries);
        setCurrentPath(path);
      } else {
        setFiles([]);
        setCurrentPath(path);
      }
      setLoading(false);
    }, 150);
  }, [mockData]);

  const navigate = useCallback((path: string) => {
    loadFiles(path);
  }, [loadFiles]);

  const upload = useCallback((_files: FileEntry[]) => {
    console.log('[mock] upload', _files);
  }, []);

  const download = useCallback((_files: FileEntry[]) => {
    console.log('[mock] download', _files);
  }, []);

  const mkdir = useCallback((name: string) => {
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
  }, []);

  const rename = useCallback((oldName: string, newName: string) => {
    setFiles(prev =>
      prev.map(f => (f.name === oldName ? { ...f, name: newName } : f))
    );
  }, []);

  const deleteFiles = useCallback((toDelete: FileEntry[]) => {
    const names = new Set(toDelete.map(f => f.name));
    setFiles(prev => prev.filter(f => !names.has(f.name)));
  }, []);

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
    mkdir,
    rename,
    deleteFiles,
    refresh,
  };
}

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
