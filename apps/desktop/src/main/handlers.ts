import type { BrowserWindow } from 'electron';
import type { SettingsDTO } from '@pm/ipc';
import { handle } from './ipc.js';

/**
 * Registers every IPC handler. Phase 0 wires the walking-skeleton subset
 * (ping + read-only settings/vault stubs). Later phases replace the stubs with
 * real use-case calls from the DI container.
 */
export function registerHandlers(_getWindow: () => BrowserWindow | null): void {
  handle('app:ping', (message) => `pong: ${message} @ ${new Date().toISOString()}`);

  const settings: SettingsDTO = {
    vaultPath: null,
    modelId: 'claude-opus-4-8',
    hasAnthropicKey: false,
    hasAtlassianCreds: false,
  };

  handle('settings:get', () => settings);
  handle('vault:current', () => null);
  handle('sessions:list', () => []);
}
