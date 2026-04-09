import React, { useState, useRef, useEffect } from 'react';

export type LogLevel = 'info' | 'success' | 'error' | 'warning';

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  message: string;
}

const MOCK_LOGS: LogEntry[] = [
  { id: '1', timestamp: new Date('2026-04-08T10:00:00'), level: 'info', message: 'BridgeFile started' },
  { id: '2', timestamp: new Date('2026-04-08T10:00:05'), level: 'info', message: 'Connecting to 192.168.1.100:22 via SFTP...' },
  { id: '3', timestamp: new Date('2026-04-08T10:00:06'), level: 'success', message: 'Connected to 192.168.1.100 as deploy' },
  { id: '4', timestamp: new Date('2026-04-08T10:00:07'), level: 'info', message: 'Listing remote directory /' },
  { id: '5', timestamp: new Date('2026-04-08T10:00:08'), level: 'info', message: 'Found 5 items in /' },
  { id: '6', timestamp: new Date('2026-04-08T10:01:15'), level: 'info', message: 'Starting upload: node-v24.13.0.tar.gz (40.9 MB)' },
  { id: '7', timestamp: new Date('2026-04-08T10:02:30'), level: 'success', message: 'Upload complete: node-v24.13.0.tar.gz' },
  { id: '8', timestamp: new Date('2026-04-08T10:02:35'), level: 'info', message: 'Starting upload: design-mockup.fig (15.0 MB)' },
  { id: '9', timestamp: new Date('2026-04-08T10:03:00'), level: 'warning', message: 'Transfer speed dropped below 1 MB/s' },
  { id: '10', timestamp: new Date('2026-04-08T10:03:45'), level: 'info', message: 'Starting download: db-2026-04-07.sql.gz (50.0 MB)' },
  { id: '11', timestamp: new Date('2026-04-08T10:04:00'), level: 'error', message: 'Download failed: auth.log - Connection timed out' },
  { id: '12', timestamp: new Date('2026-04-08T10:04:01'), level: 'info', message: 'Retrying download: auth.log (attempt 2/3)' },
  { id: '13', timestamp: new Date('2026-04-08T10:05:00'), level: 'success', message: 'Upload complete: report-q1.pdf' },
];

const LEVEL_STYLES: Record<LogLevel, string> = {
  info: 'text-[#71717a]',
  success: 'text-emerald-400',
  error: 'text-red-400',
  warning: 'text-amber-400',
};

const LEVEL_BADGE_STYLES: Record<LogLevel, string> = {
  info: 'bg-[#71717a]/15 text-[#71717a]',
  success: 'bg-emerald-500/15 text-emerald-400',
  error: 'bg-red-500/15 text-red-400',
  warning: 'bg-amber-500/15 text-amber-400',
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function LogPanel() {
  const [logs, setLogs] = useState<LogEntry[]>(MOCK_LOGS);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 20;
    setAutoScroll(isAtBottom);
  };

  const clearLogs = () => {
    setLogs([]);
  };

  const copyEntry = (entry: LogEntry) => {
    const text = `[${formatTime(entry.timestamp)}] [${entry.level.toUpperCase()}] ${entry.message}`;
    navigator.clipboard?.writeText(text);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1e1e2e]">
        <div className="flex items-center gap-2 text-[11px] text-[#71717a]">
          <span>{logs.length} entries</span>
          {!autoScroll && (
            <button
              onClick={() => {
                setAutoScroll(true);
                if (scrollRef.current) {
                  scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                }
              }}
              className="text-[#3b82f6] hover:text-[#2563eb] transition-colors"
            >
              Scroll to bottom
            </button>
          )}
        </div>
        <button
          onClick={clearLogs}
          className="text-[11px] text-[#71717a] hover:text-[#a1a1aa] transition-colors"
        >
          Clear
        </button>
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto font-mono text-[11px] leading-5"
        onScroll={handleScroll}
      >
        {logs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[#71717a] text-xs font-sans">
            No log entries
          </div>
        ) : (
          logs.map(entry => (
            <div
              key={entry.id}
              className="flex items-start gap-2 px-3 py-0.5 hover:bg-[#1a1a26]/50 group transition-colors"
            >
              {/* Timestamp */}
              <span className="text-[#4a4a5a] shrink-0 select-none">
                {formatTime(entry.timestamp)}
              </span>

              {/* Level badge */}
              <span
                className={`px-1 rounded text-[9px] uppercase font-semibold tracking-wide shrink-0 mt-[1px] ${LEVEL_BADGE_STYLES[entry.level]}`}
              >
                {entry.level.slice(0, 4)}
              </span>

              {/* Message */}
              <span className={`flex-1 min-w-0 break-words ${LEVEL_STYLES[entry.level]}`}>
                {entry.message}
              </span>

              {/* Copy button */}
              <button
                onClick={() => copyEntry(entry)}
                className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 text-[#71717a] hover:text-[#a1a1aa] transition-all"
                title="Copy"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                  <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
