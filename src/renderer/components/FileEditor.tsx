import React, { useState, useEffect, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────

interface FileEditorProps {
  isOpen: boolean;
  onClose: () => void;
  protocol?: 'sftp' | 's3' | 'ftp';
  connectionId?: string;
  remotePath: string;
  fileName: string;
  fileSize: number;
}

// ── Text file extensions ───────────────────────────────────────

const TEXT_EXTENSIONS = new Set([
  '.txt', '.json', '.xml', '.yml', '.yaml', '.md',
  '.html', '.css', '.js', '.ts', '.py', '.sh',
  '.conf', '.cfg', '.ini', '.log', '.env',
  '.jsx', '.tsx', '.scss', '.less', '.svg',
  '.toml', '.csv', '.sql', '.rb', '.go',
  '.rs', '.java', '.c', '.h', '.cpp', '.hpp',
  '.php', '.pl', '.lua', '.r', '.m',
  '.dockerfile', '.makefile', '.gitignore',
]);

export function isTextFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  // Check extension
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx >= 0) {
    const ext = lower.slice(dotIdx);
    if (TEXT_EXTENSIONS.has(ext)) return true;
  }
  // Also check some extensionless files
  const baseName = lower.split('/').pop() || '';
  if (['makefile', 'dockerfile', '.gitignore', '.env', '.editorconfig', '.prettierrc'].includes(baseName)) {
    return true;
  }
  return false;
}

// ── Helpers ────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof window.bridgefile !== 'undefined';
}

// ── Component ──────────────────────────────────────────────────

export default function FileEditor({
  isOpen,
  onClose,
  protocol,
  connectionId,
  remotePath,
  fileName,
  fileSize,
}: FileEditorProps) {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const hasChanges = content !== originalContent;

  // Load file content
  useEffect(() => {
    if (!isOpen || !protocol || !connectionId) return;

    setLoading(true);
    setError(null);
    setSaved(false);

    (async () => {
      try {
        if (isElectron()) {
          const tempPath = await window.bridgefile.app.editRemoteFile(protocol, connectionId, remotePath);
          // Read the downloaded temp file -- we need to read it via fetch or a new IPC
          // Since we have the temp path, we'll use the fs:readFile approach
          // For simplicity, download again and read content via the API
          // Actually, editRemoteFile returns a temp path. We need another IPC to read it.
          // Let's use the fs:listLocal approach -- but actually we need file content.
          // The simplest approach: re-download content via the protocol APIs directly
          // and have the main process return the content. But our current API downloads to
          // a file. Let's use fetch on the temp path. In Electron, we can use file:// URLs.
          const response = await fetch(`file://${tempPath}`);
          const text = await response.text();
          setContent(text);
          setOriginalContent(text);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen, protocol, connectionId, remotePath]);

  const handleSave = useCallback(async () => {
    if (!protocol || !connectionId || !isElectron()) return;

    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      await window.bridgefile.app.saveRemoteFile(protocol, connectionId, remotePath, content);
      setOriginalContent(content);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSaving(false);
    }
  }, [protocol, connectionId, remotePath, content]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Ctrl/Cmd+S to save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (hasChanges) handleSave();
      }
    },
    [hasChanges, handleSave],
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[760px] h-[560px] bg-[#12121a] border border-[#1e1e2e] rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-[#1e1e2e]">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[#e4e4e7] flex items-center gap-2">
                {fileName}
                {hasChanges && (
                  <span className="text-[9px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                    Modified
                  </span>
                )}
                {saved && (
                  <span className="text-[9px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                    Saved
                  </span>
                )}
              </h2>
              <p className="text-[10px] text-[#71717a] font-mono mt-0.5">
                {remotePath} &middot; {formatSize(fileSize)} &middot; UTF-8
              </p>
            </div>
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

        {/* Editor area */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full text-[#71717a] text-xs">
              Loading file...
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full text-red-400 text-xs px-4 text-center">
              {error}
            </div>
          ) : (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full h-full resize-none bg-[#0a0a0f] text-[#e4e4e7] font-mono text-xs leading-5 p-3 focus:outline-none border-none"
              spellCheck={false}
              wrap="off"
            />
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between p-3 border-t border-[#1e1e2e]">
          <div className="text-[10px] text-[#71717a]">
            {content.split('\n').length} lines &middot; {new Blob([content]).size} bytes
            {hasChanges && ' (unsaved changes)'}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded text-[#a1a1aa] hover:bg-[#1a1a26] border border-[#1e1e2e] transition-colors"
            >
              Close
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className={`px-4 py-1.5 text-xs rounded transition-colors ${
                saving
                  ? 'bg-[#3b82f6]/50 text-white/50 cursor-wait'
                  : hasChanges
                  ? 'bg-[#3b82f6] text-white hover:bg-[#2563eb]'
                  : 'bg-[#3b82f6]/30 text-white/30 cursor-not-allowed'
              }`}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
