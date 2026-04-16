# Changelog

All notable changes to BridgeFile will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **FileZilla-beating multi-channel SFTP**: 4 concurrent SFTP subsystem channels on the same SSH connection, each with 64 parallel read/write requests
- **S3 multipart upload** for files >20 MB with 4 parallel 10 MB parts
- **S3 parallel range downloads** for files >10 MB (4 byte-range GetObject requests written to file offsets)
- **FileZilla-style overwrite dialog** with 6 actions: overwrite, overwrite-if-newer, overwrite-if-size-differs, resume, skip, rename, plus "apply to all" checkbox
- **Preferences dialog** (⌘/Ctrl+,): theme, language, default max concurrent, default speed limit, show hidden files
- **Keyboard shortcuts help** (⌘/Ctrl+/): in-app cheat sheet
- **About dialog**: version, platform, license, source link
- **Welcome screen** for first-time users (no connections yet)
- **Cross-pane clipboard**: ⌘/Ctrl+C copy, ⌘/Ctrl+X cut, ⌘/Ctrl+V paste triggers transfer
- **Path history navigation**: Alt+Left/Right walks through per-pane history stack
- **Show hidden files toggle** (dotfiles) in preferences
- **Transfer queue** with max concurrent up to 64
- **Parallel directory transfers**: 4 files at a time for SFTP and S3
- **FTP connection mutex**: serializes concurrent FTP commands to prevent "Client closed" crashes
- **Light theme** via CSS variable overrides (no longer broken)
- **File editor line numbers** with scroll sync
- **IPC path validation**: rejects paths outside home/tmp/downloads
- **CSP headers** in renderer index.html
- **Favicon and app icons** (ICO, ICNS, PNG)

### Changed
- Upgraded `basic-ftp` from 5.2.1 → 5.3.0 (patches CRLF injection CVE-2024-27086)
- Stream-based chunk merge for multi-channel SFTP downloads (no more RAM spikes on large files)
- All stream buffers increased to 256 KB for fewer syscalls
- SSH compression now prefers `none` for LAN-speed transfers of already-compressed files
- Electron sandbox enabled (`sandbox: true`)
- Navigation guards block redirects to unknown origins; external links open in system browser
- Temp files for remote-file editing use `crypto.randomUUID()` instead of predictable `Date.now()`
- Transfer queue polling consolidated: `SpeedIndicator` receives queue data as prop instead of polling independently
- `TransferQueue` operations now surface errors via the log panel instead of silently failing

### Fixed
- **Data corruption**: `mergeChunks` now properly awaits stream flush (multi-channel SFTP downloads were silently truncating files)
- **Data loss**: S3 parallel download cleans up partial files on abort or chunk failure
- **Deadlock**: FTP `resumeDownload` no longer double-wraps in `withMutex`
- **Crash**: `startTransfer` wraps sync throws in try/catch so unknown protocols fail the transfer instead of crashing main process
- **Connection leak**: SFTP jump-host `proxyClient` is now stored in the pool and cleaned up on idle prune
- **Stale closure**: `handleDisconnect` uses fresh state from `setTabs` updater callback
- **Stale closure**: `handleOverwriteResponse` no longer recreated on every dialog open
- **Progress timing**: SFTP/S3/FTP `uploadDir`/`downloadDir` now reports progress AFTER each file completes (was reporting before the transfer started)
- **Memory leak**: `transfer-rate-limit` promise chain no longer grows unbounded; skipped entirely when no rate limit active
- **`deleteDir` resilience**: wraps `unlink` and `rmdir` in `withReconnect`

### Security
- Upgraded dependencies to patch `basic-ftp` and `follow-redirects` vulnerabilities (`npm audit` now clean)
- Enabled Electron sandbox
- Added navigation guards to prevent redirect hijacking
- IPC handlers validate paths stay within user directories
- CSP headers restrict renderer to local origin

## [0.1.0] - 2026-04-12

Initial release with SFTP, FTP/FTPS, and S3 support, dual-pane browser,
transfer queue, multi-tab sessions, and basic overwrite handling.
