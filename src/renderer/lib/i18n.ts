// ── Simple i18n system ──────────────────────────────────────────

export type Locale = 'en' | 'zh-TW';

const STORAGE_KEY = 'bridgefile-locale';

let currentLocale: Locale = 'en';

// Initialize from localStorage
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'zh-TW') {
    currentLocale = stored;
  }
} catch {
  // Ignore — localStorage may not be available
}

const translations: Record<Locale, Record<string, string>> = {
  en: {
    // Connection
    'connect': 'Connect',
    'disconnect': 'Disconnect',
    'connecting': 'Connecting...',
    'connected': 'Connected',
    'disconnected': 'Disconnected',
    'connection_name': 'Connection Name',
    'connections': 'Connections',
    'new_connection': '+ New',
    'save': 'Save',
    'cancel': 'Cancel',
    'delete': 'Delete',

    // File operations
    'upload': 'Upload',
    'download': 'Download',
    'rename': 'Rename',
    'new_folder': 'New Folder',
    'refresh': 'Refresh',
    'search': 'Search',
    'select_all': 'Select All',
    'copy': 'Copy',
    'paste': 'Paste',
    'cut': 'Cut',

    // Panels
    'local': 'Local',
    'remote': 'Remote',
    'transfers': 'Transfers',
    'log': 'Log',
    'settings': 'Settings',
    'transfer_queue': 'Transfer Queue',

    // Status
    'no_files': 'No files',
    'loading': 'Loading...',
    'error': 'Error',
    'success': 'Success',
    'failed': 'Failed',
    'completed': 'Completed',
    'cancelled': 'Cancelled',
    'queued': 'Queued',
    'in_progress': 'In Progress',

    // File info
    'name': 'Name',
    'size': 'Size',
    'modified': 'Modified',
    'permissions': 'Permissions',
    'type': 'Type',
    'file': 'File',
    'folder': 'Folder',

    // Connection form
    'host': 'Host',
    'port': 'Port',
    'username': 'Username',
    'password': 'Password',
    'private_key': 'Private Key Path',
    'timeout': 'Timeout (seconds)',
    'group': 'Group',

    // S3
    'access_key': 'Access Key',
    'secret_key': 'Secret Key',
    'region': 'Region',
    'bucket': 'Bucket',
    'prefix': 'Prefix',
    'endpoint': 'Custom Endpoint',

    // FTP
    'use_ftps': 'Use FTPS (TLS)',

    // SFTP proxy
    'jump_host': 'Jump Host / Proxy',
    'proxy_host': 'Proxy Host',
    'proxy_port': 'Port',
    'proxy_username': 'Proxy Username',
    'proxy_password': 'Proxy Password',

    // Checksum
    'checksum': 'Checksum',
    'verify': 'Verify',
    'computing': 'Computing...',
    'match': 'Match',
    'mismatch': 'Mismatch',
    'local_checksum': 'Local Checksum',
    'remote_checksum': 'Remote Checksum',

    // Update
    'update_available': 'BridgeFile v{version} available',
    'download_update': 'Download',
    'up_to_date': 'Up to date',

    // Misc
    'favorites': 'Favorites',
    'recent': 'Recent',
    'ungrouped': 'Ungrouped',
    'close': 'Close',
    'confirm': 'Confirm',
    'go_to_path': 'Go to Path',
    'bookmarks': 'Bookmarks',
    'add_bookmark': 'Add Bookmark',
    'export_logs': 'Export Logs',
    'edit_file': 'Edit File',
    'chmod': 'Change Permissions',
  },

  'zh-TW': {
    // Connection
    'connect': '\u9023\u7dda',
    'disconnect': '\u65b7\u958b\u9023\u7dda',
    'connecting': '\u9023\u7dda\u4e2d...',
    'connected': '\u5df2\u9023\u7dda',
    'disconnected': '\u5df2\u65b7\u958b',
    'connection_name': '\u9023\u7dda\u540d\u7a31',
    'connections': '\u9023\u7dda',
    'new_connection': '+ \u65b0\u589e',
    'save': '\u5132\u5b58',
    'cancel': '\u53d6\u6d88',
    'delete': '\u522a\u9664',

    // File operations
    'upload': '\u4e0a\u50b3',
    'download': '\u4e0b\u8f09',
    'rename': '\u91cd\u65b0\u547d\u540d',
    'new_folder': '\u65b0\u8cc7\u6599\u593e',
    'refresh': '\u91cd\u65b0\u6574\u7406',
    'search': '\u641c\u5c0b',
    'select_all': '\u5168\u9078',
    'copy': '\u8907\u88fd',
    'paste': '\u8cbc\u4e0a',
    'cut': '\u526a\u4e0b',

    // Panels
    'local': '\u672c\u6a5f',
    'remote': '\u9060\u7aef',
    'transfers': '\u50b3\u8f38',
    'log': '\u8a18\u9304',
    'settings': '\u8a2d\u5b9a',
    'transfer_queue': '\u50b3\u8f38\u4f47\u5217',

    // Status
    'no_files': '\u6c92\u6709\u6a94\u6848',
    'loading': '\u8f09\u5165\u4e2d...',
    'error': '\u932f\u8aa4',
    'success': '\u6210\u529f',
    'failed': '\u5931\u6557',
    'completed': '\u5df2\u5b8c\u6210',
    'cancelled': '\u5df2\u53d6\u6d88',
    'queued': '\u7b49\u5f85\u4e2d',
    'in_progress': '\u9032\u884c\u4e2d',

    // File info
    'name': '\u540d\u7a31',
    'size': '\u5927\u5c0f',
    'modified': '\u4fee\u6539\u65e5\u671f',
    'permissions': '\u6b0a\u9650',
    'type': '\u985e\u578b',
    'file': '\u6a94\u6848',
    'folder': '\u8cc7\u6599\u593e',

    // Connection form
    'host': '\u4e3b\u6a5f',
    'port': '\u9023\u63a5\u57e0',
    'username': '\u4f7f\u7528\u8005\u540d\u7a31',
    'password': '\u5bc6\u78bc',
    'private_key': '\u79c1\u5bc6\u91d1\u9470\u8def\u5f91',
    'timeout': '\u903e\u6642 (\u79d2)',
    'group': '\u7fa4\u7d44',

    // S3
    'access_key': '\u5b58\u53d6\u91d1\u9470',
    'secret_key': '\u79d8\u5bc6\u91d1\u9470',
    'region': '\u5340\u57df',
    'bucket': '\u5132\u5b58\u6876',
    'prefix': '\u524d\u7db4',
    'endpoint': '\u81ea\u8a02\u7aef\u9ede',

    // FTP
    'use_ftps': '\u4f7f\u7528 FTPS (TLS)',

    // SFTP proxy
    'jump_host': '\u8df3\u677f\u4e3b\u6a5f / \u4ee3\u7406',
    'proxy_host': '\u4ee3\u7406\u4e3b\u6a5f',
    'proxy_port': '\u9023\u63a5\u57e0',
    'proxy_username': '\u4ee3\u7406\u4f7f\u7528\u8005\u540d\u7a31',
    'proxy_password': '\u4ee3\u7406\u5bc6\u78bc',

    // Checksum
    'checksum': '\u6821\u9a57\u78bc',
    'verify': '\u9a57\u8b49',
    'computing': '\u8a08\u7b97\u4e2d...',
    'match': '\u76f8\u7b26',
    'mismatch': '\u4e0d\u76f8\u7b26',
    'local_checksum': '\u672c\u6a5f\u6821\u9a57\u78bc',
    'remote_checksum': '\u9060\u7aef\u6821\u9a57\u78bc',

    // Update
    'update_available': 'BridgeFile v{version} \u53ef\u7528',
    'download_update': '\u4e0b\u8f09',
    'up_to_date': '\u5df2\u662f\u6700\u65b0\u7248\u672c',

    // Misc
    'favorites': '\u6536\u85cf',
    'recent': '\u6700\u8fd1',
    'ungrouped': '\u672a\u5206\u7d44',
    'close': '\u95dc\u9589',
    'confirm': '\u78ba\u8a8d',
    'go_to_path': '\u524d\u5f80\u8def\u5f91',
    'bookmarks': '\u66f8\u7c64',
    'add_bookmark': '\u65b0\u589e\u66f8\u7c64',
    'export_logs': '\u532f\u51fa\u8a18\u9304',
    'edit_file': '\u7de8\u8f2f\u6a94\u6848',
    'chmod': '\u8b8a\u66f4\u6b0a\u9650',
  },
};

/**
 * Get a translated string by key.
 * Supports simple interpolation: t('update_available', { version: '0.2.0' })
 */
export function t(key: string, params?: Record<string, string>): string {
  let value = translations[currentLocale]?.[key] ?? translations.en[key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(`{${k}}`, v);
    }
  }

  return value;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Ignore
  }
}

export function getLocale(): Locale {
  return currentLocale;
}
