import React from 'react';

interface WelcomeScreenProps {
  onNewConnection: () => void;
  onShowShortcuts: () => void;
}

export default function WelcomeScreen({ onNewConnection, onShowShortcuts }: WelcomeScreenProps) {
  const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
  const mod = isMac ? '⌘' : 'Ctrl';

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md w-full">
        <div className="flex items-center justify-center mb-6">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#3b82f6] to-[#8b5cf6] flex items-center justify-center shadow-xl shadow-[#3b82f6]/20">
            <span className="text-white text-3xl font-bold">BF</span>
          </div>
        </div>

        <h1 className="text-xl font-semibold text-[#e4e4e7] text-center mb-2">
          Welcome to BridgeFile
        </h1>
        <p className="text-sm text-[#a1a1aa] text-center mb-8">
          A fast, cross-platform file transfer client for SFTP, FTP/FTPS, and S3.
        </p>

        <div className="space-y-3">
          <button
            onClick={onNewConnection}
            className="w-full px-4 py-3 text-sm rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] text-white font-medium transition-colors flex items-center justify-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Create your first connection
          </button>

          <div className="grid grid-cols-3 gap-2 text-center text-[10px] text-[#71717a]">
            <Feature label="SFTP" />
            <Feature label="FTP / FTPS" />
            <Feature label="Amazon S3" />
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-[#1e1e2e] space-y-2">
          <Hint
            shortcut={`${mod}+N`}
            description="New connection"
          />
          <Hint
            shortcut={`${mod}+/`}
            description="Show all keyboard shortcuts"
            onClick={onShowShortcuts}
          />
          <Hint
            shortcut={`${mod}+,`}
            description="Open preferences"
          />
        </div>
      </div>
    </div>
  );
}

function Feature({ label }: { label: string }) {
  return (
    <div className="px-2 py-1.5 rounded bg-[#1a1a26] border border-[#1e1e2e] text-[#a1a1aa] uppercase tracking-wider">
      {label}
    </div>
  );
}

function Hint({
  shortcut,
  description,
  onClick,
}: {
  shortcut: string;
  description: string;
  onClick?: () => void;
}) {
  const Wrapper: React.ElementType = onClick ? 'button' : 'div';
  return (
    <Wrapper
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-2 text-xs ${
        onClick ? 'cursor-pointer hover:bg-[#1a1a26] -mx-2 px-2 py-1 rounded transition-colors' : ''
      }`}
    >
      <span className="text-[#71717a]">{description}</span>
      <kbd className="px-2 py-0.5 text-[10px] font-mono rounded bg-[#0a0a0f] border border-[#2a2a3e] text-[#a1a1aa]">
        {shortcut}
      </kbd>
    </Wrapper>
  );
}
