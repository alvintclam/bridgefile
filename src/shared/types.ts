// ── Protocol types ──────────────────────────────────────────────

export type ProtocolType = 'sftp' | 's3' | 'ftp';

export interface SFTPConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  /** Jump host / proxy for tunnelling */
  proxyHost?: string;
  proxyPort?: number;
  proxyUsername?: string;
  proxyPassword?: string;
  /** Connection timeout in seconds (default 30) */
  timeout?: number;
}

export interface FTPConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  /** Enable FTPS (TLS) */
  secure: boolean;
  /** Additional TLS options for FTPS connections */
  secureOptions?: { rejectUnauthorized?: boolean };
  /** Connection timeout in seconds (default 30) */
  timeout?: number;
}

export interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  /** Optional key prefix treated as the virtual root */
  prefix?: string;
  /** Custom endpoint for S3-compatible services (MinIO, R2, etc.) */
  endpoint?: string;
  /** Force path-style addressing (required for some S3-compatible services) */
  forcePathStyle?: boolean;
  /** Connection timeout in seconds (default 30) */
  timeout?: number;
}

// ── Connection profiles ─────────────────────────────────────────

export interface ConnectionProfile {
  id: string;
  name: string;
  type: ProtocolType;
  config: SFTPConfig | FTPConfig | S3Config;
  lastUsed?: number;
  favorite: boolean;
  /** Group/folder for organizing connections in the site manager */
  group?: string;
}

// ── File entries ────────────────────────────────────────────────

export interface FileEntry {
  name: string;
  path: string;
  size: number;
  modifiedAt: number;
  isDirectory: boolean;
  permissions?: string;
  /** S3 storage class, SFTP owner, etc. */
  meta?: Record<string, string>;
}

// ── Bookmarks ──────────────────────────────────────────────────

export interface BookmarkEntry {
  id: string;
  connectionId: string;
  path: string;
  name: string;
  createdAt: number;
}

// ── Transfer queue ──────────────────────────────────────────────

export type TransferStatus =
  | 'queued'
  | 'in-progress'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TransferDirection = 'upload' | 'download';

export interface TransferItem {
  id: string;
  connectionId: string;
  direction: TransferDirection;
  localPath: string;
  remotePath: string;
  fileName: string;
  size: number;
  transferred: number;
  status: TransferStatus;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

// ── IPC channel map (keeps preload and handlers in sync) ────────

export interface IPCChannels {
  // Connections
  'connections:getAll': () => ConnectionProfile[];
  'connections:getById': (id: string) => ConnectionProfile | null;
  'connections:save': (profile: ConnectionProfile) => ConnectionProfile;
  'connections:delete': (id: string) => boolean;

  // SFTP
  'sftp:connect': (config: SFTPConfig) => string;
  'sftp:disconnect': (connId: string) => void;
  'sftp:list': (connId: string, path: string) => FileEntry[];
  'sftp:upload': (connId: string, localPath: string, remotePath: string) => string;
  'sftp:download': (connId: string, remotePath: string, localPath: string) => string;
  'sftp:mkdir': (connId: string, path: string) => void;
  'sftp:rename': (connId: string, oldPath: string, newPath: string) => void;
  'sftp:delete': (connId: string, path: string) => void;
  'sftp:stat': (connId: string, path: string) => FileEntry;
  'sftp:uploadDir': (connId: string, localDir: string, remoteDir: string) => void;
  'sftp:downloadDir': (connId: string, remoteDir: string, localDir: string) => void;
  'sftp:deleteDir': (connId: string, dirPath: string) => void;
  'sftp:chmod': (connId: string, path: string, mode: number) => void;
  'sftp:resumeTransfer': (
    connId: string,
    direction: 'upload' | 'download',
    localPath: string,
    remotePath: string,
  ) => string;

  // FTP
  'ftp:connect': (config: FTPConfig) => string;
  'ftp:disconnect': (connId: string) => void;
  'ftp:list': (connId: string, path: string) => FileEntry[];
  'ftp:upload': (connId: string, localPath: string, remotePath: string) => string;
  'ftp:download': (connId: string, remotePath: string, localPath: string) => string;
  'ftp:mkdir': (connId: string, path: string) => void;
  'ftp:rename': (connId: string, oldPath: string, newPath: string) => void;
  'ftp:delete': (connId: string, path: string) => void;
  'ftp:uploadDir': (connId: string, localDir: string, remoteDir: string) => void;
  'ftp:downloadDir': (connId: string, remoteDir: string, localDir: string) => void;
  'ftp:deleteDir': (connId: string, dirPath: string) => void;
  'ftp:resumeTransfer': (
    connId: string,
    direction: 'upload' | 'download',
    localPath: string,
    remotePath: string,
  ) => string;

  // S3
  's3:connect': (config: S3Config) => string;
  's3:disconnect': (connId: string) => void;
  's3:list': (connId: string, path: string) => FileEntry[];
  's3:upload': (connId: string, localPath: string, remotePath: string) => string;
  's3:download': (connId: string, remotePath: string, localPath: string) => string;
  's3:mkdir': (connId: string, path: string) => void;
  's3:rename': (connId: string, oldKey: string, newKey: string) => void;
  's3:delete': (connId: string, key: string) => void;
  's3:uploadDir': (connId: string, localDir: string, remoteDir: string) => void;
  's3:downloadDir': (connId: string, remoteDir: string, localDir: string) => void;
  's3:deleteDir': (connId: string, dirPath: string) => void;

  // Transfer queue
  'transfer:getQueue': () => TransferItem[];
  'transfer:cancel': (transferId: string) => void;
  'transfer:retry': (transferId: string) => void;

  // Local filesystem
  'fs:listLocal': (dirPath: string) => FileEntry[];
  'fs:getHomeDir': () => string;

  // Bookmarks
  'bookmarks:getAll': () => BookmarkEntry[];
  'bookmarks:add': (bookmark: Omit<BookmarkEntry, 'id' | 'createdAt'>) => BookmarkEntry;
  'bookmarks:delete': (id: string) => boolean;

  // Search
  'sftp:search': (connId: string, basePath: string, pattern: string, recursive: boolean) => FileEntry[];
  's3:search': (connId: string, prefix: string, pattern: string) => FileEntry[];
  'ftp:search': (connId: string, basePath: string, pattern: string, recursive: boolean) => FileEntry[];

  // Remote file editing
  'app:editRemoteFile': (protocol: string, connId: string, remotePath: string) => string;
  'app:saveRemoteFile': (protocol: string, connId: string, remotePath: string, content: string) => void;

  // Log export
  'app:exportLogs': (content: string) => boolean;

  // App
  'app:getVersion': () => string;
  'app:getPlatform': () => string;
  'app:checkForUpdates': () => {
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion: string;
    downloadUrl: string;
  };
  'app:computeChecksum': (filePath: string, algorithm: string) => string;

  // Remote checksum
  'sftp:computeRemoteChecksum': (connId: string, remotePath: string, algorithm: string) => string;
}
