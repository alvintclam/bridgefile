import { ipcMain, app, dialog, BrowserWindow } from 'electron';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as sftpClient from './protocols/sftp';
import * as ftpClient from './protocols/ftp';
import * as s3Client from './protocols/s3';
import * as store from './store';
import type { FileEntry, TransferItem } from '../shared/types';

// ── In-memory transfer queue ───────────────────────────────────

const transferQueue: TransferItem[] = [];

function addTransfer(item: TransferItem): void {
  transferQueue.push(item);
  // Keep queue bounded — remove completed items beyond 200
  const completed = transferQueue.filter(
    (t) => t.status === 'completed' || t.status === 'cancelled',
  );
  if (completed.length > 200) {
    const toRemove = completed.slice(0, completed.length - 200);
    for (const t of toRemove) {
      const idx = transferQueue.indexOf(t);
      if (idx >= 0) transferQueue.splice(idx, 1);
    }
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
        connectionId: connId,
        direction: 'upload',
        localPath,
        remotePath,
        fileName,
        size: stat.size,
        transferred: 0,
        status: 'in-progress',
        startedAt: Date.now(),
      };
      addTransfer(transfer);

      // Run upload async — don't block the IPC reply
      sftpClient
        .upload(connId, localPath, remotePath, (transferred, total) => {
          transfer.transferred = transferred;
          transfer.size = total;
        })
        .then(() => {
          transfer.status = 'completed';
          transfer.completedAt = Date.now();
        })
        .catch((err) => {
          transfer.status = 'failed';
          transfer.error = err.message;
        });

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
        connectionId: connId,
        direction: 'download',
        localPath,
        remotePath,
        fileName,
        size: 0,
        transferred: 0,
        status: 'in-progress',
        startedAt: Date.now(),
      };
      addTransfer(transfer);

      sftpClient
        .download(connId, remotePath, localPath, (transferred, total) => {
          transfer.transferred = transferred;
          transfer.size = total;
        })
        .then(() => {
          transfer.status = 'completed';
          transfer.completedAt = Date.now();
        })
        .catch((err) => {
          transfer.status = 'failed';
          transfer.error = err.message;
        });

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
      return sftpClient.uploadDir(connId, localDir, remoteDir);
    },
  );

  ipcMain.handle(
    'sftp:downloadDir',
    async (_event, connId: string, remoteDir: string, localDir: string) => {
      return sftpClient.downloadDir(connId, remoteDir, localDir);
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
        connectionId: connId,
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

      sftpClient
        .resumeTransfer(connId, direction, localPath, remotePath, (transferred, total) => {
          transfer.transferred = transferred;
          transfer.size = total;
        })
        .then(() => {
          transfer.status = 'completed';
          transfer.completedAt = Date.now();
        })
        .catch((err) => {
          transfer.status = 'failed';
          transfer.error = err.message;
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
        connectionId: connId,
        direction: 'upload',
        localPath,
        remotePath,
        fileName,
        size: stat.size,
        transferred: 0,
        status: 'in-progress',
        startedAt: Date.now(),
      };
      addTransfer(transfer);

      ftpClient
        .upload(connId, localPath, remotePath, (transferred, total) => {
          transfer.transferred = transferred;
          transfer.size = total;
        })
        .then(() => {
          transfer.status = 'completed';
          transfer.completedAt = Date.now();
        })
        .catch((err) => {
          transfer.status = 'failed';
          transfer.error = err.message;
        });

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
        connectionId: connId,
        direction: 'download',
        localPath,
        remotePath,
        fileName,
        size: 0,
        transferred: 0,
        status: 'in-progress',
        startedAt: Date.now(),
      };
      addTransfer(transfer);

      ftpClient
        .download(connId, remotePath, localPath, (transferred, total) => {
          transfer.transferred = transferred;
          transfer.size = total;
        })
        .then(() => {
          transfer.status = 'completed';
          transfer.completedAt = Date.now();
        })
        .catch((err) => {
          transfer.status = 'failed';
          transfer.error = err.message;
        });

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

  ipcMain.handle(
    'ftp:uploadDir',
    async (_event, connId: string, localDir: string, remoteDir: string) => {
      return ftpClient.uploadDir(connId, localDir, remoteDir);
    },
  );

  ipcMain.handle(
    'ftp:downloadDir',
    async (_event, connId: string, remoteDir: string, localDir: string) => {
      return ftpClient.downloadDir(connId, remoteDir, localDir);
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
        connectionId: connId,
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

      ftpClient
        .resumeTransfer(connId, direction, localPath, remotePath, (transferred, total) => {
          transfer.transferred = transferred;
          transfer.size = total;
        })
        .then(() => {
          transfer.status = 'completed';
          transfer.completedAt = Date.now();
        })
        .catch((err) => {
          transfer.status = 'failed';
          transfer.error = err.message;
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
        connectionId: connId,
        direction: 'upload',
        localPath,
        remotePath,
        fileName,
        size: stat.size,
        transferred: 0,
        status: 'in-progress',
        startedAt: Date.now(),
      };
      addTransfer(transfer);

      s3Client
        .upload(connId, localPath, remotePath, (transferred, total) => {
          transfer.transferred = transferred;
          transfer.size = total;
        })
        .then(() => {
          transfer.status = 'completed';
          transfer.completedAt = Date.now();
        })
        .catch((err) => {
          transfer.status = 'failed';
          transfer.error = err.message;
        });

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
        connectionId: connId,
        direction: 'download',
        localPath,
        remotePath,
        fileName,
        size: 0,
        transferred: 0,
        status: 'in-progress',
        startedAt: Date.now(),
      };
      addTransfer(transfer);

      s3Client
        .download(connId, remotePath, localPath, (transferred, total) => {
          transfer.transferred = transferred;
          transfer.size = total;
        })
        .then(() => {
          transfer.status = 'completed';
          transfer.completedAt = Date.now();
        })
        .catch((err) => {
          transfer.status = 'failed';
          transfer.error = err.message;
        });

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

  ipcMain.handle(
    's3:uploadDir',
    async (_event, connId: string, localDir: string, remoteDir: string) => {
      return s3Client.uploadDir(connId, localDir, remoteDir);
    },
  );

  ipcMain.handle(
    's3:downloadDir',
    async (_event, connId: string, remoteDir: string, localDir: string) => {
      return s3Client.downloadDir(connId, remoteDir, localDir);
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

  ipcMain.handle('transfer:cancel', async (_event, transferId: string) => {
    const t = transferQueue.find((item) => item.id === transferId);
    if (t && (t.status === 'queued' || t.status === 'in-progress')) {
      t.status = 'cancelled';
    }
  });

  ipcMain.handle('transfer:retry', async (_event, transferId: string) => {
    const t = transferQueue.find((item) => item.id === transferId);
    if (t && t.status === 'failed') {
      t.status = 'queued';
      t.error = undefined;
      t.transferred = 0;
      // NOTE: actual retry logic would re-dispatch the transfer here.
      // For now we just reset the status so the UI can trigger a new transfer.
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
        const stat = fs.statSync(fullPath);
        result.push({
          name: entry.name,
          path: fullPath,
          size: stat.size,
          modifiedAt: stat.mtimeMs,
          isDirectory: stat.isDirectory(),
        });
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

      if (protocol === 'sftp') {
        await sftpClient.download(connId, remotePath, tmpPath);
      } else if (protocol === 'ftp') {
        await ftpClient.download(connId, remotePath, tmpPath);
      } else if (protocol === 's3') {
        await s3Client.download(connId, remotePath, tmpPath);
      }

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
