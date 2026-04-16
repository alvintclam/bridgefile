import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { registerIPCHandlers } from './ipc-handlers';
import './auto-updater';

// ── Crash logging to file ──────────────────────────────────────

function getLogFile(): string {
  const logDir = path.join(app.getPath('userData'), 'logs');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch { /* ignore */ }
  const date = new Date().toISOString().slice(0, 10);
  return path.join(logDir, `${date}.log`);
}

function logToFile(level: string, message: string, stack?: string): void {
  try {
    const line = `[${new Date().toISOString()}] [${level}] ${message}${stack ? '\n' + stack : ''}\n`;
    fs.appendFileSync(getLogFile(), line);
  } catch {
    // best-effort
  }
}

process.on('uncaughtException', (err) => {
  logToFile('fatal', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logToFile('error', `Unhandled rejection: ${msg}`, stack);
});

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Graceful show — avoids white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // In production, load the built renderer files
    const indexPath = path.join(__dirname, '..', 'renderer', 'index.html');
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── App lifecycle ──────────────────────────────────────────────

app.whenReady().then(() => {
  registerIPCHandlers();
  createWindow();

  // macOS: re-create window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, keep the app running until Cmd+Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Security: prevent navigation to unknown origins and deny new windows
app.on('web-contents-created', (_event, contents) => {
  // Block any navigation away from our loaded origin (file:// or dev server)
  contents.on('will-navigate', (event, url) => {
    const parsed = new URL(url);
    const isDevServer =
      !!process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL);
    const isFileProto = parsed.protocol === 'file:';
    if (!isDevServer && !isFileProto) {
      event.preventDefault();
    }
  });

  // Open external links (like the GitHub update URL) in the system browser instead of a new window
  contents.setWindowOpenHandler(({ url }) => {
    // Only allow https: URLs, and open them externally
    if (url.startsWith('https://') || url.startsWith('http://')) {
      import('electron').then(({ shell }) => {
        shell.openExternal(url).catch(() => {});
      });
    }
    return { action: 'deny' };
  });
});
