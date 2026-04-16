export interface ParsedUrl {
  protocol: 'sftp' | 'ftp' | 's3';
  username?: string;
  host?: string;
  port?: number;
  path: string;
  bucket?: string;
  prefix?: string;
}

export function parseUrl(url: string): ParsedUrl {
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
