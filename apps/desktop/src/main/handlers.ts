import { BrowserWindow, dialog } from 'electron';
import type { ModelInfoDTO, SettingsDTO } from '@pm/ipc';
import {
  captureSignal,
  getBacklinks,
  getNote,
  getVaultTree,
  rebuild,
  resolveLink,
  saveAuthoredNote,
  searchNotes,
  setThemeStance,
} from '@pm/application';
import { handle, pushEvent } from './ipc.js';
import { SettingsService } from './services/settings-service.js';
import { VaultService } from './services/vault-service.js';
import { backlinkToDTO, hitToDTO, noteToDTO, treeToDTO, vaultInfoToDTO } from './dto.js';

// Placeholder model list until the pi ModelRegistry lands in Phase 2.
const MODELS: ModelInfoDTO[] = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
];

export function registerHandlers(getWindow: () => BrowserWindow | null): { onReady: () => Promise<void> } {
  const settings = new SettingsService();
  const vaultService = new VaultService((paths) => {
    pushEvent(getWindow(), { channel: 'vault:changed', paths });
  });

  const settingsDTO = (): SettingsDTO => {
    const s = settings.get();
    return {
      vaultPath: vaultService.currentVaultPath() ?? s.vaultPath,
      modelId: s.modelId,
      hasAnthropicKey: !!settings.getAnthropicKey(),
      hasAtlassianCreds: !!settings.getAtlassian(),
    };
  };

  handle('app:ping', (message) => `pong: ${message}`);

  handle('settings:get', () => settingsDTO());
  handle('settings:setModel', async (modelId) => {
    await settings.setModel(modelId);
    return settingsDTO();
  });
  handle('settings:setAnthropicKey', async (key) => {
    await settings.setAnthropicKey(key);
    return settingsDTO();
  });
  handle('settings:setAtlassian', async (creds) => {
    await settings.setAtlassian(creds.baseUrl, creds.email, creds.token);
    return settingsDTO();
  });
  handle('models:list', () => MODELS);

  handle('vault:pick', async () => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Open a vault',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const path = result.filePaths[0]!;
    const info = await vaultService.open(path);
    await settings.setVaultPath(info.path);
    return vaultInfoToDTO(info);
  });

  handle('vault:open', async (path) => {
    const info = await vaultService.open(path);
    await settings.setVaultPath(info.path);
    return vaultInfoToDTO(info);
  });

  handle('vault:current', async () => {
    if (vaultService.context()) {
      const ctx = vaultService.requireContext();
      return vaultInfoToDTO({
        path: ctx.vault.root(),
        name: ctx.vault.root().split('/').filter(Boolean).pop() ?? ctx.vault.root(),
        git: (await ctx.git.available()) && (await ctx.git.isRepo()),
        noteCount: ctx.index.count(),
      });
    }
    return null;
  });

  handle('vault:tree', () => treeToDTO(getVaultTree(vaultService.requireContext())));
  handle('vault:rebuildIndex', () => rebuild(vaultService.requireContext()));

  handle('note:get', async (path) => {
    const note = await getNote(vaultService.requireContext(), path);
    return note ? noteToDTO(note) : null;
  });
  handle('note:save', async (input) => {
    const note = await saveAuthoredNote(vaultService.requireContext(), input.path, input.body);
    return noteToDTO(note);
  });
  handle('note:backlinks', (path) =>
    getBacklinks(vaultService.requireContext(), path).map(backlinkToDTO),
  );
  handle('note:resolveLink', (target) => resolveLink(vaultService.requireContext(), target));
  handle('note:setThemeStance', async (path, stance) => {
    const note = await setThemeStance(vaultService.requireContext(), path, stance);
    return noteToDTO(note);
  });

  handle('signal:capture', async (input) => {
    const note = await captureSignal(vaultService.requireContext(), input);
    return noteToDTO(note);
  });

  handle('search:query', (query, limit) =>
    searchNotes(vaultService.requireContext(), query, limit).map(hitToDTO),
  );

  // --- Not yet implemented (later phases) ---
  handle('proposals:list', () => []);
  handle('proposals:accept', () => ({ ok: false }));
  handle('proposals:reject', () => ({ ok: false }));
  handle('agent:run', () => {
    throw new Error('agent runtime lands in Phase 2');
  });
  handle('agent:abort', () => undefined);
  handle('sessions:list', () => []);

  return {
    async onReady() {
      await settings.load();
      // Dev affordance: PM_VAULT opens a vault without the picker.
      const saved = process.env['PM_VAULT'] ?? settings.get().vaultPath;
      if (saved) {
        try {
          const info = await vaultService.open(saved);
          console.log(`[pm] opened vault "${info.name}" — ${info.noteCount} notes, git=${info.git}`);
        } catch (err) {
          console.error('[pm] failed to open vault:', err);
        }
      }
    },
  };
}
