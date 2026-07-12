import { app, shell, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { is } from '@electron-toolkit/utils';
import { registerHandlers } from './handlers.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#faf9f7',
    webPreferences: {
      // The preload is CommonJS so it can run sandboxed (PLAN §3.2).
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
    // Dev-only self-screenshot for verification (no desktop capture involved).
    const shot = process.env['PM_SCREENSHOT'];
    if (shot) {
      setTimeout(async () => {
        try {
          const image = await mainWindow!.webContents.capturePage();
          const { writeFile } = await import('node:fs/promises');
          await writeFile(shot, image.toPNG());
          console.log(`[pm] screenshot → ${shot}`);
        } catch (err) {
          console.error('[pm] screenshot failed', err);
        }
        app.quit();
      }, 2500);
    }
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: 'deny' };
  });

  const open = process.env['PM_OPEN'];
  const search = open ? `open=${encodeURIComponent(open)}` : undefined;
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL']);
    if (search) url.search = search;
    void mainWindow.loadURL(url.toString());
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'), search ? { search } : undefined);
  }
}

app.whenReady().then(async () => {
  const { onReady } = registerHandlers(() => mainWindow);
  await onReady();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
