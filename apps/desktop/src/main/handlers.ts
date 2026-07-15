import { app, BrowserWindow, dialog } from 'electron';
import type { ModelInfoDTO, SettingsDTO } from '@pm/ipc';
import { AgentRuntime } from '@pm/agent';
import {
  acceptProposal,
  createProposal,
  type UseCaseContext,
  captureNote,
  captureMeeting,
  getBacklinks,
  getNote,
  getProblemsByHeat,
  getVaultTree,
  getWorkspaceHealth,
  queryNotes,
  listProposals,
  previewProposal,
  rebuild,
  refreshFolderIndexes,
  rejectProposal,
  resolveLink,
  saveAuthoredNote,
  saveFrontmatter,
  searchNotes,
  setProblemStance,
} from '@pm/application';
import { parseFrontmatter, type Frontmatter } from '@pm/domain';
import { handle, pushEvent } from './ipc.js';
import { SettingsService } from './services/settings-service.js';
import { VaultService } from './services/vault-service.js';
import {
  backlinkToDTO,
  hitToDTO,
  indexedToRefDTO,
  noteToDTO,
  problemHeatToDTO,
  proposalToDTO,
  treeToDTO,
  vaultInfoToDTO,
} from './dto.js';

/** Dev-only: seed an insight card so the Inbox is demoable without an API key. */
function seedDemoProposal(ctx: UseCaseContext): void {
  if (ctx.proposals.pendingCount() > 0) return;
  const meeting = ctx.index.listByType('meeting')[0];
  if (!meeting) return;
  createProposal(ctx, {
    kind: 'note',
    sessionId: 'seed',
    targetPath: 'insights/seed-demo.md',
    baseHash: null,
    payload: {
      path: 'insights/seed-demo.md',
      frontmatter: { type: 'insight', summary: 'Seed insight from the demo meeting', evidence: [`[[${meeting.slug}]]`], confidence: 'med' },
      body: 'A demo insight showing the approval-card flow.\n',
      rationale: 'Demonstrates the Inbox card without a live model.',
    },
    rationale: 'seed',
    evidence: [{ ref: `[[${meeting.slug}]]`, resolved: true }],
    inference: false,
  });
}

// Placeholder model list until the pi ModelRegistry has a live key.
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
  const agent = new AgentRuntime();

  const now = (): string => vaultService.context()?.clock.now() ?? new Date().toISOString();

  const reconfigureAgent = (): void => {
    const ctx = vaultService.context();
    if (!ctx) return;
    const s = settings.get();
    agent.configure({
      vaultDir: ctx.vault.root(),
      userDataDir: app.getPath('userData'),
      modelId: s.modelId,
      apiKey: settings.getAnthropicKey(),
      atlassian: settings.getAtlassian(),
    });
  };

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
    reconfigureAgent();
    return settingsDTO();
  });
  handle('settings:setAnthropicKey', async (key) => {
    await settings.setAnthropicKey(key);
    reconfigureAgent();
    return settingsDTO();
  });
  handle('settings:setAtlassian', async (creds) => {
    await settings.setAtlassian(creds.baseUrl, creds.email, creds.token);
    reconfigureAgent();
    return settingsDTO();
  });
  handle('models:list', () => {
    const live = agent.listModels();
    return live.length > 0 ? live : MODELS;
  });

  handle('vault:pick', async () => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Open a workspace',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const path = result.filePaths[0]!;
    const info = await vaultService.open(path);
    await settings.setVaultPath(info.path);
    reconfigureAgent();
    return vaultInfoToDTO(info);
  });

  handle('vault:open', async (path) => {
    const info = await vaultService.open(path);
    await settings.setVaultPath(info.path);
    reconfigureAgent();
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

  handle('vault:tree', () => treeToDTO(getVaultTree(vaultService.requireContext()), now()));
  handle('vault:rebuildIndex', () => rebuild(vaultService.requireContext()));
  handle('vault:health', () => getWorkspaceHealth(vaultService.requireContext()));
  handle('vault:refreshIndexes', () => refreshFolderIndexes(vaultService.requireContext()));
  handle('vault:query', (query) =>
    queryNotes(vaultService.requireContext(), query).map((n) => indexedToRefDTO(n, now())),
  );

  handle('note:get', async (path) => {
    const note = await getNote(vaultService.requireContext(), path);
    return note ? noteToDTO(note, now()) : null;
  });
  handle('note:save', async (input) => {
    const note = await saveAuthoredNote(vaultService.requireContext(), input.path, input.body);
    return noteToDTO(note, now());
  });
  handle('note:saveFrontmatter', async (input) => {
    const parsed = parseFrontmatter(input.frontmatter);
    if (!parsed.ok || !parsed.data) throw new Error(`invalid frontmatter: ${parsed.error}`);
    const note = await saveFrontmatter(vaultService.requireContext(), input.path, parsed.data as Frontmatter);
    return noteToDTO(note, now());
  });
  handle('note:backlinks', (path) =>
    getBacklinks(vaultService.requireContext(), path).map(backlinkToDTO),
  );
  handle('note:resolveLink', (target) => resolveLink(vaultService.requireContext(), target));
  handle('note:setProblemStance', async (path, stance) => {
    const note = await setProblemStance(vaultService.requireContext(), path, stance);
    return noteToDTO(note, now());
  });

  handle('note:capture', async (input) => {
    const note = await captureNote(vaultService.requireContext(), input);
    return noteToDTO(note, now());
  });
  handle('meeting:capture', async (input) => {
    const note = await captureMeeting(vaultService.requireContext(), input);
    return noteToDTO(note, now());
  });

  handle('search:query', (query, limit) =>
    searchNotes(vaultService.requireContext(), query, limit).map(hitToDTO),
  );

  handle('problems:byHeat', () =>
    getProblemsByHeat(vaultService.requireContext()).map((r) => problemHeatToDTO(r, now())),
  );

  const notifyProposals = (): void => {
    const ctx = vaultService.context();
    if (!ctx) return;
    pushEvent(getWindow(), { channel: 'proposals:changed', pendingCount: ctx.proposals.pendingCount() });
  };

  handle('proposals:list', (status) =>
    listProposals(vaultService.requireContext(), status).map(proposalToDTO),
  );
  handle('proposals:preview', (id) => previewProposal(vaultService.requireContext(), id));
  handle('proposals:accept', async (id, edited) => {
    const result = await acceptProposal(vaultService.requireContext(), id, edited);
    notifyProposals();
    return result;
  });
  handle('proposals:reject', (id) => {
    const result = rejectProposal(vaultService.requireContext(), id);
    notifyProposals();
    return result;
  });
  handle('agent:run', async (input) => {
    const ctx = vaultService.requireContext();
    return agent.run(input, ctx, (streamId, chunk) => {
      pushEvent(getWindow(), { channel: 'agent:event', streamId, chunk });
    });
  });
  handle('agent:abort', (streamId) => agent.abort(streamId));
  handle('sessions:list', () => []);

  return {
    async onReady() {
      await settings.load();
      // Dev affordance: PM_VAULT opens a workspace without the picker.
      const saved = process.env['PM_VAULT'] ?? settings.get().vaultPath;
      if (saved) {
        try {
          const info = await vaultService.open(saved);
          reconfigureAgent();
          console.log(`[pm] opened workspace "${info.name}" — ${info.noteCount} notes, git=${info.git}`);
          if (process.env['PM_SEED_PROPOSAL']) seedDemoProposal(vaultService.requireContext());
        } catch (err) {
          console.error('[pm] failed to open workspace:', err);
        }
      }
    },
  };
}
