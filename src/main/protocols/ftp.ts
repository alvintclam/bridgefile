import { Client as FTPClient, FileInfo } from 'basic-ftp';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import type { FTPConfig, FileEntry } from '../../shared/types';

// ── Connection pool ────────────────────────────────────────────

interface PooledFTP {
  id: string;
  client: FTPClient;
  config: FTPConfig;
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
  const client = new FTPClient();
  client.ftp.verbose = false;

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
  const { client } = getConn(connId);

  let entries: FileInfo[] = await client.list(dirPath);

  // Some FTP servers return empty at "/" because the user lands in a
  // different working directory.  Fall back to the server-reported cwd.
  if (entries.length === 0 && dirPath === '/') {
    try {
      const cwd = await client.pwd();
      if (cwd && cwd !== '/') {
        entries = await client.list(cwd);
      }
    } catch {
      // Ignore — best-effort fallback
    }
  }

  const result: FileEntry[] = entries
    .filter((entry) => entry.name !== '.' && entry.name !== '..')
    .map((entry) => {
      const isDir = entry.isDirectory;
      return {
        name: entry.name,
        path: path.posix.join(dirPath, entry.name),
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
): Promise<void> {
  const { client } = getConn(connId);

  if (onProgress) {
    client.trackProgress((info) => {
      onProgress(info.bytes, info.bytesOverall);
    });
  }

  try {
    await client.uploadFrom(localPath, remotePath);
  } finally {
    client.trackProgress();
  }
}

export async function download(
  connId: string,
  remotePath: string,
  localPath: string,
  onProgress?: (transferred: number, total: number) => void,
): Promise<void> {
  const { client } = getConn(connId);

  if (onProgress) {
    client.trackProgress((info) => {
      onProgress(info.bytes, info.bytesOverall);
    });
  }

  try {
    await client.downloadTo(localPath, remotePath);
  } finally {
    client.trackProgress();
  }
}

export async function mkdir(connId: string, dirPath: string): Promise<void> {
  const { client } = getConn(connId);
  await client.ensureDir(dirPath);
  // ensureDir changes working directory — go back to root
  await client.cd('/');
}

export async function rename(
  connId: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  const { client } = getConn(connId);
  await client.rename(oldPath, newPath);
}

export async function del(connId: string, targetPath: string): Promise<void> {
  const { client } = getConn(connId);

  // Try to detect if target is a directory by listing it
  try {
    const entries = await client.list(targetPath);
    // If list succeeds without error and targetPath doesn't look like a file
    // that just happened to have entries, treat it as a directory.
    // basic-ftp's list on a file may return one entry; for a dir, the contents.
    const isDir =
      entries.length === 0 ||
      entries.some((e) => e.name === '.' || e.name === '..') ||
      entries.length > 1;

    if (isDir) {
      await client.removeDir(targetPath);
      return;
    }
  } catch {
    // list failed — it's a file (or doesn't exist)
  }

  await client.remove(targetPath);
}

// ── Transfer Resume ────────────────────────────────────────────

export async function resumeTransfer(
  connId: string,
  direction: 'upload' | 'download',
  localPath: string,
  remotePath: string,
  onProgress?: (transferred: number, total: number) => void,
): Promise<void> {
  if (direction === 'upload') {
    return resumeUpload(connId, localPath, remotePath, onProgress);
  } else {
    return resumeDownload(connId, remotePath, localPath, onProgress);
  }
}

async function resumeUpload(
  connId: string,
  localPath: string,
  remotePath: string,
  onProgress?: (transferred: number, total: number) => void,
): Promise<void> {
  const { client } = getConn(connId);
  const fileStat = fs.statSync(localPath);
  const total = fileStat.size;

  // Check remote file size for resume
  let remoteSize = 0;
  try {
    remoteSize = await client.size(remotePath);
  } catch {
    // File doesn't exist remotely — start from 0
  }

  if (remoteSize >= total) {
    onProgress?.(total, total);
    return;
  }

  if (onProgress) {
    client.trackProgress((info) => {
      onProgress(remoteSize + info.bytes, total);
    });
  }

  try {
    if (remoteSize > 0) {
      // Use appendFrom for resume -- basic-ftp uses APPE command
      const stream = fs.createReadStream(localPath, { start: remoteSize });
      await client.appendFrom(stream, remotePath);
    } else {
      await client.uploadFrom(localPath, remotePath);
    }
  } finally {
    client.trackProgress();
  }
}

async function resumeDownload(
  connId: string,
  remotePath: string,
  localPath: string,
  onProgress?: (transferred: number, total: number) => void,
): Promise<void> {
  const { client } = getConn(connId);

  // Get remote file size
  let total = 0;
  try {
    total = await client.size(remotePath);
  } catch {
    // Fall back to non-resume download
    return download(connId, remotePath, localPath, onProgress);
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

  if (onProgress) {
    client.trackProgress((info) => {
      onProgress(localSize + info.bytes, total);
    });
  }

  try {
    const stream = fs.createWriteStream(localPath, { flags: localSize > 0 ? 'a' : 'w' });
    await client.downloadTo(stream, remotePath, localSize);
  } finally {
    client.trackProgress();
  }
}

// ── Recursive directory operations ─────────────────────────────

export async function uploadDir(
  connId: string,
  localDir: string,
  remoteDir: string,
  onProgress?: (file: string, fileIndex: number, totalFiles: number) => void,
): Promise<void> {
  const { client } = getConn(connId);

  if (onProgress) {
    // Count all files first
    const allFiles: string[] = [];
    const countFiles = (dir: string) => {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          countFiles(fullPath);
        } else {
          allFiles.push(fullPath);
        }
      }
    };
    countFiles(localDir);

    let fileIndex = 0;
    client.trackProgress((info) => {
      onProgress(info.name, fileIndex + 1, allFiles.length);
    });

    try {
      await client.uploadFromDir(localDir, remoteDir);
    } finally {
      client.trackProgress();
    }
  } else {
    await client.uploadFromDir(localDir, remoteDir);
  }
}

export async function downloadDir(
  connId: string,
  remoteDir: string,
  localDir: string,
  onProgress?: (file: string, fileIndex: number, totalFiles: number) => void,
): Promise<void> {
  const { client } = getConn(connId);

  // Ensure local directory exists
  fs.mkdirSync(localDir, { recursive: true });

  if (onProgress) {
    // Count remote files first
    const allFiles: string[] = [];
    const countFiles = async (dir: string) => {
      const entries = await client.list(dir);
      for (const entry of entries) {
        if (entry.name === '.' || entry.name === '..') continue;
        const fullPath = path.posix.join(dir, entry.name);
        if (entry.isDirectory) {
          await countFiles(fullPath);
        } else {
          allFiles.push(fullPath);
        }
      }
    };
    await countFiles(remoteDir);

    let fileIndex = 0;
    client.trackProgress((info) => {
      onProgress(info.name, fileIndex + 1, allFiles.length);
    });

    try {
      await client.downloadToDir(localDir, remoteDir);
    } finally {
      client.trackProgress();
    }
  } else {
    await client.downloadToDir(localDir, remoteDir);
  }
}

export async function deleteDir(connId: string, dirPath: string): Promise<void> {
  const { client } = getConn(connId);

  // Recursively list and delete all contents
  const entries = await client.list(dirPath);

  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') continue;
    const fullPath = path.posix.join(dirPath, entry.name);
    if (entry.isDirectory) {
      await deleteDir(connId, fullPath);
    } else {
      await client.remove(fullPath);
    }
  }

  // Remove the now-empty directory
  await client.removeDir(dirPath);
}

// ── Helpers ────────────────────────────────────────────────────

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
