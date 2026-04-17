import React, { useState } from 'react';
import { formatFileSize } from '../hooks/useFileOperations';
import { useEscClose } from '../hooks/useEscClose';

// ── Types ─────────────────────────────────────────────────────────

export type OverwriteAction =
  | 'overwrite'
  | 'overwrite-if-newer'
  | 'overwrite-if-different-size'
  | 'resume'
  | 'skip'
  | 'rename';

export interface FileInfo {
  name: string;
  size: number;
  modifiedAt: number;
}

export interface OverwriteDialogRequest {
  visible: boolean;
  sourceName: string;
  sourceInfo: FileInfo | null;
  destInfo: FileInfo | null;
  isDirectory: boolean;
  protocol: string | undefined;
  resolve: ((result: { action: OverwriteAction; applyToAll: boolean }) => void) | null;
}

export const emptyOverwriteRequest: OverwriteDialogRequest = {
  visible: false,
  sourceName: '',
  sourceInfo: null,
  destInfo: null,
  isDirectory: false,
  protocol: undefined,
  resolve: null,
};

// ── Helpers ───────────────────────────────────────────────────────

function formatTimestamp(ms: number): string {
  if (!ms) return 'Unknown';
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Component ─────────────────────────────────────────────────────

export default function OverwriteConfirmDialog({
  request,
  onResponse,
}: {
  request: OverwriteDialogRequest;
  onResponse: (action: OverwriteAction, applyToAll: boolean) => void;
}) {
  const [applyToAll, setApplyToAll] = useState(false);

  // Esc = skip (default safe action)
  useEscClose(request.visible, () => onResponse('skip', false));

  const { sourceInfo, destInfo, sourceName, isDirectory, protocol } = request;
  const resumeDisabled = protocol === 's3' || isDirectory;

  const sourceNewer =
    sourceInfo && destInfo ? sourceInfo.modifiedAt > destInfo.modifiedAt : null;
  const sizeDiffers =
    sourceInfo && destInfo ? sourceInfo.size !== destInfo.size : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-[#12121a] border border-[#1e1e2e] rounded-lg shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="px-4 pt-4 pb-2">
          <h3 className="text-sm font-semibold text-[#e4e4e7]">
            {isDirectory ? 'Folder' : 'File'} Already Exists
          </h3>
          <p className="text-xs text-[#a1a1aa] mt-1">
            <span className="text-[#e4e4e7] font-mono">{sourceName}</span> already
            exists in the destination.
          </p>
        </div>

        {/* File comparison */}
        {sourceInfo && destInfo && (
          <div className="mx-4 mb-3 grid grid-cols-2 gap-2 text-[10px]">
            <div className="rounded bg-[#0a0a0f] border border-[#1e1e2e] p-2.5">
              <div className="text-[#71717a] mb-1.5 uppercase tracking-wider font-medium">Source</div>
              <div className="text-[#a1a1aa]">
                Size: <span className="text-[#e4e4e7]">{formatFileSize(sourceInfo.size)}</span>
              </div>
              <div className="text-[#a1a1aa] mt-0.5">
                Modified:{' '}
                <span className={sourceNewer ? 'text-emerald-400' : 'text-[#e4e4e7]'}>
                  {formatTimestamp(sourceInfo.modifiedAt)}
                </span>
                {sourceNewer && <span className="ml-1 text-emerald-400">(newer)</span>}
              </div>
            </div>
            <div className="rounded bg-[#0a0a0f] border border-[#1e1e2e] p-2.5">
              <div className="text-[#71717a] mb-1.5 uppercase tracking-wider font-medium">Destination</div>
              <div className="text-[#a1a1aa]">
                Size: <span className="text-[#e4e4e7]">{formatFileSize(destInfo.size)}</span>
                {sizeDiffers && <span className="ml-1 text-amber-400">({sourceInfo.size > destInfo.size ? 'smaller' : 'larger'})</span>}
              </div>
              <div className="text-[#a1a1aa] mt-0.5">
                Modified:{' '}
                <span className={sourceNewer === false ? 'text-emerald-400' : 'text-[#e4e4e7]'}>
                  {formatTimestamp(destInfo.modifiedAt)}
                </span>
                {sourceNewer === false && <span className="ml-1 text-emerald-400">(newer)</span>}
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="px-4 flex flex-col gap-1.5">
          <ActionButton
            label="Overwrite"
            desc="Replace the existing file"
            onClick={() => onResponse('overwrite', applyToAll)}
          />
          <ActionButton
            label="Overwrite if newer"
            desc="Only replace if source was modified more recently"
            onClick={() => onResponse('overwrite-if-newer', applyToAll)}
          />
          <ActionButton
            label="Overwrite if size differs"
            desc="Only replace if file sizes don't match"
            onClick={() => onResponse('overwrite-if-different-size', applyToAll)}
          />
          <ActionButton
            label="Resume"
            desc={resumeDisabled ? (protocol === 's3' ? 'Not available for S3' : 'Not available for folders') : 'Continue partial transfer from where it left off'}
            onClick={() => onResponse('resume', applyToAll)}
            disabled={resumeDisabled}
          />
          <ActionButton
            label="Skip"
            desc="Keep the existing file"
            onClick={() => onResponse('skip', applyToAll)}
          />
          <ActionButton
            label="Rename (auto)"
            desc="Save with a new name (e.g. file_1.txt)"
            onClick={() => onResponse('rename', applyToAll)}
          />
        </div>

        {/* Apply to all */}
        <div className="px-4 py-3">
          <label className="flex items-center gap-2 text-xs text-[#a1a1aa] cursor-pointer">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
              className="rounded border-[#1e1e2e] bg-[#0a0a0f] text-[#3b82f6] focus:ring-[#3b82f6] focus:ring-offset-0"
            />
            Apply to all remaining files
          </label>
        </div>
      </div>
    </div>
  );
}

// ── Action Button ────────────────────────────────────────────────

function ActionButton({
  label,
  desc,
  onClick,
  disabled,
}: {
  label: string;
  desc: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full px-3 py-2 text-xs text-left rounded transition-colors ${
        disabled
          ? 'bg-[#1a1a26]/50 text-[#52525b] cursor-not-allowed'
          : 'bg-[#1a1a26] hover:bg-[#3b82f6]/15 text-[#e4e4e7] cursor-pointer'
      }`}
    >
      {label}
      <span className={`block text-[10px] mt-0.5 ${disabled ? 'text-[#3f3f46]' : 'text-[#71717a]'}`}>
        {desc}
      </span>
    </button>
  );
}
