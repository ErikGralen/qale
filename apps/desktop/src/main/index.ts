import { app, shell, BrowserWindow, Menu } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { is } from '@electron-toolkit/utils';
import { registerHandlers } from './handlers.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Dev-only: sandbox all app state (settings, app.db, pi sessions, localStorage)
// into a scratch dir so verification runs never touch the real profile.
if (process.env['PM_USERDATA']) app.setPath('userData', process.env['PM_USERDATA']);

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
      const delay = Number(process.env['PM_SCREENSHOT_DELAY'] ?? 2500);
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
      }, delay);
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

/**
 * Custom menu: Close Window moves to ⌘⇧W so ⌘W reaches the renderer and closes
 * the active tab (default menus swallow it). Edit/View/Window roles kept so the
 * standard clipboard, zoom, and devtools accelerators still work.
 */
function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [{ role: 'close', accelerator: 'CmdOrCtrl+Shift+W' }],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin'
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  buildMenu();
  const { onReady, dispose } = registerHandlers(() => mainWindow);
  await onReady();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Quit-time teardown: without this, dispose()s never run — the DB and
  // watcher just die with the process.
  let disposed = false;
  app.on('will-quit', (event) => {
    if (disposed) return;
    event.preventDefault();
    void dispose()
      .catch((err) => console.error('[pm] quit teardown failed:', err))
      .finally(() => {
        disposed = true;
        app.quit();
      });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
