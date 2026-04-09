import React, { useState, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────

interface SearchResult {
  name: string;
  path: string;
  size: number;
  modifiedAt: number;
}

interface SearchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  protocol?: 'sftp' | 's3' | 'ftp';
  connectionId?: string;
  currentPath: string;
  onNavigate: (path: string) => void;
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

function getParentPath(filePath: string): string {
  const parts = filePath.split('/');
  parts.pop();
  return parts.join('/') || '/';
}

function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof window.bridgefile !== 'undefined';
}

// ── Component ──────────────────────────────────────────────────

export default function SearchDialog({
  isOpen,
  onClose,
  protocol,
  connectionId,
  currentPath,
  onNavigate,
}: SearchDialogProps) {
  const [pattern, setPattern] = useState('*');
  const [recursive, setRecursive] = useState(true);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchedCount, setSearchedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = useCallback(async () => {
    if (!isElectron() || !protocol || !connectionId) return;
    if (!pattern.trim()) return;

    setSearching(true);
    setResults([]);
    setSearchedCount(0);
    setError(null);

    try {
      let searchResults: SearchResult[];

      if (protocol === 's3') {
        searchResults = await window.bridgefile.s3.search(connectionId, currentPath, pattern);
      } else if (protocol === 'sftp') {
        searchResults = await window.bridgefile.sftp.search(connectionId, currentPath, pattern, recursive);
      } else {
        searchResults = await window.bridgefile.ftp.search(connectionId, currentPath, pattern, recursive);
      }

      setResults(searchResults);
      setSearchedCount(searchResults.length);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSearching(false);
    }
  }, [protocol, connectionId, currentPath, pattern, recursive]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSearch();
      }
    },
    [handleSearch],
  );

  const handleNavigateToFile = useCallback(
    (filePath: string) => {
      const parent = getParentPath(filePath);
      onNavigate(parent);
      onClose();
    },
    [onNavigate, onClose],
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[640px] max-h-[500px] bg-[#12121a] border border-[#1e1e2e] rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-[#1e1e2e]">
          <h2 className="text-sm font-semibold text-[#e4e4e7]">Remote File Search</h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#71717a] hover:text-[#e4e4e7] hover:bg-[#1a1a26] transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Search form */}
        <div className="p-3 border-b border-[#1e1e2e]">
          <div className="flex items-center gap-2 mb-2">
            <input
              type="text"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="*.log, report*, *.json"
              className="flex-1 px-2.5 py-1.5 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] placeholder-[#71717a] focus:border-[#3b82f6] focus:outline-none transition-colors font-mono"
              autoFocus
            />
            <button
              onClick={handleSearch}
              disabled={searching}
              className={`px-4 py-1.5 text-xs rounded transition-colors ${
                searching
                  ? 'bg-[#3b82f6]/50 text-white/50 cursor-wait'
                  : 'bg-[#3b82f6] text-white hover:bg-[#2563eb]'
              }`}
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
          </div>

          <div className="flex items-center gap-4 text-[10px]">
            <span className="text-[#71717a]">
              Searching in: <span className="text-[#a1a1aa] font-mono">{currentPath}</span>
            </span>
            {protocol !== 's3' && (
              <label className="flex items-center gap-1.5 text-[#a1a1aa] cursor-pointer">
                <input
                  type="checkbox"
                  checked={recursive}
                  onChange={(e) => setRecursive(e.target.checked)}
                  className="rounded border-[#1e1e2e]"
                />
                Recursive
              </label>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {searching ? (
            <div className="flex flex-col items-center justify-center h-full text-[#71717a] text-xs gap-2 py-8">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="60" strokeDashoffset="15" />
              </svg>
              <span>Searching... {searchedCount > 0 && `${searchedCount} files found`}</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full text-red-400 text-xs px-4 text-center py-8">
              {error}
            </div>
          ) : results.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[#71717a] text-xs py-8">
              {searchedCount === 0 ? 'Enter a pattern and click Search' : 'No files matched'}
            </div>
          ) : (
            <div>
              <div className="px-3 py-1.5 text-[10px] text-[#71717a] border-b border-[#1e1e2e] sticky top-0 bg-[#12121a]">
                {results.length} result{results.length !== 1 ? 's' : ''}
              </div>
              {results.map((result, idx) => (
                <div
                  key={idx}
                  onClick={() => handleNavigateToFile(result.path)}
                  className="flex items-center gap-3 px-3 py-1.5 hover:bg-[#1a1a26] cursor-pointer group border-b border-[#1e1e2e]/50 transition-colors"
                >
                  {/* File icon */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0 text-[#71717a]">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" strokeWidth="1.5" />
                    <polyline points="14,2 14,8 20,8" stroke="currentColor" strokeWidth="1.5" />
                  </svg>

                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-[#e4e4e7] truncate">{result.name}</div>
                    <div className="text-[10px] text-[#71717a] font-mono truncate">{result.path}</div>
                  </div>

                  <div className="text-[10px] text-[#71717a] shrink-0 text-right">
                    <div>{formatSize(result.size)}</div>
                    <div>{formatDate(result.modifiedAt)}</div>
                  </div>

                  {/* Navigate arrow */}
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    className="shrink-0 text-[#71717a] opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
