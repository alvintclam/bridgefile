import React, { useState, useEffect } from 'react';

export interface Preferences {
  theme: 'dark' | 'light';
  language: 'en' | 'zh-TW';
  defaultMaxConcurrent: number;
  defaultSpeedLimitMbps: number | null;
  showHiddenFiles: boolean;
}

export const defaultPreferences: Preferences = {
  theme: 'dark',
  language: 'en',
  defaultMaxConcurrent: 4,
  defaultSpeedLimitMbps: null,
  showHiddenFiles: false,
};

interface PreferencesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  preferences: Preferences;
  onSave: (prefs: Preferences) => void;
}

type Tab = 'general' | 'transfers' | 'advanced';

export default function PreferencesDialog({ isOpen, onClose, preferences, onSave }: PreferencesDialogProps) {
  const [tab, setTab] = useState<Tab>('general');
  const [draft, setDraft] = useState<Preferences>(preferences);

  useEffect(() => {
    if (isOpen) setDraft(preferences);
  }, [isOpen, preferences]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onSave(draft);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#12121a] border border-[#1e1e2e] rounded-lg shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e1e2e]">
          <h3 className="text-sm font-semibold text-[#e4e4e7]">Preferences</h3>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#71717a] hover:text-[#e4e4e7] hover:bg-[#1a1a26]"
            aria-label="Close preferences"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex border-b border-[#1e1e2e]">
          {(['general', 'transfers', 'advanced'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-xs capitalize transition-colors ${
                tab === t
                  ? 'text-[#e4e4e7] border-b-2 border-[#3b82f6]'
                  : 'text-[#71717a] hover:text-[#a1a1aa]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="p-5 min-h-[240px]">
          {tab === 'general' && (
            <div className="space-y-4">
              <Row label="Theme">
                <select
                  value={draft.theme}
                  onChange={(e) => set('theme', e.target.value as 'dark' | 'light')}
                  className="bg-[#0a0a0f] border border-[#1e1e2e] rounded px-2 py-1 text-xs text-[#e4e4e7] focus:outline-none focus:border-[#3b82f6]"
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </Row>
              <Row label="Language">
                <select
                  value={draft.language}
                  onChange={(e) => set('language', e.target.value as 'en' | 'zh-TW')}
                  className="bg-[#0a0a0f] border border-[#1e1e2e] rounded px-2 py-1 text-xs text-[#e4e4e7] focus:outline-none focus:border-[#3b82f6]"
                >
                  <option value="en">English</option>
                  <option value="zh-TW">繁體中文</option>
                </select>
              </Row>
              <p className="text-[10px] text-[#71717a] pt-2">
                Language changes take effect on next app launch.
              </p>
            </div>
          )}

          {tab === 'transfers' && (
            <div className="space-y-4">
              <Row label="Default max concurrent">
                <select
                  value={draft.defaultMaxConcurrent}
                  onChange={(e) => set('defaultMaxConcurrent', Number(e.target.value))}
                  className="bg-[#0a0a0f] border border-[#1e1e2e] rounded px-2 py-1 text-xs text-[#e4e4e7] focus:outline-none focus:border-[#3b82f6]"
                >
                  {[1, 2, 3, 4, 5, 8, 10, 16, 24, 32, 48, 64].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </Row>
              <Row label="Default speed limit">
                <select
                  value={draft.defaultSpeedLimitMbps ?? 'unlimited'}
                  onChange={(e) =>
                    set(
                      'defaultSpeedLimitMbps',
                      e.target.value === 'unlimited' ? null : Number(e.target.value),
                    )
                  }
                  className="bg-[#0a0a0f] border border-[#1e1e2e] rounded px-2 py-1 text-xs text-[#e4e4e7] focus:outline-none focus:border-[#3b82f6]"
                >
                  <option value="unlimited">Unlimited</option>
                  <option value="1">1 MB/s</option>
                  <option value="5">5 MB/s</option>
                  <option value="10">10 MB/s</option>
                  <option value="50">50 MB/s</option>
                  <option value="100">100 MB/s</option>
                </select>
              </Row>
            </div>
          )}

          {tab === 'advanced' && (
            <div className="space-y-4">
              <Row label="Show hidden files">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.showHiddenFiles}
                    onChange={(e) => set('showHiddenFiles', e.target.checked)}
                    className="rounded border-[#1e1e2e] bg-[#0a0a0f] text-[#3b82f6] focus:ring-[#3b82f6] focus:ring-offset-0"
                  />
                  <span className="text-xs text-[#a1a1aa]">Show dotfiles in local/remote panes</span>
                </label>
              </Row>
              <p className="text-[10px] text-[#71717a] pt-2">
                Changes apply to future directory listings; refresh existing panes with F5.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#1e1e2e]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded text-[#a1a1aa] hover:bg-[#1a1a26] border border-[#1e1e2e]"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-1.5 text-xs rounded bg-[#3b82f6] hover:bg-[#2563eb] text-white font-medium"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label className="text-xs text-[#e4e4e7]">{label}</label>
      <div>{children}</div>
    </div>
  );
}
