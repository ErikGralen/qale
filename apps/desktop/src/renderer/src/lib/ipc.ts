import type { PmBridge } from '@pm/ipc';

/**
 * The renderer's single door to main. Everything the UI does crosses here as a
 * typed IPC call — no fs, no sqlite, no secrets in the renderer (PLAN §3.2).
 */
// Guarded so the module can be imported in a Node test env (no `window`) —
// in the real renderer the preload bridge is always present.
export const pm: PmBridge = (typeof window !== 'undefined' ? window.pm : undefined) as PmBridge;

// `invoke` is the channel-keyed call map, not a function — hand through the
// bridge's own (or an empty stand-in for tests, where nothing is called).
export const invoke: PmBridge['invoke'] = pm ? pm.invoke : ({} as PmBridge['invoke']);
export const onEvent: PmBridge['onEvent'] = (cb) => (pm ? pm.onEvent(cb) : () => undefined);
