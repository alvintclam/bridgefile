import React, { useState, useRef, useCallback, useEffect } from 'react';
import ConnectionBar from './components/ConnectionBar';
import ConnectionManager from './components/ConnectionManager';
import type { ConnectionProfile } from './components/ConnectionManager';
import BookmarkBar from './components/BookmarkBar';
import FilePane from './components/FilePane';
import TransferQueue from './components/TransferQueue';
import LogPanel from './components/LogPanel';

type BottomTab = 'transfers' | 'log';

export default function App() {
  const [isConnected, setIsConnected] = useState(true);
  const [protocol, setProtocol] = useState<'SFTP' | 'FTP' | 'S3' | null>('SFTP');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [host, setHost] = useState<string | null>('192.168.1.100');
  const [remotePath, setRemotePath] = useState<string | null>('/var/www');
  const [showConnectionManager, setShowConnectionManager] = useState(false);
  const [bottomTab, setBottomTab] = useState<BottomTab>('transfers');
  const [bottomCollapsed, setBottomCollapsed] = useState(false);
  const [bottomHeight, setBottomHeight] = useState(220);
  const [dividerPos, setDividerPos] = useState(50); // percentage for left pane

  const isDraggingBottom = useRef(false);
  const isDraggingDivider = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleConnect = (profile: ConnectionProfile) => {
    setIsConnected(true);
    setProtocol(profile.type);
    setHost(
      profile.type === 'SFTP' || profile.type === 'FTP'
        ? profile.host || null
        : profile.bucket || null
    );
    setRemotePath('/');
    setShowConnectionManager(false);
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setProtocol(null);
    setHost(null);
    setRemotePath(null);
  };

  // Bottom panel resize
  const handleBottomDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingBottom.current = true;
  }, []);

  // Divider (horizontal split) resize
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
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <div className={`flex flex-col h-screen select-none overflow-hidden ${
      theme === 'light'
        ? 'bg-[#f5f5f7] text-[#1a1a2e] light-theme'
        : 'bg-[#0a0a0f] text-[#e4e4e7]'
    }`}>
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
      />

      {/* Bookmark bar */}
      <BookmarkBar
        currentPath={remotePath}
        onNavigate={(path) => setRemotePath(path)}
      />

      {/* Middle: Dual pane file browsers */}
      <div
        ref={containerRef}
        className="flex-1 flex min-h-0"
      >
        {/* Local pane */}
        <div style={{ width: `${dividerPos}%` }} className="min-w-0">
          <FilePane side="local" label="Local" />
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
          <FilePane side="remote" label="Remote" />
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
            <TabButton
              active={bottomTab === 'transfers'}
              onClick={() => {
                setBottomTab('transfers');
                if (bottomCollapsed) setBottomCollapsed(false);
              }}
              label="Transfers"
              badge={5}
            />
            <TabButton
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
            onClick={() => setBottomCollapsed(c => !c)}
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

function TabButton({
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
