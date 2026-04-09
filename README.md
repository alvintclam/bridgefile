# BridgeFile

**File transfer, without limits.**

A cross-platform file transfer client that supports traditional protocols and controlled S3 access -- without requiring full bucket browsing.

![License: BSL](https://img.shields.io/badge/license-BSL-blue)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

## Why BridgeFile?

Most S3 clients assume you have full access to list all buckets and browse freely. In reality, many teams work with restricted IAM policies -- a single bucket, a specific prefix, and nothing more.

**BridgeFile doesn't assume.** Set a fixed bucket and prefix, and that's all you see. No bucket picker. No account browser. Just your files.

## Features

### Protocol Support
- **SFTP** -- SSH key and password authentication with compression negotiation (zlib)
- **FTP / FTPS** -- Plain FTP and implicit/explicit TLS
- **S3** -- Single-bucket mode with minimal IAM permissions (no `ListAllBuckets` needed)
- **S3-Compatible** -- MinIO, Cloudflare R2, DigitalOcean Spaces via custom endpoint

### File Management
- **Dual-Pane Browser** -- FileZilla-style local + remote file browsing
- **Drag & Drop** -- Reorder tabs, drag files between panes
- **Recursive Directory Operations** -- Upload, download, and delete entire folders
- **Remote File Editing** -- Edit text files directly on the server
- **File Search** -- Glob-pattern search across remote directories (recursive)
- **File Permissions** -- View and change permissions (chmod) on SFTP
- **Checksum Verification** -- Compute and compare MD5/SHA-256 checksums for local and remote files

### Transfer Engine
- **Transfer Queue** -- Progress, speed, and ETA for every transfer
- **Transfer Resume** -- Resume interrupted uploads and downloads (SFTP, FTP)
- **Transfer Compression** -- Automatic zlib compression negotiation for SFTP transfers
- **Connection Pooling** -- Idle connection management with automatic cleanup

### Connection Management
- **Site Manager** -- Save, organize, and group connection profiles
- **Favorites & Groups** -- Star connections and organize into folders
- **Jump Host / Proxy** -- SSH tunnelling through bastion hosts
- **Connection Timeout** -- Configurable timeout per connection (default 30s)
- **Auto-Reconnect** -- Transparent reconnection on stale/broken connections
- **Bookmarks** -- Save frequently accessed remote paths

### User Interface
- **Multi-Tab Sessions** -- Multiple simultaneous connections with tab reordering
- **Synchronized Browsing** -- Navigate local and remote panes in sync
- **Dark & Light Themes** -- Toggle between themes
- **Resizable Panels** -- Drag to resize panes and bottom panel
- **Collapsible Transfer Queue** -- Minimize when not needed
- **Activity Logging** -- Full session log with export capability
- **Localization** -- English and Traditional Chinese (zh-TW) support

### Security & Updates
- **Secure Credentials** -- OS Keychain (macOS) / Credential Manager (Windows)
- **Auto-Update Check** -- Notifies when a new version is available on GitHub
- **Cross-Platform** -- Windows, macOS, Linux

## Feature Comparison vs FileZilla

| Feature | BridgeFile | FileZilla |
|---------|:----------:|:---------:|
| SFTP | Yes | Yes |
| FTP / FTPS | Yes | Yes |
| S3 Single-Bucket Mode | Yes | No |
| S3-Compatible (MinIO, R2) | Yes | No |
| Multi-Tab Sessions | Yes | Yes |
| Synchronized Browsing | Yes | Yes |
| Transfer Resume | Yes | Yes |
| Transfer Compression (zlib) | Yes | Yes |
| Remote File Editing | Yes | Yes |
| File Search (glob) | Yes | Yes |
| Checksum Verification | Yes | Yes |
| Jump Host / Proxy | Yes | No* |
| Bookmarks | Yes | Yes |
| Connection Timeout Config | Yes | Yes |
| Drag & Drop Tab Reorder | Yes | No |
| Dark / Light Theme | Yes | No |
| Localization (i18n) | Yes | Yes |
| Auto-Update Notification | Yes | Yes |
| Open Source | Yes | Yes |
| No Bundled Adware | Yes | No |

*FileZilla Pro supports proxy but not SSH jump host tunnelling.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/alvintclam/bridgefile.git
cd bridgefile

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
npm run dist
```

## S3 Single-Bucket Mode

The key differentiator. When creating an S3 connection:

1. Set **Bucket** to your specific bucket name
2. Optionally set **Prefix** to a path within the bucket
3. BridgeFile will only show files within that scope

**Minimum IAM permissions required:**
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "s3:ListBucket",
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject"
    ],
    "Resource": [
      "arn:aws:s3:::my-bucket",
      "arn:aws:s3:::my-bucket/*"
    ]
  }]
}
```

No `s3:ListAllMyBuckets` needed. No account-level access required.

## Tech Stack

- **Electron** -- Cross-platform desktop framework
- **React + TypeScript** -- UI
- **Vite** -- Build tool
- **ssh2** -- SFTP protocol
- **basic-ftp** -- FTP/FTPS protocol
- **AWS SDK v3** -- S3 protocol
- **keytar** -- Secure credential storage
- **Tailwind CSS** -- Styling

## Project Structure

```
src/
+-- main/               # Electron main process
|   +-- main.ts         # Window management
|   +-- preload.ts      # Secure IPC bridge
|   +-- ipc-handlers.ts # IPC request handlers
|   +-- store.ts        # Connection profile storage
|   +-- auto-updater.ts # GitHub release update checker
|   +-- protocols/
|       +-- sftp.ts     # SFTP client (ssh2)
|       +-- ftp.ts      # FTP/FTPS client (basic-ftp)
|       +-- s3.ts       # S3 client (AWS SDK)
+-- renderer/           # React frontend
|   +-- App.tsx         # Main layout
|   +-- lib/
|   |   +-- i18n.ts     # Localization (en, zh-TW)
|   +-- components/
|   |   +-- ConnectionManager.tsx
|   |   +-- ConnectionBar.tsx
|   |   +-- FilePane.tsx
|   |   +-- TransferQueue.tsx
|   |   +-- LogPanel.tsx
|   |   +-- TabBar.tsx
|   |   +-- BookmarkBar.tsx
|   |   +-- ChecksumDialog.tsx
|   +-- hooks/
|       +-- useFileOperations.ts
+-- shared/             # Shared types
    +-- types.ts
```

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| New Connection | `Ctrl/Cmd + N` |
| Refresh | `F5` |
| Upload | `Ctrl/Cmd + U` |
| Download | `Ctrl/Cmd + D` |
| Delete | `Delete` |
| Rename | `F2` |
| New Folder | `Ctrl/Cmd + Shift + N` |
| Select All | `Ctrl/Cmd + A` |
| Go to Path | `Ctrl/Cmd + L` |
| Close Tab | `Ctrl/Cmd + W` |
| Next Tab | `Ctrl/Cmd + Tab` |
| Toggle Theme | `Ctrl/Cmd + Shift + T` |

## License

**Business Source License (BSL)**

- Free for personal use
- Source code is public
- Commercial use requires a license -- [Get Pro](https://bridgefile.io/pricing)

## Links

- [Website](https://bridgefile.io)
- [Documentation](https://bridgefile.io/docs)
- [Report a Bug](https://github.com/alvintclam/bridgefile/issues)
- [Discussions](https://github.com/alvintclam/bridgefile/discussions)
