import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import SpeedIndicator from './SpeedIndicator';
import type { SpeedLimit } from './SpeedIndicator';
import { t } from '../lib/i18n';
import { logError } from './LogPanel';

export type TransferStatus = 'queued' | 'transferring' | 'completed' | 'failed' | 'paused' | 'cancelled';

export interface TransferItem {
  id: string;
  filename: string;
  entryType: 'file' | 'directory';
  direction: 'upload' | 'download';
  size: number;
  transferred: number;
  speed: number; // bytes per second
  status: TransferStatus;
  currentFile?: string;
  error?: string;
}

interface TransferQueueState {
  items: {
    id: string;
    fileName: string;
    entryType: 'file' | 'directory';
    direction: 'upload' | 'download';
    size: number;
    transferred: number;
    status: string;
    currentFile?: string;
    error?: string;
    startedAt?: number;
    completedAt?: number;
  }[];
  maxConcurrent: number;
  paused: boolean;
  speedLimitMbps: number | null;
}

function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof window.bridgefile !== 'undefined';
}

/** Map IPC TransferItem (status: 'in-progress') to renderer TransferItem (status: 'transferring') */
function mapIPCTransfer(raw: {
  id: string;
  fileName: string;
  entryType: 'file' | 'directory';
  direction: 'upload' | 'download';
  size: number;
  transferred: number;
  status: string;
  currentFile?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}, queuePaused: boolean): TransferItem {
  let status: TransferStatus;
  switch (raw.status) {
    case 'in-progress':
      status = queuePaused ? 'paused' : 'transferring';
      break;
    case 'completed':
      status = 'completed';
      break;
    case 'failed':
      status = 'failed';
      break;
    case 'cancelled':
      status = 'cancelled';
      break;
    default:
      status = queuePaused ? 'paused' : 'queued';
  }

  // Estimate speed from transferred and startedAt
  let speed = 0;
  if (status === 'transferring' && raw.startedAt) {
    const elapsed = (Date.now() - raw.startedAt) / 1000;
    if (elapsed > 0) speed = raw.transferred / elapsed;
  }

  return {
    id: raw.id,
    filename: raw.fileName,
    entryType: raw.entryType,
    direction: raw.direction,
    size: raw.size,
    transferred: raw.transferred,
    speed,
    status,
    currentFile: raw.currentFile,
    error: raw.error,
  };
}

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

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

function formatProgress(item: TransferItem): string {
  if (item.entryType === 'directory') {
    return `${Math.min(item.transferred, item.size)} / ${item.size} files`;
  }
  return `${formatSize(item.transferred)} / ${formatSize(item.size)}`;
}

const STATUS_STYLES: Record<TransferStatus, string> = {
  queued: 'bg-[#71717a]/15 text-[#71717a]',
  transferring: 'bg-[#3b82f6]/15 text-[#3b82f6]',
  completed: 'bg-emerald-500/15 text-emerald-400',
  failed: 'bg-red-500/15 text-red-400',
  paused: 'bg-amber-500/15 text-amber-400',
  cancelled: 'bg-[#52525b]/15 text-[#a1a1aa]',
};

export default function TransferQueue() {
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [maxConcurrent, setMaxConcurrent] = useState(2);
  const [allPaused, setAllPaused] = useState(false);
  const [speedLimit, setSpeedLimit] = useState<SpeedLimit>('unlimited');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [startTime] = useState(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll IPC for real transfer data and scheduler settings
  const fetchQueueState = useCallback(async () => {
    if (!isElectron()) return;
    try {
      const state = await window.bridgefile.transfer.getState() as TransferQueueState;
      setTransfers(state.items.map((item) => mapIPCTransfer(item, state.paused)));
      setMaxConcurrent(state.maxConcurrent);
      setAllPaused(state.paused);
      setSpeedLimit(state.speedLimitMbps ?? 'unlimited');
    } catch {
      // Silently ignore polling errors
    }
  }, []);

  useEffect(() => {
    if (!isElectron()) return;

    // Initial fetch
    fetchQueueState();

    // Poll every 500ms
    intervalRef.current = setInterval(fetchQueueState, 500);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchQueueState]);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [contextMenu]);

  const clearCompleted = async () => {
    if (isElectron()) {
      try {
        await window.bridgefile.transfer.clearFinished();
        await fetchQueueState();
        return;
      } catch {
        // Fall through to local removal
      }
    }
    setTransfers(prev => prev.filter(t => t.status !== 'completed' && t.status !== 'cancelled'));
  };

  const cancelTransfer = async (id: string) => {
    if (isElectron()) {
      try {
        await window.bridgefile.transfer.cancelTransfer(id);
        await fetchQueueState();
        return;
      } catch {
        // Fall through to local removal
      }
    }
    setTransfers(prev => prev.filter(t => t.id !== id));
  };

  const retryTransfer = async (id: string) => {
    if (isElectron()) {
      try {
        await window.bridgefile.transfer.retryTransfer(id);
        await fetchQueueState();
        return;
      } catch {
        // Fall through to local retry
      }
    }
    setTransfers(prev =>
      prev.map(t =>
        t.id === id ? { ...t, status: 'queued' as TransferStatus, transferred: 0, error: undefined } : t
      )
    );
  };

  const moveToTop = useCallback((id: string) => {
    if (!isElectron()) {
      setContextMenu(null);
      return;
    }

    window.bridgefile.transfer
      .moveToTop(id)
      .then(() => fetchQueueState())
      .catch((err: unknown) => logError(`Move to top failed: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => setContextMenu(null));
  }, [fetchQueueState]);

  const handlePauseAll = useCallback(() => {
    if (!isElectron()) {
      setAllPaused(true);
      return;
    }

    window.bridgefile.transfer
      .setPaused(true)
      .then(() => fetchQueueState())
      .catch((err: unknown) => logError(`Pause all failed: ${err instanceof Error ? err.message : String(err)}`));
  }, [fetchQueueState]);

  const handleResumeAll = useCallback(() => {
    if (!isElectron()) {
      setAllPaused(false);
      return;
    }

    window.bridgefile.transfer
      .setPaused(false)
      .then(() => fetchQueueState())
      .catch((err: unknown) => logError(`Resume all failed: ${err instanceof Error ? err.message : String(err)}`));
  }, [fetchQueueState]);

  const handleMaxConcurrentChange = useCallback((nextValue: number) => {
    if (!isElectron()) {
      setMaxConcurrent(nextValue);
      return;
    }

    window.bridgefile.transfer
      .setMaxConcurrent(nextValue)
      .then(() => fetchQueueState())
      .catch((err: unknown) => logError(`Set max concurrent failed: ${err instanceof Error ? err.message : String(err)}`));
  }, [fetchQueueState]);

  const handleSpeedLimitChange = useCallback((nextLimit: SpeedLimit) => {
    if (!isElectron()) {
      setSpeedLimit(nextLimit);
      return;
    }

    const normalizedLimit = nextLimit === 'unlimited' ? null : Number(nextLimit);
    window.bridgefile.transfer
      .setSpeedLimit(normalizedLimit)
      .then(() => fetchQueueState())
      .catch((err: unknown) => logError(`Set speed limit failed: ${err instanceof Error ? err.message : String(err)}`));
  }, [fetchQueueState]);

  const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, id });
  }, []);

  // Stats
  const fileTransfers = transfers.filter(t => t.entryType === 'file');
  const totalSize = fileTransfers.reduce((a, t) => a + t.size, 0);
  const totalTransferred = fileTransfers.reduce((a, t) => a + t.transferred, 0);
  const activeCount = transfers.filter(t => t.status === 'transferring').length;
  const pausedCount = transfers.filter(t => t.status === 'paused').length;
  const completedCount = transfers.filter(t => t.status === 'completed').length;
  const cancelledCount = transfers.filter(t => t.status === 'cancelled').length;
  const queuedCount = transfers.filter(t => t.status === 'queued').length;
  const elapsedMs = Date.now() - startTime;
  const avgSpeed = useMemo(() => {
    const activeTransfers = transfers.filter(t => t.status === 'transferring');
    if (activeTransfers.length === 0) return 0;
    return activeTransfers.reduce((a, t) => a + t.speed, 0);
  }, [transfers]);

  return (
    <div className="flex flex-col h-full">
      {/* Summary bar with SpeedIndicator */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1e1e2e]">
        <div className="flex items-center gap-3 text-[11px] text-[#71717a]">
          <span>{transfers.length} {t('transfers').toLowerCase()}</span>
          {activeCount > 0 && (
            <span className="text-[#3b82f6]">{activeCount} active</span>
          )}
          {allPaused && pausedCount > 0 && (
            <span className="text-amber-400">{pausedCount} paused</span>
          )}
          {queuedCount > 0 && (
            <span className="text-[#71717a]">{queuedCount} queued</span>
          )}
          {completedCount > 0 && (
            <span className="text-emerald-400">{completedCount} done</span>
          )}
          {cancelledCount > 0 && (
            <span className="text-[#a1a1aa]">{cancelledCount} cancelled</span>
          )}
          <span>
            {formatSize(totalTransferred)} / {formatSize(totalSize)}
          </span>
          {activeCount > 0 && (
            <>
              <span>Elapsed: {formatElapsed(elapsedMs)}</span>
              <span>Avg: {formatSpeed(avgSpeed)}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Speed indicator */}
          <SpeedIndicator speedLimit={speedLimit} onSpeedLimitChange={handleSpeedLimitChange} queue={transfers} />

          {/* Max concurrent dropdown */}
          <div className="flex items-center gap-1 text-[11px] text-[#71717a]">
            <span>Max:</span>
            <select
              value={maxConcurrent}
              onChange={(e) => handleMaxConcurrentChange(Number(e.target.value))}
              className="bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[10px] text-[#a1a1aa] px-1 py-0.5 focus:outline-none focus:border-[#3b82f6]"
            >
              {[1, 2, 3, 4, 5, 8, 10, 16, 24, 32, 48, 64].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>

          {/* Pause / Resume all */}
          {allPaused ? (
            <button
              onClick={handleResumeAll}
              className="px-2 py-0.5 text-[10px] rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 transition-colors"
              title="Resume paused transfers"
            >
              {t('resume_transfers')}
            </button>
          ) : (
            <button
              onClick={handlePauseAll}
              className="px-2 py-0.5 text-[10px] rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 transition-colors"
              title="Pause active and queued transfers"
            >
              {t('pause_transfers')}
            </button>
          )}

          {(completedCount > 0 || cancelledCount > 0) && (
            <button
              onClick={clearCompleted}
              className="text-[11px] text-[#71717a] hover:text-[#a1a1aa] transition-colors"
            >
              {t('clear_completed')}
            </button>
          )}
        </div>
      </div>

      {/* Total progress bar */}
      {(activeCount > 0 || pausedCount > 0) && (
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
          <div className="flex flex-col items-center justify-center h-full text-[#71717a] text-xs gap-2 px-4 text-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-[#52525b]">
              <path d="M7 10l5-5 5 5M12 5v14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="text-[#a1a1aa]">{t('no_transfers')}</div>
            <div className="text-[10px] text-[#52525b] max-w-sm">
              {t('transfers_empty_hint')}
            </div>
          </div>
        ) : (
          transfers.map(t => {
            const progress = t.size > 0 ? (t.transferred / t.size) * 100 : 0;
            const remaining = t.size - t.transferred;

            return (
              <div
                key={t.id}
                onContextMenu={(e) => handleContextMenu(e, t.id)}
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

                  {t.entryType === 'directory' && t.currentFile && (
                    <div className="mb-1 text-[10px] text-[#71717a] truncate">
                      {t.currentFile}
                    </div>
                  )}

                  {/* Progress bar */}
                  {(t.status === 'transferring' || t.status === 'queued' || t.status === 'paused') && (
                    <div className="h-1 bg-[#1e1e2e] rounded-full overflow-hidden mb-1">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          t.status === 'transferring'
                            ? 'bg-[#3b82f6]'
                            : t.status === 'paused'
                            ? 'bg-amber-500'
                            : 'bg-[#71717a]'
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}

                  {/* Details row */}
                  <div className="flex items-center gap-2 text-[10px] text-[#71717a]">
                    <span>{formatProgress(t)}</span>
                    {t.entryType === 'file' && t.status === 'transferring' && (
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
                      aria-label={`Retry transfer ${t.filename}`}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                  {(t.status === 'queued' || t.status === 'transferring' || t.status === 'paused') && (
                    <button
                      onClick={() => cancelTransfer(t.id)}
                      className="p-1 rounded text-[#71717a] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Cancel"
                      aria-label={`Cancel transfer ${t.filename}`}
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

      {/* Context menu for priority */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[#12121a] border border-[#1e1e2e] rounded-lg shadow-xl py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => moveToTop(contextMenu.id)}
            className="w-full px-3 py-1.5 text-left text-[11px] text-[#a1a1aa] hover:bg-[#1a1a26] hover:text-[#e4e4e7] transition-colors"
          >
            Move to top
          </button>
          <button
            onClick={() => {
              cancelTransfer(contextMenu.id);
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left text-[11px] text-red-400 hover:bg-red-500/10 transition-colors"
          >
            Cancel transfer
          </button>
        </div>
      )}
    </div>
  );
}
