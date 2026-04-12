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
    chmod: (connId: string, path: string, mode: number) =>
      ipcRenderer.invoke('sftp:chmod', connId, path, mode),
    resumeTransfer: (
      connId: string,
      direction: 'upload' | 'download',
      localPath: string,
      remotePath: string,
    ) => ipcRenderer.invoke('sftp:resumeTransfer', connId, direction, localPath, remotePath),
    search: (connId: string, basePath: string, pattern: string, recursive: boolean) =>
      ipcRenderer.invoke('sftp:search', connId, basePath, pattern, recursive),
    computeRemoteChecksum: (connId: string, remotePath: string, algorithm: string) =>
      ipcRenderer.invoke('sftp:computeRemoteChecksum', connId, remotePath, algorithm),
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
    stat: (connId: string, path: string) => ipcRenderer.invoke('ftp:stat', connId, path),
    uploadDir: (connId: string, localDir: string, remoteDir: string) =>
      ipcRenderer.invoke('ftp:uploadDir', connId, localDir, remoteDir),
    downloadDir: (connId: string, remoteDir: string, localDir: string) =>
      ipcRenderer.invoke('ftp:downloadDir', connId, remoteDir, localDir),
    deleteDir: (connId: string, dirPath: string) =>
      ipcRenderer.invoke('ftp:deleteDir', connId, dirPath),
    resumeTransfer: (
      connId: string,
      direction: 'upload' | 'download',
      localPath: string,
      remotePath: string,
    ) => ipcRenderer.invoke('ftp:resumeTransfer', connId, direction, localPath, remotePath),
    search: (connId: string, basePath: string, pattern: string, recursive: boolean) =>
      ipcRenderer.invoke('ftp:search', connId, basePath, pattern, recursive),
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
    stat: (connId: string, path: string) => ipcRenderer.invoke('s3:stat', connId, path),
    uploadDir: (connId: string, localDir: string, remoteDir: string) =>
      ipcRenderer.invoke('s3:uploadDir', connId, localDir, remoteDir),
    downloadDir: (connId: string, remoteDir: string, localDir: string) =>
      ipcRenderer.invoke('s3:downloadDir', connId, remoteDir, localDir),
    deleteDir: (connId: string, dirPath: string) =>
      ipcRenderer.invoke('s3:deleteDir', connId, dirPath),
    search: (connId: string, prefix: string, pattern: string) =>
      ipcRenderer.invoke('s3:search', connId, prefix, pattern),
  },

  // ── Transfer queue ─────────────────────────────────────────
  transfer: {
    getQueue: () => ipcRenderer.invoke('transfer:getQueue'),
    getState: () => ipcRenderer.invoke('transfer:getState'),
    cancelTransfer: (transferId: string) =>
      ipcRenderer.invoke('transfer:cancel', transferId),
    retryTransfer: (transferId: string) =>
      ipcRenderer.invoke('transfer:retry', transferId),
    setMaxConcurrent: (maxConcurrent: number) =>
      ipcRenderer.invoke('transfer:setMaxConcurrent', maxConcurrent),
    setPaused: (paused: boolean) =>
      ipcRenderer.invoke('transfer:setPaused', paused),
    setSpeedLimit: (speedLimitMbps: number | null) =>
      ipcRenderer.invoke('transfer:setSpeedLimit', speedLimitMbps),
    moveToTop: (transferId: string) =>
      ipcRenderer.invoke('transfer:moveToTop', transferId),
    clearFinished: () => ipcRenderer.invoke('transfer:clearFinished'),
  },

  // ── Local filesystem ───────────────────────────────────────
  fs: {
    listLocal: (dirPath: string) => ipcRenderer.invoke('fs:listLocal', dirPath),
    getHomeDir: () => ipcRenderer.invoke('fs:getHomeDir'),
    mkdir: (dirPath: string) => ipcRenderer.invoke('fs:mkdir', dirPath),
    rename: (oldPath: string, newPath: string) =>
      ipcRenderer.invoke('fs:rename', oldPath, newPath),
    delete: (targetPath: string) => ipcRenderer.invoke('fs:delete', targetPath),
    readTextFile: (filePath: string) => ipcRenderer.invoke('fs:readTextFile', filePath),
    writeTextFile: (filePath: string, content: string) =>
      ipcRenderer.invoke('fs:writeTextFile', filePath, content),
    stat: (targetPath: string) => ipcRenderer.invoke('fs:stat', targetPath),
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
    editRemoteFile: (protocol: string, connId: string, remotePath: string) =>
      ipcRenderer.invoke('app:editRemoteFile', protocol, connId, remotePath),
    saveRemoteFile: (protocol: string, connId: string, remotePath: string, content: string) =>
      ipcRenderer.invoke('app:saveRemoteFile', protocol, connId, remotePath, content),
    computeRemoteChecksum: (
      protocol: 'sftp' | 's3' | 'ftp',
      connId: string,
      remotePath: string,
      algorithm: string,
    ) => ipcRenderer.invoke('app:computeRemoteChecksum', protocol, connId, remotePath, algorithm),
    exportLogs: (content: string) => ipcRenderer.invoke('app:exportLogs', content),
    checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
    computeChecksum: (filePath: string, algorithm: string) =>
      ipcRenderer.invoke('app:computeChecksum', filePath, algorithm),
  },
};

contextBridge.exposeInMainWorld('bridgefile', api);

// Type declaration for the renderer side
export type BridgeFileAPI = typeof api;
