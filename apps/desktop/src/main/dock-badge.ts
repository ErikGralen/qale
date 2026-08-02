import { app } from 'electron';

/**
 * The dock badge — one bit: "something is waiting on you". Deliberately not a
 * count: a number on the dock invites triage-by-arithmetic from across the
 * room, and the honest answer to "how much?" lives in the Inbox and the Todos
 * view, where each item can say what it is.
 *
 * macOS only. Windows' equivalent (BrowserWindow.setOverlayIcon) wants a
 * bitmap and Linux's (app.setBadgeCount) can only say a number — neither is
 * the same promise, so neither is faked here.
 */

let shown = false;

export function setDockBadge(on: boolean): void {
  if (process.platform !== 'darwin' || on === shown) return;
  shown = on;
  app.dock?.setBadge(on ? '•' : '');
}
