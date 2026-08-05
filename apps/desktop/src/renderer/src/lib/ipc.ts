import type { QaleBridge } from '@qale/ipc';

/**
 * The renderer's single door to main. Everything the UI does crosses here as a
 * typed IPC call — no fs, no sqlite, no secrets in the renderer (PLAN §3.2).
 */
// Guarded so the module can be imported in a Node test env (no `window`) —
// in the real renderer the preload bridge is always present.
export const bridge: QaleBridge = (typeof window !== 'undefined' ? window.qale : undefined) as QaleBridge;

// `invoke` is the channel-keyed call map, not a function — hand through the
// bridge's own (or an empty stand-in for tests, where nothing is called).
export const invoke: QaleBridge['invoke'] = bridge ? bridge.invoke : ({} as QaleBridge['invoke']);
export const onEvent: QaleBridge['onEvent'] = (cb) => (bridge ? bridge.onEvent(cb) : () => undefined);

/**
 * Where a dropped file lives on disk, or "" when it came from a web page and
 * has no path. Main reads it from there, which is the only way a dropped FOLDER
 * works at all: the renderer can only see one as an unreadable zero-byte file.
 */
export const pathForFile: QaleBridge['pathForFile'] = (file) =>
  bridge ? bridge.pathForFile(file) : '';
