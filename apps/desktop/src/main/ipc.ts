import { ipcMain, type BrowserWindow } from 'electron';
import type { InvokeChannel, InvokeMap, PushEvent } from '@qale/ipc';

/**
 * Typed wrapper over `ipcMain.handle`. Each handler is checked against the
 * {@link InvokeMap} entry for its channel, so a mismatch between the contract and
 * the implementation is a compile error rather than a runtime surprise.
 *
 * Also the one place every handler's errors pass through: most handlers don't
 * catch their own throws, so without this the channel name is lost by the time
 * the rejection reaches the renderer. The error itself is rethrown unchanged —
 * this only adds a log line naming which channel failed.
 */
export function handle<K extends InvokeChannel>(
  channel: K,
  fn: (...args: InvokeMap[K]['args']) => InvokeMap[K]['result'] | Promise<InvokeMap[K]['result']>,
): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...(args as InvokeMap[K]['args']));
    } catch (err) {
      console.error(`[qale] ipc ${channel} failed:`, err instanceof Error ? err.message : err);
      throw err;
    }
  });
}

/** Push a structured-clone-safe event to a renderer window. */
export function pushEvent(window: BrowserWindow | null, event: PushEvent): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(event.channel, event);
  }
}
