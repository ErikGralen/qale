import type { QaleBridge } from '@qale/ipc';

declare global {
  interface Window {
    qale: QaleBridge;
  }
}

export {};
