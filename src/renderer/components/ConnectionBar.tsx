import React from 'react';

interface ConnectionBarProps {
  isConnected: boolean;
  protocol: 'SFTP' | 'FTP' | 'S3' | null;
  host: string | null;
  remotePath: string | null;
  onConnectClick: () => void;
  onDisconnect: () => void;
  onSettingsClick: () => void;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  syncBrowsing?: boolean;
  onToggleSyncBrowsing?: () => void;
}

export default function ConnectionBar({
  isConnected,
  protocol,
  host,
  remotePath,
  onConnectClick,
  onDisconnect,
  onSettingsClick,
  theme = 'dark',
  onToggleTheme,
  syncBrowsing = false,
  onToggleSyncBrowsing,
}: ConnectionBarProps) {
  return (
    <div className="flex items-center justify-between h-11 px-3 bg-[#12121a] border-b border-[#1e1e2e] select-none shrink-0">
      {/* Left: Logo + name */}
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-2">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            className="text-[#3b82f6]"
          >
            <path
              d="M4 6h16M4 6v12a2 2 0 002 2h12a2 2 0 002-2V6M4 6l2-4h12l2 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M9 12h6M12 9v6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-sm font-semibold tracking-tight text-[#e4e4e7]">
            BridgeFile
          </span>
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-[#1e1e2e]" />

        {/* Connection info */}
        {isConnected && protocol && host ? (
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-medium uppercase tracking-wide ${
                protocol === 'SFTP'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : protocol === 'FTP'
                  ? 'bg-blue-500/15 text-blue-400'
                  : 'bg-orange-500/15 text-orange-400'
              }`}
            >
              {protocol}
            </span>
            <span className="text-[#a1a1aa]">{host}</span>
            {remotePath && (
              <>
                <span className="text-[#71717a]">/</span>
                <span className="text-[#71717a] max-w-48 truncate">
                  {remotePath}
                </span>
              </>
            )}
          </div>
        ) : (
          <span className="text-xs text-[#71717a]">No connection</span>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {/* Status indicator */}
        <div className="flex items-center gap-1.5 mr-1">
          <div
            className={`w-2 h-2 rounded-full ${
              isConnected
                ? 'bg-emerald-400 shadow-[0_0_6px_rgba(34,197,94,0.4)]'
                : 'bg-[#71717a]'
            }`}
          />
          <span className="text-[11px] text-[#71717a]">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        {/* Connect / Disconnect */}
        {isConnected ? (
          <button
            onClick={onDisconnect}
            className="px-2.5 py-1 text-xs rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={onConnectClick}
            className="px-2.5 py-1 text-xs rounded bg-[#3b82f6] text-white hover:bg-[#2563eb] transition-colors"
          >
            Connect
          </button>
        )}

        {/* Sync browsing toggle */}
        {onToggleSyncBrowsing && (
          <button
            onClick={onToggleSyncBrowsing}
            className={`p-1.5 rounded transition-colors ${
              syncBrowsing
                ? 'text-[#3b82f6] bg-[#3b82f6]/10'
                : 'text-[#71717a] hover:text-[#a1a1aa] hover:bg-[#1a1a26]'
            }`}
            title={syncBrowsing ? 'Disable synchronized browsing' : 'Enable synchronized browsing'}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}

        {/* Theme toggle */}
        {onToggleTheme && (
          <button
            onClick={onToggleTheme}
            className="p-1.5 rounded text-[#71717a] hover:text-[#a1a1aa] hover:bg-[#1a1a26] transition-colors"
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        )}

        {/* Settings */}
        <button
          onClick={onSettingsClick}
          className="p-1.5 rounded text-[#71717a] hover:text-[#a1a1aa] hover:bg-[#1a1a26] transition-colors"
          title="Settings"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 15a3 3 0 100-6 3 3 0 000 6z"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
