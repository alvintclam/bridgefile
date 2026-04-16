// Import/export connection profiles.
// Supports BridgeFile native JSON format, FileZilla XML (sitemanager.xml), and WinSCP INI.

export interface ImportedProfile {
  name: string;
  type: 'SFTP' | 'FTP' | 'S3';
  host?: string;
  port?: number;
  username?: string;
  // S3
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  bucket?: string;
  prefix?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  // FTP
  secure?: boolean;
  // SFTP
  proxyHost?: string;
  proxyPort?: number;
  proxyUsername?: string;
  // Common
  timeout?: number;
  group?: string;
  favorite?: boolean;
}

export interface ExportBundle {
  version: 1;
  exportedAt: string;
  profiles: ImportedProfile[];
}

// ── BridgeFile native JSON (round-trip) ─────────────────────────

export function exportToJSON(profiles: ImportedProfile[]): string {
  const bundle: ExportBundle = {
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles,
  };
  return JSON.stringify(bundle, null, 2);
}

export function importFromJSON(text: string): ImportedProfile[] {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed as ImportedProfile[];
  if (parsed && Array.isArray(parsed.profiles)) return parsed.profiles;
  throw new Error('Invalid JSON format');
}

// ── FileZilla sitemanager.xml ──────────────────────────────────
// Schema (simplified): <Servers><Server><Name>...</Name><Host>...</Host><Port>...</Port>...
// Protocol: 0 = FTP, 1 = SFTP (FileZilla enum)

export function importFromFileZilla(xml: string): ImportedProfile[] {
  const profiles: ImportedProfile[] = [];
  // Simple regex-based parser — sufficient for FileZilla's flat XML
  const serverBlocks = xml.match(/<Server>[\s\S]*?<\/Server>/g) ?? [];

  for (const block of serverBlocks) {
    const get = (tag: string): string | undefined => {
      const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
      return m ? decodeXmlEntities(m[1].trim()) : undefined;
    };

    const protocolRaw = get('Protocol');
    const proto: 'SFTP' | 'FTP' = protocolRaw === '1' ? 'SFTP' : 'FTP';
    const name = get('Name') || get('Host') || 'Imported';
    const host = get('Host');
    const portStr = get('Port');
    const port = portStr ? Number(portStr) : (proto === 'SFTP' ? 22 : 21);
    const username = get('User');

    profiles.push({
      name,
      type: proto,
      host,
      port,
      username,
      group: 'Imported from FileZilla',
    });
  }

  return profiles;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// ── WinSCP INI ─────────────────────────────────────────────────
// Sessions live under [Sessions\sessionName] with HostName, UserName, PortNumber, FSProtocol, etc.
// FSProtocol: 0 = SCP, 5 = SFTP (fallback SCP), 2 = SFTP, 1 = FTP

export function importFromWinSCP(ini: string): ImportedProfile[] {
  const profiles: ImportedProfile[] = [];
  const lines = ini.split(/\r?\n/);

  let currentName: string | null = null;
  let currentData: Record<string, string> = {};

  const flush = () => {
    if (!currentName) return;
    const protocolNum = Number(currentData.FSProtocol ?? '');
    const type: 'SFTP' | 'FTP' = protocolNum === 1 ? 'FTP' : 'SFTP';
    const defaultPort = type === 'SFTP' ? 22 : 21;

    profiles.push({
      name: decodeURIComponent(currentName.replace(/\+/g, ' ')),
      type,
      host: currentData.HostName,
      port: currentData.PortNumber ? Number(currentData.PortNumber) : defaultPort,
      username: currentData.UserName,
      secure: type === 'FTP' ? currentData.Ftps === '3' : undefined,
      group: 'Imported from WinSCP',
    });

    currentName = null;
    currentData = {};
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';')) continue;
    const section = trimmed.match(/^\[Sessions\\(.+)\]$/);
    if (section) {
      flush();
      currentName = section[1];
      continue;
    }
    if (currentName) {
      const kv = trimmed.match(/^([^=]+)=(.*)$/);
      if (kv) currentData[kv[1].trim()] = kv[2].trim();
    }
  }
  flush();

  return profiles;
}

// ── Auto-detect format ─────────────────────────────────────────

export function importAuto(text: string, filename?: string): ImportedProfile[] {
  const trimmed = text.trimStart();
  const lower = (filename || '').toLowerCase();

  if (lower.endsWith('.xml') || trimmed.startsWith('<?xml') || trimmed.startsWith('<Servers') || trimmed.includes('<FileZilla3')) {
    return importFromFileZilla(text);
  }
  if (lower.endsWith('.ini') || trimmed.includes('[Sessions\\')) {
    return importFromWinSCP(text);
  }
  // Fallback to JSON
  return importFromJSON(text);
}
