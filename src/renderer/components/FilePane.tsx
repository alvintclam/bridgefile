import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { FileEntry, formatFileSize, formatDate, useFileOperations } from '../hooks/useFileOperations';
import type { FileOperationsParams } from '../hooks/useFileOperations';

interface FilePaneProps {
  side: 'local' | 'remote';
  label: string;
  protocol?: 'sftp' | 's3' | 'ftp';
  connectionId?: string;
}

type SortField = 'name' | 'size' | 'modified';
type SortDirection = 'asc' | 'desc';

export default function FilePane({ side, label, protocol, connectionId }: FilePaneProps) {
  const params: FileOperationsParams = { side, protocol, connectionId };
  const ops = useFileOperations(params);
  const {
    files,
    currentPath,
    loading,
    navigate,
    mkdir,
    rename,
    deleteFiles,
    refresh,
  } = ops;

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

  const listRef = useRef<HTMLDivElement>(null);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const newFolderRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPathInput(currentPath);
  }, [currentPath]);

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
      const newPath =
        currentPath === '/'
          ? `/${file.name}`
          : `${currentPath}/${file.name}`;
      navigate(newPath);
      setSelected(new Set());
    }
  };

  const handleGoUp = () => {
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
    <div className="flex flex-col h-full bg-[#0a0a0f] min-w-0">
      {/* Header: label + filter */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[#1e1e2e] bg-[#12121a]">
        <span className="text-[11px] uppercase tracking-wider text-[#71717a] font-medium shrink-0">
          {label}
        </span>
        <div className="flex-1 relative">
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter..."
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
          Name <SortIcon field="name" />
        </button>
        <button
          className="flex items-center w-20 shrink-0 hover:text-[#a1a1aa] transition-colors text-right justify-end"
          onClick={() => handleSort('size')}
        >
          Size <SortIcon field="size" />
        </button>
        <button
          className="flex items-center w-28 shrink-0 hover:text-[#a1a1aa] transition-colors text-right justify-end"
          onClick={() => handleSort('modified')}
        >
          Modified <SortIcon field="modified" />
        </button>
        <div className="w-20 shrink-0 text-right">Perms</div>
      </div>

      {/* File list */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto overflow-x-hidden relative"
        onContextMenu={e => handleContextMenu(e)}
      >
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
              {filter ? 'No matching files' : 'No files'}
            </span>
            <span className="text-[10px] text-[#4a4a5a]">
              Drop files here to transfer
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
              // mock
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
                const fullPath =
                  currentPath === '/'
                    ? `/${contextMenu.file.name}`
                    : `${currentPath}/${contextMenu.file.name}`;
                navigator.clipboard?.writeText(fullPath);
              }
              setContextMenu(null);
            }}
            side={side}
          />
        )}
      </div>

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
    onClick,
    danger,
    disabled,
  }: {
    label: string;
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
      className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
        disabled
          ? 'text-[#4a4a5a] cursor-default'
          : danger
            ? 'text-red-400 hover:bg-red-500/10'
            : 'text-[#a1a1aa] hover:bg-[#1a1a26] hover:text-[#e4e4e7]'
      }`}
    >
      {label}
    </button>
  );

  const Divider = () => <div className="my-1 border-t border-[#1e1e2e]" />;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] py-1 bg-[#12121a] border border-[#1e1e2e] rounded-lg shadow-xl"
      style={{ left: pos.x, top: pos.y }}
      onClick={e => e.stopPropagation()}
    >
      {file && (
        <>
          {file.isDirectory ? (
            <MenuItem label="Open" onClick={() => onOpen(file)} />
          ) : null}
          <MenuItem
            label={side === 'local' ? 'Upload' : 'Download'}
            onClick={onDownload}
          />
          <MenuItem label="Rename" onClick={() => onRename(file)} />
          <MenuItem label="Copy Path" onClick={onCopyPath} />
          <Divider />
        </>
      )}
      <MenuItem label="New Folder" onClick={onNewFolder} />
      <MenuItem label="Refresh" onClick={onRefresh} />
      {file && (
        <>
          <Divider />
          <MenuItem label="Delete" onClick={onDelete} danger />
        </>
      )}
    </div>
  );
}
