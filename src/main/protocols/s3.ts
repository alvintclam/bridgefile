import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Readable } from 'stream';
import type { S3Config, FileEntry } from '../../shared/types';

// ── Connection pool ────────────────────────────────────────────

interface PooledS3 {
  id: string;
  client: S3Client;
  config: S3Config;
  bucket: string;
  /** Normalised prefix — always empty string or ends with '/' */
  rootPrefix: string;
  lastActivity: number;
}

const pool = new Map<string, PooledS3>();

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

setInterval(() => {
  const now = Date.now();
  for (const [id, conn] of pool) {
    if (now - conn.lastActivity > IDLE_TIMEOUT_MS) {
      conn.client.destroy();
      pool.delete(id);
    }
  }
}, 60_000);

function touch(connId: string): void {
  const conn = pool.get(connId);
  if (conn) conn.lastActivity = Date.now();
}

function getConn(connId: string): PooledS3 {
  const conn = pool.get(connId);
  if (!conn) throw new Error(`S3 connection "${connId}" not found or expired`);
  touch(connId);
  return conn;
}

/**
 * Resolve a virtual path (what the UI sees) to the real S3 key
 * by prepending the configured root prefix.
 */
function resolveKey(conn: PooledS3, virtualPath: string): string {
  // Strip leading slash — S3 keys should never start with /
  const clean = virtualPath.replace(/^\/+/, '');
  return conn.rootPrefix + clean;
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Connect to an S3 bucket.
 *
 * **Single-bucket mode:** the bucket is fixed in config. We never call
 * ListBuckets, so the IAM user only needs s3:ListBucket + s3:GetObject +
 * s3:PutObject + s3:DeleteObject on the one bucket ARN.
 */
export async function connect(config: S3Config): Promise<string> {
  const id = crypto.randomUUID();

  const clientConfig: Record<string, unknown> = {
    region: config.region || 'us-east-1',
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  };

  if (config.endpoint) {
    clientConfig.endpoint = config.endpoint;
    clientConfig.forcePathStyle = config.forcePathStyle ?? true;
  }

  const client = new S3Client(clientConfig as any);

  // Validate access with a small list call (max 1 key)
  try {
    await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        MaxKeys: 1,
        Prefix: config.prefix ?? '',
      }),
    );
  } catch (err: any) {
    client.destroy();
    throw new Error(`S3 connection failed: ${err.message}`);
  }

  // Normalise root prefix
  let rootPrefix = (config.prefix ?? '').replace(/^\/+/, '');
  if (rootPrefix && !rootPrefix.endsWith('/')) rootPrefix += '/';

  pool.set(id, {
    id,
    client,
    config,
    bucket: config.bucket,
    rootPrefix,
    lastActivity: Date.now(),
  });

  return id;
}

export async function disconnect(connId: string): Promise<void> {
  const conn = pool.get(connId);
  if (conn) {
    conn.client.destroy();
    pool.delete(connId);
  }
}

/**
 * List objects under `virtualPath`.
 *
 * Uses Delimiter='/' + CommonPrefixes to simulate directory listing.
 * Handles pagination automatically.
 */
export async function list(connId: string, virtualPath: string): Promise<FileEntry[]> {
  const conn = getConn(connId);

  let prefix = resolveKey(conn, virtualPath);
  if (prefix && !prefix.endsWith('/')) prefix += '/';

  const entries: FileEntry[] = [];
  let continuationToken: string | undefined;

  do {
    const resp = await conn.client.send(
      new ListObjectsV2Command({
        Bucket: conn.bucket,
        Prefix: prefix,
        Delimiter: '/',
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );

    // Directories (common prefixes)
    for (const cp of resp.CommonPrefixes ?? []) {
      if (!cp.Prefix) continue;
      const dirName = cp.Prefix.slice(prefix.length).replace(/\/$/, '');
      if (!dirName) continue; // skip self

      const displayPath = stripRootPrefix(conn, cp.Prefix);
      entries.push({
        name: dirName,
        path: '/' + displayPath.replace(/\/$/, ''),
        size: 0,
        modifiedAt: 0,
        isDirectory: true,
      });
    }

    // Files
    for (const obj of resp.Contents ?? []) {
      if (!obj.Key) continue;
      // Skip the "directory marker" itself
      if (obj.Key === prefix) continue;

      const fileName = obj.Key.slice(prefix.length);
      // Skip if this looks like a nested path (shouldn't happen with Delimiter)
      if (fileName.includes('/')) continue;

      const displayPath = stripRootPrefix(conn, obj.Key);
      entries.push({
        name: fileName,
        path: '/' + displayPath,
        size: obj.Size ?? 0,
        modifiedAt: obj.LastModified?.getTime() ?? 0,
        isDirectory: false,
        meta: obj.StorageClass ? { storageClass: obj.StorageClass } : undefined,
      });
    }

    continuationToken = resp.NextContinuationToken;
  } while (continuationToken);

  // Directories first, then alphabetical
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return entries;
}

export async function upload(
  connId: string,
  localPath: string,
  remotePath: string,
  onProgress?: (transferred: number, total: number) => void,
): Promise<void> {
  const conn = getConn(connId);
  const key = resolveKey(conn, remotePath);
  const stat = fs.statSync(localPath);
  const total = stat.size;

  // For files under 100 MB, use simple PutObject with a stream
  const body = fs.createReadStream(localPath);

  let transferred = 0;
  body.on('data', (chunk: Buffer) => {
    transferred += chunk.length;
    onProgress?.(transferred, total);
  });

  await conn.client.send(
    new PutObjectCommand({
      Bucket: conn.bucket,
      Key: key,
      Body: body,
      ContentLength: total,
    }),
  );
}

export async function download(
  connId: string,
  remotePath: string,
  localPath: string,
  onProgress?: (transferred: number, total: number) => void,
): Promise<void> {
  const conn = getConn(connId);
  const key = resolveKey(conn, remotePath);

  const resp = await conn.client.send(
    new GetObjectCommand({
      Bucket: conn.bucket,
      Key: key,
    }),
  );

  const total = resp.ContentLength ?? 0;

  // Ensure local directory exists
  const dir = path.dirname(localPath);
  fs.mkdirSync(dir, { recursive: true });

  const body = resp.Body as Readable;
  const writeStream = fs.createWriteStream(localPath);
  let transferred = 0;

  return new Promise((resolve, reject) => {
    body.on('data', (chunk: Buffer) => {
      transferred += chunk.length;
      onProgress?.(transferred, total);
    });

    body.on('error', (err: Error) =>
      reject(new Error(`S3 download stream error: ${err.message}`)),
    );
    writeStream.on('error', (err: Error) =>
      reject(new Error(`Write error: ${err.message}`)),
    );
    writeStream.on('close', () => resolve());

    body.pipe(writeStream);
  });
}

/**
 * Create a "directory" by putting an empty object with trailing slash.
 */
export async function mkdir(connId: string, dirPath: string): Promise<void> {
  const conn = getConn(connId);
  let key = resolveKey(conn, dirPath);
  if (!key.endsWith('/')) key += '/';

  await conn.client.send(
    new PutObjectCommand({
      Bucket: conn.bucket,
      Key: key,
      Body: '',
      ContentLength: 0,
    }),
  );
}

/**
 * Rename an object by copying to the new key and deleting the original.
 * For "directories" (prefix), this renames all objects under the prefix.
 */
export async function rename(
  connId: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  const conn = getConn(connId);
  const oldKey = resolveKey(conn, oldPath);
  const newKey = resolveKey(conn, newPath);

  // Check if it's a "directory" (has sub-objects)
  const probe = await conn.client.send(
    new ListObjectsV2Command({
      Bucket: conn.bucket,
      Prefix: oldKey.endsWith('/') ? oldKey : oldKey + '/',
      MaxKeys: 1,
    }),
  );

  if ((probe.Contents?.length ?? 0) > 0) {
    // It's a prefix/directory — rename all objects under it
    await renamePrefix(conn, oldKey, newKey);
  } else {
    // Single object
    await conn.client.send(
      new CopyObjectCommand({
        Bucket: conn.bucket,
        CopySource: `${conn.bucket}/${oldKey}`,
        Key: newKey,
      }),
    );

    await conn.client.send(
      new DeleteObjectCommand({
        Bucket: conn.bucket,
        Key: oldKey,
      }),
    );
  }
}

/**
 * Delete an object or all objects under a prefix.
 */
export async function del(connId: string, targetPath: string): Promise<void> {
  const conn = getConn(connId);
  const key = resolveKey(conn, targetPath);

  // Try deleting as single object first
  await conn.client.send(
    new DeleteObjectCommand({
      Bucket: conn.bucket,
      Key: key,
    }),
  );

  // Also delete the "directory marker" if it exists
  if (!key.endsWith('/')) {
    try {
      await conn.client.send(
        new DeleteObjectCommand({
          Bucket: conn.bucket,
          Key: key + '/',
        }),
      );
    } catch {
      // Ignore — marker may not exist
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Strip the root prefix from a key to get the virtual path the UI shows.
 */
function stripRootPrefix(conn: PooledS3, key: string): string {
  if (conn.rootPrefix && key.startsWith(conn.rootPrefix)) {
    return key.slice(conn.rootPrefix.length);
  }
  return key;
}

/**
 * Rename all objects under `oldPrefix` to `newPrefix`.
 * Used when "renaming a directory" in S3.
 */
async function renamePrefix(
  conn: PooledS3,
  oldPrefix: string,
  newPrefix: string,
): Promise<void> {
  const normalOld = oldPrefix.endsWith('/') ? oldPrefix : oldPrefix + '/';
  const normalNew = newPrefix.endsWith('/') ? newPrefix : newPrefix + '/';

  let continuationToken: string | undefined;

  do {
    const resp = await conn.client.send(
      new ListObjectsV2Command({
        Bucket: conn.bucket,
        Prefix: normalOld,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );

    for (const obj of resp.Contents ?? []) {
      if (!obj.Key) continue;

      const suffix = obj.Key.slice(normalOld.length);
      const destKey = normalNew + suffix;

      await conn.client.send(
        new CopyObjectCommand({
          Bucket: conn.bucket,
          CopySource: `${conn.bucket}/${obj.Key}`,
          Key: destKey,
        }),
      );

      await conn.client.send(
        new DeleteObjectCommand({
          Bucket: conn.bucket,
          Key: obj.Key,
        }),
      );
    }

    continuationToken = resp.NextContinuationToken;
  } while (continuationToken);
}
