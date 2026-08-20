import { app, shell, BrowserWindow, Menu, session } from 'electron';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { electronApp, is } from '@electron-toolkit/utils';
import { registerHandlers } from './handlers.js';
import { installLogCapture } from './log.js';
import type { Telemetry } from './telemetry.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// First thing: a packaged app's console goes to a stderr nobody reads, so tee
// it into the ring buffer that "Copy diagnostics" hands over. Anything logged
// before this call is only ever on stderr.
installLogCapture();

/**
 * The QALE_* variables are our verification harness: they redirect where app state
 * lives, drive the renderer, and (QALE_SCREENSHOT_CLICK's `js:` form) run arbitrary
 * JavaScript inside it. Fine on our own machines, not something to compile into a
 * binary we hand to other people — so a packaged build never reads them at all.
 */
function devEnv(name: string): string | undefined {
  return is.dev ? process.env[name] : undefined;
}

/**
 * A dev run and the installed app share a codebase, but they are not the same
 * product: dev opens the demo workspace and gets torn down constantly, the
 * installed app holds the notes you actually keep. Electron would give them one
 * identity — the same `~/Library/Application Support/Qale`, so the same
 * settings.json, the same "which workspace is open", the same session receipts,
 * and the same keychain item — and they would keep overwriting each other.
 *
 * Naming the dev build separately splits all of that in one move, because the
 * userData directory is derived from the app name (and on macOS so is the
 * keychain item safeStorage encrypts against; on Windows DPAPI has no named
 * item, but the settings file holding the encrypted values is already split by
 * the same move). It also puts "Qale Dev" in the menu bar, so it is obvious
 * which one you are looking at. The packaged app never takes this branch.
 */
if (is.dev) app.setName('Qale Dev');

/**
 * The other half of the app's identity, and the Windows-only half: a toast on
 * Windows does not belong to the process that raised it, it belongs to an "app
 * user model id". The shell looks that id up against the shortcut the installer
 * wrote and takes the name and icon on the notification from there. Unset, the
 * two `new Notification(...)` calls in handlers.ts (a background session that
 * failed, a session that finished while the window was in the background) come
 * out attributed to whatever the shell guesses, which is a toast with the wrong
 * name on it or, on a clean Windows install, no toast at all.
 *
 * The literal has to stay character-for-character the electron-builder `appId`
 * in electron-builder.yml (`ai.qale.app`), because that is the id the installer
 * registers. If either one ever moves, the other has to move with it, and the
 * symptom of forgetting is silent: notifications simply stop arriving.
 *
 * The dev/prod split here is the toolkit helper's, and it is the split we want:
 * in a dev run it sets `process.execPath` instead, so the run identifies as the
 * electron binary it actually is. That keeps the same line drawn as `setName`
 * above: a dev run gets its own toast history and its own grouping in the
 * action centre, and can never post a notification that looks like it came from
 * the installed app holding your real notes. It is a no-op off Windows, which
 * is why it sits outside the platform branches rather than inside one.
 */
electronApp.setAppUserModelId('ai.qale.app');

// Dev-only: sandbox all app state (settings, app.db, pi sessions, localStorage)
// into a scratch dir so verification runs never touch the real profile. Layered
// on top of the name above: this is the per-run scratch, that is the standing
// dev profile.
const userDataOverride = devEnv('QALE_USERDATA');
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
    console.warn('[qale] refused to open a malformed link');
    return;
  }
  if (!OPENABLE_SCHEMES.has(scheme)) {
    console.warn(`[qale] refused to open a "${scheme}" link`);
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

/**
 * Windows' caption strip, painted in the app's own colours.
 *
 * The app draws its own header (the tab strip), so on Windows the OS title bar
 * is a second one: `titleBarStyle: 'default'` there gives you a grey system bar
 * with the window title in it and the app's tab strip immediately underneath,
 * two headers stacked, forty wasted pixels. `'hidden'` plus this overlay is the
 * single-header version: the frame goes away, Windows keeps drawing the
 * minimise/maximise/close buttons itself over the top-right corner of the page,
 * and TabStrip.tsx holds a lane of exactly that width open on the right so none
 * of the app's own buttons end up underneath them. Nothing here touches macOS,
 * which stays on `hiddenInset` and its traffic lights.
 *
 * The colours are the LIGHT theme's chrome, hardcoded: `color` is --sidebar,
 * which is what the tab strip is painted with, and `symbolColor` is
 * --muted-foreground, which is what the toolbar icons sitting next to those
 * buttons are drawn in. Hardcoded because the main process has no way to know
 * which theme is on: the choice lives in the renderer's localStorage under
 * `qale-theme`, it defaults to light, and no IPC carries it over. Inventing a
 * channel for three pixels of chrome is not worth it, so the failure mode is
 * accepted and named instead: someone who switches to the dark theme gets a
 * pale patch behind the three caption buttons. If a theme signal ever does
 * reach main, the fix is one line at the receiving end,
 * `mainWindow.setTitleBarOverlay(...)` with the dark equivalents.
 *
 * `height` is the tab strip's own height (h-10, 40px), so the buttons line up
 * with the row they sit in rather than with a taller default bar.
 */
const WINDOWS_TITLE_BAR_OVERLAY = { color: '#f1f3f6', symbolColor: '#666b71', height: 40 };

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle:
      process.platform === 'darwin'
        ? 'hiddenInset'
        : process.platform === 'win32'
          ? 'hidden'
          : 'default',
    ...(process.platform === 'win32' ? { titleBarOverlay: WINDOWS_TITLE_BAR_OVERLAY } : {}),
    // Matches --background (light steel paper) so the first paint doesn't flash white.
    backgroundColor: '#f9fafc',
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
    const shot = devEnv('QALE_SCREENSHOT');
    if (shot) {
      const delay = Number(devEnv('QALE_SCREENSHOT_DELAY') ?? 2500);
      setTimeout(async () => {
        try {
          const click = devEnv('QALE_SCREENSHOT_CLICK');
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
          console.log(`[qale] screenshot → ${shot}`);
        } catch (err) {
          console.error('[qale] screenshot failed', err);
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

  const open = devEnv('QALE_OPEN');
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

/**
 * The four ways this app dies, reported as one event (docs/telemetry-posthog.md
 * TEL-5). None of them existed before: an unhandled throw in main took the app
 * with it silently, and a renderer that died left a white window and no trace.
 *
 * Installed before `onReady`, because the riskiest minute is the one where the
 * workspace is being opened. The sender holds anything raised before the
 * consent switch has been read, so an early crash is not lost to the ordering
 * and is still dropped for good if the answer turns out to be no.
 *
 * Nothing here changes what the app does when it dies. `uncaughtException`
 * deliberately does NOT swallow the error: Electron's default is to log and
 * carry on, and a telemetry hook is not the place to change that policy.
 */
function installCrashReporting(telemetry: Telemetry): void {
  process.on('uncaughtException', (err) => {
    telemetry.crash('main', err);
    console.error('[qale] uncaught exception:', err);
  });
  process.on('unhandledRejection', (reason) => {
    telemetry.crash('promise', reason);
    console.error('[qale] unhandled rejection:', reason);
  });
  app.on('render-process-gone', (_event, _contents, details) => {
    // `details.reason` is one of Chromium's words ('crashed', 'oom', ...), not
    // anything the PM wrote, so it is safe as the message. There is no stack to
    // be had on this path.
    telemetry.crash('renderer', new Error(`renderer ${details.reason} (exit ${details.exitCode})`));
    console.error('[qale] renderer gone:', details.reason);
  });
  app.on('child-process-gone', (_event, details) => {
    telemetry.crash('child', new Error(`${details.type} ${details.reason}`));
    console.error('[qale] child process gone:', details.type, details.reason);
  });
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

  const { onReady, dispose, telemetry } = registerHandlers(() => mainWindow);
  installCrashReporting(telemetry);
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
      console.error('[qale] quit teardown timed out — exiting anyway');
      app.exit(0);
    }, 5000);
    void dispose()
      .catch((err) => console.error('[qale] quit teardown failed:', err))
      .finally(() => {
        clearTimeout(watchdog);
        app.exit(0);
      });
  });
});

app.on('window-all-closed', () => {
  // Staying alive windowless is macOS app behaviour, but a QALE_USERDATA run is a
  // throwaway sandboxed launch — outliving its window only litters the dock.
  if (process.platform !== 'darwin' || userDataOverride) app.quit();
});
