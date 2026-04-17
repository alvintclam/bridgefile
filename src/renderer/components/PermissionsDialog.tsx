import React, { useState, useMemo, useCallback } from 'react';
import { useEscClose } from '../hooks/useEscClose';

interface PermissionsDialogProps {
  isOpen: boolean;
  fileName: string;
  currentPermissions?: string; // e.g. "-rwxr-xr-x" or "drwxr-xr-x"
  connectionId: string;
  remotePath: string;
  onClose: () => void;
  onApply: (mode: number) => void;
}

// Parse a permission string like "-rwxr-xr-x" into a 9-element boolean array
function parsePermString(perm: string): boolean[] {
  // Strip the first char (type indicator: d, -, l, etc.)
  const perms = perm.length >= 10 ? perm.slice(1, 10) : perm.slice(0, 9);
  const result: boolean[] = [];
  for (let i = 0; i < 9; i++) {
    const ch = perms[i] || '-';
    result.push(ch !== '-');
  }
  return result;
}

// Convert a 9-element boolean array into an octal mode number
function boolsToMode(bits: boolean[]): number {
  let mode = 0;
  for (let i = 0; i < 9; i++) {
    if (bits[i]) {
      mode |= 1 << (8 - i);
    }
  }
  return mode;
}

// Convert an octal mode number to a 9-element boolean array
function modeToBools(mode: number): boolean[] {
  const bits: boolean[] = [];
  for (let i = 8; i >= 0; i--) {
    bits.push((mode & (1 << i)) !== 0);
  }
  return bits;
}

// Convert mode to octal string like "755"
function modeToOctal(mode: number): string {
  return mode.toString(8).padStart(3, '0');
}

// Labels for the grid rows and columns
const ENTITIES = ['Owner', 'Group', 'Other'] as const;
const PERMS = ['Read', 'Write', 'Execute'] as const;

export default function PermissionsDialog({
  isOpen,
  fileName,
  currentPermissions,
  connectionId,
  remotePath,
  onClose,
  onApply,
}: PermissionsDialogProps) {
  useEscClose(isOpen, onClose);
  const initialBits = useMemo(() => {
    if (currentPermissions) {
      return parsePermString(currentPermissions);
    }
    // Default to 644
    return modeToBools(0o644);
  }, [currentPermissions]);

  const [bits, setBits] = useState<boolean[]>(initialBits);
  const [octalInput, setOctalInput] = useState<string>(modeToOctal(boolsToMode(initialBits)));

  // Reset state when dialog opens with new props
  React.useEffect(() => {
    if (isOpen) {
      const newBits = currentPermissions ? parsePermString(currentPermissions) : modeToBools(0o644);
      setBits(newBits);
      setOctalInput(modeToOctal(boolsToMode(newBits)));
    }
  }, [isOpen, currentPermissions]);

  const mode = useMemo(() => boolsToMode(bits), [bits]);

  const toggleBit = useCallback(
    (index: number) => {
      const newBits = [...bits];
      newBits[index] = !newBits[index];
      setBits(newBits);
      setOctalInput(modeToOctal(boolsToMode(newBits)));
    },
    [bits],
  );

  const handleOctalChange = useCallback((value: string) => {
    // Only allow digits 0-7
    const clean = value.replace(/[^0-7]/g, '').slice(0, 3);
    setOctalInput(clean);
    if (clean.length === 3) {
      const parsed = parseInt(clean, 8);
      setBits(modeToBools(parsed));
    }
  }, []);

  const handleApply = useCallback(() => {
    onApply(mode);
  }, [mode, onApply]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[400px] bg-[#12121a] border border-[#1e1e2e] rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-[#1e1e2e]">
          <div>
            <h2 className="text-sm font-semibold text-[#e4e4e7]">File Permissions</h2>
            <p className="text-[11px] text-[#71717a] mt-0.5 truncate max-w-[300px]">{fileName}</p>
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

        {/* Permission grid */}
        <div className="p-4">
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left text-[11px] text-[#71717a] uppercase tracking-wide pb-2" />
                {PERMS.map((p) => (
                  <th key={p} className="text-center text-[11px] text-[#71717a] uppercase tracking-wide pb-2">
                    {p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ENTITIES.map((entity, entityIdx) => (
                <tr key={entity}>
                  <td className="text-xs text-[#a1a1aa] py-1.5 pr-4">{entity}</td>
                  {PERMS.map((perm, permIdx) => {
                    const bitIndex = entityIdx * 3 + permIdx;
                    const isSet = bits[bitIndex];
                    return (
                      <td key={perm} className="text-center py-1.5">
                        <button
                          onClick={() => toggleBit(bitIndex)}
                          className={`w-6 h-6 rounded border transition-colors ${
                            isSet
                              ? 'bg-[#3b82f6] border-[#3b82f6] text-white'
                              : 'bg-[#0a0a0f] border-[#1e1e2e] text-[#71717a] hover:border-[#3b82f6]/50'
                          }`}
                        >
                          {isSet && (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="mx-auto">
                              <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Numeric mode */}
          <div className="mt-4 flex items-center gap-3">
            <label className="text-xs text-[#71717a]">Numeric mode:</label>
            <input
              type="text"
              value={octalInput}
              onChange={(e) => handleOctalChange(e.target.value)}
              maxLength={3}
              className="w-16 px-2 py-1 text-sm bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] font-mono text-center focus:border-[#3b82f6] focus:outline-none transition-colors"
            />
            <span className="text-[11px] text-[#71717a] font-mono">
              (0{modeToOctal(mode)})
            </span>
          </div>

          {/* Permission string preview */}
          <div className="mt-2 text-[11px] text-[#71717a] font-mono">
            {bits.map((b, i) => {
              const chars = 'rwxrwxrwx';
              return b ? chars[i] : '-';
            }).join('')}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 p-3 border-t border-[#1e1e2e]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded text-[#a1a1aa] hover:bg-[#1a1a26] border border-[#1e1e2e] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            className="px-4 py-1.5 text-xs rounded bg-[#3b82f6] text-white hover:bg-[#2563eb] transition-colors"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
