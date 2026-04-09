import { Client, SFTPWrapper } from 'ssh2';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import type { SFTPConfig, FileEntry } from '../../shared/types';

// ── Connection pool ────────────────────────────────────────────

interface PooledConnection {
  id: string;
  client: Client;
  sftp: SFTPWrapper;
  config: SFTPConfig;
  lastActivity: number;
}

const pool = new Map<string, PooledConnection>();

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Prune idle connections periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, conn] of pool) {
    if (now - conn.lastActivity > IDLE_TIMEOUT_MS) {
      conn.client.end();
      pool.delete(id);
    }
  }
}, 60_000);

function touch(connId: string): void {
  const conn = pool.get(connId);
  if (conn) conn.lastActivity = Date.now();
}

function getConn(connId: string): PooledConnection {
  const conn = pool.get(connId);
  if (!conn) throw new Error(`SFTP connection "${connId}" not found or expired`);
  touch(connId);
  return conn;
}

// ── Public API ─────────────────────────────────────────────────

export async function connect(config: SFTPConfig): Promise<string> {
  const id = crypto.randomUUID();

  return new Promise<string>((resolve, reject) => {
    const client = new Client();

    const connectConfig: Record<string, unknown> = {
      host: config.host,
      port: config.port ?? 22,
      username: config.username,
      readyTimeout: 15_000,
      keepaliveInterval: 10_000,
    };

    if (config.privateKey) {
      connectConfig.privateKey = config.privateKey;
      if (config.passphrase) connectConfig.passphrase = config.passphrase;
    } else if (config.password) {
      connectConfig.password = config.password;
    }

    client.on('ready', () => {
      client.sftp((err, sftp) => {
        if (err) {
          client.end();
          return reject(new Error(`SFTP subsystem failed: ${err.message}`));
        }

        pool.set(id, {
          id,
          client,
          sftp,
          config,
          lastActivity: Date.now(),
        });

        resolve(id);
      });
    });

    client.on('error', (err) => {
      pool.delete(id);
      reject(new Error(`SSH connection failed: ${err.message}`));
    });

    client.connect(connectConfig as any);
  });
}

export async function disconnect(connId: string): Promise<void> {
  const conn = pool.get(connId);
  if (conn) {
    conn.client.end();
    pool.delete(connId);
  }
}

export async function list(connId: string, dirPath: string): Promise<FileEntry[]> {
  const { sftp } = getConn(connId);

  return new Promise((resolve, reject) => {
    sftp.readdir(dirPath, (err, entries) => {
      if (err) return reject(new Error(`Failed to list "${dirPath}": ${err.message}`));

      const result: FileEntry[] = entries.map((entry) => {
        const isDir = (entry.attrs.mode & 0o40000) !== 0;
        return {
          name: entry.filename,
          path: path.posix.join(dirPath, entry.filename),
          size: entry.attrs.size,
          modifiedAt: entry.attrs.mtime * 1000,
          isDirectory: isDir,
          permissions: formatPermissions(entry.attrs.mode),
        };
      });

      // Directories first, then alphabetical
      result.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      resolve(result);
    });
  });
}

export async function upload(
  connId: string,
  localPath: string,
  remotePath: string,
  onProgress?: (transferred: number, total: number) => void,
): Promise<void> {
  const { sftp } = getConn(connId);
  const stat = fs.statSync(localPath);
  const total = stat.size;

  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(localPath);
    const writeStream = sftp.createWriteStream(remotePath);
    let transferred = 0;

    readStream.on('data', (chunk: Buffer) => {
      transferred += chunk.length;
      onProgress?.(transferred, total);
    });

    writeStream.on('close', () => resolve());
    writeStream.on('error', (err: Error) =>
      reject(new Error(`Upload failed: ${err.message}`)),
    );
    readStream.on('error', (err: Error) =>
      reject(new Error(`Read failed: ${err.message}`)),
    );

    readStream.pipe(writeStream);
  });
}

export async function download(
  connId: string,
  remotePath: string,
  localPath: string,
  onProgress?: (transferred: number, total: number) => void,
): Promise<void> {
  const { sftp } = getConn(connId);

  // Get remote file size first
  const remoteStat = await stat(connId, remotePath);
  const total = remoteStat.size;

  // Ensure local directory exists
  const dir = path.dirname(localPath);
  fs.mkdirSync(dir, { recursive: true });

  return new Promise((resolve, reject) => {
    const readStream = sftp.createReadStream(remotePath);
    const writeStream = fs.createWriteStream(localPath);
    let transferred = 0;

    readStream.on('data', (chunk: Buffer) => {
      transferred += chunk.length;
      onProgress?.(transferred, total);
    });

    writeStream.on('close', () => resolve());
    writeStream.on('error', (err: Error) =>
      reject(new Error(`Write failed: ${err.message}`)),
    );
    readStream.on('error', (err: Error) =>
      reject(new Error(`Download failed: ${err.message}`)),
    );

    readStream.pipe(writeStream);
  });
}

export async function mkdir(connId: string, dirPath: string): Promise<void> {
  const { sftp } = getConn(connId);

  return new Promise((resolve, reject) => {
    sftp.mkdir(dirPath, (err) => {
      if (err) return reject(new Error(`mkdir failed: ${err.message}`));
      resolve();
    });
  });
}

export async function rename(
  connId: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  const { sftp } = getConn(connId);

  return new Promise((resolve, reject) => {
    sftp.rename(oldPath, newPath, (err) => {
      if (err) return reject(new Error(`rename failed: ${err.message}`));
      resolve();
    });
  });
}

export async function del(connId: string, targetPath: string): Promise<void> {
  const { sftp } = getConn(connId);
  const entry = await stat(connId, targetPath);

  return new Promise((resolve, reject) => {
    if (entry.isDirectory) {
      sftp.rmdir(targetPath, (err) => {
        if (err) return reject(new Error(`rmdir failed: ${err.message}`));
        resolve();
      });
    } else {
      sftp.unlink(targetPath, (err) => {
        if (err) return reject(new Error(`unlink failed: ${err.message}`));
        resolve();
      });
    }
  });
}

export async function stat(connId: string, targetPath: string): Promise<FileEntry> {
  const { sftp } = getConn(connId);

  return new Promise((resolve, reject) => {
    sftp.stat(targetPath, (err, attrs) => {
      if (err) return reject(new Error(`stat failed: ${err.message}`));

      const isDir = (attrs.mode & 0o40000) !== 0;
      const name = path.posix.basename(targetPath) || '/';

      resolve({
        name,
        path: targetPath,
        size: attrs.size,
        modifiedAt: attrs.mtime * 1000,
        isDirectory: isDir,
        permissions: formatPermissions(attrs.mode),
      });
    });
  });
}

// ── Recursive directory operations ─────────────────────────────

export async function uploadDir(
  connId: string,
  localDir: string,
  remoteDir: string,
  onProgress?: (file: string, fileIndex: number, totalFiles: number) => void,
): Promise<void> {
  const { sftp } = getConn(connId);

  // Ensure remote directory exists
  await new Promise<void>((resolve, reject) => {
    sftp.mkdir(remoteDir, (err) => {
      if (err && (err as any).code !== 4) return reject(err); // code 4 = already exists
      resolve();
    });
  });

  const entries = fs.readdirSync(localDir, { withFileTypes: true });
  const allFiles: { local: string; remote: string }[] = [];

  // Gather all files recursively
  const gather = (localBase: string, remoteBase: string) => {
    const items = fs.readdirSync(localBase, { withFileTypes: true });
    for (const item of items) {
      const localPath = path.join(localBase, item.name);
      const remotePath = path.posix.join(remoteBase, item.name);
      if (item.isDirectory()) {
        gather(localPath, remotePath);
      } else {
        allFiles.push({ local: localPath, remote: remotePath });
      }
    }
  };
  gather(localDir, remoteDir);

  // Create all remote directories first
  const createDirs = async (localBase: string, remoteBase: string) => {
    const items = fs.readdirSync(localBase, { withFileTypes: true });
    for (const item of items) {
      if (item.isDirectory()) {
        const remotePath = path.posix.join(remoteBase, item.name);
        await new Promise<void>((resolve, reject) => {
          sftp.mkdir(remotePath, (err) => {
            if (err && (err as any).code !== 4) return reject(err);
            resolve();
          });
        });
        await createDirs(path.join(localBase, item.name), remotePath);
      }
    }
  };
  await createDirs(localDir, remoteDir);

  // Upload all files
  for (let i = 0; i < allFiles.length; i++) {
    const f = allFiles[i];
    onProgress?.(f.local, i + 1, allFiles.length);
    await upload(connId, f.local, f.remote);
  }
}

export async function downloadDir(
  connId: string,
  remoteDir: string,
  localDir: string,
  onProgress?: (file: string, fileIndex: number, totalFiles: number) => void,
): Promise<void> {
  // Ensure local directory exists
  fs.mkdirSync(localDir, { recursive: true });

  const entries = await list(connId, remoteDir);
  const allFiles: { remote: string; local: string }[] = [];

  // Gather all files recursively
  const gather = async (remotePath: string, localPath: string) => {
    const items = await list(connId, remotePath);
    for (const item of items) {
      const rPath = path.posix.join(remotePath, item.name);
      const lPath = path.join(localPath, item.name);
      if (item.isDirectory) {
        fs.mkdirSync(lPath, { recursive: true });
        await gather(rPath, lPath);
      } else {
        allFiles.push({ remote: rPath, local: lPath });
      }
    }
  };
  await gather(remoteDir, localDir);

  // Download all files
  for (let i = 0; i < allFiles.length; i++) {
    const f = allFiles[i];
    onProgress?.(f.remote, i + 1, allFiles.length);
    await download(connId, f.remote, f.local);
  }
}

export async function deleteDir(connId: string, dirPath: string): Promise<void> {
  const { sftp } = getConn(connId);

  const entries = await list(connId, dirPath);

  for (const entry of entries) {
    const fullPath = path.posix.join(dirPath, entry.name);
    if (entry.isDirectory) {
      await deleteDir(connId, fullPath);
    } else {
      await new Promise<void>((resolve, reject) => {
        sftp.unlink(fullPath, (err) => {
          if (err) return reject(new Error(`unlink failed: ${err.message}`));
          resolve();
        });
      });
    }
  }

  // Remove the now-empty directory
  await new Promise<void>((resolve, reject) => {
    sftp.rmdir(dirPath, (err) => {
      if (err) return reject(new Error(`rmdir failed: ${err.message}`));
      resolve();
    });
  });
}

// ── Helpers ────────────────────────────────────────────────────

function formatPermissions(mode: number): string {
  const perms = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
  const owner = perms[(mode >> 6) & 7];
  const group = perms[(mode >> 3) & 7];
  const other = perms[mode & 7];
  const type = (mode & 0o40000) !== 0 ? 'd' : '-';
  return `${type}${owner}${group}${other}`;
}
