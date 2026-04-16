import type {
  ConnectionProfile,
  FileEntry,
  TransferItem,
  TransferQueueState,
  BookmarkEntry,
  SFTPConfig,
  FTPConfig,
  S3Config,
} from './types';

export interface BridgeFileAPI {
  connections: {
    getAll(): Promise<ConnectionProfile[]>;
    getById(id: string): Promise<ConnectionProfile | null>;
    save(profile: ConnectionProfile): Promise<ConnectionProfile>;
    delete(id: string): Promise<boolean>;
  };

  sftp: {
    connect(config: SFTPConfig): Promise<string>;
    disconnect(connId: string): Promise<void>;
    list(connId: string, path: string): Promise<FileEntry[]>;
    upload(connId: string, localPath: string, remotePath: string): Promise<string>;
    download(connId: string, remotePath: string, localPath: string): Promise<string>;
    mkdir(connId: string, path: string): Promise<void>;
    rename(connId: string, oldPath: string, newPath: string): Promise<void>;
    delete(connId: string, path: string): Promise<void>;
    stat(connId: string, path: string): Promise<FileEntry>;
    uploadDir(connId: string, localDir: string, remoteDir: string): Promise<string>;
    downloadDir(connId: string, remoteDir: string, localDir: string): Promise<string>;
    deleteDir(connId: string, dirPath: string): Promise<void>;
    chmod(connId: string, path: string, mode: number): Promise<void>;
    search(connId: string, basePath: string, pattern: string, recursive: boolean): Promise<FileEntry[]>;
    computeRemoteChecksum(connId: string, remotePath: string, algorithm: string): Promise<string>;
    resumeTransfer(connId: string, direction: 'upload' | 'download', localPath: string, remotePath: string): Promise<string>;
  };

  ftp: {
    connect(config: FTPConfig): Promise<string>;
    disconnect(connId: string): Promise<void>;
    list(connId: string, path: string): Promise<FileEntry[]>;
    upload(connId: string, localPath: string, remotePath: string): Promise<string>;
    download(connId: string, remotePath: string, localPath: string): Promise<string>;
    mkdir(connId: string, path: string): Promise<void>;
    rename(connId: string, oldPath: string, newPath: string): Promise<void>;
    delete(connId: string, path: string): Promise<void>;
    stat(connId: string, path: string): Promise<FileEntry>;
    uploadDir(connId: string, localDir: string, remoteDir: string): Promise<string>;
    downloadDir(connId: string, remoteDir: string, localDir: string): Promise<string>;
    deleteDir(connId: string, dirPath: string): Promise<void>;
    search(connId: string, basePath: string, pattern: string, recursive: boolean): Promise<FileEntry[]>;
    resumeTransfer(connId: string, direction: 'upload' | 'download', localPath: string, remotePath: string): Promise<string>;
  };

  s3: {
    connect(config: S3Config): Promise<string>;
    disconnect(connId: string): Promise<void>;
    list(connId: string, path: string): Promise<FileEntry[]>;
    upload(connId: string, localPath: string, remotePath: string): Promise<string>;
    download(connId: string, remotePath: string, localPath: string): Promise<string>;
    mkdir(connId: string, path: string): Promise<void>;
    rename(connId: string, oldKey: string, newKey: string): Promise<void>;
    delete(connId: string, key: string): Promise<void>;
    stat(connId: string, path: string): Promise<FileEntry>;
    uploadDir(connId: string, localDir: string, remoteDir: string): Promise<string>;
    downloadDir(connId: string, remoteDir: string, localDir: string): Promise<string>;
    deleteDir(connId: string, dirPath: string): Promise<void>;
    search(connId: string, prefix: string, pattern: string): Promise<FileEntry[]>;
  };

  transfer: {
    getQueue(): Promise<TransferItem[]>;
    getState(): Promise<TransferQueueState>;
    cancelTransfer(transferId: string): Promise<void>;
    retryTransfer(transferId: string): Promise<void>;
    setMaxConcurrent(maxConcurrent: number): Promise<number>;
    setPaused(paused: boolean): Promise<boolean>;
    setSpeedLimit(speedLimitMbps: number | null): Promise<number | null>;
    moveToTop(transferId: string): Promise<boolean>;
    clearFinished(): Promise<void>;
  };

  fs: {
    listLocal(dirPath: string, showHidden?: boolean): Promise<FileEntry[]>;
    getHomeDir(): Promise<string>;
    mkdir(dirPath: string): Promise<void>;
    rename(oldPath: string, newPath: string): Promise<void>;
    delete(targetPath: string): Promise<void>;
    readTextFile(filePath: string): Promise<string>;
    writeTextFile(filePath: string, content: string): Promise<void>;
    stat(targetPath: string): Promise<FileEntry>;
  };

  bookmarks: {
    getAll(): Promise<BookmarkEntry[]>;
    add(bookmark: Omit<BookmarkEntry, 'id' | 'createdAt'>): Promise<BookmarkEntry>;
    delete(id: string): Promise<boolean>;
  };

  history: {
    list(limit?: number): Promise<Array<{
      id: string;
      timestamp: number;
      protocol: 'sftp' | 's3' | 'ftp';
      direction: 'upload' | 'download';
      connectionId: string;
      connectionName?: string;
      localPath: string;
      remotePath: string;
      fileName: string;
      size: number;
      entryType: 'file' | 'directory';
      status: 'completed' | 'failed' | 'cancelled';
      error?: string;
      durationMs?: number;
    }>>;
    clear(): Promise<boolean>;
  };

  app: {
    getVersion(): Promise<string>;
    getPlatform(): Promise<string>;
    generateSSHKey(options: { type?: 'ed25519' | 'rsa'; bits?: number; passphrase?: string; path?: string }): Promise<{
      privateKeyPath: string;
      publicKeyPath: string;
      publicKeyOpenSSH: string;
      privateKeyPEM: string;
    }>;
    editRemoteFile(protocol: string, connId: string, remotePath: string): Promise<string>;
    openInExternalEditor(protocol: string, connId: string, remotePath: string): Promise<{ tmpPath: string }>;
    onExternalEditorEvent(
      listener: (event: 'saved' | 'error', data: { remotePath: string; error?: string }) => void,
    ): () => void;
    saveRemoteFile(protocol: string, connId: string, remotePath: string, content: string): Promise<void>;
    computeRemoteChecksum(
      protocol: 'sftp' | 's3' | 'ftp',
      connId: string,
      remotePath: string,
      algorithm: string,
    ): Promise<string>;
    exportLogs(content: string): Promise<boolean>;
    checkForUpdates(): Promise<{ hasUpdate: boolean; latestVersion: string; downloadUrl: string; currentVersion: string }>;
    computeChecksum(filePath: string, algorithm: string): Promise<string>;
  };
}

declare global {
  interface Window {
    bridgefile: BridgeFileAPI;
  }
}
