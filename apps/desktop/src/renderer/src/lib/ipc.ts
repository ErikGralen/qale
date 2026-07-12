import type { PmBridge } from '@pm/ipc';

/**
 * The renderer's single door to main. Everything the UI does crosses here as a
 * typed IPC call — no fs, no sqlite, no secrets in the renderer (PLAN §3.2).
 */
export const pm: PmBridge = window.pm;

export const invoke = pm.invoke;
export const onEvent = pm.onEvent;
