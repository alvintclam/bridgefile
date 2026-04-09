# Contributing to BridgeFile

Thanks for your interest in contributing to BridgeFile! This document provides guidelines for contributing.

## Development Setup

```bash
git clone https://github.com/bridgefile/bridgefile.git
cd bridgefile
npm install
npm run dev
```

## Project Structure

- `src/main/` — Electron main process (Node.js)
- `src/renderer/` — React UI (browser context)
- `src/shared/` — Types shared between main and renderer
- `src/main/protocols/` — Protocol implementations (SFTP, S3)

## Guidelines

### Code Style
- TypeScript strict mode
- Functional components with hooks (React)
- No `any` types unless absolutely necessary
- Error handling with try/catch in all async operations

### Commits
- Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`
- One logical change per commit

### Pull Requests
- Fork the repo and create a feature branch
- Write clear PR description
- Ensure TypeScript compiles with zero errors
- Test on both Windows and macOS if possible

## Areas for Contribution

### Good First Issues
- UI improvements and polish
- Keyboard shortcut additions
- File icon improvements
- Error message improvements
- Documentation

### Intermediate
- FTP/FTPS protocol support
- Bookmark system
- Dark/light mode toggle
- Transfer retry logic

### Advanced
- Multi-threaded transfers
- Folder comparison
- S3-compatible service testing (MinIO, R2, Backblaze)

## Reporting Bugs

Please use [GitHub Issues](https://github.com/bridgefile/bridgefile/issues) with:
- OS and version
- Steps to reproduce
- Expected vs actual behavior
- Screenshots if applicable

## License

By contributing, you agree that your contributions will be licensed under the BSL license.
