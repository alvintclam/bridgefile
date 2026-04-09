import React, { useState, useEffect, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────

interface FileInfo {
  name: string;
  size: number;
  modifiedAt: number;
  isDirectory: boolean;
}

type CompareStatus = 'only-local' | 'only-remote' | 'different' | 'same';

interface CompareEntry {
  name: string;
  localSize?: number;
  remoteSize?: number;
  localDate?: number;
  remoteDate?: number;
  status: CompareStatus;
}

interface DirectoryCompareProps {
  isOpen: boolean;
  onClose: () => void;
  localPath: string;
  remotePath: string;
  protocol?: 'sftp' | 's3' | 'ftp';
  connectionId?: string;
}

// ── Helpers ────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes === 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(ts: number): string {
  if (!ts) return '--';
  return new Date(ts).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATUS_STYLES: Record<CompareStatus, { bg: string; text: string; label: string }> = {
  'only-local': { bg: 'bg-emerald-500/10', text: 'text-emerald-400', label: 'Only Local' },
  'only-remote': { bg: 'bg-blue-500/10', text: 'text-blue-400', label: 'Only Remote' },
  different: { bg: 'bg-amber-500/10', text: 'text-amber-400', label: 'Different' },
  same: { bg: 'bg-[#71717a]/10', text: 'text-[#71717a]', label: 'Same' },
};

function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof window.bridgefile !== 'undefined';
}

// ── Component ──────────────────────────────────────────────────

export default function DirectoryCompare({
  isOpen,
  onClose,
  localPath,
  remotePath,
  protocol,
  connectionId,
}: DirectoryCompareProps) {
  const [entries, setEntries] = useState<CompareEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [hideIdentical, setHideIdentical] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const compare = useCallback(async () => {
    if (!isElectron() || !protocol || !connectionId) return;

    setLoading(true);
    setError(null);

    try {
      // Get local files
      const localRaw: FileInfo[] = await window.bridgefile.fs.listLocal(localPath);
      const localFiles = new Map<string, FileInfo>();
      for (const f of localRaw) {
        if (!f.isDirectory) localFiles.set(f.name, f);
      }

      // Get remote files
      const api = protocol === 'sftp' ? window.bridgefile.sftp
        : protocol === 's3' ? window.bridgefile.s3
        : window.bridgefile.ftp;
      const remoteRaw: FileInfo[] = await api.list(connectionId, remotePath);
      const remoteFiles = new Map<string, FileInfo>();
      for (const f of remoteRaw) {
        if (!f.isDirectory) remoteFiles.set(f.name, f);
      }

      // Build comparison
      const allNames = new Set([...localFiles.keys(), ...remoteFiles.keys()]);
      const result: CompareEntry[] = [];

      for (const name of allNames) {
        const local = localFiles.get(name);
        const remote = remoteFiles.get(name);

        let status: CompareStatus;
        if (local && !remote) {
          status = 'only-local';
        } else if (!local && remote) {
          status = 'only-remote';
        } else if (local && remote) {
          // Different if size differs or modified dates differ by more than 2 seconds
          const sizeDiff = local.size !== remote.size;
          const dateDiff = Math.abs(local.modifiedAt - remote.modifiedAt) > 2000;
          status = sizeDiff || dateDiff ? 'different' : 'same';
        } else {
          status = 'same';
        }

        result.push({
          name,
          localSize: local?.size,
          remoteSize: remote?.size,
          localDate: local?.modifiedAt,
          remoteDate: remote?.modifiedAt,
          status,
        });
      }

      result.sort((a, b) => {
        const order: Record<CompareStatus, number> = {
          'only-local': 0,
          'only-remote': 1,
          different: 2,
          same: 3,
        };
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        return a.name.localeCompare(b.name);
      });

      setEntries(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [localPath, remotePath, protocol, connectionId]);

  useEffect(() => {
    if (isOpen) {
      compare();
    }
  }, [isOpen, compare]);

  const handleSync = useCallback(
    async (mode: 'upload-missing' | 'download-missing' | 'sync-both') => {
      if (!isElectron() || !protocol || !connectionId) return;

      setSyncing(true);
      setError(null);

      try {
        const api = protocol === 'sftp' ? window.bridgefile.sftp
          : protocol === 's3' ? window.bridgefile.s3
          : window.bridgefile.ftp;

        for (const entry of entries) {
          if (mode === 'upload-missing' || mode === 'sync-both') {
            if (entry.status === 'only-local') {
              const lp = localPath.endsWith('/') ? localPath + entry.name : localPath + '/' + entry.name;
              const rp = remotePath.endsWith('/') ? remotePath + entry.name : remotePath + '/' + entry.name;
              await api.upload(connectionId, lp, rp);
            }
          }
          if (mode === 'download-missing' || mode === 'sync-both') {
            if (entry.status === 'only-remote') {
              const rp = remotePath.endsWith('/') ? remotePath + entry.name : remotePath + '/' + entry.name;
              const lp = localPath.endsWith('/') ? localPath + entry.name : localPath + '/' + entry.name;
              await api.download(connectionId, rp, lp);
            }
          }
        }

        // Re-compare after sync
        await compare();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      } finally {
        setSyncing(false);
      }
    },
    [entries, localPath, remotePath, protocol, connectionId, compare],
  );

  if (!isOpen) return null;

  const displayed = hideIdentical ? entries.filter((e) => e.status !== 'same') : entries;

  const counts = {
    onlyLocal: entries.filter((e) => e.status === 'only-local').length,
    onlyRemote: entries.filter((e) => e.status === 'only-remote').length,
    different: entries.filter((e) => e.status === 'different').length,
    same: entries.filter((e) => e.status === 'same').length,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[800px] max-h-[600px] bg-[#12121a] border border-[#1e1e2e] rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-[#1e1e2e]">
          <div>
            <h2 className="text-sm font-semibold text-[#e4e4e7]">Directory Comparison</h2>
            <p className="text-[10px] text-[#71717a] mt-0.5 font-mono">
              {localPath} &harr; {remotePath}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#71717a] hover:text-[#e4e4e7] hover:bg-[#1a1a26] transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Summary + controls */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e1e2e]">
          <div className="flex items-center gap-3 text-[10px]">
            <span className="text-emerald-400">{counts.onlyLocal} local only</span>
            <span className="text-blue-400">{counts.onlyRemote} remote only</span>
            <span className="text-amber-400">{counts.different} different</span>
            <span className="text-[#71717a]">{counts.same} same</span>
          </div>
          <label className="flex items-center gap-1.5 text-[10px] text-[#a1a1aa] cursor-pointer">
            <input
              type="checkbox"
              checked={hideIdentical}
              onChange={(e) => setHideIdentical(e.target.checked)}
              className="rounded border-[#1e1e2e]"
            />
            Hide identical
          </label>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full text-[#71717a] text-xs">
              Comparing directories...
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full text-red-400 text-xs px-4 text-center">
              {error}
            </div>
          ) : displayed.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[#71717a] text-xs">
              {entries.length === 0 ? 'No files found' : 'All files are identical'}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#12121a] border-b border-[#1e1e2e]">
                <tr className="text-[10px] uppercase tracking-wider text-[#71717a]">
                  <th className="text-left py-1.5 px-3 font-medium">Filename</th>
                  <th className="text-right py-1.5 px-2 font-medium">Local Size</th>
                  <th className="text-right py-1.5 px-2 font-medium">Remote Size</th>
                  <th className="text-right py-1.5 px-2 font-medium">Local Date</th>
                  <th className="text-right py-1.5 px-2 font-medium">Remote Date</th>
                  <th className="text-center py-1.5 px-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((entry) => {
                  const style = STATUS_STYLES[entry.status];
                  return (
                    <tr key={entry.name} className="hover:bg-[#1a1a26]/50 border-b border-[#1e1e2e]/50">
                      <td className="py-1 px-3 text-[#e4e4e7] truncate max-w-[200px]">{entry.name}</td>
                      <td className="py-1 px-2 text-right text-[#a1a1aa] font-mono">
                        {entry.localSize != null ? formatSize(entry.localSize) : '--'}
                      </td>
                      <td className="py-1 px-2 text-right text-[#a1a1aa] font-mono">
                        {entry.remoteSize != null ? formatSize(entry.remoteSize) : '--'}
                      </td>
                      <td className="py-1 px-2 text-right text-[#a1a1aa] text-[10px]">
                        {entry.localDate ? formatDate(entry.localDate) : '--'}
                      </td>
                      <td className="py-1 px-2 text-right text-[#a1a1aa] text-[10px]">
                        {entry.remoteDate ? formatDate(entry.remoteDate) : '--'}
                      </td>
                      <td className="py-1 px-2 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${style.bg} ${style.text}`}>
                          {style.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between p-3 border-t border-[#1e1e2e]">
          <button
            onClick={compare}
            disabled={loading}
            className="px-3 py-1.5 text-xs rounded text-[#a1a1aa] hover:bg-[#1a1a26] border border-[#1e1e2e] transition-colors"
          >
            Refresh
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleSync('upload-missing')}
              disabled={syncing || counts.onlyLocal === 0}
              className="px-3 py-1.5 text-xs rounded text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/20 transition-colors disabled:opacity-40"
            >
              Upload missing to remote
            </button>
            <button
              onClick={() => handleSync('download-missing')}
              disabled={syncing || counts.onlyRemote === 0}
              className="px-3 py-1.5 text-xs rounded text-blue-400 hover:bg-blue-500/10 border border-blue-500/20 transition-colors disabled:opacity-40"
            >
              Download missing to local
            </button>
            <button
              onClick={() => handleSync('sync-both')}
              disabled={syncing || (counts.onlyLocal === 0 && counts.onlyRemote === 0)}
              className="px-3 py-1.5 text-xs rounded bg-[#3b82f6] text-white hover:bg-[#2563eb] transition-colors disabled:opacity-40"
            >
              {syncing ? 'Syncing...' : 'Sync both ways'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
