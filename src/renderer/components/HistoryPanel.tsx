import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { t } from '../lib/i18n';

interface HistoryEntry {
  id: string;
  timestamp: number;
  protocol: 'sftp' | 's3' | 'ftp';
  direction: 'upload' | 'download';
  connectionId: string;
  connectionName?: string;
  localPath: string;
  remotePath: string;
  fileName: string;
  size: number;
  entryType: 'file' | 'directory';
  status: 'completed' | 'failed' | 'cancelled';
  error?: string;
  durationMs?: number;
}

function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof window.bridgefile !== 'undefined';
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(ms?: number): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

type StatusFilter = 'all' | 'completed' | 'failed' | 'cancelled';

export default function HistoryPanel() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!isElectron()) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const rows = await window.bridgefile.history.list(500);
      setEntries(rows);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Refresh when panel mounts / periodically in case new transfers completed
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    return entries.filter((e) => {
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (!q) return true;
      return (
        e.fileName.toLowerCase().includes(q) ||
        e.localPath.toLowerCase().includes(q) ||
        e.remotePath.toLowerCase().includes(q) ||
        e.protocol.includes(q)
      );
    });
  }, [entries, filter, statusFilter]);

  const handleClear = useCallback(async () => {
    if (!isElectron()) return;
    if (!window.confirm('Clear all transfer history? This cannot be undone.')) return;
    await window.bridgefile.history.clear();
    setEntries([]);
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1e1e2e] shrink-0">
        <input
          type="text"
          placeholder={t('history_filter_placeholder')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 bg-[#0a0a0f] border border-[#1e1e2e] rounded px-2 py-1 text-[11px] text-[#e4e4e7] placeholder-[#52525b] focus:outline-none focus:border-[#3b82f6]"
          aria-label={t('history_filter_placeholder')}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="bg-[#0a0a0f] border border-[#1e1e2e] rounded px-2 py-1 text-[11px] text-[#a1a1aa] focus:outline-none focus:border-[#3b82f6]"
          aria-label={t('history_col_status')}
        >
          <option value="all">{t('history_all')}</option>
          <option value="completed">{t('history_completed')}</option>
          <option value="failed">{t('history_failed')}</option>
          <option value="cancelled">{t('history_cancelled')}</option>
        </select>
        <button
          onClick={load}
          className="px-2 py-1 text-[11px] rounded text-[#a1a1aa] hover:text-[#e4e4e7] hover:bg-[#1a1a26]"
          aria-label="Refresh history"
          title="Refresh"
        >
          ↻
        </button>
        <button
          onClick={handleClear}
          className="px-2 py-1 text-[11px] rounded text-red-400/80 hover:text-red-400 hover:bg-red-500/10"
          aria-label="Clear all history"
        >
          {t('clear')}
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-xs text-[#71717a]">
            {t('history_loading')}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-[#71717a]">
            {entries.length === 0 ? t('history_empty') : t('history_no_matches')}
          </div>
        ) : (
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-[#12121a] border-b border-[#1e1e2e]">
              <tr className="text-left text-[#71717a]">
                <th className="px-3 py-1.5 font-medium">{t('history_col_when')}</th>
                <th className="px-3 py-1.5 font-medium">{t('history_col_dir')}</th>
                <th className="px-3 py-1.5 font-medium">{t('history_col_file')}</th>
                <th className="px-3 py-1.5 font-medium">{t('history_col_size')}</th>
                <th className="px-3 py-1.5 font-medium">{t('history_col_proto')}</th>
                <th className="px-3 py-1.5 font-medium">{t('history_col_duration')}</th>
                <th className="px-3 py-1.5 font-medium">{t('history_col_status')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr
                  key={e.id}
                  className="border-b border-[#1e1e2e]/50 hover:bg-[#1a1a26]/50"
                  title={`${e.direction === 'upload' ? e.localPath + ' → ' + e.remotePath : e.remotePath + ' → ' + e.localPath}${e.error ? '\nError: ' + e.error : ''}`}
                >
                  <td className="px-3 py-1 text-[#a1a1aa] whitespace-nowrap">{formatTime(e.timestamp)}</td>
                  <td className="px-3 py-1 text-[#a1a1aa]">
                    {e.direction === 'upload' ? '↑' : '↓'}
                  </td>
                  <td className="px-3 py-1 text-[#e4e4e7] font-mono truncate max-w-[280px]">
                    {e.fileName}
                  </td>
                  <td className="px-3 py-1 text-[#a1a1aa] whitespace-nowrap">{formatSize(e.size)}</td>
                  <td className="px-3 py-1 text-[#a1a1aa] uppercase tracking-wide text-[10px]">
                    {e.protocol}
                  </td>
                  <td className="px-3 py-1 text-[#71717a] whitespace-nowrap">
                    {formatDuration(e.durationMs)}
                  </td>
                  <td className="px-3 py-1 whitespace-nowrap">
                    <StatusBadge status={e.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer count */}
      <div className="px-3 py-1.5 border-t border-[#1e1e2e] text-[10px] text-[#71717a] shrink-0">
        {filtered.length} of {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: HistoryEntry['status'] }) {
  const colors = {
    completed: 'bg-emerald-500/15 text-emerald-400',
    failed: 'bg-red-500/15 text-red-400',
    cancelled: 'bg-[#71717a]/15 text-[#71717a]',
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] ${colors[status]}`}>
      {status}
    </span>
  );
}
