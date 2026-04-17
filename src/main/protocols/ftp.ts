import { Client as FTPClient, FileInfo } from 'basic-ftp';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import type { FTPConfig, FileEntry } from '../../shared/types';
import { bindAbort, createAbortError, throwIfAborted } from './transfer-abort';
import { createRateLimitedTransform } from './transfer-rate-limit';

// ── Connection session pool ────────────────────────────────────
// basic-ftp allows only one command at a time per client, so we maintain
// a pool of up to MAX_SESSIONS clients per logical connection ID.
// Concurrent ops check out an idle client (or spawn a new one up to the
// limit, or wait). This is what makes `maxConcurrent` work for FTP.

const MAX_SESSIONS_PER_CONN = 4;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface FTPSession {
  client: FTPClient;
  busy: boolean;
}

interface FTPConnPool {
  config: FTPConfig;
  rootDir: string;
  sessions: FTPSession[];
  waiters: Array<(s: FTPSession) => void>;
  lastActivity: number;
}

interface FTPContext {
  client: FTPClient;
  rootDir: string;
}

const pools = new Map<string, FTPConnPool>();

// Prune idle connections periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, p] of pools) {
    if (now - p.lastActivity > IDLE_TIMEOUT_MS) {
      for (const s of p.sessions) {
        try { s.client.close(); } catch { /* ignore */ }
      }
      pools.delete(id);
    }
  }
}, 60_000);

async function openClient(config: FTPConfig): Promise<FTPClient> {
  const client = new FTPClient((config.timeout ?? 30) * 1000);
  client.ftp.verbose = false;
  await client.access({
    host: config.host,
    port: config.port ?? 21,
    user: config.username,
    password: config.password,
    secure: config.secure ?? false,
    secureOptions: config.secureOptions,
  });
  await client.useDefaultSettings();
  return client;
}

async function acquireSession(connId: string): Promise<FTPSession> {
  const p = pools.get(connId);
  if (!p) throw new Error(`FTP connection "${connId}" not found or expired`);
  p.lastActivity = Date.now();

  const idle = p.sessions.find((s) => !s.busy);
  if (idle) {
    idle.busy = true;
    return idle;
  }

  if (p.sessions.length < MAX_SESSIONS_PER_CONN) {
    const client = await openClient(p.config);
    const session: FTPSession = { client, busy: true };
    p.sessions.push(session);
    return session;
  }

  return new Promise<FTPSession>((resolve) => {
    p.waiters.push((s) => {
      s.busy = true;
      resolve(s);
    });
  });
}

function releaseSession(connId: string, session: FTPSession): void {
  const p = pools.get(connId);
  if (!p) {
    try { session.client.close(); } catch { /* ignore */ }
    return;
  }
  p.lastActivity = Date.now();
  session.busy = false;
  const waiter = p.waiters.shift();
  if (waiter) waiter(session);
}

async function withSession<T>(
  connId: string,
  fn: (ctx: FTPContext) => Promise<T>,
): Promise<T> {
  const p = pools.get(connId);
  if (!p) throw new Error(`FTP connection "${connId}" not found or expired`);
  const session = await acquireSession(connId);
  try {
    return await fn({ client: session.client, rootDir: p.rootDir });
  } finally {
    releaseSession(connId, session);
  }
}

// ── Public API ─────────────────────────────────────────────────

export async function connect(config: FTPConfig): Promise<string> {
  const id = crypto.randomUUID();
  let client: FTPClient;
  let rootDir = '/';

  try {
    client = await openClient(config);
    rootDir = normalizeAbsolutePath(await client.pwd());
  } catch (err: any) {
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

  pools.set(id, {
    config,
    rootDir,
    sessions: [{ client, busy: false }],
    waiters: [],
    lastActivity: Date.now(),
  });

  return id;
}

export async function disconnect(connId: string): Promise<void> {
  const p = pools.get(connId);
  if (p) {
    for (const s of p.sessions) {
      try { s.client.close(); } catch { /* ignore */ }
    }
    pools.delete(connId);
  }
}

export function list(connId: string, dirPath: string): Promise<FileEntry[]> {
  return withSession(connId, (ctx) => listImpl(ctx, dirPath));
}

async function listImpl(ctx: FTPContext, dirPath: string): Promise<FileEntry[]> {
  const normalizedDirPath = normalizeAbsolutePath(dirPath);
  const entries = await listDirectory(ctx, normalizedDirPath);

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

export function upload(
  connId: string,
  localPath: string,
  remotePath: string,
  onProgress?: (transferred: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return withSession(connId, async (ctx) => {
    throwIfAborted(signal);
    const remoteServerPath = resolveServerPath(ctx, remotePath);
    const total = fs.statSync(localPath).size;
    let transferred = 0;
    const readStream = fs.createReadStream(localPath, { highWaterMark: 256 * 1024 });
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
      await ctx.client.uploadFrom(throttle, remoteServerPath);
    } finally {
      cleanupAbort();
      readStream.destroy();
    }
  });
}

export function download(
  connId: string,
  remotePath: string,
  localPath: string,
  onProgress?: (transferred: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return withSession(connId, (ctx) => downloadImpl(ctx, remotePath, localPath, onProgress, signal));
}

async function downloadImpl(
  ctx: FTPContext,
  remotePath: string,
  localPath: string,
  onProgress?: (transferred: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const remoteServerPath = resolveServerPath(ctx, remotePath);
  const total = (await statImpl(ctx, remotePath)).size;
  let transferred = 0;
  const throttle = createRateLimitedTransform((chunkBytes) => {
    transferred += chunkBytes;
    onProgress?.(transferred, total);
  });

  // Ensure local directory exists
  fs.mkdirSync(path.dirname(localPath), { recursive: true });

  const writeStream = fs.createWriteStream(localPath, { highWaterMark: 256 * 1024 });
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
    await ctx.client.downloadTo(throttle, remoteServerPath);
    await streamClosed;
  } finally {
    cleanupAbort();
    throttle.destroy();
  }
}

export function mkdir(connId: string, dirPath: string): Promise<void> {
  return withSession(connId, async (ctx) => {
    await ctx.client.ensureDir(resolveServerPath(ctx, dirPath));
    await resetWorkingDir(ctx);
  });
}

export function rename(
  connId: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  return withSession(connId, async (ctx) => {
    await ctx.client.rename(resolveServerPath(ctx, oldPath), resolveServerPath(ctx, newPath));
  });
}

export function stat(connId: string, targetPath: string): Promise<FileEntry> {
  return withSession(connId, (ctx) => statImpl(ctx, targetPath));
}

async function statImpl(ctx: FTPContext, targetPath: string): Promise<FileEntry> {
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
  const entries = await listImpl(ctx, parentPath);
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

export function del(connId: string, targetPath: string): Promise<void> {
  return withSession(connId, async (ctx) => {
    const serverTargetPath = resolveServerPath(ctx, targetPath);

    // Try to detect if target is a directory by listing it.
    // If list() succeeds, the path is a directory (listing a file throws).
    try {
      await ctx.client.list(serverTargetPath);
      await ctx.client.removeDir(serverTargetPath);
      return;
    } catch {
      // list failed — it's a file (or doesn't exist)
    }

    await ctx.client.remove(serverTargetPath);
  });
}

// ── Transfer Resume ────────────────────────────────────────────

export function resumeTransfer(
  connId: string,
  direction: 'upload' | 'download',
  localPath: string,
  remotePath: string,
  onProgress?: (transferred: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return withSession(connId, (ctx) => {
    if (direction === 'upload') {
      return resumeUpload(ctx, localPath, remotePath, onProgress, signal);
    } else {
      return resumeDownload(ctx, remotePath, localPath, onProgress, signal);
    }
  });
}

async function resumeUpload(
  ctx: FTPContext,
  localPath: string,
  remotePath: string,
  onProgress?: (transferred: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const remoteServerPath = resolveServerPath(ctx, remotePath);
  const fileStat = fs.statSync(localPath);
  const total = fileStat.size;

  // Check remote file size for resume
  let remoteSize = 0;
  try {
    remoteSize = await ctx.client.size(remoteServerPath);
  } catch {
    // File doesn't exist remotely — start from 0
  }

  if (remoteSize >= total) {
    onProgress?.(total, total);
    return;
  }
  let transferred = remoteSize;
  const readStream = fs.createReadStream(localPath, { start: remoteSize, highWaterMark: 256 * 1024 });
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
      await ctx.client.appendFrom(throttle, remoteServerPath);
    } else {
      await ctx.client.uploadFrom(throttle, remoteServerPath);
    }
  } finally {
    cleanupAbort();
    readStream.destroy();
  }
}

async function resumeDownload(
  ctx: FTPContext,
  remotePath: string,
  localPath: string,
  onProgress?: (transferred: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const remoteServerPath = resolveServerPath(ctx, remotePath);
  throwIfAborted(signal);

  // Get remote file size
  let total = 0;
  try {
    total = await ctx.client.size(remoteServerPath);
  } catch {
    // Fall back to non-resume download
    return downloadImpl(ctx, remotePath, localPath, onProgress, signal);
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
  const writeStream = fs.createWriteStream(localPath, { flags: localSize > 0 ? 'a' : 'w', highWaterMark: 256 * 1024 });
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
    await ctx.client.downloadTo(throttle, remoteServerPath, localSize);
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

  // Upload files in parallel batches (pool handles per-client serialization)
  const BATCH_SIZE = MAX_SESSIONS_PER_CONN;
  let completed = 0;
  for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
    throwIfAborted(signal);
    const batch = allFiles.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map((f) =>
      upload(connId, f.local, f.remote, undefined, signal).then(() => {
        completed += 1;
        onProgress?.(f.local, completed, allFiles.length);
      }),
    ));
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

  // Download files in parallel batches
  const BATCH_SIZE = MAX_SESSIONS_PER_CONN;
  let completed = 0;
  for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
    throwIfAborted(signal);
    const batch = allFiles.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map((f) =>
      download(connId, f.remote, f.local, undefined, signal).then(() => {
        completed += 1;
        onProgress?.(f.remote, completed, allFiles.length);
      }),
    ));
  }
}

export async function deleteDir(connId: string, dirPath: string): Promise<void> {
  const entries = await list(connId, dirPath);

  for (const entry of entries) {
    if (entry.isDirectory) {
      await deleteDir(connId, entry.path);
    } else {
      await withSession(connId, async (ctx) => {
        await ctx.client.remove(resolveServerPath(ctx, entry.path));
      });
    }
  }

  // Remove the now-empty directory
  await withSession(connId, async (ctx) => {
    await ctx.client.removeDir(resolveServerPath(ctx, dirPath));
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

function resolveServerPath(ctx: FTPContext, targetPath: string): string {
  const normalizedTargetPath = normalizeAbsolutePath(targetPath);
  if (ctx.rootDir === '/') {
    return normalizedTargetPath;
  }
  if (normalizedTargetPath === '/') {
    return ctx.rootDir;
  }
  return path.posix.join(ctx.rootDir, normalizedTargetPath.slice(1));
}

async function resetWorkingDir(ctx: FTPContext): Promise<void> {
  try {
    await ctx.client.cd(ctx.rootDir);
  } catch {
    // Ignore — absolute path operations do not rely on the current directory.
  }
}

async function listDirectory(ctx: FTPContext, dirPath: string): Promise<FileInfo[]> {
  try {
    return await ctx.client.list(resolveServerPath(ctx, dirPath));
  } catch (error) {
    if (dirPath !== '/') {
      throw error;
    }

    // Some FTP servers reject LIST on absolute root paths even though the
    // login directory itself is readable. Re-anchor to the session root and
    // list the current directory instead.
    await resetWorkingDir(ctx);
    return ctx.client.list();
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
