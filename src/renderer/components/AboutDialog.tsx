import React, { useEffect, useState } from 'react';

interface AboutDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof window.bridgefile !== 'undefined';
}

export default function AboutDialog({ isOpen, onClose }: AboutDialogProps) {
  const [version, setVersion] = useState<string>('');
  const [platform, setPlatform] = useState<string>('');

  useEffect(() => {
    if (!isOpen || !isElectron()) return;
    window.bridgefile.app.getVersion().then(setVersion).catch(() => {});
    window.bridgefile.app.getPlatform().then(setPlatform).catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-[#12121a] border border-[#1e1e2e] rounded-lg shadow-2xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e1e2e]">
          <h3 className="text-sm font-semibold text-[#e4e4e7]">About BridgeFile</h3>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#71717a] hover:text-[#e4e4e7] hover:bg-[#1a1a26]"
            aria-label="Close about dialog"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-[#3b82f6] to-[#8b5cf6] flex items-center justify-center shrink-0">
              <span className="text-white text-2xl font-bold">BF</span>
            </div>
            <div>
              <div className="text-base font-semibold text-[#e4e4e7]">BridgeFile</div>
              <div className="text-[11px] text-[#71717a]">
                Version {version || '—'} · {platform || '—'}
              </div>
            </div>
          </div>

          <p className="text-xs text-[#a1a1aa] leading-relaxed">
            A cross-platform file transfer client that supports SFTP, FTP/FTPS, and S3 with
            multi-channel parallel transfers, smart overwrite handling, and encrypted credential
            storage via the OS keychain.
          </p>

          <div className="pt-2 border-t border-[#1e1e2e] space-y-2">
            <Row label="License">
              <span className="text-[#a1a1aa]">Business Source License 1.1</span>
            </Row>
            <Row label="Source">
              <a
                href="https://github.com/alvintclam/bridgefile"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#3b82f6] hover:text-[#60a5fa] underline underline-offset-2"
              >
                github.com/alvintclam/bridgefile
              </a>
            </Row>
          </div>

          <div className="pt-2 border-t border-[#1e1e2e]">
            <p className="text-[10px] text-[#71717a]">
              Built with Electron, React, and TypeScript. Free for personal use.
              Commercial use requires a license.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end px-4 py-3 border-t border-[#1e1e2e]">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs rounded bg-[#1a1a26] hover:bg-[#2a2a3e] text-[#e4e4e7] border border-[#1e1e2e]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="text-[#71717a]">{label}</span>
      <div>{children}</div>
    </div>
  );
}
