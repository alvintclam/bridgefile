import type {
  ConnectionProfile as StoredConnectionProfile,
  FTPConfig,
  ProtocolType,
  S3Config,
  SFTPConfig,
} from './types';

export interface UIConnectionProfile {
  id: string;
  name: string;
  type: 'SFTP' | 'S3' | 'FTP';
  favorite: boolean;
  lastUsed?: number;
  group?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  proxyHost?: string;
  proxyPort?: number;
  proxyUsername?: string;
  proxyPassword?: string;
  secure?: boolean;
  accessKey?: string;
  secretKey?: string;
  region?: string;
  bucket?: string;
  prefix?: string;
  endpoint?: string;
  timeout?: number;
}

export type ProtocolTab = UIConnectionProfile['type'];

export const DEFAULT_GROUPS: string[] = ['Production', 'Staging', 'Personal'];

export const TAB_TO_PROTOCOL: Record<ProtocolTab, ProtocolType> = {
  SFTP: 'sftp',
  FTP: 'ftp',
  S3: 's3',
};

export const PROTOCOL_TO_TAB: Record<ProtocolType, ProtocolTab> = {
  sftp: 'SFTP',
  ftp: 'FTP',
  s3: 'S3',
};

export const EMPTY_SFTP: Partial<UIConnectionProfile> = {
  name: '',
  type: 'SFTP',
  host: '',
  port: 22,
  username: '',
  password: '',
  privateKeyPath: '',
  passphrase: '',
  proxyHost: '',
  proxyPort: 22,
  proxyUsername: '',
  proxyPassword: '',
  favorite: false,
  group: '',
  timeout: 30,
};

export const EMPTY_FTP: Partial<UIConnectionProfile> = {
  name: '',
  type: 'FTP',
  host: '',
  port: 21,
  username: '',
  password: '',
  secure: false,
  favorite: false,
  group: '',
  timeout: 30,
};

export const EMPTY_S3: Partial<UIConnectionProfile> = {
  name: '',
  type: 'S3',
  accessKey: '',
  secretKey: '',
  region: 'us-east-1',
  bucket: '',
  prefix: '',
  endpoint: '',
  favorite: false,
  group: '',
  timeout: 30,
};

export function toUIProfile(profile: StoredConnectionProfile): UIConnectionProfile {
  const base = {
    id: profile.id,
    name: profile.name,
    type: PROTOCOL_TO_TAB[profile.type],
    favorite: profile.favorite,
    lastUsed: profile.lastUsed,
    group: profile.group,
  };

  switch (profile.type) {
    case 'sftp': {
      const config = profile.config as SFTPConfig;
      return {
        ...base,
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        privateKeyPath: config.privateKey,
        passphrase: config.passphrase,
        proxyHost: config.proxyHost,
        proxyPort: config.proxyPort,
        proxyUsername: config.proxyUsername,
        proxyPassword: config.proxyPassword,
        timeout: config.timeout,
      };
    }
    case 'ftp': {
      const config = profile.config as FTPConfig;
      return {
        ...base,
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        secure: config.secure,
        timeout: config.timeout,
      };
    }
    case 's3': {
      const config = profile.config as S3Config;
      return {
        ...base,
        accessKey: config.accessKeyId,
        secretKey: config.secretAccessKey,
        region: config.region,
        bucket: config.bucket,
        prefix: config.prefix,
        endpoint: config.endpoint,
        timeout: config.timeout,
      };
    }
  }
}

export function toStoredProfile(profile: UIConnectionProfile): StoredConnectionProfile {
  switch (profile.type) {
    case 'SFTP':
      return {
        id: profile.id,
        name: profile.name,
        type: TAB_TO_PROTOCOL[profile.type],
        favorite: profile.favorite,
        lastUsed: profile.lastUsed,
        group: profile.group,
        config: {
          host: profile.host || '',
          port: profile.port || 22,
          username: profile.username || '',
          password: profile.password,
          privateKey: profile.privateKeyPath,
          passphrase: profile.passphrase,
          proxyHost: profile.proxyHost,
          proxyPort: profile.proxyPort,
          proxyUsername: profile.proxyUsername,
          proxyPassword: profile.proxyPassword,
          timeout: profile.timeout ?? 30,
        },
      };
    case 'FTP':
      return {
        id: profile.id,
        name: profile.name,
        type: TAB_TO_PROTOCOL[profile.type],
        favorite: profile.favorite,
        lastUsed: profile.lastUsed,
        group: profile.group,
        config: {
          host: profile.host || '',
          port: profile.port || 21,
          username: profile.username || '',
          password: profile.password || '',
          secure: profile.secure || false,
          timeout: profile.timeout ?? 30,
        },
      };
    case 'S3':
      return {
        id: profile.id,
        name: profile.name,
        type: TAB_TO_PROTOCOL[profile.type],
        favorite: profile.favorite,
        lastUsed: profile.lastUsed,
        group: profile.group,
        config: {
          accessKeyId: profile.accessKey || '',
          secretAccessKey: profile.secretKey || '',
          region: profile.region || 'us-east-1',
          bucket: profile.bucket || '',
          prefix: profile.prefix,
          endpoint: profile.endpoint,
          timeout: profile.timeout ?? 30,
        },
      };
  }
}

export function toSftpConnectConfig(profile: UIConnectionProfile): SFTPConfig {
  return {
    host: profile.host || '',
    port: profile.port || 22,
    username: profile.username || '',
    password: profile.password,
    privateKey: profile.privateKeyPath,
    passphrase: profile.passphrase || undefined,
    proxyHost: profile.proxyHost || undefined,
    proxyPort: profile.proxyHost ? profile.proxyPort || 22 : undefined,
    proxyUsername: profile.proxyUsername || undefined,
    proxyPassword: profile.proxyPassword || undefined,
    timeout: profile.timeout ?? 30,
  };
}

export function mergeGroups(profiles: UIConnectionProfile[]): string[] {
  return Array.from(
    new Set([
      ...DEFAULT_GROUPS,
      ...profiles
        .map((profile) => profile.group?.trim())
        .filter((group): group is string => Boolean(group)),
    ]),
  );
}
