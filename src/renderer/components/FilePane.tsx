import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { FileEntry, formatFileSize, formatDate, useFileOperations, joinPath, isWindowsPath } from '../hooks/useFileOperations';
import type { FileOperationsParams } from '../hooks/useFileOperations';
import { t } from '../lib/i18n';
import { isTextFile } from './FileEditor';

export interface ExternalDropItem {
  path: string;
  name: string;
  isDirectory?: boolean;
}

function isExternalDropItem(
  item: ExternalDropItem | null,
): item is ExternalDropItem {
  return item !== null;
}

export interface ClipboardEntry {
  side: 'local' | 'remote';
  path: string;
  files: { name: string; isDirectory: boolean }[];
  cut: boolean;
}

interface FilePaneProps {
  side: 'local' | 'remote';
  label: string;
  protocol?: 'sftp' | 's3' | 'ftp';
  connectionId?: string;
  /** Called when the user navigates to a new path (for synchronized browsing) */
  onNavigate?: (path: string) => void;
  /** When set, the pane should attempt to navigate to this path. */
  syncPath?: string;
  refreshToken?: number;
  onTransfer?: (
    direction: 'upload' | 'download',
    files: { name: string; isDirectory: boolean }[],
    sourcePath: string,
  ) => Promise<void>;
  onDesktopDrop?: (items: ExternalDropItem[], targetPath: string) => Promise<void>;
  /** Clipboard integration (cross-pane copy/paste) */
  clipboard?: ClipboardEntry | null;
  onSetClipboard?: (entry: ClipboardEntry | null) => void;
  /** Dialog callbacks */
  onCompare?: () => void;
  onSearch?: () => void;
  onEditFile?: (file: { path: string; name: string; size: number }) => void;
  onChecksum?: (file: { path: string; name: string }) => void;
  onPermissions?: (file: { path: string; name: string; permissions: string }) => void;
}

type SortField = 'name' | 'size' | 'modified';
type SortDirection = 'asc' | 'desc';

// ── Overwrite Dialog types ─────────────────────────────────────

type OverwriteAction = 'overwrite' | 'skip' | 'rename';

interface OverwriteDialogState {
  visible: boolean;
  fileName: string;
  action: OverwriteAction;
  applyToAll: boolean;
  resolve: ((result: { action: OverwriteAction; applyToAll: boolean }) => void) | null;
}

// ── Multi-file progress types ──────────────────────────────────

interface MultiFileProgress {
  visible: boolean;
  direction: 'upload' | 'download';
  current: number;
  total: number;
  currentFile: string;
}

// ── Drag & Drop data key ───────────────────────────────────────

const DRAG_DATA_KEY = 'application/x-bridgefile-transfer';
type FileWithPath = File & { path?: string };
type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => { isDirectory: boolean } | null;
};

export default function FilePane({
  side,
  label: _label,
  protocol,
  connectionId,
  onNavigate,
  syncPath,
  refreshToken = 0,
  onTransfer,
  onDesktopDrop,
  clipboard,
  onSetClipboard,
  onCompare,
  onSearch,
  onEditFile,
  onChecksum,
  onPermissions,
}: FilePaneProps) {
  const params: FileOperationsParams = { side, protocol, connectionId };
  const ops = useFileOperations(params);
  const {
    files,
    currentPath,
    loading,
    navigate: rawNavigate,
    mkdir,
    rename,
    deleteFiles,
    refresh,
  } = ops;

  // Wrap navigate to also call onNavigate for synchronized browsing
  const navigate = useCallback(
    (path: string) => {
      rawNavigate(path);
      onNavigate?.(path);
    },
    [rawNavigate, onNavigate],
  );

  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [pathInput, setPathInput] = useState(currentPath);
  const [editingPath, setEditingPath] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file?: FileEntry } | null>(null);
  const [newFolderName, setNewFolderName] = useState<string | null>(null);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  // Overwrite dialog state
  const [overwriteDialog, setOverwriteDialog] = useState<OverwriteDialogState>({
    visible: false,
    fileName: '',
    action: 'overwrite',
    applyToAll: false,
    resolve: null,
  });

  // Multi-file progress state
  const [multiProgress, setMultiProgress] = useState<MultiFileProgress>({
    visible: false,
    direction: 'upload',
    current: 0,
    total: 0,
    currentFile: '',
  });

  const listRef = useRef<HTMLDivElement>(null);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const newFolderRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPathInput(currentPath);
  }, [currentPath]);

  useEffect(() => {
    if (syncPath && syncPath !== currentPath) {
      rawNavigate(syncPath);
      setSelected(new Set());
    }
  }, [syncPath, currentPath, rawNavigate]);

  useEffect(() => {
    if (refreshToken > 0) {
      refresh();
    }
  }, [refreshToken, refresh]);

  useEffect(() => {
    if (editingPath && pathInputRef.current) {
      pathInputRef.current.focus();
      pathInputRef.current.select();
    }
  }, [editingPath]);

  useEffect(() => {
    if (newFolderName !== null && newFolderRef.current) {
      newFolderRef.current.focus();
    }
  }, [newFolderName]);

  useEffect(() => {
    if (renamingFile && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renamingFile]);

  // Close context menu on click outside
  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  const sortedFiles = useMemo(() => {
    let filtered = files;
    if (filter) {
      const lf = filter.toLowerCase();
      filtered = files.filter(f => f.name.toLowerCase().includes(lf));
    }

    const sorted = [...filtered].sort((a, b) => {
      // Directories first always
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;

      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'size':
          cmp = a.size - b.size;
          break;
        case 'modified':
          cmp = a.modified.getTime() - b.modified.getTime();
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return sorted;
  }, [files, filter, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const handleSelect = useCallback(
    (file: FileEntry, e: React.MouseEvent) => {
      const name = file.name;

      if (e.ctrlKey || e.metaKey) {
        setSelected(prev => {
          const next = new Set(prev);
          if (next.has(name)) next.delete(name);
          else next.add(name);
          return next;
        });
        setLastSelected(name);
      } else if (e.shiftKey && lastSelected) {
        const names = sortedFiles.map(f => f.name);
        const start = names.indexOf(lastSelected);
        const end = names.indexOf(name);
        if (start !== -1 && end !== -1) {
          const range = names.slice(
            Math.min(start, end),
            Math.max(start, end) + 1
          );
          setSelected(new Set(range));
        }
      } else {
        setSelected(new Set([name]));
        setLastSelected(name);
      }
    },
    [lastSelected, sortedFiles]
  );

  const handleDoubleClick = (file: FileEntry) => {
    if (file.isDirectory) {
      const newPath = joinPath(currentPath, file.name, side);
      navigate(newPath);
      setSelected(new Set());
    } else if (isTextFile(file.name) && onEditFile) {
      const filePath = joinPath(currentPath, file.name, side);
      onEditFile({ path: filePath, name: file.name, size: file.size });
    }
  };

  const handleGoUp = () => {
    if (side === 'local' && isWindowsPath(currentPath)) {
      // Windows: C:\Users\foo -> C:\Users, C:\ stays as C:\
      const parts = currentPath.split(/[\\/]/).filter(Boolean);
      if (parts.length <= 1) return; // At drive root
      parts.pop();
      navigate(parts[0] + '\\' + parts.slice(1).join('\\'));
      setSelected(new Set());
      return;
    }
    if (currentPath === '/') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    navigate(parts.length === 0 ? '/' : '/' + parts.join('/'));
    setSelected(new Set());
  };

  const handlePathSubmit = () => {
    setEditingPath(false);
    if (pathInput && pathInput !== currentPath) {
      navigate(pathInput);
      setSelected(new Set());
    }
  };

  const handleContextMenu = (e: React.MouseEvent, file?: FileEntry) => {
    e.preventDefault();
    if (file && !selected.has(file.name)) {
      setSelected(new Set([file.name]));
    }
    setContextMenu({ x: e.clientX, y: e.clientY, file });
  };

  const handleCreateFolder = () => {
    if (newFolderName && newFolderName.trim()) {
      mkdir(newFolderName.trim());
    }
    setNewFolderName(null);
  };

  const handleRename = () => {
    if (renamingFile && renameValue && renameValue.trim()) {
      rename(renamingFile, renameValue.trim());
    }
    setRenamingFile(null);
    setRenameValue('');
  };

  // ── Overwrite dialog helper ──────────────────────────────────

  const showOverwriteDialog = useCallback((fileName: string): Promise<{ action: OverwriteAction; applyToAll: boolean }> => {
    return new Promise((resolve) => {
      setOverwriteDialog({
        visible: true,
        fileName,
        action: 'overwrite',
        applyToAll: false,
        resolve,
      });
    });
  }, []);

  const handleOverwriteResponse = useCallback((action: OverwriteAction, applyToAll: boolean) => {
    setOverwriteDialog((prev) => {
      prev.resolve?.({ action, applyToAll });
      return {
        visible: false,
        fileName: '',
        action: 'overwrite',
        applyToAll: false,
        resolve: null,
      };
    });
  }, []);

  const getActionFiles = useCallback((preferredFile?: FileEntry): FileEntry[] => {
    if (preferredFile && selected.has(preferredFile.name)) {
      return sortedFiles.filter(file => selected.has(file.name));
    }
    if (preferredFile) {
      return [preferredFile];
    }
    return sortedFiles.filter(file => selected.has(file.name));
  }, [selected, sortedFiles]);

  const requestTransfer = useCallback(async (fileEntries: FileEntry[]) => {
    if (!onTransfer || fileEntries.length === 0) return;

    await onTransfer(
      side === 'local' ? 'upload' : 'download',
      fileEntries.map(file => ({
        name: file.name,
        isDirectory: file.isDirectory,
      })),
      currentPath,
    );
  }, [onTransfer, side, currentPath]);

  // ── Drag from desktop / Finder ───────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Check if this is an external file drop or a pane-to-pane transfer
    const hasExternalFiles = e.dataTransfer.types.includes('Files');
    const hasPaneTransfer = e.dataTransfer.types.includes(DRAG_DATA_KEY);
    if ((hasExternalFiles && onDesktopDrop) || (hasPaneTransfer && onTransfer)) {
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  }, [onDesktopDrop, onTransfer]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only reset if we're actually leaving the container
    const rect = listRef.current?.getBoundingClientRect();
    if (rect) {
      const { clientX, clientY } = e;
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        setIsDragOver(false);
      }
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    // Handle pane-to-pane transfer
    const transferData = e.dataTransfer.getData(DRAG_DATA_KEY);
    if (transferData) {
      try {
        const data = JSON.parse(transferData) as {
          sourceSide: 'local' | 'remote';
          sourcePath: string;
          files: { name: string; isDirectory: boolean }[];
        };

        if (data.sourceSide !== side) {
          const direction = data.sourceSide === 'local' ? 'upload' : 'download';
          await onTransfer?.(direction, data.files, data.sourcePath);
        }
      } catch {
        // Invalid transfer data
      }
      return;
    }

    // Handle external file drops (from desktop/Finder)
    const droppedFiles = Array.from(e.dataTransfer.files) as FileWithPath[];
    if (droppedFiles.length > 0) {
      const droppedItems = droppedFiles
        .map((file, index) => {
          const dataTransferItem = e.dataTransfer.items[index] as DataTransferItemWithEntry | undefined;
          const entry = dataTransferItem?.webkitGetAsEntry?.() ?? null;
          if (!file.path) {
            return null;
          }
          return {
            path: file.path,
            name: file.name || file.path.split(/[\\/]/).pop() || file.path,
            isDirectory: entry?.isDirectory,
          } as ExternalDropItem;
        })
        .filter(isExternalDropItem);

      if (droppedItems.length > 0 && onDesktopDrop) {
        const fileNames = droppedItems.map((item) => item.name);
        setMultiProgress({
          visible: true,
          direction: 'upload',
          current: 0,
          total: fileNames.length,
          currentFile: fileNames[0] ?? '',
        });
        try {
          await onDesktopDrop(droppedItems, currentPath);
        } finally {
          setMultiProgress(prev => ({ ...prev, visible: false }));
        }
      }
    }
  }, [side, currentPath, onTransfer, onDesktopDrop]);

  // ── Drag between panes (row draggable) ───────────────────────

  const handleRowDragStart = useCallback((e: React.DragEvent, file: FileEntry) => {
    // If file is not in selected set, select only this file
    const selectedFiles = selected.has(file.name)
      ? sortedFiles.filter(f => selected.has(f.name))
      : [file];

    const transferPayload = {
      sourceSide: side,
      sourcePath: currentPath,
      files: selectedFiles.map(f => ({
        name: f.name,
        isDirectory: f.isDirectory,
      })),
    };

    e.dataTransfer.setData(DRAG_DATA_KEY, JSON.stringify(transferPayload));
    e.dataTransfer.effectAllowed = 'copy';

    // Set a drag image label
    const dragLabel = document.createElement('div');
    dragLabel.textContent = selectedFiles.length > 1
      ? `${selectedFiles.length} items`
      : file.name;
    dragLabel.style.cssText = 'position:absolute;top:-9999px;padding:4px 8px;background:#3b82f6;color:#fff;border-radius:4px;font-size:12px;white-space:nowrap;';
    document.body.appendChild(dragLabel);
    e.dataTransfer.setDragImage(dragLabel, 0, 0);
    requestAnimationFrame(() => document.body.removeChild(dragLabel));
  }, [side, currentPath, selected, sortedFiles]);

  // ── Keyboard shortcuts ───────────────────────────────────────

  useEffect(() => {
    const container = listRef.current?.closest('.file-pane-root') as HTMLElement | null;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if an input/textarea is focused (except our own)
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const isMod = e.ctrlKey || e.metaKey;

      // F2: rename selected file
      if (e.key === 'F2' && selected.size === 1) {
        e.preventDefault();
        const fileName = Array.from(selected)[0];
        setRenamingFile(fileName);
        setRenameValue(fileName);
        return;
      }

      // Delete or Backspace: delete selected files
      if ((e.key === 'Delete' || (e.key === 'Backspace' && selected.size > 0)) && !isMod) {
        e.preventDefault();
        const toDelete = sortedFiles.filter(f => selected.has(f.name));
        if (toDelete.length > 0) {
          deleteFiles(toDelete);
          setSelected(new Set());
        }
        return;
      }

      // Backspace with nothing selected: go to parent directory
      if (e.key === 'Backspace' && selected.size === 0 && !isMod) {
        e.preventDefault();
        handleGoUp();
        return;
      }

      // F5: refresh
      if (e.key === 'F5') {
        e.preventDefault();
        refresh();
        return;
      }

      // Ctrl/Cmd+A: select all
      if (isMod && e.key === 'a') {
        e.preventDefault();
        setSelected(new Set(sortedFiles.map(f => f.name)));
        return;
      }

      // Ctrl/Cmd+L: focus path input
      if (isMod && e.key === 'l') {
        e.preventDefault();
        setEditingPath(true);
        return;
      }

      // Ctrl/Cmd+C: copy selected files into cross-pane clipboard
      if (isMod && e.key === 'c' && selected.size > 0 && onSetClipboard) {
        e.preventDefault();
        const files = sortedFiles
          .filter((f) => selected.has(f.name))
          .map((f) => ({ name: f.name, isDirectory: f.isDirectory }));
        onSetClipboard({ side, path: currentPath, files, cut: false });
        return;
      }

      // Ctrl/Cmd+X: cut (copy + mark for move)
      if (isMod && e.key === 'x' && selected.size > 0 && onSetClipboard) {
        e.preventDefault();
        const files = sortedFiles
          .filter((f) => selected.has(f.name))
          .map((f) => ({ name: f.name, isDirectory: f.isDirectory }));
        onSetClipboard({ side, path: currentPath, files, cut: true });
        return;
      }

      // Ctrl/Cmd+V: paste — if clipboard is from opposite side, trigger transfer
      if (isMod && e.key === 'v' && clipboard && onTransfer && clipboard.side !== side) {
        e.preventDefault();
        const direction = side === 'remote' ? 'upload' : 'download';
        onTransfer(direction, clipboard.files, clipboard.path).catch(() => {});
        // Clear clipboard after cut-paste
        if (clipboard.cut && onSetClipboard) {
          onSetClipboard(null);
        }
        return;
      }

      // Enter: open selected folder / download selected file
      if (e.key === 'Enter' && selected.size > 0) {
        e.preventDefault();
        const selectedFile = sortedFiles.find(f => selected.has(f.name));
        if (selectedFile) {
          if (selectedFile.isDirectory) {
            handleDoubleClick(selectedFile);
          } else {
            requestTransfer([selectedFile]).catch(() => {});
          }
        }
        return;
      }

      // Arrow keys for navigation through file list
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (sortedFiles.length === 0) return;

        const names = sortedFiles.map(f => f.name);
        const currentSelected = Array.from(selected);
        let currentIndex = -1;

        if (currentSelected.length > 0) {
          currentIndex = names.indexOf(currentSelected[currentSelected.length - 1]);
        }

        let nextIndex: number;
        if (e.key === 'ArrowDown') {
          nextIndex = currentIndex < names.length - 1 ? currentIndex + 1 : currentIndex;
        } else {
          nextIndex = currentIndex > 0 ? currentIndex - 1 : 0;
        }

        if (e.shiftKey) {
          setSelected(prev => {
            const next = new Set(prev);
            next.add(names[nextIndex]);
            return next;
          });
        } else {
          setSelected(new Set([names[nextIndex]]));
        }
        setLastSelected(names[nextIndex]);
        return;
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [selected, sortedFiles, deleteFiles, refresh, handleGoUp, requestTransfer, clipboard, onSetClipboard, onTransfer, side, currentPath]);

  const breadcrumbs = currentPath === '/'
    ? ['/']
    : ['/', ...currentPath.split('/').filter(Boolean)];

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return (
      <span className="ml-1 text-[#3b82f6]">
        {sortDir === 'asc' ? '\u2191' : '\u2193'}
      </span>
    );
  };

  return (
    <div
      className="file-pane-root flex flex-col h-full bg-[#0a0a0f] min-w-0"
      tabIndex={0}
    >
      {/* Header: label + filter */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[#1e1e2e] bg-[#12121a]">
        <span className="text-[11px] uppercase tracking-wider text-[#71717a] font-medium shrink-0">
          {t(side === 'local' ? 'local' : 'remote')}
        </span>
        <div className="flex-1 relative">
          <input
            ref={filterInputRef}
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder={t('search') + '...'}
            className="w-full pl-6 pr-2 py-1 text-xs bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] placeholder-[#71717a] focus:border-[#3b82f6] focus:outline-none transition-colors"
          />
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            className="absolute left-2 top-1/2 -translate-y-1/2 text-[#71717a]"
          >
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
            <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <button
          onClick={refresh}
          className="p-1 rounded text-[#71717a] hover:text-[#a1a1aa] hover:bg-[#1a1a26] transition-colors shrink-0"
          title="Refresh"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path
              d="M1 4v6h6M23 20v-6h-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* Breadcrumb / path bar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[#1e1e2e] bg-[#12121a] min-h-[30px]">
        <button
          onClick={handleGoUp}
          className="p-0.5 rounded text-[#71717a] hover:text-[#a1a1aa] hover:bg-[#1a1a26] transition-colors shrink-0"
          title="Go up"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {editingPath ? (
          <form
            onSubmit={e => {
              e.preventDefault();
              handlePathSubmit();
            }}
            className="flex-1 flex gap-1"
          >
            <input
              ref={pathInputRef}
              type="text"
              value={pathInput}
              onChange={e => setPathInput(e.target.value)}
              onBlur={handlePathSubmit}
              className="flex-1 px-2 py-0.5 text-xs font-mono bg-[#0a0a0f] border border-[#3b82f6] rounded text-[#e4e4e7] focus:outline-none"
            />
          </form>
        ) : (
          <div
            className="flex-1 flex items-center gap-0.5 text-xs overflow-x-auto cursor-pointer"
            onClick={() => setEditingPath(true)}
            title="Click to edit path"
          >
            {breadcrumbs.map((crumb, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="text-[#71717a] mx-0.5">/</span>}
                <button
                  onClick={e => {
                    e.stopPropagation();
                    const path =
                      i === 0
                        ? '/'
                        : '/' + breadcrumbs.slice(1, i + 1).join('/');
                    navigate(path);
                    setSelected(new Set());
                  }}
                  className="text-[#a1a1aa] hover:text-[#e4e4e7] hover:underline transition-colors whitespace-nowrap"
                >
                  {crumb === '/' ? (side === 'local' ? '~' : '/') : crumb}
                </button>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      {/* Column headers */}
      <div className="flex items-center px-2 py-1 text-[11px] text-[#71717a] border-b border-[#1e1e2e] bg-[#12121a] uppercase tracking-wide select-none">
        <button
          className="flex items-center flex-1 min-w-0 hover:text-[#a1a1aa] transition-colors text-left"
          onClick={() => handleSort('name')}
        >
          {t('name')} <SortIcon field="name" />
        </button>
        <button
          className="flex items-center w-20 shrink-0 hover:text-[#a1a1aa] transition-colors text-right justify-end"
          onClick={() => handleSort('size')}
        >
          {t('size')} <SortIcon field="size" />
        </button>
        <button
          className="flex items-center w-28 shrink-0 hover:text-[#a1a1aa] transition-colors text-right justify-end"
          onClick={() => handleSort('modified')}
        >
          {t('modified')} <SortIcon field="modified" />
        </button>
        <div className="w-20 shrink-0 text-right">{t('permissions')}</div>
      </div>

      {/* File list */}
      <div
        ref={listRef}
        className={`flex-1 overflow-y-auto overflow-x-hidden relative ${
          isDragOver ? 'bg-[#3b82f6]/5' : ''
        }`}
        onContextMenu={e => handleContextMenu(e)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drop overlay */}
        {isDragOver && (
          <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center gap-2 px-6 py-4 rounded-lg border-2 border-dashed border-[#3b82f6] bg-[#3b82f6]/10">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-[#3b82f6]">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points="17,8 12,3 7,8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span className="text-xs text-[#3b82f6] font-medium">Drop items here to transfer</span>
            </div>
          </div>
        )}

        {/* Multi-file progress banner */}
        {multiProgress.visible && (
          <div className="sticky top-0 z-30 flex items-center gap-2 px-3 py-2 bg-[#3b82f6]/10 border-b border-[#3b82f6]/20 text-xs text-[#3b82f6]">
            <svg className="animate-spin h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="opacity-75" />
            </svg>
            <span>
              {multiProgress.direction === 'upload' ? 'Uploading' : 'Downloading'}{' '}
              {multiProgress.current + 1} of {multiProgress.total} files...
            </span>
            <span className="text-[#71717a] truncate ml-1">{multiProgress.currentFile}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex items-center gap-2 text-[#71717a] text-xs">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="opacity-75" />
              </svg>
              Loading...
            </div>
          </div>
        ) : sortedFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[#71717a] gap-2">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="opacity-40">
              <path
                d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2v11z"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
            <span className="text-xs">
              {t('no_files')}
            </span>
            <span className="text-[10px] text-[#4a4a5a]">
              {t('drop_files')}
            </span>
          </div>
        ) : (
          <>
            {/* Go up row */}
            {currentPath !== '/' && (
              <div
                className="flex items-center px-2 py-1 text-xs hover:bg-[#1a1a26] cursor-pointer text-[#71717a]"
                onDoubleClick={handleGoUp}
              >
                <div className="flex items-center flex-1 gap-2 min-w-0">
                  <span className="text-sm">..</span>
                </div>
              </div>
            )}

            {sortedFiles.map(file => (
              <div
                key={file.name}
                draggable
                onDragStart={e => handleRowDragStart(e, file)}
                className={`flex items-center px-2 py-[3px] text-xs cursor-pointer transition-colors ${
                  selected.has(file.name)
                    ? 'bg-[#3b82f6]/15 text-[#e4e4e7]'
                    : 'text-[#a1a1aa] hover:bg-[#1a1a26]'
                }`}
                onClick={e => handleSelect(file, e)}
                onDoubleClick={() => handleDoubleClick(file)}
                onContextMenu={e => {
                  e.stopPropagation();
                  handleContextMenu(e, file);
                }}
              >
                {/* Icon + name */}
                <div className="flex items-center flex-1 gap-2 min-w-0">
                  {file.isDirectory ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-[#3b82f6] shrink-0">
                      <path
                        d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2v11z"
                        fill="currentColor"
                        fillOpacity="0.15"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-[#71717a] shrink-0">
                      <path
                        d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                  )}

                  {renamingFile === file.name ? (
                    <input
                      ref={renameRef}
                      type="text"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={handleRename}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRename();
                        if (e.key === 'Escape') {
                          setRenamingFile(null);
                          setRenameValue('');
                        }
                      }}
                      className="flex-1 px-1 py-0 text-xs bg-[#0a0a0f] border border-[#3b82f6] rounded text-[#e4e4e7] focus:outline-none min-w-0"
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <span className="truncate">{file.name}</span>
                  )}
                </div>

                {/* Size */}
                <div className="w-20 shrink-0 text-right text-[#71717a] tabular-nums">
                  {file.isDirectory ? '--' : formatFileSize(file.size)}
                </div>

                {/* Modified */}
                <div className="w-28 shrink-0 text-right text-[#71717a]">
                  {formatDate(file.modified)}
                </div>

                {/* Permissions */}
                <div className="w-20 shrink-0 text-right font-mono text-[10px] text-[#4a4a5a]">
                  {file.permissions}
                </div>
              </div>
            ))}

            {/* New folder row */}
            {newFolderName !== null && (
              <div className="flex items-center px-2 py-[3px] text-xs bg-[#3b82f6]/10">
                <div className="flex items-center flex-1 gap-2 min-w-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-[#3b82f6] shrink-0">
                    <path
                      d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2v11z"
                      fill="currentColor"
                      fillOpacity="0.15"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                  </svg>
                  <input
                    ref={newFolderRef}
                    type="text"
                    value={newFolderName}
                    onChange={e => setNewFolderName(e.target.value)}
                    onBlur={handleCreateFolder}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleCreateFolder();
                      if (e.key === 'Escape') setNewFolderName(null);
                    }}
                    placeholder="Folder name"
                    className="flex-1 px-1 py-0 text-xs bg-[#0a0a0f] border border-[#3b82f6] rounded text-[#e4e4e7] placeholder-[#71717a] focus:outline-none min-w-0"
                  />
                </div>
              </div>
            )}
          </>
        )}

        {/* Context menu */}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            file={contextMenu.file}
            currentPath={currentPath}
            onClose={() => setContextMenu(null)}
            onOpen={(file) => handleDoubleClick(file)}
            onDownload={() => {
              const toTransfer = getActionFiles(contextMenu.file);
              requestTransfer(toTransfer).catch(() => {});
              setContextMenu(null);
            }}
            onRename={(file) => {
              setRenamingFile(file.name);
              setRenameValue(file.name);
              setContextMenu(null);
            }}
            onDelete={() => {
              const toDelete = sortedFiles.filter(f => selected.has(f.name));
              if (toDelete.length > 0) deleteFiles(toDelete);
              setSelected(new Set());
              setContextMenu(null);
            }}
            onNewFolder={() => {
              setNewFolderName('');
              setContextMenu(null);
            }}
            onRefresh={() => {
              refresh();
              setContextMenu(null);
            }}
            onCopyPath={() => {
              if (contextMenu.file) {
                const fullPath = joinPath(currentPath, contextMenu.file.name, side);
                navigator.clipboard?.writeText(fullPath);
              }
              setContextMenu(null);
            }}
            side={side}
            onSearch={() => {
              onSearch?.();
              setContextMenu(null);
            }}
            onCompare={() => {
              onCompare?.();
              setContextMenu(null);
            }}
            onEditFile={contextMenu.file && !contextMenu.file.isDirectory && isTextFile(contextMenu.file.name)
              ? () => {
                  const file = contextMenu.file!;
                  const filePath = joinPath(currentPath, file.name, side);
                  onEditFile?.({ path: filePath, name: file.name, size: file.size });
                  setContextMenu(null);
                }
              : undefined
            }
            onChecksum={contextMenu.file && !contextMenu.file.isDirectory
              ? () => {
                  const file = contextMenu.file!;
                  const filePath = joinPath(currentPath, file.name, side);
                  onChecksum?.({ path: filePath, name: file.name });
                  setContextMenu(null);
                }
              : undefined
            }
            onPermissions={side === 'remote' && protocol === 'sftp' && contextMenu.file
              ? () => {
                  const file = contextMenu.file!;
                  const filePath = joinPath(currentPath, file.name, side);
                  onPermissions?.({ path: filePath, name: file.name, permissions: file.permissions });
                  setContextMenu(null);
                }
              : undefined
            }
          />
        )}
      </div>

      {/* Overwrite dialog */}
      {overwriteDialog.visible && (
        <OverwriteDialog
          fileName={overwriteDialog.fileName}
          onResponse={handleOverwriteResponse}
        />
      )}

      {/* Status bar */}
      <div className="flex items-center justify-between px-2 py-1 text-[11px] text-[#71717a] border-t border-[#1e1e2e] bg-[#12121a]">
        <span>
          {sortedFiles.length} item{sortedFiles.length !== 1 ? 's' : ''}
          {selected.size > 0 && ` \u00b7 ${selected.size} selected`}
        </span>
        <span className="font-mono text-[10px]">{currentPath}</span>
      </div>
    </div>
  );
}

// ── Overwrite Dialog Component ─────────────────────────────────

function OverwriteDialog({
  fileName,
  onResponse,
}: {
  fileName: string;
  onResponse: (action: OverwriteAction, applyToAll: boolean) => void;
}) {
  const [applyToAll, setApplyToAll] = useState(false);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[#12121a] border border-[#1e1e2e] rounded-lg shadow-xl p-4 max-w-sm w-full mx-4">
        <h3 className="text-sm font-medium text-[#e4e4e7] mb-2">File Already Exists</h3>
        <p className="text-xs text-[#a1a1aa] mb-4">
          The file <span className="text-[#e4e4e7] font-mono">{fileName}</span> already exists
          in the destination. What would you like to do?
        </p>

        <div className="flex flex-col gap-2 mb-4">
          <button
            onClick={() => onResponse('overwrite', applyToAll)}
            className="w-full px-3 py-2 text-xs text-left rounded bg-[#1a1a26] hover:bg-[#3b82f6]/15 text-[#e4e4e7] transition-colors"
          >
            Overwrite
            <span className="block text-[10px] text-[#71717a] mt-0.5">Replace the existing file</span>
          </button>
          <button
            onClick={() => onResponse('skip', applyToAll)}
            className="w-full px-3 py-2 text-xs text-left rounded bg-[#1a1a26] hover:bg-[#3b82f6]/15 text-[#e4e4e7] transition-colors"
          >
            Skip
            <span className="block text-[10px] text-[#71717a] mt-0.5">Keep the existing file</span>
          </button>
          <button
            onClick={() => onResponse('rename', applyToAll)}
            className="w-full px-3 py-2 text-xs text-left rounded bg-[#1a1a26] hover:bg-[#3b82f6]/15 text-[#e4e4e7] transition-colors"
          >
            Rename (auto)
            <span className="block text-[10px] text-[#71717a] mt-0.5">Save with a new name (e.g. file_1.txt)</span>
          </button>
        </div>

        <label className="flex items-center gap-2 text-xs text-[#a1a1aa] cursor-pointer">
          <input
            type="checkbox"
            checked={applyToAll}
            onChange={e => setApplyToAll(e.target.checked)}
            className="rounded border-[#1e1e2e] bg-[#0a0a0f] text-[#3b82f6] focus:ring-[#3b82f6] focus:ring-offset-0"
          />
          Apply to all remaining files
        </label>
      </div>
    </div>
  );
}

// ── Context Menu Component ─────────────────────────────────────

function ContextMenu({
  x,
  y,
  file,
  currentPath: _currentPath,
  onClose: _onClose,
  onOpen,
  onDownload,
  onRename,
  onDelete,
  onNewFolder,
  onRefresh,
  onCopyPath,
  side,
  onSearch,
  onCompare,
  onEditFile,
  onChecksum,
  onPermissions,
}: {
  x: number;
  y: number;
  file?: FileEntry;
  currentPath: string;
  onClose: () => void;
  onOpen: (file: FileEntry) => void;
  onDownload: () => void;
  onRename: (file: FileEntry) => void;
  onDelete: () => void;
  onNewFolder: () => void;
  onRefresh: () => void;
  onCopyPath: () => void;
  side: 'local' | 'remote';
  onSearch?: () => void;
  onCompare?: () => void;
  onEditFile?: () => void;
  onChecksum?: () => void;
  onPermissions?: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Adjust position to stay in viewport
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const newX = x + rect.width > window.innerWidth ? x - rect.width : x;
      const newY = y + rect.height > window.innerHeight ? y - rect.height : y;
      setPos({ x: Math.max(0, newX), y: Math.max(0, newY) });
    }
  }, [x, y]);

  const MenuItem = ({
    label,
    shortcut,
    onClick,
    danger,
    disabled,
  }: {
    label: string;
    shortcut?: string;
    onClick: () => void;
    danger?: boolean;
    disabled?: boolean;
  }) => (
    <button
      onClick={e => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      disabled={disabled}
      className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between ${
        disabled
          ? 'text-[#4a4a5a] cursor-default'
          : danger
            ? 'text-red-400 hover:bg-red-500/10'
            : 'text-[#a1a1aa] hover:bg-[#1a1a26] hover:text-[#e4e4e7]'
      }`}
    >
      <span>{label}</span>
      {shortcut && (
        <span className="text-[10px] text-[#4a4a5a] ml-4">{shortcut}</span>
      )}
    </button>
  );

  const Divider = () => <div className="my-1 border-t border-[#1e1e2e]" />;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[200px] py-1 bg-[#12121a] border border-[#1e1e2e] rounded-lg shadow-xl"
      style={{ left: pos.x, top: pos.y }}
      onClick={e => e.stopPropagation()}
    >
      {file && (
        <>
          {file.isDirectory ? (
            <MenuItem label={t('folder')} shortcut="Enter" onClick={() => onOpen(file)} />
          ) : null}
          <MenuItem
            label={side === 'local' ? t('upload') : t('download')}
            onClick={onDownload}
          />
          <MenuItem label={t('rename')} shortcut="F2" onClick={() => onRename(file)} />
          <MenuItem label={t('copy')} onClick={onCopyPath} />
          <Divider />
        </>
      )}
      <MenuItem label={t('new_folder')} onClick={onNewFolder} />
      <MenuItem label={t('refresh')} shortcut="F5" onClick={onRefresh} />
      {onSearch && (
        <MenuItem label={t('search_files')} onClick={onSearch} />
      )}
      {onCompare && (
        <MenuItem label={t('compare_dirs')} onClick={onCompare} />
      )}
      <MenuItem label={t('select_all')} shortcut={navigator.platform?.includes('Mac') ? '\u2318A' : 'Ctrl+A'} onClick={() => {
        // Handled by keyboard shortcuts
      }} disabled />
      {onEditFile && (
        <MenuItem label={t('edit_file')} onClick={onEditFile} />
      )}
      {onChecksum && (
        <MenuItem label={t('checksum')} onClick={onChecksum} />
      )}
      {onPermissions && (
        <MenuItem label={t('chmod')} onClick={onPermissions} />
      )}
      {file && (
        <>
          <Divider />
          <MenuItem label={t('delete')} shortcut="Del" onClick={onDelete} danger />
        </>
      )}
    </div>
  );
}
