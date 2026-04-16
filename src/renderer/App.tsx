import React, { useState, useRef, useCallback, useEffect } from 'react';
import ConnectionBar from './components/ConnectionBar';
import ConnectionManager from './components/ConnectionManager';
import type { ConnectionProfile } from './components/ConnectionManager';
import BookmarkBar from './components/BookmarkBar';
import FilePane from './components/FilePane';
import type { ExternalDropItem, ClipboardEntry } from './components/FilePane';
import TransferQueue from './components/TransferQueue';
import LogPanel, { logConnected, logDisconnected, logError } from './components/LogPanel';
import TabBar from './components/TabBar';
import type { SessionTab } from './components/TabBar';
import DirectoryCompare from './components/DirectoryCompare';
import SearchDialog from './components/SearchDialog';
import FileEditor from './components/FileEditor';
import ChecksumDialog from './components/ChecksumDialog';
import PermissionsDialog from './components/PermissionsDialog';
import OverwriteConfirmDialog from './components/OverwriteConfirmDialog';
import type { OverwriteAction, OverwriteDialogRequest, FileInfo } from './components/OverwriteConfirmDialog';
import { emptyOverwriteRequest } from './components/OverwriteConfirmDialog';
import { addLog } from './components/LogPanel';
import PreferencesDialog, { defaultPreferences } from './components/PreferencesDialog';
import type { Preferences } from './components/PreferencesDialog';

const PREFERENCES_STORAGE_KEY = 'bridgefile.preferences';

function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return defaultPreferences;
    return { ...defaultPreferences, ...JSON.parse(raw) };
  } catch {
    return defaultPreferences;
  }
}

function savePreferences(prefs: Preferences): void {
  try {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

type BottomTab = 'transfers' | 'log';

interface UpdateInfo {
  latestVersion: string;
  downloadUrl: string;
}

interface SelectedFileState {
  name: string;
  size?: number;
  permissions?: string;
  localPath?: string;
  remotePath?: string;
}

interface SyncRoots {
  local: string;
  remote: string;
}

interface QueueTransferState {
  id: string;
  connectionId: string;
  direction: 'upload' | 'download';
  status: string;
}

let tabIdCounter = 0;
function nextTabId(): string {
  tabIdCounter += 1;
  return `tab-${tabIdCounter}`;
}

function normalizePath(path: string): string {
  if (!path) return '/';
  if (path === '/') return '/';
  return path.replace(/\/+$/, '') || '/';
}

function joinChildPath(basePath: string, name: string): string {
  const normalizedBase = normalizePath(basePath);
  return normalizedBase === '/' ? `/${name}` : `${normalizedBase}/${name}`;
}

function getRelativePath(rootPath: string, targetPath: string): string | null {
  const normalizedRoot = normalizePath(rootPath);
  const normalizedTarget = normalizePath(targetPath);

  if (normalizedRoot === '/') {
    return normalizedTarget === '/' ? '' : normalizedTarget.slice(1);
  }
  if (normalizedTarget === normalizedRoot) {
    return '';
  }
  if (normalizedTarget.startsWith(`${normalizedRoot}/`)) {
    return normalizedTarget.slice(normalizedRoot.length + 1);
  }
  return null;
}

function applyRelativePath(rootPath: string, relativePath: string): string {
  const normalizedRoot = normalizePath(rootPath);
  if (!relativePath) return normalizedRoot;
  return normalizedRoot === '/' ? `/${relativePath}` : `${normalizedRoot}/${relativePath}`;
}

function isMissingPathError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ENOENT|not found|no such file|no such key|550/i.test(message);
}

function generateAutoRenamePath(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/');
  const dir = lastSlash >= 0 ? filePath.substring(0, lastSlash + 1) : '';
  const basename = lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;
  const dotIdx = basename.lastIndexOf('.');
  const name = dotIdx > 0 ? basename.substring(0, dotIdx) : basename;
  const ext = dotIdx > 0 ? basename.substring(dotIdx) : '';
  const match = name.match(/^(.+)_(\d+)$/);
  if (match) {
    return `${dir}${match[1]}_${Number(match[2]) + 1}${ext}`;
  }
  return `${dir}${name}_1${ext}`;
}

export default function App() {
  // ── Multi-tab session state ─────────────────────────────────
  const [tabs, setTabs] = useState<SessionTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Derive active tab's connection state
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const isConnected = activeTab !== null;
  const protocol = activeTab?.protocol ?? null;
  const connectionId = activeTab?.connectionId ?? null;
  const host = activeTab?.name ?? null;
  const remotePath = activeTab?.remotePath ?? null;

  // ── Auto-update ─────────────────────────────────────────────
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (typeof window !== 'undefined' && window.bridgefile) {
        window.bridgefile.app
          .checkForUpdates()
          .then((result: { hasUpdate: boolean; latestVersion: string; downloadUrl: string }) => {
            if (result.hasUpdate) {
              setUpdateInfo({
                latestVersion: result.latestVersion,
                downloadUrl: result.downloadUrl,
              });
            }
          })
          .catch(() => {
            // Silently ignore update check failures
          });
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.bridgefile) return;

    window.bridgefile.fs
      .getHomeDir()
      .then((homeDir: string) => setLocalPath(homeDir))
      .catch(() => setLocalPath('/'));
  }, []);

  // ── Synchronized browsing ───────────────────────────────────
  const [syncBrowsing, setSyncBrowsing] = useState(false);
  const [localPath, setLocalPath] = useState<string | null>(null);
  const [syncRoots, setSyncRoots] = useState<SyncRoots | null>(null);

  // ── UI state ────────────────────────────────────────────────
  const [theme, setTheme] = useState<'dark' | 'light'>(() => loadPreferences().theme);
  const [showConnectionManager, setShowConnectionManager] = useState(false);
  const [bottomTab, setBottomTab] = useState<BottomTab>('transfers');
  const [bottomCollapsed, setBottomCollapsed] = useState(false);
  const [bottomHeight, setBottomHeight] = useState(220);
  const [dividerPos, setDividerPos] = useState(50);

  // ── Overwrite dialog state ──────────────────────────────────
  const [overwriteRequest, setOverwriteRequest] = useState<OverwriteDialogRequest>(emptyOverwriteRequest);
  const [clipboard, setClipboard] = useState<ClipboardEntry | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences());
  const [showPreferences, setShowPreferences] = useState(false);

  const handleSavePreferences = useCallback((next: Preferences) => {
    setPreferences(next);
    savePreferences(next);
    setTheme(next.theme);
  }, []);

  // ── Dialog state ──────────────────────────────────────────────
  const [showCompare, setShowCompare] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showChecksum, setShowChecksum] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);
  const [selectedFile, setSelectedFile] = useState<SelectedFileState | null>(null);
  const [localRefreshToken, setLocalRefreshToken] = useState(0);
  const [remoteRefreshToken, setRemoteRefreshToken] = useState(0);
  const [transferBadgeCount, setTransferBadgeCount] = useState(0);

  const isDraggingBottom = useRef(false);
  const isDraggingDivider = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const seenCompletedTransfers = useRef<Map<string, string>>(new Map());

  const handleConnect = (profile: ConnectionProfile, connId: string) => {
    const tabName =
      profile.name ||
      (profile.type === 'SFTP' || profile.type === 'FTP'
        ? profile.host || 'Server'
        : profile.bucket || 'Bucket');

    const newTab: SessionTab = {
      id: nextTabId(),
      name: tabName,
      protocol: profile.type,
      connectionId: connId,
      remotePath: '/',
    };

    logConnected(profile.type, profile.host || profile.bucket || 'server', profile.username);
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setShowConnectionManager(false);
  };

  const handleDisconnect = () => {
    if (!activeTab) return;

    logDisconnected(activeTab.name);

    // Call disconnect via IPC if in Electron
    if (typeof window !== 'undefined' && window.bridgefile && activeTab.connectionId) {
      const proto = activeTab.protocol.toLowerCase() as 'sftp' | 's3' | 'ftp';
      const api = window.bridgefile[proto];
      api.disconnect(activeTab.connectionId).catch((err: unknown) => {
        logError(`Disconnect error: ${err instanceof Error ? err.message : String(err)}`);
      });
    }

    // Remove the active tab (derive next tab from fresh state, not stale closure)
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== activeTab.id);
      if (remaining.length === 0) {
        setActiveTabId(null);
      } else {
        const idx = prev.findIndex((t) => t.id === activeTab.id);
        const nextIdx = Math.min(idx, remaining.length - 1);
        setActiveTabId(remaining[nextIdx]?.id ?? null);
      }
      return remaining;
    });
  };

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return;

      // Disconnect in background
      if (typeof window !== 'undefined' && window.bridgefile && tab.connectionId) {
        const proto = tab.protocol.toLowerCase() as 'sftp' | 's3' | 'ftp';
        window.bridgefile[proto].disconnect(tab.connectionId).catch(() => {});
      }

      setTabs((prev) => {
        const remaining = prev.filter((t) => t.id !== tabId);
        if (tabId === activeTabId) {
          const idx = prev.findIndex((t) => t.id === tabId);
          const nextIdx = Math.min(idx, remaining.length - 1);
          setActiveTabId(remaining[nextIdx]?.id ?? null);
        }
        return remaining;
      });
    },
    [tabs, activeTabId],
  );

  const handleSelectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  const handleNewTab = useCallback(() => {
    setShowConnectionManager(true);
  }, []);

  const handleReorderTabs = useCallback((reordered: SessionTab[]) => {
    setTabs(reordered);
  }, []);

  // Update remote path for active tab
  const setRemotePath = useCallback(
    (path: string) => {
      if (!activeTabId) return;
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, remotePath: path } : t)),
      );
    },
    [activeTabId],
  );

  // ── Synchronized browsing handlers ──────────────────────────

  const handleLocalNavigate = useCallback(
    (newLocalPath: string) => {
      setLocalPath(newLocalPath);

      if (syncBrowsing && syncRoots) {
        const relativePath = getRelativePath(syncRoots.local, newLocalPath);
        if (relativePath !== null) {
          setRemotePath(applyRelativePath(syncRoots.remote, relativePath));
        }
      }
    },
    [syncBrowsing, syncRoots, setRemotePath],
  );

  const handleRemoteNavigate = useCallback(
    (newRemotePath: string) => {
      setRemotePath(newRemotePath);

      if (syncBrowsing && syncRoots) {
        const relativePath = getRelativePath(syncRoots.remote, newRemotePath);
        if (relativePath !== null) {
          setLocalPath(applyRelativePath(syncRoots.local, relativePath));
        }
      }
    },
    [syncBrowsing, syncRoots, setRemotePath],
  );

  // ── Bottom panel resize ─────────────────────────────────────

  const handleBottomDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingBottom.current = true;
  }, []);

  const handleDividerDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingDivider.current = true;
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingBottom.current) {
        const windowHeight = window.innerHeight;
        const newHeight = windowHeight - e.clientY;
        setBottomHeight(Math.max(100, Math.min(windowHeight * 0.6, newHeight)));
        if (bottomCollapsed) setBottomCollapsed(false);
      }
      if (isDraggingDivider.current && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const pct = ((e.clientX - rect.left) / rect.width) * 100;
        setDividerPos(Math.max(20, Math.min(80, pct)));
      }
    };

    const handleMouseUp = () => {
      isDraggingBottom.current = false;
      isDraggingDivider.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [bottomCollapsed]);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next: 'dark' | 'light' = prev === 'dark' ? 'light' : 'dark';
      setPreferences((p): Preferences => {
        const updated: Preferences = { ...p, theme: next };
        savePreferences(updated);
        return updated;
      });
      return next;
    });
  };

  // Derive the lowercase protocol for the remote pane
  const remoteProtocol = protocol
    ? (protocol.toLowerCase() as 'sftp' | 's3' | 'ftp')
    : undefined;

  const handleToggleSyncBrowsing = useCallback(() => {
    if (!syncBrowsing) {
      if (localPath && remotePath) {
        setSyncRoots({
          local: normalizePath(localPath),
          remote: normalizePath(remotePath),
        });
      }
    } else {
      setSyncRoots(null);
    }

    setSyncBrowsing((prev) => !prev);
  }, [syncBrowsing, localPath, remotePath]);

  useEffect(() => {
    seenCompletedTransfers.current = new Map();
  }, [connectionId]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.bridgefile) return;

    const pollQueue = async () => {
      try {
        const queue = await window.bridgefile.transfer.getQueue() as QueueTransferState[];
        setTransferBadgeCount(
          queue.filter((item) => item.status !== 'completed' && item.status !== 'cancelled').length,
        );

        if (!connectionId) {
          return;
        }

        const nextSeen = new Map(seenCompletedTransfers.current);
        let refreshLocal = false;
        let refreshRemote = false;

        for (const item of queue) {
          if (item.connectionId !== connectionId) continue;

          if (item.status === 'completed') {
            if (nextSeen.get(item.id) !== 'completed') {
              if (item.direction === 'upload') {
                refreshRemote = true;
              } else {
                refreshLocal = true;
              }
            }
            nextSeen.set(item.id, 'completed');
          } else {
            nextSeen.set(item.id, item.status);
          }
        }

        seenCompletedTransfers.current = nextSeen;

        if (refreshRemote) {
          setRemoteRefreshToken((token) => token + 1);
        }
        if (refreshLocal) {
          setLocalRefreshToken((token) => token + 1);
        }
      } catch {
        // Ignore polling failures
      }
    };

    pollQueue();
    const intervalId = window.setInterval(pollQueue, 750);
    return () => window.clearInterval(intervalId);
  }, [connectionId]);

  const getLocalEntryIfExists = useCallback(async (targetPath: string) => {
    try {
      return await window.bridgefile.fs.stat(targetPath);
    } catch (error) {
      if (isMissingPathError(error)) {
        return null;
      }
      throw error;
    }
  }, []);

  const getRemoteEntryIfExists = useCallback(
    async (targetPath: string) => {
      if (!remoteProtocol || !connectionId) return null;
      try {
        return await window.bridgefile[remoteProtocol].stat(connectionId, targetPath);
      } catch (error) {
        if (isMissingPathError(error)) {
          return null;
        }
        throw error;
      }
    },
    [remoteProtocol, connectionId],
  );

  // ── Overwrite dialog helpers ─────────────────────────────────

  const showOverwriteDialog = useCallback(
    (
      sourceName: string,
      sourceInfo: FileInfo | null,
      destInfo: FileInfo | null,
      isDirectory: boolean,
    ): Promise<{ action: OverwriteAction; applyToAll: boolean }> => {
      return new Promise((resolve) => {
        setOverwriteRequest({
          visible: true,
          sourceName,
          sourceInfo,
          destInfo,
          isDirectory,
          protocol: remoteProtocol,
          resolve,
        });
      });
    },
    [remoteProtocol],
  );

  const handleOverwriteResponse = useCallback(
    (action: OverwriteAction, applyToAll: boolean) => {
      setOverwriteRequest((prev) => {
        prev.resolve?.({ action, applyToAll });
        return emptyOverwriteRequest;
      });
    },
    [],
  );

  const toFileInfo = (entry: { name: string; size: number; modifiedAt: number } | null): FileInfo | null => {
    if (!entry) return null;
    return { name: entry.name, size: entry.size, modifiedAt: entry.modifiedAt };
  };

  /**
   * Resolve what to do when the destination already exists.
   * Returns { proceed, useResume, destPath } or null to skip.
   */
  const resolveOverwriteAction = useCallback(
    async (
      action: OverwriteAction,
      sourceInfo: FileInfo | null,
      destInfo: FileInfo | null,
      destPath: string,
    ): Promise<{ proceed: boolean; useResume: boolean; destPath: string }> => {
      switch (action) {
        case 'skip':
          return { proceed: false, useResume: false, destPath };
        case 'overwrite':
          return { proceed: true, useResume: false, destPath };
        case 'overwrite-if-newer':
          if (sourceInfo && destInfo && sourceInfo.modifiedAt <= destInfo.modifiedAt) {
            addLog('info', `Skipped "${sourceInfo.name}" (destination is same age or newer)`);
            return { proceed: false, useResume: false, destPath };
          }
          return { proceed: true, useResume: false, destPath };
        case 'overwrite-if-different-size':
          if (sourceInfo && destInfo && sourceInfo.size === destInfo.size) {
            addLog('info', `Skipped "${sourceInfo.name}" (same size)`);
            return { proceed: false, useResume: false, destPath };
          }
          return { proceed: true, useResume: false, destPath };
        case 'resume':
          return { proceed: true, useResume: true, destPath };
        case 'rename':
          return { proceed: true, useResume: false, destPath: generateAutoRenamePath(destPath) };
        default:
          return { proceed: true, useResume: false, destPath };
      }
    },
    [],
  );

  // ── File transfer handler (sequential to avoid FTP single-connection issues) ──
  const handleTransfer = useCallback(
    async (
      direction: 'upload' | 'download',
      files: { name: string; isDirectory: boolean }[],
      sourcePath: string,
    ) => {
      if (!remoteProtocol || !connectionId) return;
      const api = typeof window !== 'undefined' && window.bridgefile
        ? window.bridgefile[remoteProtocol]
        : null;
      if (!api) return;

      const currentRemotePath = normalizePath(remotePath || '/');
      const currentLocalPath = normalizePath(localPath || '/');
      let batchAction: OverwriteAction | null = null;

      for (const file of files) {
        try {
          const isUpload = direction === 'upload';
          let local = isUpload
            ? joinChildPath(sourcePath, file.name)
            : joinChildPath(currentLocalPath, file.name);
          let remote = isUpload
            ? joinChildPath(currentRemotePath, file.name)
            : joinChildPath(sourcePath, file.name);

          // Check if destination exists
          const destEntry = isUpload
            ? await getRemoteEntryIfExists(remote)
            : await getLocalEntryIfExists(local);

          if (destEntry) {
            // Type mismatch check
            if (destEntry.isDirectory !== file.isDirectory) {
              throw new Error(
                `Cannot transfer "${file.name}" because destination is a ${destEntry.isDirectory ? 'folder' : 'file'}.`,
              );
            }

            let action: OverwriteAction;
            let sourceInfo: FileInfo | null = null;
            const destInfo = toFileInfo(destEntry);

            if (batchAction) {
              action = batchAction;
              // For conditional actions, still need source info
              if (action === 'overwrite-if-newer' || action === 'overwrite-if-different-size') {
                const srcEntry = isUpload
                  ? await getLocalEntryIfExists(local)
                  : await getRemoteEntryIfExists(remote);
                sourceInfo = toFileInfo(srcEntry);
              }
            } else {
              // Get source info for comparison display
              const srcEntry = isUpload
                ? await getLocalEntryIfExists(local)
                : await getRemoteEntryIfExists(remote);
              sourceInfo = toFileInfo(srcEntry);

              const result = await showOverwriteDialog(file.name, sourceInfo, destInfo, file.isDirectory);
              action = result.action;
              if (result.applyToAll) {
                batchAction = action;
              }
            }

            const resolution = await resolveOverwriteAction(action, sourceInfo ?? toFileInfo(destEntry), destInfo, isUpload ? remote : local);
            if (!resolution.proceed) {
              continue;
            }

            // Apply renamed path
            if (isUpload) {
              remote = resolution.destPath;
            } else {
              local = resolution.destPath;
            }

            // Handle resume
            if (resolution.useResume && !file.isDirectory && (remoteProtocol === 'sftp' || remoteProtocol === 'ftp')) {
              await (api as any).resumeTransfer(connectionId, direction, local, remote);
              continue;
            }
          }

          // Proceed with transfer
          if (isUpload) {
            if (file.isDirectory) {
              await api.uploadDir(connectionId, local, remote);
            } else {
              await api.upload(connectionId, local, remote);
            }
          } else {
            if (file.isDirectory) {
              await api.downloadDir(connectionId, remote, local);
            } else {
              await api.download(connectionId, remote, local);
            }
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logError(`Transfer failed for ${file.name}: ${message}`);
        }
      }
    },
    [remoteProtocol, connectionId, remotePath, localPath, getLocalEntryIfExists, getRemoteEntryIfExists, showOverwriteDialog, resolveOverwriteAction],
  );

  // ── Desktop drop handler (sequential) ──────────────────────
  const handleDesktopDrop = useCallback(
    async (items: ExternalDropItem[], targetPath: string) => {
      if (!remoteProtocol || !connectionId) return;
      const bridgefile = typeof window !== 'undefined' && window.bridgefile
        ? window.bridgefile
        : null;
      const api = bridgefile
        ? window.bridgefile[remoteProtocol]
        : null;
      if (!api || !bridgefile) return;

      let batchAction: OverwriteAction | null = null;

      for (const item of items) {
        try {
          const fileName = item.name || item.path.split(/[\\/]/).pop() || item.path;
          let remote = joinChildPath(targetPath, fileName);
          const localEntry = typeof item.isDirectory === 'boolean'
            ? { isDirectory: item.isDirectory }
            : await bridgefile.fs.stat(item.path);

          // Check if destination exists
          const destEntry = await getRemoteEntryIfExists(remote);

          if (destEntry) {
            if (destEntry.isDirectory !== localEntry.isDirectory) {
              throw new Error(
                `Cannot upload "${fileName}" because destination is a ${destEntry.isDirectory ? 'folder' : 'file'}.`,
              );
            }

            let action: OverwriteAction;
            let sourceInfo: FileInfo | null = null;
            const destInfo = toFileInfo(destEntry);

            if (batchAction) {
              action = batchAction;
              if (action === 'overwrite-if-newer' || action === 'overwrite-if-different-size') {
                const srcEntry = await getLocalEntryIfExists(item.path);
                sourceInfo = toFileInfo(srcEntry);
              }
            } else {
              const srcEntry = await getLocalEntryIfExists(item.path);
              sourceInfo = toFileInfo(srcEntry);
              const result = await showOverwriteDialog(fileName, sourceInfo, destInfo, localEntry.isDirectory);
              action = result.action;
              if (result.applyToAll) {
                batchAction = action;
              }
            }

            const resolution = await resolveOverwriteAction(action, sourceInfo ?? toFileInfo(destEntry), destInfo, remote);
            if (!resolution.proceed) {
              continue;
            }
            remote = resolution.destPath;

            if (resolution.useResume && !localEntry.isDirectory && (remoteProtocol === 'sftp' || remoteProtocol === 'ftp')) {
              await (api as any).resumeTransfer(connectionId, 'upload', item.path, remote);
              continue;
            }
          }

          if (localEntry.isDirectory) {
            await api.uploadDir(connectionId, item.path, remote);
          } else {
            await api.upload(connectionId, item.path, remote);
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logError(`Desktop drop upload failed for ${item.name}: ${message}`);
        }
      }
    },
    [remoteProtocol, connectionId, getLocalEntryIfExists, getRemoteEntryIfExists, showOverwriteDialog, resolveOverwriteAction],
  );
  return (
    <div
      className={`flex flex-col h-screen select-none overflow-hidden ${
        theme === 'light'
          ? 'bg-[#f5f5f7] text-[#1a1a2e] light-theme'
          : 'bg-[#0a0a0f] text-[#e4e4e7]'
      }`}
    >
      {/* Update banner */}
      {updateInfo && (
        <div className="flex items-center justify-center gap-2 px-3 py-1.5 bg-[#3b82f6]/10 border-b border-[#3b82f6]/20 text-xs text-[#93c5fd]">
          <span>
            BridgeFile v{updateInfo.latestVersion} available
          </span>
          <span className="text-[#3b82f6]/40">—</span>
          <a
            href={updateInfo.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#3b82f6] hover:text-[#60a5fa] underline underline-offset-2 transition-colors"
          >
            Download
          </a>
          <button
            onClick={() => setUpdateInfo(null)}
            className="ml-auto p-0.5 rounded text-[#71717a] hover:text-[#e4e4e7] transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      {/* Top: Connection bar */}
      <ConnectionBar
        isConnected={isConnected}
        protocol={protocol}
        host={host}
        remotePath={remotePath}
        onConnectClick={() => setShowConnectionManager(true)}
        onDisconnect={handleDisconnect}
        onSettingsClick={() => setShowPreferences(true)}
        theme={theme}
        onToggleTheme={toggleTheme}
        syncBrowsing={syncBrowsing}
        onToggleSyncBrowsing={handleToggleSyncBrowsing}
      />

      {/* Tab bar for multi-session tabs */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onNewTab={handleNewTab}
        onReorder={handleReorderTabs}
      />

      {/* Bookmark bar */}
      <BookmarkBar
        currentPath={remotePath}
        connectionId={connectionId}
        onNavigate={handleRemoteNavigate}
      />

      {/* Middle: Dual pane file browsers */}
      <div ref={containerRef} className="flex-1 flex min-h-0">
        {/* Local pane */}
        <div style={{ width: `${dividerPos}%` }} className="min-w-0">
          <FilePane
            side="local"
            label="Local"
            onNavigate={handleLocalNavigate}
            syncPath={localPath ?? undefined}
            refreshToken={localRefreshToken}
            onTransfer={handleTransfer}
            clipboard={clipboard}
            onSetClipboard={setClipboard}
            onCompare={() => setShowCompare(true)}
            onSearch={() => setShowSearch(true)}
            onEditFile={(file) => {
              setSelectedFile({
                name: file.name,
                size: file.size,
                localPath: file.path,
              });
              setShowEditor(true);
            }}
            onChecksum={(file) => {
              setSelectedFile({
                name: file.name,
                localPath: file.path,
              });
              setShowChecksum(true);
            }}
          />
        </div>

        {/* Vertical divider */}
        <div
          className="w-[3px] bg-[#1e1e2e] hover:bg-[#3b82f6] cursor-col-resize transition-colors shrink-0 relative group"
          onMouseDown={handleDividerDragStart}
        >
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>

        {/* Remote pane */}
        <div style={{ width: `${100 - dividerPos}%` }} className="min-w-0">
          <FilePane
            side="remote"
            label="Remote"
            protocol={remoteProtocol}
            connectionId={connectionId ?? undefined}
            onNavigate={handleRemoteNavigate}
            syncPath={remotePath ?? undefined}
            refreshToken={remoteRefreshToken}
            onTransfer={handleTransfer}
            onDesktopDrop={handleDesktopDrop}
            clipboard={clipboard}
            onSetClipboard={setClipboard}
            onCompare={() => setShowCompare(true)}
            onSearch={() => setShowSearch(true)}
            onEditFile={(file) => {
              setSelectedFile({
                name: file.name,
                size: file.size,
                remotePath: file.path,
              });
              setShowEditor(true);
            }}
            onChecksum={remoteProtocol
              ? (file) => {
                  setSelectedFile({
                    name: file.name,
                    remotePath: file.path,
                  });
                  setShowChecksum(true);
                }
              : undefined
            }
            onPermissions={(file) => {
              setSelectedFile({
                name: file.name,
                permissions: file.permissions,
                remotePath: file.path,
              });
              setShowPermissions(true);
            }}
          />
        </div>
      </div>

      {/* Bottom: Transfers + Log (tabbed, collapsible) */}
      <div
        style={{ height: bottomCollapsed ? 32 : bottomHeight }}
        className="shrink-0 border-t border-[#1e1e2e] bg-[#12121a] flex flex-col"
      >
        {/* Resize handle */}
        {!bottomCollapsed && (
          <div
            className="h-[3px] bg-[#1e1e2e] hover:bg-[#3b82f6] cursor-row-resize transition-colors shrink-0 relative group"
            onMouseDown={handleBottomDragStart}
          >
            <div className="absolute -top-1 -bottom-1 inset-x-0" />
          </div>
        )}

        {/* Tab bar */}
        <div className="flex items-center justify-between px-2 h-8 shrink-0 border-b border-[#1e1e2e]">
          <div className="flex items-center gap-1">
            <BottomTabButton
              active={bottomTab === 'transfers'}
              onClick={() => {
                setBottomTab('transfers');
                if (bottomCollapsed) setBottomCollapsed(false);
              }}
              label="Transfers"
              badge={transferBadgeCount}
            />
            <BottomTabButton
              active={bottomTab === 'log'}
              onClick={() => {
                setBottomTab('log');
                if (bottomCollapsed) setBottomCollapsed(false);
              }}
              label="Log"
            />
          </div>

          {/* Collapse toggle */}
          <button
            onClick={() => setBottomCollapsed((c) => !c)}
            className="p-1 rounded text-[#71717a] hover:text-[#a1a1aa] hover:bg-[#1a1a26] transition-colors"
            title={bottomCollapsed ? 'Expand' : 'Collapse'}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              className={`transition-transform ${bottomCollapsed ? 'rotate-180' : ''}`}
            >
              <path
                d="M6 9l6 6 6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        {/* Tab content */}
        {!bottomCollapsed && (
          <div className="flex-1 min-h-0 overflow-hidden">
            {bottomTab === 'transfers' ? <TransferQueue /> : <LogPanel />}
          </div>
        )}
      </div>

      {/* Connection Manager modal */}
      <ConnectionManager
        isOpen={showConnectionManager}
        onClose={() => setShowConnectionManager(false)}
        onConnect={handleConnect}
      />

      {/* Directory Compare dialog */}
      <DirectoryCompare
        isOpen={showCompare}
        onClose={() => setShowCompare(false)}
        localPath={localPath ?? '/'}
        remotePath={remotePath ?? '/'}
        protocol={remoteProtocol}
        connectionId={connectionId ?? undefined}
      />

      {/* Search dialog */}
      <SearchDialog
        isOpen={showSearch}
        onClose={() => setShowSearch(false)}
        protocol={remoteProtocol}
        connectionId={connectionId ?? undefined}
        currentPath={remotePath ?? '/'}
        onNavigate={handleRemoteNavigate}
      />

      {/* File Editor dialog */}
      {showEditor && selectedFile && (
        <FileEditor
          isOpen={showEditor}
          onClose={() => { setShowEditor(false); setSelectedFile(null); }}
          protocol={selectedFile.remotePath ? remoteProtocol ?? undefined : undefined}
          connectionId={selectedFile.remotePath ? connectionId ?? undefined : undefined}
          localPath={selectedFile.localPath}
          remotePath={selectedFile.remotePath}
          fileName={selectedFile.name}
          fileSize={selectedFile.size ?? 0}
        />
      )}

      {/* Checksum dialog */}
      {showChecksum && selectedFile && (
        <ChecksumDialog
          isOpen={showChecksum}
          onClose={() => { setShowChecksum(false); setSelectedFile(null); }}
          protocol={selectedFile.remotePath ? remoteProtocol ?? undefined : undefined}
          localPath={selectedFile.localPath}
          remotePath={selectedFile.remotePath}
          connectionId={selectedFile.remotePath ? connectionId ?? undefined : undefined}
          fileName={selectedFile.name}
        />
      )}

      {/* Permissions dialog */}
      {showPermissions && selectedFile?.remotePath && connectionId && (
        <PermissionsDialog
          isOpen={showPermissions}
          onClose={() => { setShowPermissions(false); setSelectedFile(null); }}
          fileName={selectedFile.name}
          currentPermissions={selectedFile.permissions}
          connectionId={connectionId}
          remotePath={selectedFile.remotePath}
          onApply={(mode: number) => {
            const remoteTarget = selectedFile.remotePath;
            if (connectionId && remoteTarget) {
              window.bridgefile.sftp.chmod(connectionId, remoteTarget, mode).catch((err: unknown) => {
                logError(`chmod failed: ${err instanceof Error ? err.message : String(err)}`);
              });
            }
            setShowPermissions(false);
            setSelectedFile(null);
          }}
        />
      )}

      {/* Overwrite confirm dialog */}
      {overwriteRequest.visible && (
        <OverwriteConfirmDialog
          request={overwriteRequest}
          onResponse={handleOverwriteResponse}
        />
      )}

      {/* Preferences dialog */}
      <PreferencesDialog
        isOpen={showPreferences}
        onClose={() => setShowPreferences(false)}
        preferences={preferences}
        onSave={handleSavePreferences}
      />
    </div>
  );
}

function BottomTabButton({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded transition-colors ${
        active
          ? 'text-[#e4e4e7] bg-[#1a1a26]'
          : 'text-[#71717a] hover:text-[#a1a1aa]'
      }`}
    >
      {label}
      {badge !== undefined && badge > 0 && (
        <span
          className={`px-1 min-w-[16px] text-center rounded-full text-[9px] font-medium ${
            active
              ? 'bg-[#3b82f6]/20 text-[#3b82f6]'
              : 'bg-[#71717a]/15 text-[#71717a]'
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
