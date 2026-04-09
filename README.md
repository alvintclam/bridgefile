# BridgeFile

**File transfer, without limits.**

A cross-platform file transfer client that supports traditional protocols and controlled S3 access — without requiring full bucket browsing.

![License: BSL](https://img.shields.io/badge/license-BSL-blue)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

## Why BridgeFile?

Most S3 clients assume you have full access to list all buckets and browse freely. In reality, many teams work with restricted IAM policies — a single bucket, a specific prefix, and nothing more.

**BridgeFile doesn't assume.** Set a fixed bucket and prefix, and that's all you see. No bucket picker. No account browser. Just your files.

## Features

- **Dual-Pane Browser** — FileZilla-style local + remote file browsing
- **S3 Single-Bucket Mode** — Works with minimal IAM permissions (no `ListAllBuckets` needed)
- **SFTP Support** — SSH key and password authentication
- **Transfer Queue** — Progress, speed, ETA for every transfer
- **Secure Credentials** — OS Keychain (macOS) / Credential Manager (Windows)
- **Cross-Platform** — Windows, macOS, Linux

## Quick Start

```bash
# Clone the repository
git clone https://github.com/bridgefile/bridgefile.git
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

- **Electron** — Cross-platform desktop framework
- **React + TypeScript** — UI
- **Vite** — Build tool
- **ssh2** — SFTP protocol
- **AWS SDK v3** — S3 protocol
- **keytar** — Secure credential storage
- **Tailwind CSS** — Styling

## Project Structure

```
src/
├── main/               # Electron main process
│   ├── main.ts         # Window management
│   ├── preload.ts      # Secure IPC bridge
│   ├── ipc-handlers.ts # IPC request handlers
│   ├── store.ts        # Connection profile storage
│   └── protocols/
│       ├── sftp.ts     # SFTP client (ssh2)
│       └── s3.ts       # S3 client (AWS SDK)
├── renderer/           # React frontend
│   ├── App.tsx         # Main layout
│   ├── components/
│   │   ├── ConnectionManager.tsx
│   │   ├── ConnectionBar.tsx
│   │   ├── FilePane.tsx
│   │   ├── TransferQueue.tsx
│   │   └── LogPanel.tsx
│   └── hooks/
│       └── useFileOperations.ts
└── shared/             # Shared types
    └── types.ts
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

## License

**Business Source License (BSL)**

- ✅ Free for personal use
- ✅ Source code is public
- 💼 Commercial use requires a license — [Get Pro](https://bridgefile.io/pricing)

## Links

- 🌐 [Website](https://bridgefile.io)
- 📖 [Documentation](https://bridgefile.io/docs)
- 🐛 [Report a Bug](https://github.com/bridgefile/bridgefile/issues)
- 💬 [Discussions](https://github.com/bridgefile/bridgefile/discussions)
