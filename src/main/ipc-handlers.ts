import { ipcMain, app, dialog, BrowserWindow } from 'electron';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import * as sftpClient from './protocols/sftp';
import * as ftpClient from './protocols/ftp';
import * as s3Client from './protocols/s3';
import { isAbortError } from './protocols/transfer-abort';
import { getTransferSpeedLimit, setTransferPaused, setTransferSpeedLimit } from './protocols/transfer-rate-limit';
import { canStartTransfer } from './protocols/transfer-scheduler';
import * as store from './store';
import { checkForUpdates } from './auto-updater';
import type { FileEntry, TransferItem, TransferQueueState } from '../shared/types';

// ── In-memory transfer queue ───────────────────────────────────

const transferQueue: TransferItem[] = [];
const runningTransferIds = new Set<string>();
const activeTransferControllers = new Map<string, AbortController>();
const transferSettings = {
  maxConcurrent: 2,
  paused: false,
  speedLimitMbps: getTransferSpeedLimit(),
};

function trimCompletedTransfers(): void {
  const completed = transferQueue.filter(
    (t) =>
      (t.status === 'completed' || t.status === 'cancelled') &&
      !runningTransferIds.has(t.id),
  );
  if (completed.length > 200) {
    const toRemove = completed.slice(0, completed.length - 200);
    for (const t of toRemove) {
      const idx = transferQueue.indexOf(t);
      if (idx >= 0) transferQueue.splice(idx, 1);
    }
  }
}

function addTransfer(item: TransferItem): void {
  transferQueue.push(item);
  trimCompletedTransfers();
  scheduleTransfers();
}

function startTransfer(transfer: TransferItem): void {
  if (runningTransferIds.has(transfer.id)) return;

  runningTransferIds.add(transfer.id);
  const controller = new AbortController();
  activeTransferControllers.set(transfer.id, controller);
  transfer.status = 'in-progress';
  transfer.error = undefined;
  transfer.startedAt = Date.now();
  transfer.completedAt = undefined;

  let task: Promise<void>;
  if (transfer.entryType === 'directory') {
    const onDirectoryProgress = (file: string, fileIndex: number, totalFiles: number) => {
      if (transfer.status === 'cancelled') return;
      transfer.currentFile = path.basename(file);
      transfer.transferred = fileIndex;
      transfer.size = totalFiles;
    };

    switch (transfer.protocol) {
      case 'sftp':
        task = transfer.direction === 'upload'
          ? sftpClient.uploadDir(transfer.connectionId, transfer.localPath, transfer.remotePath, onDirectoryProgress, controller.signal)
          : sftpClient.downloadDir(transfer.connectionId, transfer.remotePath, transfer.localPath, onDirectoryProgress, controller.signal);
        break;
      case 'ftp':
        task = transfer.direction === 'upload'
          ? ftpClient.uploadDir(transfer.connectionId, transfer.localPath, transfer.remotePath, onDirectoryProgress, controller.signal)
          : ftpClient.downloadDir(transfer.connectionId, transfer.remotePath, transfer.localPath, onDirectoryProgress, controller.signal);
        break;
      case 's3':
        task = transfer.direction === 'upload'
          ? s3Client.uploadDir(transfer.connectionId, transfer.localPath, transfer.remotePath, onDirectoryProgress, controller.signal)
          : s3Client.downloadDir(transfer.connectionId, transfer.remotePath, transfer.localPath, onDirectoryProgress, controller.signal);
        break;
      default:
        throw new Error(`Unsupported protocol: ${transfer.protocol}`);
    }
  } else {
    const onProgress = (transferred: number, total: number) => {
      if (transfer.status === 'cancelled') return;
      transfer.transferred = transferred;
      transfer.size = total;
    };

    switch (transfer.protocol) {
      case 'sftp':
        task = transfer.direction === 'upload'
          ? sftpClient.upload(transfer.connectionId, transfer.localPath, transfer.remotePath, onProgress, controller.signal)
          : sftpClient.download(transfer.connectionId, transfer.remotePath, transfer.localPath, onProgress, controller.signal);
        break;
      case 'ftp':
        task = transfer.direction === 'upload'
          ? ftpClient.upload(transfer.connectionId, transfer.localPath, transfer.remotePath, onProgress, controller.signal)
          : ftpClient.download(transfer.connectionId, transfer.remotePath, transfer.localPath, onProgress, controller.signal);
        break;
      case 's3':
        task = transfer.direction === 'upload'
          ? s3Client.upload(transfer.connectionId, transfer.localPath, transfer.remotePath, onProgress, controller.signal)
          : s3Client.download(transfer.connectionId, transfer.remotePath, transfer.localPath, onProgress, controller.signal);
        break;
      default:
        throw new Error(`Unsupported protocol: ${transfer.protocol}`);
    }
  }

  task
    .then(() => {
      if (transfer.status === 'cancelled') return;
      transfer.status = 'completed';
      transfer.transferred = transfer.size;
      transfer.currentFile = undefined;
      transfer.completedAt = Date.now();
    })
    .catch((err: Error) => {
      if (isAbortError(err)) {
        transfer.status = 'cancelled';
        transfer.completedAt = transfer.completedAt ?? Date.now();
        transfer.error = undefined;
        return;
      }
      if (transfer.status === 'cancelled') return;
      transfer.status = 'failed';
      transfer.error = err.message;
    })
    .finally(() => {
      runningTransferIds.delete(transfer.id);
      activeTransferControllers.delete(transfer.id);
      trimCompletedTransfers();
      scheduleTransfers();
    });
}

function scheduleTransfers(): void {
  if (transferSettings.paused) return;

  let availableSlots = transferSettings.maxConcurrent - runningTransferIds.size;
  if (availableSlots <= 0) return;

  for (const item of transferQueue) {
    if (availableSlots <= 0) break;
    if (!canStartTransfer(item, transferQueue, runningTransferIds)) continue;
    startTransfer(item);
    availableSlots -= 1;
  }
}

function getTransferState(): TransferQueueState {
  return {
    items: [...transferQueue],
    maxConcurrent: transferSettings.maxConcurrent,
    paused: transferSettings.paused,
    speedLimitMbps: transferSettings.speedLimitMbps,
  };
}

function toLocalFileEntry(targetPath: string): FileEntry {
  const stat = fs.statSync(targetPath);
  return {
    name: path.basename(targetPath),
    path: targetPath,
    size: stat.size,
    modifiedAt: stat.mtimeMs,
    isDirectory: stat.isDirectory(),
  };
}

function normalizeLocalPath(targetPath: string): string {
  if (targetPath.startsWith('file://')) {
    try {
      return fileURLToPath(targetPath);
    } catch {
      return targetPath;
    }
  }

  return path.normalize(targetPath);
}

function isEnoentError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function statLocalEntry(targetPath: string, retries = 2): Promise<FileEntry> {
  const normalizedPath = normalizeLocalPath(targetPath);

  for (let attempt = 0; ; attempt += 1) {
    try {
      return toLocalFileEntry(normalizedPath);
    } catch (error) {
      if (!isEnoentError(error) || attempt >= retries) {
        throw error;
      }
      await sleep(40 * (attempt + 1));
    }
  }
}

async function downloadRemoteToTemp(
  protocol: 'sftp' | 's3' | 'ftp',
  connId: string,
  remotePath: string,
  tmpPath: string,
): Promise<void> {
  if (protocol === 'sftp') {
    await sftpClient.download(connId, remotePath, tmpPath);
  } else if (protocol === 'ftp') {
    await ftpClient.download(connId, remotePath, tmpPath);
  } else {
    await s3Client.download(connId, remotePath, tmpPath);
  }
}

async function computeRemoteChecksum(
  protocol: 'sftp' | 's3' | 'ftp',
  connId: string,
  remotePath: string,
  algorithm: string,
): Promise<string> {
  const tmpDir = path.join(app.getPath('temp'), 'bridgefile-checksum');
  fs.mkdirSync(tmpDir, { recursive: true });

  const fileName = path.basename(remotePath);
  const tmpPath = path.join(tmpDir, `${Date.now()}-${fileName}`);

  await downloadRemoteToTemp(protocol, connId, remotePath, tmpPath);

  try {
    const hash = crypto.createHash(algorithm);
    const data = fs.readFileSync(tmpPath);
    hash.update(data);
    return hash.digest('hex');
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

// ── Register all IPC handlers ──────────────────────────────────

export function registerIPCHandlers(): void {
  // ── Connection profiles ────────────────────────────────────

  ipcMain.handle('connections:getAll', async () => {
    return store.getAllProfiles();
  });

  ipcMain.handle('connections:getById', async (_event, id: string) => {
    return store.getProfileById(id);
  });

  ipcMain.handle('connections:save', async (_event, profile) => {
    return store.saveProfile(profile);
  });

  ipcMain.handle('connections:delete', async (_event, id: string) => {
    return store.deleteProfile(id);
  });

  // ── SFTP ───────────────────────────────────────────────────

  ipcMain.handle('sftp:connect', async (_event, config) => {
    return sftpClient.connect(config);
  });

  ipcMain.handle('sftp:disconnect', async (_event, connId: string) => {
    return sftpClient.disconnect(connId);
  });

  ipcMain.handle('sftp:list', async (_event, connId: string, dirPath: string) => {
    return sftpClient.list(connId, dirPath);
  });

  ipcMain.handle(
    'sftp:upload',
    async (_event, connId: string, localPath: string, remotePath: string) => {
      const id = crypto.randomUUID();
      const fileName = path.basename(localPath);
      const stat = fs.statSync(localPath);

      const transfer: TransferItem = {
        id,
        protocol: 'sftp',
        connectionId: connId,
        entryType: 'file',
        direction: 'upload',
        localPath,
        remotePath,
        fileName,
        size: stat.size,
        transferred: 0,
        status: 'queued',
      };
      addTransfer(transfer);

      return id;
    },
  );

  ipcMain.handle(
    'sftp:download',
    async (_event, connId: string, remotePath: string, localPath: string) => {
      const id = crypto.randomUUID();
      const fileName = path.basename(remotePath);

      const transfer: TransferItem = {
        id,
        protocol: 'sftp',
        connectionId: connId,
        entryType: 'file',
        direction: 'download',
        localPath,
        remotePath,
        fileName,
        size: 0,
        transferred: 0,
        status: 'queued',
      };
      addTransfer(transfer);

      return id;
    },
  );

  ipcMain.handle('sftp:mkdir', async (_event, connId: string, dirPath: string) => {
    return sftpClient.mkdir(connId, dirPath);
  });

  ipcMain.handle(
    'sftp:rename',
    async (_event, connId: string, oldPath: string, newPath: string) => {
      return sftpClient.rename(connId, oldPath, newPath);
    },
  );

  ipcMain.handle('sftp:delete', async (_event, connId: string, targetPath: string) => {
    return sftpClient.del(connId, targetPath);
  });

  ipcMain.handle('sftp:stat', async (_event, connId: string, targetPath: string) => {
    return sftpClient.stat(connId, targetPath);
  });

  ipcMain.handle(
    'sftp:uploadDir',
    async (_event, connId: string, localDir: string, remoteDir: string) => {
      const id = crypto.randomUUID();
      const transfer: TransferItem = {
        id,
        protocol: 'sftp',
        connectionId: connId,
        entryType: 'directory',
        direction: 'upload',
        localPath: localDir,
        remotePath: remoteDir,
        fileName: path.basename(localDir) || localDir,
        size: 0,
        transferred: 0,
        status: 'queued',
      };
      addTransfer(transfer);
      return id;
    },
  );

  ipcMain.handle(
    'sftp:downloadDir',
    async (_event, connId: string, remoteDir: string, localDir: string) => {
      const id = crypto.randomUUID();
      const transfer: TransferItem = {
        id,
        protocol: 'sftp',
        connectionId: connId,
        entryType: 'directory',
        direction: 'download',
        localPath: localDir,
        remotePath: remoteDir,
        fileName: path.posix.basename(remoteDir) || remoteDir,
        size: 0,
        transferred: 0,
        status: 'queued',
      };
      addTransfer(transfer);
      return id;
    },
  );

  ipcMain.handle(
    'sftp:deleteDir',
    async (_event, connId: string, dirPath: string) => {
      return sftpClient.deleteDir(connId, dirPath);
    },
  );

  ipcMain.handle(
    'sftp:chmod',
    async (_event, connId: string, targetPath: string, mode: number) => {
      return sftpClient.chmod(connId, targetPath, mode);
    },
  );

  ipcMain.handle(
    'sftp:resumeTransfer',
    async (
      _event,
      connId: string,
      direction: 'upload' | 'download',
      localPath: string,
      remotePath: string,
    ) => {
      const id = crypto.randomUUID();
      const fileName = path.basename(direction === 'upload' ? localPath : remotePath);

      let size = 0;
      try {
        if (direction === 'upload') {
          size = fs.statSync(localPath).size;
        }
      } catch { /* will be resolved during transfer */ }

      const transfer: TransferItem = {
        id,
        protocol: 'sftp',
        connectionId: connId,
        entryType: 'file',
        direction,
        localPath,
        remotePath,
        fileName,
        size,
        transferred: 0,
        status: 'in-progress',
        startedAt: Date.now(),
      };
      addTransfer(transfer);
      runningTransferIds.add(transfer.id);
      const controller = new AbortController();
      activeTransferControllers.set(transfer.id, controller);
      sftpClient
        .resumeTransfer(connId, direction, localPath, remotePath, (transferred, total) => {
          if (transfer.status === 'cancelled') return;
          transfer.transferred = transferred;
          transfer.size = total;
        }, controller.signal)
        .then(() => {
          if (transfer.status === 'cancelled') return;
          transfer.status = 'completed';
          transfer.completedAt = Date.now();
        })
        .catch((err) => {
          if (isAbortError(err)) {
            transfer.status = 'cancelled';
            transfer.completedAt = transfer.completedAt ?? Date.now();
            transfer.error = undefined;
            return;
          }
          if (transfer.status === 'cancelled') return;
          transfer.status = 'failed';
          transfer.error = err.message;
        })
        .finally(() => {
          runningTransferIds.delete(transfer.id);
          activeTransferControllers.delete(transfer.id);
          trimCompletedTransfers();
          scheduleTransfers();
        });

      return id;
    },
  );

  // ── FTP ──────────────────────────────────────────────────────

  ipcMain.handle('ftp:connect', async (_event, config) => {
    return ftpClient.connect(config);
  });

  ipcMain.handle('ftp:disconnect', async (_event, connId: string) => {
    return ftpClient.disconnect(connId);
  });

  ipcMain.handle('ftp:list', async (_event, connId: string, dirPath: string) => {
    return ftpClient.list(connId, dirPath);
  });

  ipcMain.handle(
    'ftp:upload',
    async (_event, connId: string, localPath: string, remotePath: string) => {
      const id = crypto.randomUUID();
      const fileName = path.basename(localPath);
      const stat = fs.statSync(localPath);

      const transfer: TransferItem = {
        id,
        protocol: 'ftp',
        connectionId: connId,
        entryType: 'file',
        direction: 'upload',
        localPath,
        remotePath,
        fileName,
        size: stat.size,
        transferred: 0,
        status: 'queued',
      };
      addTransfer(transfer);

      return id;
    },
  );

  ipcMain.handle(
    'ftp:download',
    async (_event, connId: string, remotePath: string, localPath: string) => {
      const id = crypto.randomUUID();
      const fileName = path.basename(remotePath);

      const transfer: TransferItem = {
        id,
        protocol: 'ftp',
        connectionId: connId,
        entryType: 'file',
        direction: 'download',
        localPath,
        remotePath,
        fileName,
        size: 0,
        transferred: 0,
        status: 'queued',
      };
      addTransfer(transfer);

      return id;
    },
  );

  ipcMain.handle('ftp:mkdir', async (_event, connId: string, dirPath: string) => {
    return ftpClient.mkdir(connId, dirPath);
  });

  ipcMain.handle(
    'ftp:rename',
    async (_event, connId: string, oldPath: string, newPath: string) => {
      return ftpClient.rename(connId, oldPath, newPath);
    },
  );

  ipcMain.handle('ftp:delete', async (_event, connId: string, targetPath: string) => {
    return ftpClient.del(connId, targetPath);
  });

  ipcMain.handle('ftp:stat', async (_event, connId: string, targetPath: string) => {
    return ftpClient.stat(connId, targetPath);
  });

  ipcMain.handle(
    'ftp:uploadDir',
    async (_event, connId: string, localDir: string, remoteDir: string) => {
      const id = crypto.randomUUID();
      const transfer: TransferItem = {
        id,
        protocol: 'ftp',
        connectionId: connId,
        entryType: 'directory',
        direction: 'upload',
        localPath: localDir,
        remotePath: remoteDir,
        fileName: path.basename(localDir) || localDir,
        size: 0,
        transferred: 0,
        status: 'queued',
      };
      addTransfer(transfer);
      return id;
    },
  );

  ipcMain.handle(
    'ftp:downloadDir',
    async (_event, connId: string, remoteDir: string, localDir: string) => {
      const id = crypto.randomUUID();
      const transfer: TransferItem = {
        id,
        protocol: 'ftp',
        connectionId: connId,
        entryType: 'directory',
        direction: 'download',
        localPath: localDir,
        remotePath: remoteDir,
        fileName: path.posix.basename(remoteDir) || remoteDir,
        size: 0,
        transferred: 0,
        status: 'queued',
      };
      addTransfer(transfer);
      return id;
    },
  );

  ipcMain.handle(
    'ftp:deleteDir',
    async (_event, connId: string, dirPath: string) => {
      return ftpClient.deleteDir(connId, dirPath);
    },
  );

  ipcMain.handle(
    'ftp:resumeTransfer',
    async (
      _event,
      connId: string,
      direction: 'upload' | 'download',
      localPath: string,
      remotePath: string,
    ) => {
      const id = crypto.randomUUID();
      const fileName = path.basename(direction === 'upload' ? localPath : remotePath);

      let size = 0;
      try {
        if (direction === 'upload') {
          size = fs.statSync(localPath).size;
        }
      } catch { /* will be resolved during transfer */ }

      const transfer: TransferItem = {
        id,
        protocol: 'ftp',
        connectionId: connId,
        entryType: 'file',
        direction,
        localPath,
        remotePath,
        fileName,
        size,
        transferred: 0,
        status: 'in-progress',
        startedAt: Date.now(),
      };
      addTransfer(transfer);
      runningTransferIds.add(transfer.id);
      const controller = new AbortController();
      activeTransferControllers.set(transfer.id, controller);
      ftpClient
        .resumeTransfer(connId, direction, localPath, remotePath, (transferred, total) => {
          if (transfer.status === 'cancelled') return;
          transfer.transferred = transferred;
          transfer.size = total;
        }, controller.signal)
        .then(() => {
          if (transfer.status === 'cancelled') return;
          transfer.status = 'completed';
          transfer.completedAt = Date.now();
        })
        .catch((err) => {
          if (isAbortError(err)) {
            transfer.status = 'cancelled';
            transfer.completedAt = transfer.completedAt ?? Date.now();
            transfer.error = undefined;
            return;
          }
          if (transfer.status === 'cancelled') return;
          transfer.status = 'failed';
          transfer.error = err.message;
        })
        .finally(() => {
          runningTransferIds.delete(transfer.id);
          activeTransferControllers.delete(transfer.id);
          trimCompletedTransfers();
          scheduleTransfers();
        });

      return id;
    },
  );

  // ── S3 ─────────────────────────────────────────────────────

  ipcMain.handle('s3:connect', async (_event, config) => {
    return s3Client.connect(config);
  });

  ipcMain.handle('s3:disconnect', async (_event, connId: string) => {
    return s3Client.disconnect(connId);
  });

  ipcMain.handle('s3:list', async (_event, connId: string, dirPath: string) => {
    return s3Client.list(connId, dirPath);
  });

  ipcMain.handle(
    's3:upload',
    async (_event, connId: string, localPath: string, remotePath: string) => {
      const id = crypto.randomUUID();
      const fileName = path.basename(localPath);
      const stat = fs.statSync(localPath);

      const transfer: TransferItem = {
        id,
        protocol: 's3',
        connectionId: connId,
        entryType: 'file',
        direction: 'upload',
        localPath,
        remotePath,
        fileName,
        size: stat.size,
        transferred: 0,
        status: 'queued',
      };
      addTransfer(transfer);

      return id;
    },
  );

  ipcMain.handle(
    's3:download',
    async (_event, connId: string, remotePath: string, localPath: string) => {
      const id = crypto.randomUUID();
      const fileName = path.basename(remotePath);

      const transfer: TransferItem = {
        id,
        protocol: 's3',
        connectionId: connId,
        entryType: 'file',
        direction: 'download',
        localPath,
        remotePath,
        fileName,
        size: 0,
        transferred: 0,
        status: 'queued',
      };
      addTransfer(transfer);

      return id;
    },
  );

  ipcMain.handle('s3:mkdir', async (_event, connId: string, dirPath: string) => {
    return s3Client.mkdir(connId, dirPath);
  });

  ipcMain.handle(
    's3:rename',
    async (_event, connId: string, oldKey: string, newKey: string) => {
      return s3Client.rename(connId, oldKey, newKey);
    },
  );

  ipcMain.handle('s3:delete', async (_event, connId: string, key: string) => {
    return s3Client.del(connId, key);
  });

  ipcMain.handle('s3:stat', async (_event, connId: string, targetPath: string) => {
    return s3Client.stat(connId, targetPath);
  });

  ipcMain.handle(
    's3:uploadDir',
    async (_event, connId: string, localDir: string, remoteDir: string) => {
      const id = crypto.randomUUID();
      const transfer: TransferItem = {
        id,
        protocol: 's3',
        connectionId: connId,
        entryType: 'directory',
        direction: 'upload',
        localPath: localDir,
        remotePath: remoteDir,
        fileName: path.basename(localDir) || localDir,
        size: 0,
        transferred: 0,
        status: 'queued',
      };
      addTransfer(transfer);
      return id;
    },
  );

  ipcMain.handle(
    's3:downloadDir',
    async (_event, connId: string, remoteDir: string, localDir: string) => {
      const id = crypto.randomUUID();
      const transfer: TransferItem = {
        id,
        protocol: 's3',
        connectionId: connId,
        entryType: 'directory',
        direction: 'download',
        localPath: localDir,
        remotePath: remoteDir,
        fileName: path.posix.basename(remoteDir) || remoteDir,
        size: 0,
        transferred: 0,
        status: 'queued',
      };
      addTransfer(transfer);
      return id;
    },
  );

  ipcMain.handle(
    's3:deleteDir',
    async (_event, connId: string, dirPath: string) => {
      return s3Client.deleteDir(connId, dirPath);
    },
  );

  // ── Transfer queue ─────────────────────────────────────────

  ipcMain.handle('transfer:getQueue', async () => {
    return [...transferQueue];
  });

  ipcMain.handle('transfer:getState', async () => {
    return getTransferState();
  });

  ipcMain.handle('transfer:cancel', async (_event, transferId: string) => {
    const t = transferQueue.find((item) => item.id === transferId);
    if (t && (t.status === 'queued' || t.status === 'in-progress')) {
      t.status = 'cancelled';
      t.completedAt = Date.now();
      activeTransferControllers.get(transferId)?.abort();
      trimCompletedTransfers();
      scheduleTransfers();
    }
  });

  ipcMain.handle('transfer:retry', async (_event, transferId: string) => {
    const t = transferQueue.find((item) => item.id === transferId);
    if (t && t.status === 'failed') {
      t.status = 'queued';
      t.error = undefined;
      t.transferred = 0;
      t.startedAt = undefined;
      t.completedAt = undefined;
      scheduleTransfers();
    }
  });

  ipcMain.handle('transfer:setMaxConcurrent', async (_event, maxConcurrent: number) => {
    const nextValue = Math.max(1, Math.min(64, Math.floor(maxConcurrent)));
    transferSettings.maxConcurrent = nextValue;
    scheduleTransfers();
    return transferSettings.maxConcurrent;
  });

  ipcMain.handle('transfer:setPaused', async (_event, paused: boolean) => {
    transferSettings.paused = setTransferPaused(paused);
    if (!paused) {
      scheduleTransfers();
    }
    return transferSettings.paused;
  });

  ipcMain.handle('transfer:setSpeedLimit', async (_event, speedLimitMbps: number | null) => {
    const nextValue =
      typeof speedLimitMbps === 'number' && Number.isFinite(speedLimitMbps)
        ? Math.max(0.1, Math.min(1000, speedLimitMbps))
        : null;
    transferSettings.speedLimitMbps = setTransferSpeedLimit(nextValue);
    return transferSettings.speedLimitMbps;
  });

  ipcMain.handle('transfer:moveToTop', async (_event, transferId: string) => {
    const currentIndex = transferQueue.findIndex((item) => item.id === transferId);
    if (currentIndex === -1) return false;

    const [item] = transferQueue.splice(currentIndex, 1);
    const insertionIndex = transferQueue.findIndex((candidate) => candidate.status === 'queued');
    if (insertionIndex === -1) {
      transferQueue.push(item);
    } else {
      transferQueue.splice(insertionIndex, 0, item);
    }
    scheduleTransfers();
    return true;
  });

  ipcMain.handle('transfer:clearFinished', async () => {
    for (let i = transferQueue.length - 1; i >= 0; i -= 1) {
      const item = transferQueue[i];
      if (
        (item.status === 'completed' || item.status === 'cancelled') &&
        !runningTransferIds.has(item.id)
      ) {
        transferQueue.splice(i, 1);
      }
    }
  });

  // ── Local filesystem ───────────────────────────────────────

  ipcMain.handle('fs:listLocal', async (_event, dirPath: string) => {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const result: FileEntry[] = [];

    for (const entry of entries) {
      // Skip hidden files on Unix
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(dirPath, entry.name);
      try {
        result.push(toLocalFileEntry(fullPath));
      } catch {
        // Skip files we can't stat (permission errors, etc.)
      }
    }

    // Directories first, then alphabetical
    result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return result;
  });

  ipcMain.handle('fs:getHomeDir', async () => {
    return os.homedir();
  });

  ipcMain.handle('fs:mkdir', async (_event, dirPath: string) => {
    fs.mkdirSync(dirPath, { recursive: true });
  });

  ipcMain.handle('fs:rename', async (_event, oldPath: string, newPath: string) => {
    fs.renameSync(oldPath, newPath);
  });

  ipcMain.handle('fs:delete', async (_event, targetPath: string) => {
    fs.rmSync(targetPath, { recursive: true, force: false });
  });

  ipcMain.handle('fs:readTextFile', async (_event, filePath: string) => {
    return fs.readFileSync(filePath, 'utf-8');
  });

  ipcMain.handle('fs:writeTextFile', async (_event, filePath: string, content: string) => {
    fs.writeFileSync(filePath, content, 'utf-8');
  });

  ipcMain.handle('fs:stat', async (_event, targetPath: string) => {
    return statLocalEntry(targetPath);
  });

  // ── Bookmarks ─────────────────────────────────────────────

  ipcMain.handle('bookmarks:getAll', async () => {
    return store.getAllBookmarks();
  });

  ipcMain.handle('bookmarks:add', async (_event, bookmark) => {
    return store.addBookmark(bookmark);
  });

  ipcMain.handle('bookmarks:delete', async (_event, id: string) => {
    return store.deleteBookmark(id);
  });

  // ── App info ───────────────────────────────────────────────

  ipcMain.handle('app:getVersion', async () => {
    return app.getVersion();
  });

  ipcMain.handle('app:getPlatform', async () => {
    return process.platform;
  });

  // ── Search ──────────────────────────────────────────────────

  ipcMain.handle(
    'sftp:search',
    async (_event, connId: string, basePath: string, pattern: string, recursive: boolean) => {
      return sftpClient.search(connId, basePath, pattern, recursive);
    },
  );

  ipcMain.handle(
    's3:search',
    async (_event, connId: string, prefix: string, pattern: string) => {
      return s3Client.search(connId, prefix, pattern);
    },
  );

  ipcMain.handle(
    'ftp:search',
    async (_event, connId: string, basePath: string, pattern: string, recursive: boolean) => {
      return ftpClient.search(connId, basePath, pattern, recursive);
    },
  );

  // ── Remote file editing ───────────────────────────────────

  ipcMain.handle(
    'app:editRemoteFile',
    async (_event, protocol: string, connId: string, remotePath: string) => {
      const tmpDir = path.join(app.getPath('temp'), 'bridgefile-edit');
      fs.mkdirSync(tmpDir, { recursive: true });

      const fileName = path.basename(remotePath);
      const tmpPath = path.join(tmpDir, `${Date.now()}-${fileName}`);

      await downloadRemoteToTemp(protocol as 'sftp' | 's3' | 'ftp', connId, remotePath, tmpPath);

      return tmpPath;
    },
  );

  ipcMain.handle(
    'app:saveRemoteFile',
    async (_event, protocol: string, connId: string, remotePath: string, content: string) => {
      const tmpDir = path.join(app.getPath('temp'), 'bridgefile-edit');
      fs.mkdirSync(tmpDir, { recursive: true });

      const fileName = path.basename(remotePath);
      const tmpPath = path.join(tmpDir, `${Date.now()}-${fileName}`);
      fs.writeFileSync(tmpPath, content, 'utf-8');

      if (protocol === 'sftp') {
        await sftpClient.upload(connId, tmpPath, remotePath);
      } else if (protocol === 'ftp') {
        await ftpClient.upload(connId, tmpPath, remotePath);
      } else if (protocol === 's3') {
        await s3Client.upload(connId, tmpPath, remotePath);
      }

      // Clean up temp file
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    },
  );

  // ── Auto-update check ──────────────────────────────────────

  ipcMain.handle('app:checkForUpdates', async () => {
    try {
      return await checkForUpdates();
    } catch {
      return {
        hasUpdate: false,
        currentVersion: app.getVersion(),
        latestVersion: app.getVersion(),
        downloadUrl: '',
      };
    }
  });

  // ── Checksum computation ──────────────────────────────────

  ipcMain.handle(
    'app:computeChecksum',
    async (_event, filePath: string, algorithm: string) => {
      return new Promise<string>((resolve, reject) => {
        const hash = crypto.createHash(algorithm);
        const stream = fs.createReadStream(filePath);

        stream.on('data', (chunk: Buffer) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', (err: Error) =>
          reject(new Error(`Checksum failed: ${err.message}`)),
        );
      });
    },
  );

  ipcMain.handle(
    'app:computeRemoteChecksum',
    async (_event, protocol: 'sftp' | 's3' | 'ftp', connId: string, remotePath: string, algorithm: string) => {
      return computeRemoteChecksum(protocol, connId, remotePath, algorithm);
    },
  );

  ipcMain.handle(
    'sftp:computeRemoteChecksum',
    async (_event, connId: string, remotePath: string, algorithm: string) => {
      return computeRemoteChecksum('sftp', connId, remotePath, algorithm);
    },
  );

  // ── Log export ────────────────────────────────────────────

  ipcMain.handle('app:exportLogs', async (_event, content: string) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return false;

    const result = await dialog.showSaveDialog(win, {
      title: 'Export Logs',
      defaultPath: `bridgefile-logs-${new Date().toISOString().slice(0, 10)}.txt`,
      filters: [
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) return false;

    fs.writeFileSync(result.filePath, content, 'utf-8');
    return true;
  });
}
