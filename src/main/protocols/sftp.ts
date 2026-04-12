import { Client, SFTPWrapper } from 'ssh2';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as os from 'os';
import type { SFTPConfig, FileEntry } from '../../shared/types';
import { bindAbort, createAbortError, throwIfAborted } from './transfer-abort';
import { createRateLimitedTransform, getTransferSpeedLimit } from './transfer-rate-limit';

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

function expandHomePath(filePath: string): string {
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith('~/')) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

function resolvePrivateKey(privateKey?: string): string | undefined {
  if (!privateKey) return undefined;
  if (/BEGIN [A-Z0-9 ]+PRIVATE KEY/.test(privateKey)) return privateKey;

  const candidate = expandHomePath(privateKey);
  try {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return fs.readFileSync(candidate, 'utf-8');
    }
  } catch {
    // Fall back to the original value and let ssh2 report a useful parse error.
  }

  return privateKey;
}

function normalizeConfig(config: SFTPConfig): SFTPConfig {
  return {
    ...config,
    privateKey: resolvePrivateKey(config.privateKey),
  };
}

/**
 * Create a fresh SSH + SFTP connection using the same config, replacing the
 * stale entry in the pool.  Returns the new PooledConnection.
 */
async function reconnect(connId: string): Promise<PooledConnection> {
  const old = pool.get(connId);
  if (!old) throw new Error(`SFTP connection "${connId}" not found or expired`);

  // Tear down the old client (ignore errors — it may already be dead)
  try { old.client.end(); } catch { /* noop */ }

  if (old.config.proxyHost) {
    await connectViaProxy(connId, old.config);
    return getConn(connId);
  }

  return new Promise<PooledConnection>((resolve, reject) => {
    const client = new Client();

    const connectConfig: Record<string, unknown> = {
      host: old.config.host,
      port: old.config.port ?? 22,
      username: old.config.username,
      readyTimeout: (old.config.timeout ?? 30) * 1000,
      keepaliveInterval: 10_000,
      algorithms: {
        compress: ['none', 'zlib@openssh.com', 'zlib'],
      },
    };

    if (old.config.privateKey) {
      connectConfig.privateKey = old.config.privateKey;
      if (old.config.passphrase) connectConfig.passphrase = old.config.passphrase;
    } else if (old.config.password) {
      connectConfig.password = old.config.password;
    }

    client.on('ready', () => {
      client.sftp((err, sftp) => {
        if (err) {
          client.end();
          return reject(new Error(`SFTP subsystem failed on reconnect: ${err.message}`));
        }

        const entry: PooledConnection = {
          id: connId,
          client,
          sftp,
          config: old.config,
          lastActivity: Date.now(),
        };
        pool.set(connId, entry);
        resolve(entry);
      });
    });

    client.on('error', (err) => {
      reject(new Error(`SSH reconnect failed: ${err.message}`));
    });

    client.connect(connectConfig as any);
  });
}

/**
 * Execute an async operation with one automatic reconnect attempt.
 * If `fn` throws an error that looks like a broken/stale connection,
 * we reconnect and retry exactly once.
 */
async function withReconnect<T>(
  connId: string,
  fn: (conn: PooledConnection) => Promise<T>,
): Promise<T> {
  const conn = getConn(connId);
  try {
    return await fn(conn);
  } catch (err: any) {
    const msg: string = err?.message ?? '';
    const isStale =
      /ECONNRESET|EPIPE|end of stream|Not connected|No response|channel open failure/i.test(msg);

    if (!isStale) throw err;

    // One reconnect attempt
    const fresh = await reconnect(connId);
    return fn(fresh);
  }
}

// ── Public API ─────────────────────────────────────────────────

export async function connect(config: SFTPConfig): Promise<string> {
  const id = crypto.randomUUID();
  const normalizedConfig = normalizeConfig(config);

  // If proxy/jump host is configured, tunnel through it
  if (normalizedConfig.proxyHost) {
    return connectViaProxy(id, normalizedConfig);
  }

  return new Promise<string>((resolve, reject) => {
    const client = new Client();

    const connectConfig: Record<string, unknown> = {
      host: config.host,
      port: normalizedConfig.port ?? 22,
      username: normalizedConfig.username,
      readyTimeout: (normalizedConfig.timeout ?? 30) * 1000,
      keepaliveInterval: 10_000,
      algorithms: {
        compress: ['none', 'zlib@openssh.com', 'zlib'],
      },
    };

    if (normalizedConfig.privateKey) {
      connectConfig.privateKey = normalizedConfig.privateKey;
      if (normalizedConfig.passphrase) connectConfig.passphrase = normalizedConfig.passphrase;
    } else if (normalizedConfig.password) {
      connectConfig.password = normalizedConfig.password;
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
          config: normalizedConfig,
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

/**
 * Connect via a jump/proxy host.
 * 1. SSH into the proxy host
 * 2. Use forwardOut to create a tunnel to the target host
 * 3. Create a second SSH connection through that tunnel
 */
async function connectViaProxy(id: string, config: SFTPConfig): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const proxyClient = new Client();

    const proxyConfig: Record<string, unknown> = {
      host: config.proxyHost,
      port: config.proxyPort ?? 22,
      username: config.proxyUsername ?? config.username,
      readyTimeout: (config.timeout ?? 30) * 1000,
      keepaliveInterval: 10_000,
      algorithms: {
        compress: ['none', 'zlib@openssh.com', 'zlib'],
      },
    };

    if (config.proxyPassword) {
      proxyConfig.password = config.proxyPassword;
    }

    proxyClient.on('ready', () => {
      const targetHost = config.host;
      const targetPort = config.port ?? 22;

      proxyClient.forwardOut(
        '127.0.0.1',
        0,
        targetHost,
        targetPort,
        (err, stream) => {
          if (err) {
            proxyClient.end();
            return reject(new Error(`Tunnel through proxy failed: ${err.message}`));
          }

          const targetClient = new Client();

          const targetConfig: Record<string, unknown> = {
            sock: stream,
            username: config.username,
            readyTimeout: (config.timeout ?? 30) * 1000,
            keepaliveInterval: 10_000,
            algorithms: {
              compress: ['none', 'zlib@openssh.com', 'zlib'],
            },
          };

          if (config.privateKey) {
            targetConfig.privateKey = config.privateKey;
            if (config.passphrase) targetConfig.passphrase = config.passphrase;
          } else if (config.password) {
            targetConfig.password = config.password;
          }

          targetClient.on('ready', () => {
            targetClient.sftp((sftpErr, sftp) => {
              if (sftpErr) {
                targetClient.end();
                proxyClient.end();
                return reject(new Error(`SFTP subsystem failed via proxy: ${sftpErr.message}`));
              }

              pool.set(id, {
                id,
                client: targetClient,
                sftp,
                config,
                lastActivity: Date.now(),
              });

              // Clean up proxy when target disconnects
              targetClient.on('close', () => {
                proxyClient.end();
              });

              resolve(id);
            });
          });

          targetClient.on('error', (targetErr) => {
            proxyClient.end();
            reject(new Error(`SSH connection via proxy failed: ${targetErr.message}`));
          });

          targetClient.connect(targetConfig as any);
        },
      );
    });

    proxyClient.on('error', (proxyErr) => {
      reject(new Error(`Proxy SSH connection failed: ${proxyErr.message}`));
    });

    proxyClient.connect(proxyConfig as any);
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
  return withReconnect(connId, ({ sftp }) => {
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
  });
}

export async function upload(
  connId: string,
  localPath: string,
  remotePath: string,
  onProgress?: (transferred: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return withReconnect(connId, ({ sftp }) => {
    throwIfAborted(signal);
    const fileStat = fs.statSync(localPath);
    const total = fileStat.size;

    // Use fastPut for maximum speed when no rate limit is active
    if (getTransferSpeedLimit() == null) {
      return new Promise((resolve, reject) => {
        let aborted = false;
        const cleanupAbort = bindAbort(signal, () => {
          aborted = true;
          reject(createAbortError());
        });
        sftp.fastPut(localPath, remotePath, {
          concurrency: 64,
          chunkSize: 65536,
          step: (transferred, _chunk, totalBytes) => {
            if (aborted) return;
            onProgress?.(transferred, totalBytes);
          },
        }, (err) => {
          cleanupAbort();
          if (aborted) return;
          if (err) return reject(new Error(`Upload failed: ${err.message}`));
          resolve();
        });
      });
    }

    // Fallback: stream-based with rate limiting and larger buffers
    return new Promise((resolve, reject) => {
      let transferred = 0;
      const readStream = fs.createReadStream(localPath, { highWaterMark: 256 * 1024 });
      const throttle = createRateLimitedTransform((chunkBytes) => {
        transferred += chunkBytes;
        onProgress?.(transferred, total);
      });
      const writeStream = sftp.createWriteStream(remotePath, { highWaterMark: 256 * 1024 } as any);
      const cleanupAbort = bindAbort(signal, () => {
        const abortError = createAbortError();
        readStream.destroy(abortError);
        throttle.destroy(abortError);
        writeStream.destroy();
      });

      writeStream.on('close', () => {
        cleanupAbort();
        resolve();
      });
      writeStream.on('error', (err: Error) =>
        reject(new Error(`Upload failed: ${err.message}`)),
      );
      readStream.on('error', (err: Error) =>
        throttle.destroy(new Error(`Read failed: ${err.message}`)),
      );
      throttle.on('error', (err: Error) =>
        reject(new Error(`Upload throttling failed: ${err.message}`)),
      );

      readStream.pipe(throttle).pipe(writeStream);
    });
  });
}

export async function download(
  connId: string,
  remotePath: string,
  localPath: string,
  onProgress?: (transferred: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  // Get remote file size first (also benefits from reconnect)
  const remoteStat = await stat(connId, remotePath);
  const total = remoteStat.size;

  // Ensure local directory exists
  const dir = path.dirname(localPath);
  fs.mkdirSync(dir, { recursive: true });

  return withReconnect(connId, ({ sftp }) => {
    // Use fastGet for maximum speed when no rate limit is active
    if (getTransferSpeedLimit() == null) {
      return new Promise((resolve, reject) => {
        let aborted = false;
        const cleanupAbort = bindAbort(signal, () => {
          aborted = true;
          reject(createAbortError());
        });
        sftp.fastGet(remotePath, localPath, {
          concurrency: 64,
          chunkSize: 65536,
          step: (transferred, _chunk, totalBytes) => {
            if (aborted) return;
            onProgress?.(transferred, totalBytes);
          },
        }, (err) => {
          cleanupAbort();
          if (aborted) return;
          if (err) return reject(new Error(`Download failed: ${err.message}`));
          resolve();
        });
      });
    }

    // Fallback: stream-based with rate limiting and larger buffers
    return new Promise((resolve, reject) => {
      let transferred = 0;
      const readStream = sftp.createReadStream(remotePath, { highWaterMark: 256 * 1024 } as any);
      const throttle = createRateLimitedTransform((chunkBytes) => {
        transferred += chunkBytes;
        onProgress?.(transferred, total);
      });
      const writeStream = fs.createWriteStream(localPath, { highWaterMark: 256 * 1024 });
      const cleanupAbort = bindAbort(signal, () => {
        const abortError = createAbortError();
        readStream.destroy(abortError);
        throttle.destroy(abortError);
        writeStream.destroy();
      });

      writeStream.on('close', () => {
        cleanupAbort();
        resolve();
      });
      writeStream.on('error', (err: Error) =>
        reject(new Error(`Write failed: ${err.message}`)),
      );
      readStream.on('error', (err: Error) =>
        throttle.destroy(new Error(`Download failed: ${err.message}`)),
      );
      throttle.on('error', (err: Error) =>
        reject(new Error(`Download throttling failed: ${err.message}`)),
      );

      readStream.pipe(throttle).pipe(writeStream);
    });
  });
}

export async function mkdir(connId: string, dirPath: string): Promise<void> {
  return withReconnect(connId, ({ sftp }) => {
    return new Promise((resolve, reject) => {
      sftp.mkdir(dirPath, (err) => {
        if (err) return reject(new Error(`mkdir failed: ${err.message}`));
        resolve();
      });
    });
  });
}

export async function rename(
  connId: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  return withReconnect(connId, ({ sftp }) => {
    return new Promise((resolve, reject) => {
      sftp.rename(oldPath, newPath, (err) => {
        if (err) return reject(new Error(`rename failed: ${err.message}`));
        resolve();
      });
    });
  });
}

export async function del(connId: string, targetPath: string): Promise<void> {
  const entry = await stat(connId, targetPath);

  return withReconnect(connId, ({ sftp }) => {
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
  });
}

export async function stat(connId: string, targetPath: string): Promise<FileEntry> {
  return withReconnect(connId, ({ sftp }) => {
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
  });
}

// ── Recursive directory operations ─────────────────────────────

export async function uploadDir(
  connId: string,
  localDir: string,
  remoteDir: string,
  onProgress?: (file: string, fileIndex: number, totalFiles: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);

  // Ensure remote directory exists (using reconnect-safe mkdir)
  try {
    await mkdir(connId, remoteDir);
  } catch (err: any) {
    if (err && err.message && !err.message.includes('code 4') && !err.message.includes('already exists') && !err.message.includes('Failure')) {
      throw err;
    }
  }

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

  // Create all remote directories first (using reconnect-safe mkdir)
  const createDirs = async (localBase: string, remoteBase: string) => {
    throwIfAborted(signal);
    const items = fs.readdirSync(localBase, { withFileTypes: true });
    for (const item of items) {
      if (item.isDirectory()) {
        const remotePath = path.posix.join(remoteBase, item.name);
        try {
          await mkdir(connId, remotePath);
        } catch (err: any) {
          if (err && err.message && !err.message.includes('code 4') && !err.message.includes('already exists') && !err.message.includes('Failure')) {
            throw err;
          }
        }
        await createDirs(path.join(localBase, item.name), remotePath);
      }
    }
  };
  await createDirs(localDir, remoteDir);

  // Upload all files
  for (let i = 0; i < allFiles.length; i++) {
    throwIfAborted(signal);
    const f = allFiles[i];
    onProgress?.(f.local, i + 1, allFiles.length);
    await upload(connId, f.local, f.remote, undefined, signal);
  }
}

export async function downloadDir(
  connId: string,
  remoteDir: string,
  localDir: string,
  onProgress?: (file: string, fileIndex: number, totalFiles: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  // Ensure local directory exists
  fs.mkdirSync(localDir, { recursive: true });

  const entries = await list(connId, remoteDir);
  const allFiles: { remote: string; local: string }[] = [];

  // Gather all files recursively
  const gather = async (remotePath: string, localPath: string) => {
    throwIfAborted(signal);
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
    throwIfAborted(signal);
    const f = allFiles[i];
    onProgress?.(f.remote, i + 1, allFiles.length);
    await download(connId, f.remote, f.local, undefined, signal);
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

// ── chmod ──────────────────────────────────────────────────────

export async function chmod(connId: string, targetPath: string, mode: number): Promise<void> {
  return withReconnect(connId, ({ sftp }) => {
    return new Promise((resolve, reject) => {
      sftp.chmod(targetPath, mode, (err) => {
        if (err) return reject(new Error(`chmod failed: ${err.message}`));
        resolve();
      });
    });
  });
}

// ── Transfer Resume ────────────────────────────────────────────

export async function resumeTransfer(
  connId: string,
  direction: 'upload' | 'download',
  localPath: string,
  remotePath: string,
  onProgress?: (transferred: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (direction === 'upload') {
    return resumeUpload(connId, localPath, remotePath, onProgress, signal);
  } else {
    return resumeDownload(connId, remotePath, localPath, onProgress, signal);
  }
}

async function resumeUpload(
  connId: string,
  localPath: string,
  remotePath: string,
  onProgress?: (transferred: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const fileStat = fs.statSync(localPath);
  const total = fileStat.size;

  // Check remote file size for resume
  let remoteSize = 0;
  try {
    const remoteStat = await stat(connId, remotePath);
    remoteSize = remoteStat.size;
  } catch {
    // File doesn't exist remotely — start from 0
  }

  if (remoteSize >= total) {
    // Already fully uploaded
    onProgress?.(total, total);
    return;
  }

  return withReconnect(connId, ({ sftp }) => {
    return new Promise((resolve, reject) => {
      let transferred = remoteSize;
      const readStream = fs.createReadStream(localPath, { start: remoteSize });
      const throttle = createRateLimitedTransform((chunkBytes) => {
        transferred += chunkBytes;
        onProgress?.(transferred, total);
      });
      const writeStream = sftp.createWriteStream(remotePath, {
        flags: remoteSize > 0 ? 'a' : 'w',
      });
      const cleanupAbort = bindAbort(signal, () => {
        const abortError = createAbortError();
        readStream.destroy(abortError);
        throttle.destroy(abortError);
        writeStream.destroy();
      });

      writeStream.on('close', () => {
        cleanupAbort();
        resolve();
      });
      writeStream.on('error', (err: Error) =>
        reject(new Error(`Resume upload failed: ${err.message}`)),
      );
      readStream.on('error', (err: Error) =>
        throttle.destroy(new Error(`Read failed: ${err.message}`)),
      );
      throttle.on('error', (err: Error) =>
        reject(new Error(`Resume upload throttling failed: ${err.message}`)),
      );

      readStream.pipe(throttle).pipe(writeStream);
    });
  });
}

async function resumeDownload(
  connId: string,
  remotePath: string,
  localPath: string,
  onProgress?: (transferred: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const remoteStat = await stat(connId, remotePath);
  const total = remoteStat.size;

  // Check local file size for resume
  let localSize = 0;
  try {
    const localStat = fs.statSync(localPath);
    localSize = localStat.size;
  } catch {
    // File doesn't exist locally — start from 0
  }

  if (localSize >= total) {
    // Already fully downloaded
    onProgress?.(total, total);
    return;
  }

  // Ensure local directory exists
  const dir = path.dirname(localPath);
  fs.mkdirSync(dir, { recursive: true });

  return withReconnect(connId, ({ sftp }) => {
    return new Promise((resolve, reject) => {
      let transferred = localSize;
      const readStream = sftp.createReadStream(remotePath, { start: localSize });
      const throttle = createRateLimitedTransform((chunkBytes) => {
        transferred += chunkBytes;
        onProgress?.(transferred, total);
      });
      const writeStream = fs.createWriteStream(localPath, {
        flags: localSize > 0 ? 'a' : 'w',
      });
      const cleanupAbort = bindAbort(signal, () => {
        const abortError = createAbortError();
        readStream.destroy(abortError);
        throttle.destroy(abortError);
        writeStream.destroy(abortError);
      });

      writeStream.on('close', () => {
        cleanupAbort();
        resolve();
      });
      writeStream.on('error', (err: Error) =>
        reject(new Error(`Write failed: ${err.message}`)),
      );
      readStream.on('error', (err: Error) =>
        throttle.destroy(new Error(`Resume download failed: ${err.message}`)),
      );
      throttle.on('error', (err: Error) =>
        reject(new Error(`Resume download throttling failed: ${err.message}`)),
      );

      readStream.pipe(throttle).pipe(writeStream);
    });
  });
}

// ── Search ──────────────────────────────────────────────────────

/**
 * Recursively search for files matching a glob-like pattern.
 */
export async function search(
  connId: string,
  basePath: string,
  pattern: string,
  recursive: boolean,
): Promise<FileEntry[]> {
  const results: FileEntry[] = [];
  const regex = globToRegex(pattern);

  async function walk(dirPath: string): Promise<void> {
    let entries: FileEntry[];
    try {
      entries = await list(connId, dirPath);
    } catch {
      return; // skip unreadable directories
    }

    for (const entry of entries) {
      if (!entry.isDirectory && regex.test(entry.name)) {
        results.push(entry);
      }
      if (entry.isDirectory && recursive) {
        await walk(entry.path);
      }
    }
  }

  await walk(basePath);
  return results;
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
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
