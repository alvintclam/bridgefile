import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // ── Connection profiles ────────────────────────────────────
  connections: {
    getAll: () => ipcRenderer.invoke('connections:getAll'),
    getById: (id: string) => ipcRenderer.invoke('connections:getById', id),
    save: (profile: any) => ipcRenderer.invoke('connections:save', profile),
    delete: (id: string) => ipcRenderer.invoke('connections:delete', id),
  },

  // ── SFTP ───────────────────────────────────────────────────
  sftp: {
    connect: (config: any) => ipcRenderer.invoke('sftp:connect', config),
    disconnect: (connId: string) => ipcRenderer.invoke('sftp:disconnect', connId),
    list: (connId: string, path: string) => ipcRenderer.invoke('sftp:list', connId, path),
    upload: (connId: string, localPath: string, remotePath: string) =>
      ipcRenderer.invoke('sftp:upload', connId, localPath, remotePath),
    download: (connId: string, remotePath: string, localPath: string) =>
      ipcRenderer.invoke('sftp:download', connId, remotePath, localPath),
    mkdir: (connId: string, path: string) => ipcRenderer.invoke('sftp:mkdir', connId, path),
    rename: (connId: string, oldPath: string, newPath: string) =>
      ipcRenderer.invoke('sftp:rename', connId, oldPath, newPath),
    delete: (connId: string, path: string) =>
      ipcRenderer.invoke('sftp:delete', connId, path),
    stat: (connId: string, path: string) => ipcRenderer.invoke('sftp:stat', connId, path),
    uploadDir: (connId: string, localDir: string, remoteDir: string) =>
      ipcRenderer.invoke('sftp:uploadDir', connId, localDir, remoteDir),
    downloadDir: (connId: string, remoteDir: string, localDir: string) =>
      ipcRenderer.invoke('sftp:downloadDir', connId, remoteDir, localDir),
    deleteDir: (connId: string, dirPath: string) =>
      ipcRenderer.invoke('sftp:deleteDir', connId, dirPath),
  },

  // ── FTP ──────────────────────────────────────────────────────
  ftp: {
    connect: (config: any) => ipcRenderer.invoke('ftp:connect', config),
    disconnect: (connId: string) => ipcRenderer.invoke('ftp:disconnect', connId),
    list: (connId: string, path: string) => ipcRenderer.invoke('ftp:list', connId, path),
    upload: (connId: string, localPath: string, remotePath: string) =>
      ipcRenderer.invoke('ftp:upload', connId, localPath, remotePath),
    download: (connId: string, remotePath: string, localPath: string) =>
      ipcRenderer.invoke('ftp:download', connId, remotePath, localPath),
    mkdir: (connId: string, path: string) => ipcRenderer.invoke('ftp:mkdir', connId, path),
    rename: (connId: string, oldPath: string, newPath: string) =>
      ipcRenderer.invoke('ftp:rename', connId, oldPath, newPath),
    delete: (connId: string, path: string) =>
      ipcRenderer.invoke('ftp:delete', connId, path),
    uploadDir: (connId: string, localDir: string, remoteDir: string) =>
      ipcRenderer.invoke('ftp:uploadDir', connId, localDir, remoteDir),
    downloadDir: (connId: string, remoteDir: string, localDir: string) =>
      ipcRenderer.invoke('ftp:downloadDir', connId, remoteDir, localDir),
    deleteDir: (connId: string, dirPath: string) =>
      ipcRenderer.invoke('ftp:deleteDir', connId, dirPath),
  },

  // ── S3 ─────────────────────────────────────────────────────
  s3: {
    connect: (config: any) => ipcRenderer.invoke('s3:connect', config),
    disconnect: (connId: string) => ipcRenderer.invoke('s3:disconnect', connId),
    list: (connId: string, path: string) => ipcRenderer.invoke('s3:list', connId, path),
    upload: (connId: string, localPath: string, remotePath: string) =>
      ipcRenderer.invoke('s3:upload', connId, localPath, remotePath),
    download: (connId: string, remotePath: string, localPath: string) =>
      ipcRenderer.invoke('s3:download', connId, remotePath, localPath),
    mkdir: (connId: string, path: string) => ipcRenderer.invoke('s3:mkdir', connId, path),
    rename: (connId: string, oldKey: string, newKey: string) =>
      ipcRenderer.invoke('s3:rename', connId, oldKey, newKey),
    delete: (connId: string, key: string) => ipcRenderer.invoke('s3:delete', connId, key),
    uploadDir: (connId: string, localDir: string, remoteDir: string) =>
      ipcRenderer.invoke('s3:uploadDir', connId, localDir, remoteDir),
    downloadDir: (connId: string, remoteDir: string, localDir: string) =>
      ipcRenderer.invoke('s3:downloadDir', connId, remoteDir, localDir),
    deleteDir: (connId: string, dirPath: string) =>
      ipcRenderer.invoke('s3:deleteDir', connId, dirPath),
  },

  // ── Transfer queue ─────────────────────────────────────────
  transfer: {
    getQueue: () => ipcRenderer.invoke('transfer:getQueue'),
    cancelTransfer: (transferId: string) =>
      ipcRenderer.invoke('transfer:cancel', transferId),
    retryTransfer: (transferId: string) =>
      ipcRenderer.invoke('transfer:retry', transferId),
  },

  // ── Local filesystem ───────────────────────────────────────
  fs: {
    listLocal: (dirPath: string) => ipcRenderer.invoke('fs:listLocal', dirPath),
    getHomeDir: () => ipcRenderer.invoke('fs:getHomeDir'),
  },

  // ── Bookmarks ──────────────────────────────────────────────
  bookmarks: {
    getAll: () => ipcRenderer.invoke('bookmarks:getAll'),
    add: (bookmark: any) => ipcRenderer.invoke('bookmarks:add', bookmark),
    delete: (id: string) => ipcRenderer.invoke('bookmarks:delete', id),
  },

  // ── App info ───────────────────────────────────────────────
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
  },
};

contextBridge.exposeInMainWorld('bridgefile', api);

// Type declaration for the renderer side
export type BridgeFileAPI = typeof api;
