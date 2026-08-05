import { ipcMain, type BrowserWindow } from 'electron';
import type { InvokeChannel, InvokeMap, PushEvent } from '@qale/ipc';

/**
 * Typed wrapper over `ipcMain.handle`. Each handler is checked against the
 * {@link InvokeMap} entry for its channel, so a mismatch between the contract and
 * the implementation is a compile error rather than a runtime surprise.
 */
export function handle<K extends InvokeChannel>(
  channel: K,
  fn: (...args: InvokeMap[K]['args']) => InvokeMap[K]['result'] | Promise<InvokeMap[K]['result']>,
): void {
  ipcMain.handle(channel, (_event, ...args) => fn(...(args as InvokeMap[K]['args'])));
}

/** Push a structured-clone-safe event to a renderer window. */
export function pushEvent(window: BrowserWindow | null, event: PushEvent): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(event.channel, event);
  }
}
