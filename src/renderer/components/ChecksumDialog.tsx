import React, { useState } from 'react';
import { useEscClose } from '../hooks/useEscClose';

interface ChecksumDialogProps {
  isOpen: boolean;
  onClose: () => void;
  protocol?: 'sftp' | 's3' | 'ftp';
  /** Local file path (for local checksum computation) */
  localPath?: string;
  /** Remote file path (for remote checksum computation) */
  remotePath?: string;
  /** Connection ID (needed for remote checksum) */
  connectionId?: string;
  /** File name to display */
  fileName: string;
}

type Algorithm = 'md5' | 'sha256';

function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof window.bridgefile !== 'undefined';
}

export default function ChecksumDialog({
  isOpen,
  onClose,
  protocol,
  localPath,
  remotePath,
  connectionId,
  fileName,
}: ChecksumDialogProps) {
  useEscClose(isOpen, onClose);
  const [algorithm, setAlgorithm] = useState<Algorithm>('sha256');
  const [localHash, setLocalHash] = useState<string | null>(null);
  const [remoteHash, setRemoteHash] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCompute = async () => {
    if (!isElectron()) return;

    setComputing(true);
    setError(null);
    setLocalHash(null);
    setRemoteHash(null);

    try {
      const promises: Promise<void>[] = [];

      if (localPath) {
        promises.push(
          window.bridgefile.app
            .computeChecksum(localPath, algorithm)
            .then((hash: string) => setLocalHash(hash)),
        );
      }

      if (remotePath && connectionId && protocol) {
        promises.push(
          window.bridgefile.app
            .computeRemoteChecksum(protocol, connectionId, remotePath, algorithm)
            .then((hash: string) => setRemoteHash(hash)),
        );
      }

      await Promise.all(promises);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setComputing(false);
    }
  };

  const hashesMatch =
    localHash !== null && remoteHash !== null && localHash === remoteHash;
  const hashesMismatch =
    localHash !== null && remoteHash !== null && localHash !== remoteHash;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[520px] bg-[#12121a] border border-[#1e1e2e] rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-[#1e1e2e]">
          <h2 className="text-sm font-semibold text-[#e4e4e7]">
            Checksum Verification
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#71717a] hover:text-[#e4e4e7] hover:bg-[#1a1a26] transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M18 6L6 18M6 6l12 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          {/* File name */}
          <div className="mb-3 text-xs text-[#a1a1aa] font-mono truncate">
            {fileName}
          </div>

          {/* Algorithm selector */}
          <div className="mb-4 flex gap-2">
            <button
              onClick={() => setAlgorithm('md5')}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                algorithm === 'md5'
                  ? 'bg-[#3b82f6]/15 text-[#3b82f6]'
                  : 'text-[#71717a] hover:text-[#a1a1aa] bg-[#1a1a26]'
              }`}
            >
              MD5
            </button>
            <button
              onClick={() => setAlgorithm('sha256')}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                algorithm === 'sha256'
                  ? 'bg-[#3b82f6]/15 text-[#3b82f6]'
                  : 'text-[#71717a] hover:text-[#a1a1aa] bg-[#1a1a26]'
              }`}
            >
              SHA-256
            </button>
          </div>

          {/* Results */}
          {localHash !== null && (
            <div className="mb-3">
              <div className="text-[10px] uppercase tracking-wider text-[#71717a] mb-1 font-medium">
                Local Checksum
              </div>
              <div className="px-2.5 py-1.5 text-xs font-mono bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] break-all select-all">
                {localHash}
              </div>
            </div>
          )}

          {remoteHash !== null && (
            <div className="mb-3">
              <div className="text-[10px] uppercase tracking-wider text-[#71717a] mb-1 font-medium">
                Remote Checksum
              </div>
              <div className="px-2.5 py-1.5 text-xs font-mono bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] break-all select-all">
                {remoteHash}
              </div>
            </div>
          )}

          {/* Match indicator */}
          {hashesMatch && (
            <div className="flex items-center gap-2 px-3 py-2 rounded bg-emerald-500/10 border border-emerald-500/20">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-xs text-emerald-400 font-medium">
                Checksums match
              </span>
            </div>
          )}

          {hashesMismatch && (
            <div className="flex items-center gap-2 px-3 py-2 rounded bg-red-500/10 border border-red-500/20">
              <div className="w-2 h-2 rounded-full bg-red-400" />
              <span className="text-xs text-red-400 font-medium">
                Checksums do NOT match
              </span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-2 px-3 py-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-3 border-t border-[#1e1e2e]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded text-[#a1a1aa] hover:bg-[#1a1a26] border border-[#1e1e2e] transition-colors"
          >
            Close
          </button>
          <button
            onClick={handleCompute}
            disabled={computing}
            className={`px-4 py-1.5 text-xs rounded transition-colors ${
              computing
                ? 'bg-[#3b82f6]/50 text-white/50 cursor-wait'
                : 'bg-[#3b82f6] text-white hover:bg-[#2563eb]'
            }`}
          >
            {computing ? 'Computing...' : 'Verify'}
          </button>
        </div>
      </div>
    </div>
  );
}
