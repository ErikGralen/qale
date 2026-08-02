import { app, shell, BrowserWindow, Menu, session } from 'electron';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { is } from '@electron-toolkit/utils';
import { registerHandlers } from './handlers.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * The PM_* variables are our verification harness: they redirect where app state
 * lives, drive the renderer, and (PM_SCREENSHOT_CLICK's `js:` form) run arbitrary
 * JavaScript inside it. Fine on our own machines, not something to compile into a
 * binary we hand to other people — so a packaged build never reads them at all.
 */
function devEnv(name: string): string | undefined {
  return is.dev ? process.env[name] : undefined;
}

// Dev-only: sandbox all app state (settings, app.db, pi sessions, localStorage)
// into a scratch dir so verification runs never touch the real profile.
const userDataOverride = devEnv('PM_USERDATA');
if (userDataOverride) app.setPath('userData', userDataOverride);

const rendererFile = join(__dirname, '../renderer/index.html');

/**
 * The Vite dev server, or null in a packaged build. Read from what electron-vite
 * sets rather than hardcoded, because the port moves (it was 8400, it is now
 * whatever is free).
 */
function devServer(): { url: URL; http: string; ws: string } | null {
  const raw = devEnv('ELECTRON_RENDERER_URL');
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return {
      url,
      http: url.origin,
      ws: `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`,
    };
  } catch {
    return null;
  }
}

/**
 * The renderer's entire network surface. Everything the app talks to goes over
 * IPC, so production allows nothing external whatsoever; dev additionally allows
 * the Vite server, which is where the page, its modules and HMR come from.
 */
function contentSecurityPolicy(): string {
  const dev = devServer();
  // Vite injects the React Fast Refresh preamble as an inline script, so dev
  // needs 'unsafe-inline' as well as the origin.
  const script = dev ? `'self' 'unsafe-inline' ${dev.http}` : `'self'`;
  const connect = dev ? `'self' ${dev.http} ${dev.ws}` : `'self'`;
  return [
    `default-src 'self'`,
    `script-src ${script}`,
    // Tailwind and the TipTap editor both set styles inline. This one stays.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self' data:`,
    `connect-src ${connect}`,
    `object-src 'none'`,
    `frame-src 'none'`,
    `base-uri 'none'`,
  ].join('; ');
}

/** Schemes a link is allowed to hand to the OS. Anything else — `file:`, and the
 *  custom schemes other installed apps register — can launch things, and the link
 *  may have come out of a note or out of the agent. */
const OPENABLE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

function openExternal(url: string): void {
  let scheme: string;
  try {
    scheme = new URL(url).protocol;
  } catch {
    console.warn('[pm] refused to open a malformed link');
    return;
  }
  if (!OPENABLE_SCHEMES.has(scheme)) {
    console.warn(`[pm] refused to open a "${scheme}" link`);
    return;
  }
  void shell.openExternal(url);
}

/** Is this the app's own page? In dev that is the Vite origin (reloads, HMR); in
 *  a packaged build only the one file we loaded. */
function isAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const dev = devServer();
    if (dev) return parsed.origin === dev.http;
    return parsed.protocol === 'file:' && parsed.pathname === pathToFileURL(rendererFile).pathname;
  } catch {
    return false;
  }
}

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
    const shot = devEnv('PM_SCREENSHOT');
    if (shot) {
      const delay = Number(devEnv('PM_SCREENSHOT_DELAY') ?? 2500);
      setTimeout(async () => {
        try {
          const click = devEnv('PM_SCREENSHOT_CLICK');
          for (const sel of (click ?? '').split('|').filter(Boolean)) {
            // `js:` runs an arbitrary expression in the renderer — the only way
            // to verify a surface whose state comes from typing (the capture
            // dialog's classifier, an editor selection) rather than from clicks.
            const js = sel.startsWith('js:')
              ? `(${sel.slice(3)}), null`
              : sel.startsWith('txt:')
                ? `[...document.querySelectorAll('button,[cmdk-item]')].find(b => b.textContent?.includes(${JSON.stringify(sel.slice(4))}))?.click(), null`
                : `document.querySelector(${JSON.stringify(sel)})?.click(), null`;
            await mainWindow!.webContents.executeJavaScript(js);
            await new Promise((r) => setTimeout(r, 900));
          }
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
    openExternal(details.url);
    return { action: 'deny' };
  });

  // Links in the app are all target="_blank", so this should never fire — but a
  // plain link that did navigate would replace the whole app, state and all, with
  // someone else's page. Send it to the browser instead, through the same check.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  });

  const open = devEnv('PM_OPEN');
  const search = open ? `open=${encodeURIComponent(open)}` : undefined;
  const dev = devServer();
  if (dev) {
    const url = new URL(dev.url);
    if (search) url.search = search;
    void mainWindow.loadURL(url.toString());
  } else {
    void mainWindow.loadFile(rendererFile, search ? { search } : undefined);
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

  // The policy rides in as a response header (it reaches file:// loads too) so
  // that it can differ between dev and a packaged build, which a <meta> tag in
  // the page cannot: whatever the tag says is what ships.
  const csp = contentSecurityPolicy();
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
    });
  });

  const { onReady, dispose } = registerHandlers(() => mainWindow);
  await onReady();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Quit-time teardown: without this, dispose()s never run — the DB and
  // watcher just die with the process.
  //
  // Teardown must never be able to strand the process. Two ways it used to:
  // a second app.quit() from inside a prevented will-quit does NOT restart the
  // quit sequence (the app stayed alive, windowless, sitting in the dock), and
  // a dispose() that hangs would never reach the exit at all. So finish with
  // app.exit(), which is unconditional, and put teardown on a watchdog.
  let disposed = false;
  app.on('will-quit', (event) => {
    if (disposed) return;
    event.preventDefault();
    disposed = true;
    const watchdog = setTimeout(() => {
      console.error('[pm] quit teardown timed out — exiting anyway');
      app.exit(0);
    }, 5000);
    void dispose()
      .catch((err) => console.error('[pm] quit teardown failed:', err))
      .finally(() => {
        clearTimeout(watchdog);
        app.exit(0);
      });
  });
});

app.on('window-all-closed', () => {
  // Staying alive windowless is macOS app behaviour, but a PM_USERDATA run is a
  // throwaway sandboxed launch — outliving its window only litters the dock.
  if (process.platform !== 'darwin' || userDataOverride) app.quit();
});
