import { app, BrowserWindow, nativeImage } from 'electron';

/**
 * The dock badge — one bit: "something is waiting on you". Deliberately not a
 * count: a number on the dock invites triage-by-arithmetic from across the
 * room, and the honest answer to "how much?" lives in the Inbox and the Todos
 * view, where each item can say what it is.
 *
 * macOS and Windows say that bit in very different ways. macOS takes a string
 * and draws the red pill itself. Windows has nothing like it: `setOverlayIcon`
 * takes a bitmap, which the shell composites onto the bottom-right corner of
 * the taskbar icon, so the badge has to be drawn rather than described, and it
 * hangs off a window rather than off the app. Linux is still out: its
 * `app.setBadgeCount` can only say a number, and a number is the one thing this
 * badge refuses to say.
 */

/**
 * The Windows badge: a 16×16 ink-blue dot with a white ring around it, inlined
 * as a data URL rather than shipped as a file.
 *
 * The ring is not decoration. The taskbar is whatever colour the wallpaper and
 * the theme make it, so a bare dot can land on top of something almost exactly
 * its own tone and vanish; the ring gives it an edge on both a light and a dark
 * taskbar.
 *
 * Inline because a PNG under `resources/` would have to survive two hops to
 * reach a packaged app: electron.vite would have to copy it into `out/`, and
 * electron-builder only ships what is under `out/`. The failure is silent when
 * either hop is missed. The badge would work all through development and
 * quietly stop in the installed build, the one place nobody watches. 215 bytes
 * of base64 inside the bundled main process cannot be lost that way. Drawn once
 * offline (a filled circle, 4× supersampled for smooth edges) in --sidebar-
 * primary ink blue on transparent.
 */
const BADGE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAnklEQVR42mP4//8/Axp2AOL5QLz/PwTsh/IdsKhlQOYIIGn6f+HKAzhGAvuh6jAMAAmeB6lYtPLg/4DYrv8uQU1wDOKDxKHgPLIhMAPANndN3oiiER2D5JFcAjfAAWYzPs0wjOQSB5gBoADCcDYuDFIHBfNhBuwHBRQxmmEYGrD7YQb8J9OA/1RzAcVhQHEsUJwOqJISKc4LVMmNZGEA+cXfcVBITkQAAAAASUVORK5CYII=';

/** Read by a screen reader in place of the image, so the badge is not silent. */
const BADGE_DESCRIPTION = 'Something is waiting on you';

/** Decoded once and kept: `setOverlayIcon` runs on every badge change. */
let badgeImage: Electron.NativeImage | null = null;
function badge(): Electron.NativeImage {
  badgeImage ??= nativeImage.createFromDataURL(BADGE_PNG);
  return badgeImage;
}

let shown = false;

/** Push the current bit at one window. Windows only; safe to call repeatedly. */
function paintOverlay(win: BrowserWindow | null | undefined): void {
  if (!win || win.isDestroyed()) return;
  win.setOverlayIcon(shown ? badge() : null, shown ? BADGE_DESCRIPTION : '');
}

/**
 * The badge is computed while the workspace opens, and that happens BEFORE the
 * window exists: main awaits `onReady()` and only then calls `createWindow()`.
 * On macOS that ordering does not matter, because the badge belongs to the app;
 * on Windows it belongs to a window, so a launch that lands straight into "you
 * have three cards waiting" would set the overlay on nothing and then sit there
 * bare until the next time the count happened to change. Repainting whenever a
 * window appears closes that, and covers the reopened-window case too.
 */
if (process.platform === 'win32') {
  app.on('browser-window-created', (_event, win) => paintOverlay(win));
}

export function setDockBadge(on: boolean): void {
  if (on === shown) return;
  shown = on;
  if (process.platform === 'darwin') app.dock?.setBadge(on ? '•' : '');
  else if (process.platform === 'win32') paintOverlay(BrowserWindow.getAllWindows()[0]);
}
