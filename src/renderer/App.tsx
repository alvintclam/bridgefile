import React, { useState, useRef, useCallback, useEffect } from 'react';
import ConnectionBar from './components/ConnectionBar';
import ConnectionManager from './components/ConnectionManager';
import type { ConnectionProfile } from './components/ConnectionManager';
import BookmarkBar from './components/BookmarkBar';
import FilePane from './components/FilePane';
import TransferQueue from './components/TransferQueue';
import LogPanel from './components/LogPanel';
import TabBar from './components/TabBar';
import type { SessionTab } from './components/TabBar';

type BottomTab = 'transfers' | 'log';

let tabIdCounter = 0;
function nextTabId(): string {
  tabIdCounter += 1;
  return `tab-${tabIdCounter}`;
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

  // ── Synchronized browsing ───────────────────────────────────
  const [syncBrowsing, setSyncBrowsing] = useState(false);
  const [localPath, setLocalPath] = useState<string | null>(null);

  // ── UI state ────────────────────────────────────────────────
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [showConnectionManager, setShowConnectionManager] = useState(false);
  const [bottomTab, setBottomTab] = useState<BottomTab>('transfers');
  const [bottomCollapsed, setBottomCollapsed] = useState(false);
  const [bottomHeight, setBottomHeight] = useState(220);
  const [dividerPos, setDividerPos] = useState(50);

  const isDraggingBottom = useRef(false);
  const isDraggingDivider = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setShowConnectionManager(false);
  };

  const handleDisconnect = () => {
    if (!activeTab) return;

    // Call disconnect via IPC if in Electron
    if (typeof window !== 'undefined' && window.bridgefile && activeTab.connectionId) {
      const proto = activeTab.protocol.toLowerCase() as 'sftp' | 's3' | 'ftp';
      const api = window.bridgefile[proto];
      api.disconnect(activeTab.connectionId).catch((err: unknown) => {
        console.error('Disconnect error:', err);
      });
    }

    // Remove the active tab
    setTabs((prev) => prev.filter((t) => t.id !== activeTab.id));
    setActiveTabId((prevId) => {
      const remaining = tabs.filter((t) => t.id !== activeTab.id);
      if (remaining.length === 0) return null;
      // Select nearest tab
      const idx = tabs.findIndex((t) => t.id === activeTab.id);
      const nextIdx = Math.min(idx, remaining.length - 1);
      return remaining[nextIdx]?.id ?? null;
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

      if (syncBrowsing && activeTab && remotePath) {
        // Extract the relative path segment navigated to
        // e.g., if local goes from /Users/foo to /Users/foo/docs, relative = "docs"
        // Then we apply the same relative path to remote
        if (localPath) {
          const localNorm = localPath.endsWith('/') ? localPath : localPath + '/';
          if (newLocalPath.startsWith(localNorm)) {
            const relative = newLocalPath.slice(localNorm.length);
            if (relative) {
              const newRemote = remotePath.endsWith('/')
                ? remotePath + relative
                : remotePath + '/' + relative;
              setRemotePath(newRemote);
            }
          } else {
            // Navigating up or to a completely different path
            const segments = newLocalPath.split('/').filter(Boolean);
            const lastSegment = segments[segments.length - 1];
            if (lastSegment) {
              const remoteBase = remotePath.endsWith('/')
                ? remotePath
                : remotePath.replace(/\/[^/]*$/, '/');
              setRemotePath(remoteBase + lastSegment);
            }
          }
        }
      }
    },
    [syncBrowsing, activeTab, remotePath, localPath, setRemotePath],
  );

  const handleRemoteNavigate = useCallback(
    (newRemotePath: string) => {
      setRemotePath(newRemotePath);

      if (syncBrowsing && localPath && remotePath) {
        const remoteNorm = remotePath.endsWith('/') ? remotePath : remotePath + '/';
        if (newRemotePath.startsWith(remoteNorm)) {
          const relative = newRemotePath.slice(remoteNorm.length);
          if (relative) {
            const newLocal = localPath.endsWith('/')
              ? localPath + relative
              : localPath + '/' + relative;
            setLocalPath(newLocal);
          }
        }
      }
    },
    [syncBrowsing, localPath, remotePath, setRemotePath],
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
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Derive the lowercase protocol for the remote pane
  const remoteProtocol = protocol
    ? (protocol.toLowerCase() as 'sftp' | 's3' | 'ftp')
    : undefined;

  return (
    <div
      className={`flex flex-col h-screen select-none overflow-hidden ${
        theme === 'light'
          ? 'bg-[#f5f5f7] text-[#1a1a2e] light-theme'
          : 'bg-[#0a0a0f] text-[#e4e4e7]'
      }`}
    >
      {/* Top: Connection bar */}
      <ConnectionBar
        isConnected={isConnected}
        protocol={protocol}
        host={host}
        remotePath={remotePath}
        onConnectClick={() => setShowConnectionManager(true)}
        onDisconnect={handleDisconnect}
        onSettingsClick={() => {}}
        theme={theme}
        onToggleTheme={toggleTheme}
        syncBrowsing={syncBrowsing}
        onToggleSyncBrowsing={() => setSyncBrowsing((s) => !s)}
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
        onNavigate={(path) => setRemotePath(path)}
      />

      {/* Middle: Dual pane file browsers */}
      <div ref={containerRef} className="flex-1 flex min-h-0">
        {/* Local pane */}
        <div style={{ width: `${dividerPos}%` }} className="min-w-0">
          <FilePane
            side="local"
            label="Local"
            onNavigate={handleLocalNavigate}
            syncPath={syncBrowsing ? localPath ?? undefined : undefined}
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
            syncPath={syncBrowsing ? remotePath ?? undefined : undefined}
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
              badge={5}
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
