import React from 'react';
import { useEscClose } from '../hooks/useEscClose';

interface ShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Shortcut {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  title: string;
  shortcuts: Shortcut[];
}

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl';
const alt = isMac ? '⌥' : 'Alt';

const GROUPS: ShortcutGroup[] = [
  {
    title: 'File Operations',
    shortcuts: [
      { keys: [mod, 'C'], description: 'Copy selected files to clipboard' },
      { keys: [mod, 'X'], description: 'Cut selected files (move on paste)' },
      { keys: [mod, 'V'], description: 'Paste into other pane (transfer)' },
      { keys: [mod, 'A'], description: 'Select all files in current pane' },
      { keys: ['F2'], description: 'Rename selected file' },
      { keys: ['Delete'], description: 'Delete selected files' },
      { keys: ['Enter'], description: 'Open folder or transfer file' },
    ],
  },
  {
    title: 'Navigation',
    shortcuts: [
      { keys: [alt, '←'], description: 'Go back in path history' },
      { keys: [alt, '→'], description: 'Go forward in path history' },
      { keys: ['Backspace'], description: 'Go to parent directory' },
      { keys: [mod, 'L'], description: 'Focus path input (edit path)' },
      { keys: ['↑', '↓'], description: 'Move file selection' },
      { keys: ['Shift', '↑', '↓'], description: 'Extend selection' },
      { keys: ['F5'], description: 'Refresh current pane' },
    ],
  },
  {
    title: 'Editor (when editing a file)',
    shortcuts: [
      { keys: [mod, 'S'], description: 'Save file' },
    ],
  },
  {
    title: 'General',
    shortcuts: [
      { keys: [mod, '/'], description: 'Show this shortcuts help' },
      { keys: [mod, ','], description: 'Open preferences' },
    ],
  },
];

export default function ShortcutsHelp({ isOpen, onClose }: ShortcutsHelpProps) {
  useEscClose(isOpen, onClose);
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-[#12121a] border border-[#1e1e2e] rounded-lg shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e1e2e]">
          <h3 className="text-sm font-semibold text-[#e4e4e7]">Keyboard Shortcuts</h3>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#71717a] hover:text-[#e4e4e7] hover:bg-[#1a1a26]"
            aria-label="Close shortcuts help"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-6">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h4 className="text-[10px] uppercase tracking-wider text-[#71717a] font-semibold mb-2">
                {group.title}
              </h4>
              <div className="space-y-1.5">
                {group.shortcuts.map((sc, i) => (
                  <div key={i} className="flex items-center justify-between gap-4">
                    <span className="text-xs text-[#a1a1aa]">{sc.description}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {sc.keys.map((key, ki) => (
                        <React.Fragment key={ki}>
                          {ki > 0 && <span className="text-[#52525b] text-[10px]">+</span>}
                          <kbd className="px-2 py-0.5 text-[10px] font-mono rounded bg-[#1a1a26] border border-[#2a2a3e] text-[#e4e4e7] min-w-[20px] text-center">
                            {key}
                          </kbd>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-[#1e1e2e] text-[10px] text-[#71717a]">
          Press <kbd className="px-1.5 py-0.5 font-mono rounded bg-[#1a1a26] border border-[#2a2a3e] text-[#a1a1aa]">Esc</kbd> or click outside to close.
        </div>
      </div>
    </div>
  );
}
