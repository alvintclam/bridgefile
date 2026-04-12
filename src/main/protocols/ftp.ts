import { Client as FTPClient, FileInfo } from 'basic-ftp';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import type { FTPConfig, FileEntry } from '../../shared/types';
import { bindAbort, createAbortError, throwIfAborted } from './transfer-abort';
import { createRateLimitedTransform } from './transfer-rate-limit';

// ── Connection pool ────────────────────────────────────────────

interface PooledFTP {
  id: string;
  client: FTPClient;
  config: FTPConfig;
  rootDir: string;
  lastActivity: number;
}

const pool = new Map<string, PooledFTP>();

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Prune idle connections periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, conn] of pool) {
    if (now - conn.lastActivity > IDLE_TIMEOUT_MS) {
      conn.client.close();
      pool.delete(id);
    }
  }
}, 60_000);

function touch(connId: string): void {
  const conn = pool.get(connId);
  if (conn) conn.lastActivity = Date.now();
}

function getConn(connId: string): PooledFTP {
  const conn = pool.get(connId);
  if (!conn) throw new Error(`FTP connection "${connId}" not found or expired`);
  touch(connId);
  return conn;
}

// ── Public API ─────────────────────────────────────────────────

export async function connect(config: FTPConfig): Promise<string> {
  const id = crypto.randomUUID();
  const client = new FTPClient((config.timeout ?? 30) * 1000);
  client.ftp.verbose = false;
  let rootDir = '/';

  try {
    await client.access({
      host: config.host,
      port: config.port ?? 21,
      user: config.username,
      password: config.password,
      secure: config.secure ?? false,
      secureOptions: config.secureOptions,
    });
    await client.useDefaultSettings();
    rootDir = normalizeAbsolutePath(await client.pwd());
  } catch (err: any) {
    client.close();

    const msg = err.message ?? String(err);

    if (msg.includes('ECONNREFUSED')) {
      throw new Error(`FTP connection refused. Is the server running on ${config.host}:${config.port ?? 21}?`);
    }
    if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
      throw new Error(`FTP host not found: "${config.host}". Check the hostname or DNS.`);
    }
    if (msg.includes('ETIMEDOUT') || msg.includes('timeout')) {
      throw new Error(`FTP connection timed out to ${config.host}:${config.port ?? 21}. Check firewall rules.`);
    }
    if (/530|login|auth/i.test(msg)) {
      throw new Error(`FTP login failed for user "${config.username}". Check your username and password.`);
    }
    if (/certificate|SSL|TLS/i.test(msg)) {
      throw new Error(`FTP TLS/SSL error: ${msg}. Try toggling the "Secure" option or allowing self-signed certs.`);
    }

    throw new Error(`FTP connection failed: ${msg}`);
  }

  pool.set(id, {
    id,
    client,
    config,
    rootDir,
    lastActivity: Date.now(),
  });

  return id;
}

export async function disconnect(connId: string): Promise<void> {
  const conn = pool.get(connId);
  if (conn) {
    conn.client.close();
    pool.delete(connId);
  }
}

export async function list(connId: string, dirPath: string): Promise<FileEntry[]> {
  const conn = getConn(connId);
  const normalizedDirPath = normalizeAbsolutePath(dirPath);
  const entries = await listDirectory(conn, normalizedDirPath);

  const result: FileEntry[] = entries
    .filter((entry) => entry.name !== '.' && entry.name !== '..')
    .map((entry) => {
      const isDir = entry.isDirectory;
      return {
        name: entry.name,
        path: joinVirtualPath(normalizedDirPath, entry.name),
        size: entry.size,
        modifiedAt: entry.modifiedAt ? entry.modifiedAt.getTime() : 0,
        isDirectory: isDir,
        permissions: formatPermissions(entry),
      };
    });

  // Directories first, then alphabetical
  result.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return result;
}

export async function upload(
  connId: string,
  localPath: string,
  remotePath: string,
  onProgress?: (transferred: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const conn = getConn(connId);
  const remoteServerPath = resolveServerPath(conn, remotePath);
  const total = fs.statSync(localPath).size;
  let transferred = 0;
  const readStream = fs.createReadStream(localPath);
  const throttle = createRateLimitedTransform((chunkBytes) => {
    transferred += chunkBytes;
    onProgress?.(transferred, total);
  });
  const cleanupAbort = bindAbort(signal, () => {
    const abortError = createAbortError();
    readStream.destroy(abortError);
    throttle.destroy(abortError);
  });
  readStream.on('error', (error) => throttle.destroy(error));
  readStream.pipe(throttle);

  try {
    await conn.client.uploadFrom(throttle, remoteServerPath);
  } finally {
    cleanupAbort();
    readStream.destroy();
  }
}

export async function download(
  connId: string,
  remotePath: string,
  localPath: string,
  onProgress?: (transferred: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const conn = getConn(connId);
  const remoteServerPath = resolveServerPath(conn, remotePath);
  const total = (await stat(connId, remotePath)).size;
  let transferred = 0;
  const throttle = createRateLimitedTransform((chunkBytes) => {
    transferred += chunkBytes;
    onProgress?.(transferred, total);
  });

  // Ensure local directory exists
  fs.mkdirSync(path.dirname(localPath), { recursive: true });

  const writeStream = fs.createWriteStream(localPath);
  const cleanupAbort = bindAbort(signal, () => {
    const abortError = createAbortError();
    throttle.destroy(abortError);
    writeStream.destroy(abortError);
  });
  const streamClosed = new Promise<void>((resolve, reject) => {
    writeStream.on('close', () => resolve());
    writeStream.on('error', (error) => reject(error));
    throttle.on('error', (error) => reject(error));
  });
  throttle.pipe(writeStream);

  try {
    await conn.client.downloadTo(throttle, remoteServerPath);
    await streamClosed;
  } finally {
    cleanupAbort();
    throttle.destroy();
  }
}

export async function mkdir(connId: string, dirPath: string): Promise<void> {
  const conn = getConn(connId);
  await conn.client.ensureDir(resolveServerPath(conn, dirPath));
  // ensureDir changes working directory — restore the login directory root
  await resetWorkingDir(conn);
}

export async function rename(
  connId: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  const conn = getConn(connId);
  await conn.client.rename(resolveServerPath(conn, oldPath), resolveServerPath(conn, newPath));
}

export async function stat(connId: string, targetPath: string): Promise<FileEntry> {
  const normalizedTargetPath = normalizeAbsolutePath(targetPath);

  if (normalizedTargetPath === '/') {
    return {
      name: '/',
      path: '/',
      size: 0,
      modifiedAt: 0,
      isDirectory: true,
      permissions: 'drwxr-xr-x',
    };
  }

  const parentPath = normalizeAbsolutePath(path.posix.dirname(normalizedTargetPath));
  const baseName = path.posix.basename(normalizedTargetPath);
  const entries = await list(connId, parentPath);
  const entry = entries.find((candidate) => candidate.name === baseName);

  if (!entry) {
    throw new Error(`stat failed: "${normalizedTargetPath}" not found`);
  }

  return {
    name: entry.name,
    path: normalizedTargetPath,
    size: entry.size,
    modifiedAt: entry.modifiedAt,
    isDirectory: entry.isDirectory,
    permissions: entry.permissions,
  };
}

export async function del(connId: string, targetPath: string): Promise<void> {
  const conn = getConn(connId);
  const serverTargetPath = resolveServerPath(conn, targetPath);

  // Try to detect if target is a directory by listing it
  try {
    const entries = await conn.client.list(serverTargetPath);
    // If list succeeds without error and targetPath doesn't look like a file
    // that just happened to have entries, treat it as a directory.
    // basic-ftp's list on a file may return one entry; for a dir, the contents.
    const isDir =
      entries.length === 0 ||
      entries.some((e) => e.name === '.' || e.name === '..') ||
      entries.length > 1;

    if (isDir) {
      await conn.client.removeDir(serverTargetPath);
      return;
    }
  } catch {
    // list failed — it's a file (or doesn't exist)
  }

  await conn.client.remove(serverTargetPath);
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
  const conn = getConn(connId);
  const remoteServerPath = resolveServerPath(conn, remotePath);
  const fileStat = fs.statSync(localPath);
  const total = fileStat.size;

  // Check remote file size for resume
  let remoteSize = 0;
  try {
    remoteSize = await conn.client.size(remoteServerPath);
  } catch {
    // File doesn't exist remotely — start from 0
  }

  if (remoteSize >= total) {
    onProgress?.(total, total);
    return;
  }
  let transferred = remoteSize;
  const readStream = fs.createReadStream(localPath, { start: remoteSize });
  const throttle = createRateLimitedTransform((chunkBytes) => {
    transferred += chunkBytes;
    onProgress?.(transferred, total);
  });
  const cleanupAbort = bindAbort(signal, () => {
    const abortError = createAbortError();
    readStream.destroy(abortError);
    throttle.destroy(abortError);
  });
  readStream.on('error', (error) => throttle.destroy(error));
  readStream.pipe(throttle);

  try {
    if (remoteSize > 0) {
      await conn.client.appendFrom(throttle, remoteServerPath);
    } else {
      await conn.client.uploadFrom(throttle, remoteServerPath);
    }
  } finally {
    cleanupAbort();
    readStream.destroy();
  }
}

async function resumeDownload(
  connId: string,
  remotePath: string,
  localPath: string,
  onProgress?: (transferred: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const conn = getConn(connId);
  const remoteServerPath = resolveServerPath(conn, remotePath);
  throwIfAborted(signal);

  // Get remote file size
  let total = 0;
  try {
    total = await conn.client.size(remoteServerPath);
  } catch {
    // Fall back to non-resume download
    return download(connId, remotePath, localPath, onProgress, signal);
  }

  // Check local file size for resume
  let localSize = 0;
  try {
    const localStat = fs.statSync(localPath);
    localSize = localStat.size;
  } catch {
    // File doesn't exist locally — start from 0
  }

  if (localSize >= total) {
    onProgress?.(total, total);
    return;
  }

  // Ensure local directory exists
  const dir = path.dirname(localPath);
  fs.mkdirSync(dir, { recursive: true });
  let transferred = localSize;
  const throttle = createRateLimitedTransform((chunkBytes) => {
    transferred += chunkBytes;
    onProgress?.(transferred, total);
  });
  const writeStream = fs.createWriteStream(localPath, { flags: localSize > 0 ? 'a' : 'w' });
  const cleanupAbort = bindAbort(signal, () => {
    const abortError = createAbortError();
    throttle.destroy(abortError);
    writeStream.destroy(abortError);
  });
  const streamClosed = new Promise<void>((resolve, reject) => {
    writeStream.on('close', () => resolve());
    writeStream.on('error', (error) => reject(error));
    throttle.on('error', (error) => reject(error));
  });
  throttle.pipe(writeStream);

  try {
    await conn.client.downloadTo(throttle, remoteServerPath, localSize);
    await streamClosed;
  } finally {
    cleanupAbort();
    throttle.destroy();
  }
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
  const allFiles: { local: string; remote: string }[] = [];

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

  const createDirs = async (localBase: string, remoteBase: string) => {
    throwIfAborted(signal);
    const items = fs.readdirSync(localBase, { withFileTypes: true });
    for (const item of items) {
      if (!item.isDirectory()) continue;
      const remotePath = path.posix.join(remoteBase, item.name);
      await mkdir(connId, remotePath);
      await createDirs(path.join(localBase, item.name), remotePath);
    }
  };

  await mkdir(connId, remoteDir);
  await createDirs(localDir, remoteDir);

  for (let i = 0; i < allFiles.length; i += 1) {
    throwIfAborted(signal);
    const file = allFiles[i];
    onProgress?.(file.local, i + 1, allFiles.length);
    await upload(connId, file.local, file.remote, undefined, signal);
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
  const allFiles: { remote: string; local: string }[] = [];

  const gather = async (remoteBase: string, localBase: string) => {
    throwIfAborted(signal);
    const entries = await list(connId, remoteBase);
    for (const entry of entries) {
      const remotePath = path.posix.join(remoteBase, entry.name);
      const localPath = path.join(localBase, entry.name);
      if (entry.isDirectory) {
        fs.mkdirSync(localPath, { recursive: true });
        await gather(remotePath, localPath);
      } else {
        allFiles.push({ remote: remotePath, local: localPath });
      }
    }
  };
  await gather(remoteDir, localDir);

  for (let i = 0; i < allFiles.length; i += 1) {
    throwIfAborted(signal);
    const file = allFiles[i];
    onProgress?.(file.remote, i + 1, allFiles.length);
    await download(connId, file.remote, file.local, undefined, signal);
  }
}

export async function deleteDir(connId: string, dirPath: string): Promise<void> {
  const conn = getConn(connId);
  const entries = await list(connId, dirPath);

  for (const entry of entries) {
    if (entry.isDirectory) {
      await deleteDir(connId, entry.path);
    } else {
      await conn.client.remove(resolveServerPath(conn, entry.path));
    }
  }

  // Remove the now-empty directory
  await conn.client.removeDir(resolveServerPath(conn, dirPath));
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

function normalizeAbsolutePath(targetPath: string): string {
  const trimmed = targetPath.trim();
  const candidate = trimmed ? trimmed : '/';
  const withLeadingSlash = candidate.startsWith('/') ? candidate : `/${candidate}`;
  const normalized = path.posix.normalize(withLeadingSlash);
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function joinVirtualPath(basePath: string, name: string): string {
  return basePath === '/' ? `/${name}` : `${basePath}/${name}`;
}

function resolveServerPath(conn: PooledFTP, targetPath: string): string {
  const normalizedTargetPath = normalizeAbsolutePath(targetPath);
  if (conn.rootDir === '/') {
    return normalizedTargetPath;
  }
  if (normalizedTargetPath === '/') {
    return conn.rootDir;
  }
  return path.posix.join(conn.rootDir, normalizedTargetPath.slice(1));
}

async function resetWorkingDir(conn: PooledFTP): Promise<void> {
  try {
    await conn.client.cd(conn.rootDir);
  } catch {
    // Ignore — absolute path operations do not rely on the current directory.
  }
}

async function listDirectory(conn: PooledFTP, dirPath: string): Promise<FileInfo[]> {
  try {
    return await conn.client.list(resolveServerPath(conn, dirPath));
  } catch (error) {
    if (dirPath !== '/') {
      throw error;
    }

    // Some FTP servers reject LIST on absolute root paths even though the
    // login directory itself is readable. Re-anchor to the session root and
    // list the current directory instead.
    await resetWorkingDir(conn);
    return conn.client.list();
  }
}

function formatPermissions(entry: FileInfo): string {
  const type = entry.isDirectory ? 'd' : '-';
  // basic-ftp FileInfo has a rawModify string and permissions in raw listing,
  // but doesn't expose a structured mode. Return type indicator + raw permissions
  // if available from the entry's permissions property.
  const perms = (entry as any).permissions;
  if (perms && typeof perms === 'string') {
    return `${type}${perms}`;
  }
  // Fallback
  return entry.isDirectory ? 'drwxr-xr-x' : '-rw-r--r--';
}
