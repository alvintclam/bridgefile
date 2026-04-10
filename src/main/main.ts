import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { registerIPCHandlers } from './ipc-handlers';
import './auto-updater';

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
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false, // Required for some native modules
    },
  });

  // Graceful show — avoids white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (isDev) {
    const devServerURL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    mainWindow.loadURL(devServerURL);
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

// Security: prevent new window creation
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
});
