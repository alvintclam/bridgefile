import React, { useState } from 'react';

export type TransferStatus = 'queued' | 'transferring' | 'completed' | 'failed';

export interface TransferItem {
  id: string;
  filename: string;
  direction: 'upload' | 'download';
  size: number;
  transferred: number;
  speed: number; // bytes per second
  status: TransferStatus;
  error?: string;
}

const MOCK_TRANSFERS: TransferItem[] = [
  {
    id: '1',
    filename: 'node-v24.13.0.tar.gz',
    direction: 'upload',
    size: 42893312,
    transferred: 42893312,
    speed: 0,
    status: 'completed',
  },
  {
    id: '2',
    filename: 'design-mockup.fig',
    direction: 'upload',
    size: 15728640,
    transferred: 8912345,
    speed: 2456000,
    status: 'transferring',
  },
  {
    id: '3',
    filename: 'db-2026-04-07.sql.gz',
    direction: 'download',
    size: 52428800,
    transferred: 0,
    speed: 0,
    status: 'queued',
  },
  {
    id: '4',
    filename: 'auth.log',
    direction: 'download',
    size: 2097152,
    transferred: 1048576,
    speed: 0,
    status: 'failed',
    error: 'Connection timed out',
  },
  {
    id: '5',
    filename: 'report-q1.pdf',
    direction: 'upload',
    size: 2457600,
    transferred: 2457600,
    speed: 0,
    status: 'completed',
  },
];

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec === 0) return '--';
  return `${formatSize(bytesPerSec)}/s`;
}

function formatETA(remaining: number, speed: number): string {
  if (speed === 0) return '--';
  const secs = remaining / speed;
  if (secs < 60) return `${Math.ceil(secs)}s`;
  if (secs < 3600) return `${Math.ceil(secs / 60)}m`;
  return `${Math.floor(secs / 3600)}h ${Math.ceil((secs % 3600) / 60)}m`;
}

const STATUS_STYLES: Record<TransferStatus, string> = {
  queued: 'bg-[#71717a]/15 text-[#71717a]',
  transferring: 'bg-[#3b82f6]/15 text-[#3b82f6]',
  completed: 'bg-emerald-500/15 text-emerald-400',
  failed: 'bg-red-500/15 text-red-400',
};

export default function TransferQueue() {
  const [transfers, setTransfers] = useState<TransferItem[]>(MOCK_TRANSFERS);

  const clearCompleted = () => {
    setTransfers(prev => prev.filter(t => t.status !== 'completed'));
  };

  const cancelTransfer = (id: string) => {
    setTransfers(prev => prev.filter(t => t.id !== id));
  };

  const retryTransfer = (id: string) => {
    setTransfers(prev =>
      prev.map(t =>
        t.id === id ? { ...t, status: 'queued' as TransferStatus, transferred: 0, error: undefined } : t
      )
    );
  };

  const totalSize = transfers.reduce((a, t) => a + t.size, 0);
  const totalTransferred = transfers.reduce((a, t) => a + t.transferred, 0);
  const activeCount = transfers.filter(t => t.status === 'transferring').length;
  const completedCount = transfers.filter(t => t.status === 'completed').length;

  return (
    <div className="flex flex-col h-full">
      {/* Summary bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1e1e2e]">
        <div className="flex items-center gap-3 text-[11px] text-[#71717a]">
          <span>{transfers.length} transfer{transfers.length !== 1 ? 's' : ''}</span>
          {activeCount > 0 && (
            <span className="text-[#3b82f6]">{activeCount} active</span>
          )}
          {completedCount > 0 && (
            <span className="text-emerald-400">{completedCount} completed</span>
          )}
          <span>
            {formatSize(totalTransferred)} / {formatSize(totalSize)}
          </span>
        </div>
        {completedCount > 0 && (
          <button
            onClick={clearCompleted}
            className="text-[11px] text-[#71717a] hover:text-[#a1a1aa] transition-colors"
          >
            Clear completed
          </button>
        )}
      </div>

      {/* Total progress bar */}
      {activeCount > 0 && (
        <div className="h-1 bg-[#1e1e2e]">
          <div
            className="h-full bg-[#3b82f6] transition-all duration-300"
            style={{ width: `${totalSize > 0 ? (totalTransferred / totalSize) * 100 : 0}%` }}
          />
        </div>
      )}

      {/* Transfer list */}
      <div className="flex-1 overflow-y-auto">
        {transfers.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[#71717a] text-xs">
            No transfers
          </div>
        ) : (
          transfers.map(t => {
            const progress = t.size > 0 ? (t.transferred / t.size) * 100 : 0;
            const remaining = t.size - t.transferred;

            return (
              <div
                key={t.id}
                className="flex items-center gap-3 px-3 py-2 border-b border-[#1e1e2e]/50 hover:bg-[#1a1a26]/50 transition-colors group"
              >
                {/* Direction arrow */}
                <span
                  className={`text-sm shrink-0 ${
                    t.direction === 'upload'
                      ? 'text-emerald-400'
                      : 'text-[#3b82f6]'
                  }`}
                >
                  {t.direction === 'upload' ? '\u2191' : '\u2193'}
                </span>

                {/* File info + progress */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-[#e4e4e7] truncate">{t.filename}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${STATUS_STYLES[t.status]}`}>
                      {t.status}
                    </span>
                  </div>

                  {/* Progress bar */}
                  {(t.status === 'transferring' || t.status === 'queued') && (
                    <div className="h-1 bg-[#1e1e2e] rounded-full overflow-hidden mb-1">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          t.status === 'transferring' ? 'bg-[#3b82f6]' : 'bg-[#71717a]'
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}

                  {/* Details row */}
                  <div className="flex items-center gap-2 text-[10px] text-[#71717a]">
                    <span>
                      {formatSize(t.transferred)} / {formatSize(t.size)}
                    </span>
                    {t.status === 'transferring' && (
                      <>
                        <span>{formatSpeed(t.speed)}</span>
                        <span>ETA {formatETA(remaining, t.speed)}</span>
                      </>
                    )}
                    {t.error && (
                      <span className="text-red-400">{t.error}</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {t.status === 'failed' && (
                    <button
                      onClick={() => retryTransfer(t.id)}
                      className="p-1 rounded text-[#71717a] hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                      title="Retry"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                  {(t.status === 'queued' || t.status === 'transferring') && (
                    <button
                      onClick={() => cancelTransfer(t.id)}
                      className="p-1 rounded text-[#71717a] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Cancel"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
