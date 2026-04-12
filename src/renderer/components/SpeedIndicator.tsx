import React, { useState, useEffect, useRef, useCallback } from 'react';

export type SpeedLimit = 'unlimited' | 1 | 5 | 10 | number;

interface SpeedIndicatorProps {
  /** Current speed limit in MB/s, or 'unlimited' */
  speedLimit: SpeedLimit;
  onSpeedLimitChange: (limit: SpeedLimit) => void;
}

function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof window.bridgefile !== 'undefined';
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec === 0) return '0 B/s';
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
}

export default function SpeedIndicator({ speedLimit, onSpeedLimitChange }: SpeedIndicatorProps) {
  const [uploadSpeed, setUploadSpeed] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const [customLimit, setCustomLimit] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const prevTransferred = useRef<{ upload: number; download: number; time: number }>({
    upload: 0,
    download: 0,
    time: Date.now(),
  });

  // Poll transfer queue every 500ms to compute speeds
  useEffect(() => {
    const poll = async () => {
      if (!isElectron()) {
        setUploadSpeed(0);
        setDownloadSpeed(0);
        return;
      }

      try {
        const queue = await window.bridgefile.transfer.getQueue();
        const now = Date.now();
        const elapsed = (now - prevTransferred.current.time) / 1000;

        if (elapsed > 0) {
          let totalUpload = 0;
          let totalDownload = 0;

          for (const t of queue) {
            if (t.status === 'in-progress' && t.entryType !== 'directory') {
              if (t.direction === 'upload') {
                totalUpload += t.transferred;
              } else {
                totalDownload += t.transferred;
              }
            }
          }

          const upDelta = totalUpload - prevTransferred.current.upload;
          const downDelta = totalDownload - prevTransferred.current.download;

          // Only set positive deltas (negative means transfers completed/restarted)
          if (upDelta >= 0) setUploadSpeed(upDelta / elapsed);
          if (downDelta >= 0) setDownloadSpeed(downDelta / elapsed);

          prevTransferred.current = { upload: totalUpload, download: totalDownload, time: now };
        }
      } catch {
        // Ignore polling errors
      }
    };

    const interval = setInterval(poll, 500);
    poll();
    return () => clearInterval(interval);
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    if (showDropdown) {
      document.addEventListener('mousedown', handleClick);
    }
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showDropdown]);

  const handleLimitSelect = useCallback(
    (limit: SpeedLimit) => {
      onSpeedLimitChange(limit);
      setShowDropdown(false);
    },
    [onSpeedLimitChange],
  );

  const handleCustomSubmit = useCallback(() => {
    const val = parseFloat(customLimit);
    if (val > 0) {
      onSpeedLimitChange(val);
      setCustomLimit('');
      setShowDropdown(false);
    }
  }, [customLimit, onSpeedLimitChange]);

  const limitLabel =
    speedLimit === 'unlimited'
      ? 'Unlimited'
      : `${speedLimit} MB/s`;

  return (
    <div className="flex items-center gap-3 text-[11px] text-[#71717a] relative" ref={dropdownRef}>
      {/* Upload speed */}
      <div className="flex items-center gap-1">
        <span className="text-emerald-400">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
            <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="font-mono text-[10px]">{formatSpeed(uploadSpeed)}</span>
      </div>

      {/* Download speed */}
      <div className="flex items-center gap-1">
        <span className="text-[#3b82f6]">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M19 12l-7 7-7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="font-mono text-[10px]">{formatSpeed(downloadSpeed)}</span>
      </div>

      {/* Speed limit dropdown */}
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[#1a1a26] transition-colors"
        title="Speed limit"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 8v4l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[10px]">{limitLabel}</span>
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {showDropdown && (
        <div className="absolute top-full right-0 mt-1 bg-[#12121a] border border-[#1e1e2e] rounded-lg shadow-xl z-50 min-w-[140px] py-1">
          {(['unlimited', 1, 5, 10] as SpeedLimit[]).map((limit) => {
            const isActive = speedLimit === limit;
            const label = limit === 'unlimited' ? 'Unlimited' : `${limit} MB/s`;
            return (
              <button
                key={String(limit)}
                onClick={() => handleLimitSelect(limit)}
                className={`w-full px-3 py-1.5 text-left text-[11px] transition-colors ${
                  isActive
                    ? 'text-[#3b82f6] bg-[#3b82f6]/10'
                    : 'text-[#a1a1aa] hover:bg-[#1a1a26]'
                }`}
              >
                {label}
              </button>
            );
          })}

          {/* Custom input */}
          <div className="border-t border-[#1e1e2e] mt-1 pt-1 px-2 pb-1">
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="0.1"
                step="0.1"
                placeholder="Custom"
                value={customLimit}
                onChange={(e) => setCustomLimit(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCustomSubmit()}
                className="w-16 px-1.5 py-0.5 text-[10px] bg-[#0a0a0f] border border-[#1e1e2e] rounded text-[#e4e4e7] focus:border-[#3b82f6] focus:outline-none"
              />
              <span className="text-[10px] text-[#71717a]">MB/s</span>
              <button
                onClick={handleCustomSubmit}
                className="px-1.5 py-0.5 text-[10px] rounded bg-[#3b82f6] text-white hover:bg-[#2563eb] transition-colors"
              >
                Set
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
