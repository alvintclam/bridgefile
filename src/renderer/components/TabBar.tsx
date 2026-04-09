import React, { useState, useRef, useCallback } from 'react';

export interface SessionTab {
  id: string;
  name: string;
  protocol: 'SFTP' | 'FTP' | 'S3';
  connectionId: string;
  remotePath: string;
}

interface TabBarProps {
  tabs: SessionTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onReorder: (tabs: SessionTab[]) => void;
}

const PROTOCOL_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  SFTP: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'SF' },
  FTP: { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'FT' },
  S3: { bg: 'bg-orange-500/15', text: 'text-orange-400', label: 'S3' },
};

export default function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onReorder,
}: TabBarProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragNodeRef = useRef<HTMLDivElement | null>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      setDragIndex(index);
      dragNodeRef.current = e.currentTarget;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
      // Make the drag image semi-transparent
      if (e.currentTarget) {
        e.currentTarget.style.opacity = '0.5';
      }
    },
    [],
  );

  const handleDragEnd = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.currentTarget.style.opacity = '1';
      if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
        const reordered = [...tabs];
        const [moved] = reordered.splice(dragIndex, 1);
        reordered.splice(dragOverIndex, 0, moved);
        onReorder(reordered);
      }
      setDragIndex(null);
      setDragOverIndex(null);
      dragNodeRef.current = null;
    },
    [dragIndex, dragOverIndex, tabs, onReorder],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverIndex(index);
    },
    [],
  );

  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center h-8 bg-[#0e0e16] border-b border-[#1e1e2e] shrink-0 overflow-x-auto">
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        const style = PROTOCOL_STYLES[tab.protocol] || PROTOCOL_STYLES.SFTP;
        const isDragTarget = dragOverIndex === index && dragIndex !== index;

        return (
          <div
            key={tab.id}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, index)}
            onClick={() => onSelectTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1 h-full text-[11px] cursor-pointer transition-colors border-r border-[#1e1e2e] select-none shrink-0 ${
              isActive
                ? 'bg-[#1a1a26] text-[#e4e4e7] border-b-2 border-b-[#3b82f6]'
                : 'text-[#71717a] hover:text-[#a1a1aa] hover:bg-[#12121a]'
            } ${isDragTarget ? 'border-l-2 border-l-[#3b82f6]' : ''}`}
          >
            {/* Protocol icon */}
            <span
              className={`w-4 h-4 rounded flex items-center justify-center text-[8px] font-bold shrink-0 ${style.bg} ${style.text}`}
            >
              {style.label}
            </span>

            {/* Connection name */}
            <span className="truncate max-w-[120px]">{tab.name}</span>

            {/* Close button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              className="ml-1 p-0.5 rounded text-[#71717a] hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
              title="Close tab"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                <path
                  d="M18 6L6 18M6 6l12 12"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        );
      })}

      {/* New tab button */}
      <button
        onClick={onNewTab}
        className="flex items-center justify-center w-7 h-full text-[#71717a] hover:text-[#a1a1aa] hover:bg-[#12121a] transition-colors shrink-0"
        title="New connection tab"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 5v14M5 12h14"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
