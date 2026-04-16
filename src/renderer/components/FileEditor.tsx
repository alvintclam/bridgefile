import React, { useState, useEffect, useCallback, useRef } from 'react';
import { highlight, detectLanguage } from '../lib/highlight';

// ── Types ──────────────────────────────────────────────────────

interface FileEditorProps {
  isOpen: boolean;
  onClose: () => void;
  protocol?: 'sftp' | 's3' | 'ftp';
  connectionId?: string;
  localPath?: string;
  remotePath?: string;
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
  localPath,
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
  const activePath = localPath ?? remotePath ?? '';
  const isLocalFile = Boolean(localPath);

  // Load file content
  useEffect(() => {
    if (!isOpen || (!localPath && (!protocol || !connectionId || !remotePath))) return;

    setLoading(true);
    setError(null);
    setSaved(false);

    (async () => {
      try {
        if (isElectron()) {
          const text = localPath
            ? await window.bridgefile.fs.readTextFile(localPath)
            : await (async () => {
                const tempPath = await window.bridgefile.app.editRemoteFile(protocol!, connectionId!, remotePath!);
                return window.bridgefile.fs.readTextFile(tempPath);
              })();
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
  }, [isOpen, protocol, connectionId, localPath, remotePath]);

  const handleSave = useCallback(async () => {
    if (!isElectron()) return;
    if (!localPath && (!protocol || !connectionId || !remotePath)) return;

    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      if (localPath) {
        await window.bridgefile.fs.writeTextFile(localPath, content);
      } else {
        await window.bridgefile.app.saveRemoteFile(protocol!, connectionId!, remotePath!, content);
      }
      setOriginalContent(content);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSaving(false);
    }
  }, [protocol, connectionId, localPath, remotePath, content]);

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
                {activePath} &middot; {formatSize(fileSize)} &middot; UTF-8
                {isLocalFile ? ' · Local' : ' · Remote'}
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
            <LineNumberedEditor
              content={content}
              onChange={setContent}
              onKeyDown={handleKeyDown}
              fileName={fileName}
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

// ── Line-numbered editor ──────────────────────────────────────

function LineNumberedEditor({
  content,
  onChange,
  onKeyDown,
  fileName,
}: {
  content: string;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  fileName: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumberRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const lineCount = content.split('\n').length;
  const gutterWidth = Math.max(3, String(lineCount).length) * 9 + 16;
  const language = detectLanguage(fileName);
  // Only highlight for reasonably-sized files (avoid jank on huge files)
  const useHighlight = language !== 'plain' && content.length < 500_000;
  const highlighted = useHighlight ? highlight(content, language) : '';

  const handleScroll = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (lineNumberRef.current) lineNumberRef.current.scrollTop = ta.scrollTop;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = ta.scrollTop;
      highlightRef.current.scrollLeft = ta.scrollLeft;
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      <div
        ref={lineNumberRef}
        className="shrink-0 bg-[#0a0a0f] text-[#52525b] font-mono text-xs leading-5 pt-3 pb-3 text-right overflow-hidden select-none border-r border-[#1e1e2e]"
        style={{ width: gutterWidth }}
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className="pr-2 pl-2">{i + 1}</div>
        ))}
      </div>
      <div className="relative flex-1 h-full overflow-hidden bg-[#0a0a0f]">
        {/* Highlighted layer (visible, scrolled by syncing with textarea) */}
        {useHighlight && (
          <pre
            ref={highlightRef}
            aria-hidden="true"
            className="absolute inset-0 m-0 p-3 font-mono text-xs leading-5 whitespace-pre overflow-auto pointer-events-none text-[#e4e4e7]"
          >
            <code dangerouslySetInnerHTML={{ __html: highlighted + '\n' }} />
          </pre>
        )}
        {/* Textarea on top: transparent text so only caret/selection show */}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={handleScroll}
          className={`absolute inset-0 resize-none bg-transparent font-mono text-xs leading-5 p-3 focus:outline-none border-none caret-[#e4e4e7] ${
            useHighlight ? '' : 'text-[#e4e4e7]'
          }`}
          spellCheck={false}
          wrap="off"
          style={
            useHighlight
              ? { color: 'transparent', WebkitTextFillColor: 'transparent' }
              : undefined
          }
        />
      </div>
    </div>
  );
}
