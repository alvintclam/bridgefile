import React, { useState } from 'react';

interface BookmarkItem {
  id: string;
  connectionId: string;
  path: string;
  name: string;
  createdAt: number;
}

interface BookmarkBarProps {
  currentPath: string | null;
  onNavigate: (path: string) => void;
}

const MOCK_BOOKMARKS: BookmarkItem[] = [
  { id: '1', connectionId: 'conn-1', path: '/var/www', name: 'www', createdAt: Date.now() - 86400000 },
  { id: '2', connectionId: 'conn-1', path: '/home/deploy', name: 'deploy home', createdAt: Date.now() - 50000000 },
  { id: '3', connectionId: 'conn-1', path: '/etc/nginx', name: 'nginx conf', createdAt: Date.now() - 30000000 },
];

export default function BookmarkBar({ currentPath, onNavigate }: BookmarkBarProps) {
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(MOCK_BOOKMARKS);

  const handleAddBookmark = () => {
    if (!currentPath) return;
    // Don't add duplicates
    if (bookmarks.some(b => b.path === currentPath)) return;

    const name = currentPath.split('/').filter(Boolean).pop() || '/';
    const newBookmark: BookmarkItem = {
      id: Date.now().toString(),
      connectionId: 'current',
      path: currentPath,
      name,
      createdAt: Date.now(),
    };
    setBookmarks(prev => [...prev, newBookmark]);
  };

  const handleRemove = (id: string) => {
    setBookmarks(prev => prev.filter(b => b.id !== id));
  };

  const isCurrentBookmarked = currentPath
    ? bookmarks.some(b => b.path === currentPath)
    : false;

  return (
    <div className="flex items-center gap-1.5 h-8 px-3 bg-[#0e0e16] border-b border-[#1e1e2e] shrink-0 overflow-x-auto">
      {/* Star button to bookmark current path */}
      <button
        onClick={handleAddBookmark}
        disabled={!currentPath || isCurrentBookmarked}
        className={`p-1 rounded shrink-0 transition-colors ${
          isCurrentBookmarked
            ? 'text-amber-400 cursor-default'
            : currentPath
            ? 'text-[#71717a] hover:text-amber-400 hover:bg-[#1a1a26]'
            : 'text-[#3a3a4a] cursor-not-allowed'
        }`}
        title={isCurrentBookmarked ? 'Already bookmarked' : 'Bookmark current path'}
      >
        {isCurrentBookmarked ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        )}
      </button>

      {/* Divider */}
      {bookmarks.length > 0 && (
        <div className="w-px h-4 bg-[#1e1e2e] shrink-0" />
      )}

      {/* Bookmark chips */}
      {bookmarks.map(bookmark => (
        <div
          key={bookmark.id}
          onClick={() => onNavigate(bookmark.path)}
          className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#1a1a26] text-[11px] text-[#a1a1aa] hover:text-[#e4e4e7] hover:bg-[#222233] cursor-pointer transition-colors shrink-0 group"
          title={bookmark.path}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#71717a] shrink-0">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
          <span className="truncate max-w-[120px]">{bookmark.name}</span>
          <button
            onClick={e => {
              e.stopPropagation();
              handleRemove(bookmark.id);
            }}
            className="ml-0.5 text-[#71717a] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}

      {bookmarks.length === 0 && (
        <span className="text-[10px] text-[#3a3a4a] select-none">
          No bookmarks — click the star to save a path
        </span>
      )}
    </div>
  );
}
