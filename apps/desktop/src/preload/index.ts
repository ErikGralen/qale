import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { INVOKE_CHANNELS, PUSH_CHANNELS, type IpcApi, type QaleBridge, type PushEvent } from '@qale/ipc';

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

const bridge: QaleBridge = {
  invoke,
  onEvent(cb: (event: PushEvent) => void) {
    const listener = (_event: IpcRendererEvent, payload: PushEvent) => cb(payload);
    for (const channel of PUSH_CHANNELS) ipcRenderer.on(channel, listener);
    return () => {
      for (const channel of PUSH_CHANNELS) ipcRenderer.removeListener(channel, listener);
    };
  },
  // Reads nothing and grants nothing: it turns a File the renderer was already
  // handed into the path main can open. Anything dragged out of a browser has
  // no path and comes back empty, which the caller reads as "send the bytes".
  pathForFile(file) {
    try {
      return webUtils.getPathForFile(file as unknown as File);
    } catch {
      return '';
    }
  },
};

contextBridge.exposeInMainWorld('qale', bridge);
