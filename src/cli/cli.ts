#!/usr/bin/env node
/**
 * BridgeFile CLI — headless file transfer for CI/CD and scripts.
 *
 * Usage:
 *   bridgefile <command> [options]
 *
 * Commands:
 *   list <url>                  List files at a remote path
 *   upload <local> <url>        Upload a local file or directory
 *   download <url> <local>      Download a remote file or directory
 *   help                        Show this message
 *
 * URL format (keep secrets in env vars, not argv):
 *   sftp://user@host[:port]/path      (env: BF_PASSWORD or BF_PRIVATE_KEY)
 *   ftp://user@host[:port]/path       (env: BF_PASSWORD)
 *   s3://bucket[/prefix]              (env: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION)
 *
 * Examples:
 *   bridgefile list sftp://user@host:22/home/user
 *   bridgefile upload ./dist sftp://user@host/var/www
 *   AWS_REGION=us-east-1 bridgefile download s3://my-bucket/data ./data
 */

import * as fs from 'fs';
import * as sftp from '../main/protocols/sftp';
import * as ftp from '../main/protocols/ftp';
import * as s3 from '../main/protocols/s3';

interface ParsedUrl {
  protocol: 'sftp' | 'ftp' | 's3';
  username?: string;
  host?: string;
  port?: number;
  path: string;
  bucket?: string;
  prefix?: string;
}

function parseUrl(url: string): ParsedUrl {
  if (url.startsWith('sftp://') || url.startsWith('ftp://')) {
    const isSftp = url.startsWith('sftp://');
    const rest = url.slice(isSftp ? 7 : 6);
    const match = rest.match(/^(?:([^@]+)@)?([^:/]+)(?::(\d+))?(\/.*)?$/);
    if (!match) throw new Error(`Invalid URL: ${url}`);
    return {
      protocol: isSftp ? 'sftp' : 'ftp',
      username: match[1],
      host: match[2],
      port: match[3] ? Number(match[3]) : (isSftp ? 22 : 21),
      path: match[4] || '/',
    };
  }
  if (url.startsWith('s3://')) {
    const rest = url.slice(5);
    const slash = rest.indexOf('/');
    const bucket = slash < 0 ? rest : rest.slice(0, slash);
    const prefix = slash < 0 ? '' : rest.slice(slash + 1);
    return { protocol: 's3', bucket, prefix, path: '/' + prefix };
  }
  throw new Error(`Unsupported URL scheme: ${url}`);
}

function env(key: string): string | undefined {
  return process.env[key];
}

async function connect(parsed: ParsedUrl): Promise<string> {
  if (parsed.protocol === 'sftp') {
    if (!parsed.host || !parsed.username) throw new Error('SFTP URL must include user@host');
    const privateKey = env('BF_PRIVATE_KEY');
    const password = env('BF_PASSWORD');
    if (!privateKey && !password) {
      throw new Error('Set BF_PASSWORD or BF_PRIVATE_KEY for SFTP auth');
    }
    return sftp.connect({
      host: parsed.host,
      port: parsed.port ?? 22,
      username: parsed.username,
      privateKey,
      password,
      passphrase: env('BF_PASSPHRASE'),
    });
  }
  if (parsed.protocol === 'ftp') {
    if (!parsed.host || !parsed.username) throw new Error('FTP URL must include user@host');
    return ftp.connect({
      host: parsed.host,
      port: parsed.port ?? 21,
      username: parsed.username,
      password: env('BF_PASSWORD') ?? '',
      secure: env('BF_FTPS') === '1' || env('BF_FTPS') === 'true',
    });
  }
  // s3
  if (!parsed.bucket) throw new Error('S3 URL must include bucket');
  const accessKeyId = env('AWS_ACCESS_KEY_ID');
  const secretAccessKey = env('AWS_SECRET_ACCESS_KEY');
  const region = env('AWS_REGION') ?? env('AWS_DEFAULT_REGION');
  if (!accessKeyId || !secretAccessKey || !region) {
    throw new Error('Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION');
  }
  return s3.connect({
    accessKeyId,
    secretAccessKey,
    region,
    bucket: parsed.bucket,
    prefix: parsed.prefix,
    endpoint: env('AWS_ENDPOINT_URL'),
    forcePathStyle: env('AWS_S3_FORCE_PATH_STYLE') === '1',
  });
}

function getApi(protocol: 'sftp' | 'ftp' | 's3') {
  if (protocol === 'sftp') return sftp;
  if (protocol === 'ftp') return ftp;
  return s3;
}

function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function printProgress(prefix: string, done: number, total: number): void {
  const pct = total > 0 ? ((done / total) * 100).toFixed(1) : '0.0';
  process.stderr.write(`\r${prefix} ${pct}% (${formatSize(done)}/${formatSize(total)})     `);
}

async function commandList(url: string): Promise<void> {
  const parsed = parseUrl(url);
  const connId = await connect(parsed);
  try {
    const api = getApi(parsed.protocol);
    const entries = await api.list(connId, parsed.path);
    for (const e of entries) {
      const kind = e.isDirectory ? 'd' : '-';
      const size = e.isDirectory ? '—' : formatSize(e.size);
      const modified = e.modifiedAt ? new Date(e.modifiedAt).toISOString().slice(0, 16).replace('T', ' ') : '                ';
      console.log(`${kind} ${size.padStart(10)}  ${modified}  ${e.name}`);
    }
  } finally {
    await getApi(parsed.protocol).disconnect(connId);
  }
}

async function commandUpload(local: string, url: string): Promise<void> {
  if (!fs.existsSync(local)) throw new Error(`Local path not found: ${local}`);
  const parsed = parseUrl(url);
  const connId = await connect(parsed);
  try {
    const api = getApi(parsed.protocol);
    const stat = fs.statSync(local);
    if (stat.isDirectory()) {
      const startedAt = Date.now();
      await (api as any).uploadDir(connId, local, parsed.path, (file: string, idx: number, total: number) => {
        process.stderr.write(`\r[${idx}/${total}] ${file}     `);
      });
      process.stderr.write(`\n✓ Uploaded directory in ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);
    } else {
      const startedAt = Date.now();
      await api.upload(connId, local, parsed.path, (done, total) => printProgress('Uploading', done, total));
      process.stderr.write(`\n✓ Uploaded ${formatSize(stat.size)} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);
    }
  } finally {
    await getApi(parsed.protocol).disconnect(connId);
  }
}

async function commandDownload(url: string, local: string): Promise<void> {
  const parsed = parseUrl(url);
  const connId = await connect(parsed);
  try {
    const api = getApi(parsed.protocol);
    const rstat = await api.stat(connId, parsed.path);
    if (rstat.isDirectory) {
      const startedAt = Date.now();
      await (api as any).downloadDir(connId, parsed.path, local, (file: string, idx: number, total: number) => {
        process.stderr.write(`\r[${idx}/${total}] ${file}     `);
      });
      process.stderr.write(`\n✓ Downloaded directory in ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);
    } else {
      const startedAt = Date.now();
      await api.download(connId, parsed.path, local, (done, total) => printProgress('Downloading', done, total));
      process.stderr.write(`\n✓ Downloaded in ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);
    }
  } finally {
    await getApi(parsed.protocol).disconnect(connId);
  }
}

function printHelp(): void {
  console.log(`BridgeFile CLI

Usage:
  bridgefile <command> [options]

Commands:
  list <url>                 List files at a remote path
  upload <local> <url>       Upload a local file or directory
  download <url> <local>     Download a remote file or directory
  help                       Show this message

URL format:
  sftp://user@host[:port]/path       env: BF_PASSWORD or BF_PRIVATE_KEY, BF_PASSPHRASE
  ftp://user@host[:port]/path        env: BF_PASSWORD, BF_FTPS=1 for FTPS
  s3://bucket[/prefix]               env: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION

Examples:
  bridgefile list sftp://me@host:22/var/www
  BF_PASSWORD=secret bridgefile upload ./dist sftp://me@host/var/www
  AWS_REGION=us-east-1 bridgefile download s3://bucket/key.tgz ./key.tgz
`);
}

async function main(): Promise<void> {
  const [, , cmd, ...args] = process.argv;
  try {
    switch (cmd) {
      case 'list':
        if (!args[0]) throw new Error('Usage: bridgefile list <url>');
        await commandList(args[0]);
        break;
      case 'upload':
        if (!args[0] || !args[1]) throw new Error('Usage: bridgefile upload <local> <url>');
        await commandUpload(args[0], args[1]);
        break;
      case 'download':
        if (!args[0] || !args[1]) throw new Error('Usage: bridgefile download <url> <local>');
        await commandDownload(args[0], args[1]);
        break;
      case 'help':
      case '--help':
      case '-h':
      case undefined:
        printHelp();
        break;
      default:
        console.error(`Unknown command: ${cmd}`);
        printHelp();
        process.exit(2);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  } finally {
    // The connection pools have timers that keep the process alive; force exit
    setTimeout(() => process.exit(0), 100).unref();
  }
}

main();
