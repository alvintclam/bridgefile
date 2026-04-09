import React, { useState, useRef, useEffect, useCallback } from 'react';

export type LogLevel = 'info' | 'success' | 'error' | 'warning';

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  message: string;
}

// ── Event-emitter-based global log bus ─────────────────────────

type LogListener = (entry: LogEntry) => void;

const listeners = new Set<LogListener>();
let nextId = 1;

/**
 * Add a log entry from anywhere in the renderer process.
 *
 * ```ts
 * import { addLog } from './LogPanel';
 * addLog('info', 'Connected to 192.168.1.100');
 * addLog('error', 'Upload failed: permission denied');
 * ```
 */
export function addLog(level: LogLevel, message: string): void {
  const entry: LogEntry = {
    id: String(nextId++),
    timestamp: new Date(),
    level,
    message,
  };
  for (const fn of listeners) {
    fn(entry);
  }
}

/** Subscribe to new log entries. Returns an unsubscribe function. */
function subscribe(fn: LogListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ── Convenience helpers for common log patterns ────────────────

export function logConnection(protocol: string, host: string, user?: string): void {
  const who = user ? ` as ${user}` : '';
  addLog('info', `Connecting to ${host} via ${protocol}...`);
  // The caller should follow up with logConnected / logError
  void who; // used above
}

export function logConnected(protocol: string, host: string, user?: string): void {
  const who = user ? ` as ${user}` : '';
  addLog('success', `Connected to ${host}${who} (${protocol})`);
}

export function logDisconnected(host: string): void {
  addLog('info', `Disconnected from ${host}`);
}

export function logTransferStart(action: 'upload' | 'download', name: string, sizeBytes?: number): void {
  const size = sizeBytes != null ? ` (${formatSize(sizeBytes)})` : '';
  addLog('info', `Starting ${action}: ${name}${size}`);
}

export function logTransferComplete(action: 'upload' | 'download', name: string): void {
  addLog('success', `${capitalize(action)} complete: ${name}`);
}

export function logError(message: string): void {
  addLog('error', message);
}

export function logWarning(message: string): void {
  addLog('warning', message);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ── Component ──────────────────────────────────────────────────

const MAX_LOG_ENTRIES = 5000;

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
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Subscribe to log bus
  useEffect(() => {
    const unsubscribe = subscribe((entry) => {
      setLogs((prev) => {
        const next = [...prev, entry];
        // Cap entries to prevent memory issues
        return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
      });
    });
    return unsubscribe;
  }, []);

  // Emit a startup log on mount
  useEffect(() => {
    addLog('info', 'BridgeFile started');
  }, []);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 20;
    setAutoScroll(isAtBottom);
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const exportLogs = useCallback(() => {
    const lines = logs.map(
      (entry) =>
        `[${entry.timestamp.toISOString()}] [${entry.level.toUpperCase()}] ${entry.message}`,
    );
    const content = lines.join('\n');

    if (typeof window !== 'undefined' && window.bridgefile) {
      window.bridgefile.app.exportLogs(content).catch((err: unknown) => {
        console.error('Export failed:', err);
      });
    } else {
      // Fallback: download as blob
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bridgefile-logs-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [logs]);

  const copyEntry = useCallback((entry: LogEntry) => {
    const text = `[${formatTime(entry.timestamp)}] [${entry.level.toUpperCase()}] ${entry.message}`;
    navigator.clipboard?.writeText(text);
  }, []);

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
        <div className="flex items-center gap-2">
          <button
            onClick={exportLogs}
            className="text-[11px] text-[#71717a] hover:text-[#a1a1aa] transition-colors"
          >
            Export
          </button>
          <button
            onClick={clearLogs}
            className="text-[11px] text-[#71717a] hover:text-[#a1a1aa] transition-colors"
          >
            Clear
          </button>
        </div>
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
