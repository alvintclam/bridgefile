import type {
  ConnectionProfile,
  FileEntry,
  TransferItem,
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
    uploadDir(connId: string, localDir: string, remoteDir: string): Promise<void>;
    downloadDir(connId: string, remoteDir: string, localDir: string): Promise<void>;
    deleteDir(connId: string, dirPath: string): Promise<void>;
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
    uploadDir(connId: string, localDir: string, remoteDir: string): Promise<void>;
    downloadDir(connId: string, remoteDir: string, localDir: string): Promise<void>;
    deleteDir(connId: string, dirPath: string): Promise<void>;
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
    uploadDir(connId: string, localDir: string, remoteDir: string): Promise<void>;
    downloadDir(connId: string, remoteDir: string, localDir: string): Promise<void>;
    deleteDir(connId: string, dirPath: string): Promise<void>;
  };

  transfer: {
    getQueue(): Promise<TransferItem[]>;
    cancelTransfer(transferId: string): Promise<void>;
    retryTransfer(transferId: string): Promise<void>;
  };

  fs: {
    listLocal(dirPath: string): Promise<FileEntry[]>;
    getHomeDir(): Promise<string>;
  };

  bookmarks: {
    getAll(): Promise<BookmarkEntry[]>;
    add(bookmark: Omit<BookmarkEntry, 'id' | 'createdAt'>): Promise<BookmarkEntry>;
    delete(id: string): Promise<boolean>;
  };

  app: {
    getVersion(): Promise<string>;
    getPlatform(): Promise<string>;
  };
}

declare global {
  interface Window {
    bridgefile: BridgeFileAPI;
  }
}
