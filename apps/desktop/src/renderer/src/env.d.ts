/// <reference types="vite/client" />
import type { PmBridge } from '@pm/ipc';

declare global {
  interface Window {
    pm: PmBridge;
  }
}

export {};
