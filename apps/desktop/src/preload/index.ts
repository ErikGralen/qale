import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { INVOKE_CHANNELS, type IpcApi, type PmBridge, type PushEvent } from '@pm/ipc';

/**
 * Build concrete per-channel invoke functions from the contract's channel list.
 * There is no generic `invoke(channel, …)` passthrough — the renderer can only
 * call channels that exist in {@link INVOKE_CHANNELS}, closing the any-channel
 * hole (PLAN §3.2). `IpcRendererEvent` never leaks to the renderer.
 */
const invoke = Object.fromEntries(
  INVOKE_CHANNELS.map((channel) => [
    channel,
    (...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  ]),
) as unknown as IpcApi;

const PUSH_CHANNELS = ['agent:event', 'vault:changed', 'proposals:changed'] as const;

const bridge: PmBridge = {
  invoke,
  onEvent(cb: (event: PushEvent) => void) {
    const listener = (_event: IpcRendererEvent, payload: PushEvent) => cb(payload);
    for (const channel of PUSH_CHANNELS) ipcRenderer.on(channel, listener);
    return () => {
      for (const channel of PUSH_CHANNELS) ipcRenderer.removeListener(channel, listener);
    };
  },
};

contextBridge.exposeInMainWorld('pm', bridge);
