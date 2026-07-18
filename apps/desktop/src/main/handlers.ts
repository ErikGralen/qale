import { app, BrowserWindow, dialog, Notification } from 'electron';
import type { AgentRunInput, ModelInfoDTO, SettingsDTO } from '@pm/ipc';
import { AgentRuntime } from '@pm/agent';
import {
  acceptProposal,
  completeMeetingReview,
  captureNote,
  captureTodo,
  deleteNote,
  ensureDefaultSkills,
  getBacklinks,
  getNote,
  getProblemsByHeat,
  getMaintenanceReport,
  getProposalStats,
  getVaultTree,
  listSkills,
  skillsForEvent,
  queryNotes,
  runLibrarianSweep,
  listPings,
  openPing,
  dismissPing,
  resolvePingItem,
  listProposals,
  previewProposal,
  rebuild,
  rejectProposal,
  ingestCapture,
  renameNote,
  resolveLink,
  saveGoldenAnswer,
  saveAuthoredNote,
  saveFrontmatter,
  searchNotes,
  setTodoStatus,
} from '@pm/application';
import { classifyCapture, parseFrontmatter, type Frontmatter } from '@pm/domain';
import { DEFAULT_SKILLS } from '@pm/sessions';
import { handle, pushEvent } from './ipc.js';
import { seedDemoProposal } from './dev-seed.js';
import { SettingsService } from './services/settings-service.js';
import { VaultService } from './services/vault-service.js';
import { makeOutbound } from './services/outbound-service.js';
import { SchedulerService } from './services/scheduler-service.js';
import { McpService } from './services/mcp-service.js';
import {
  backlinkToDTO,
  hitToDTO,
  indexedToRefDTO,
  noteToDTO,
  pingToDTO,
  problemHeatToDTO,
  proposalToDTO,
  skillToDTO,
  treeToDTO,
  vaultInfoToDTO,
} from './dto.js';

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

  const afterOpen = async (): Promise<void> => {
    const ctx = vaultService.context();
    if (!ctx) return;
    await ensureDefaultSkills(ctx, DEFAULT_SKILLS);
    // App-open cron (PLAN-V2 §3.5): let the librarian work ahead on launch —
    // prepared link fixes land as approval cards, judgment calls as pings.
    await runLibrarianSweep(ctx);
    notifyPings();
    notifyProposalsFor();
  };

  const reconfigureAgent = (): void => {
    const ctx = vaultService.context();
    if (!ctx) return;
    const s = settings.get();
    // The card-application layer writes outbound only when Atlassian is configured.
    ctx.outbound = makeOutbound(settings.getAtlassian());
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
      schedules: s.schedules,
      mcp: { enabled: s.mcpEnabled, port: s.mcpPort, token: s.mcpToken, running: mcp.isRunning() },
    };
  };

  const notifyProposalsFor = (): void => {
    const ctx = vaultService.context();
    if (ctx) pushEvent(getWindow(), { channel: 'proposals:changed', pendingCount: ctx.proposals.pendingCount() });
  };

  const notifyPings = (): void => {
    const ctx = vaultService.context();
    if (ctx?.pings) pushEvent(getWindow(), { channel: 'pings:changed', pendingCount: ctx.pings.pendingCount() });
  };

  const SESSION_LABEL: Record<string, string> = {
    chat: 'Chat',
    ask: 'Ask',
    'after-meeting': 'After-Meeting',
    'before-meeting': 'Before-Meeting',
    'external-transcript': 'External transcript',
    intake: 'Intake',
    'weekly-update': 'Weekly update',
    'sprint-review': 'Sprint review',
    librarian: 'Librarian',
  };
  const sessionLabel = (type: string): string => SESSION_LABEL[type] ?? type.replace(/-/g, ' ');

  const fireSession = async (sessionType: string, prompt: string): Promise<void> => {
    const ctx = vaultService.context();
    if (!ctx) return;
    try {
      // Proposal/badge refreshes ride on the session:status settle push (agent.onStatus).
      await agent.run({ sessionType: sessionType as AgentRunInput['sessionType'], prompt }, ctx, () => {});
    } catch (err) {
      // Every caller is fire-and-forget (`void fireSession(...)`): a run that
      // dies here — most often "no API key yet" — must surface, not become an
      // unhandled rejection while the PO waits for cards that never come.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[pm] background ${sessionType} session failed:`, message);
      if (Notification.isSupported()) {
        new Notification({ title: `${sessionLabel(sessionType)} failed`, body: message, silent: true }).show();
      }
    }
  };

  // Session lifecycle → renderer rail/badges, plus an OS notification when a
  // background run finishes while the PO is elsewhere (nothing silent).
  agent.onStatus = (s) => {
    const ctx = vaultService.context();
    const pendingCards = ctx
      ? ctx.proposals.list('pending').filter((p) => p.sessionId === s.sessionId).length
      : 0;
    pushEvent(getWindow(), { channel: 'session:status', ...s, pendingCards });
    if (s.status !== 'settled') return;
    notifyProposalsFor();
    const win = getWindow();
    if ((win && win.isFocused()) || !Notification.isSupported()) return;
    const notification = new Notification({
      title: `${sessionLabel(s.sessionType)} ready`,
      body: pendingCards > 0 ? `${pendingCards} proposal${pendingCards === 1 ? '' : 's'} to review` : s.title,
      silent: true,
    });
    notification.on('click', () => {
      const w = getWindow();
      if (w) {
        if (w.isMinimized()) w.restore();
        w.show();
        w.focus();
      }
      pushEvent(getWindow(), {
        channel: 'session:focus',
        sessionId: s.sessionId,
        sessionType: s.sessionType,
        title: s.title,
      });
    });
    notification.show();
  };

  const scheduler = new SchedulerService(
    () => vaultService.context(),
    settings,
    fireSession,
    notifyProposalsFor,
    () => {
      const ctx = vaultService.context();
      if (!ctx) return;
      void runLibrarianSweep(ctx).then(({ pings, fixes }) => {
        if (pings > 0) notifyPings();
        if (fixes > 0) notifyProposalsFor();
      });
    },
  );

  const mcp = new McpService(
    () => vaultService.context(),
    () => settings.get().mcpToken,
    notifyProposalsFor,
  );

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
  handle('settings:setSchedule', async (sessionType, patch) => {
    await settings.setSchedule(sessionType, patch);
    return settingsDTO();
  });
  handle('skills:list', async () => {
    const summaries = await listSkills(vaultService.requireContext());
    return summaries.map(skillToDTO);
  });
  handle('schedule:runNow', async (sessionType) => {
    await scheduler.runNow(sessionType);
    return { ok: true };
  });
  handle('settings:setMcp', async (patch) => {
    await settings.setMcp(patch);
    const s = settings.get();
    if (s.mcpEnabled) await mcp.restart(s.mcpPort);
    else await mcp.stop();
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
    await afterOpen();
    reconfigureAgent();
    return vaultInfoToDTO(info);
  });

  handle('vault:open', async (path) => {
    const info = await vaultService.open(path);
    await settings.setVaultPath(info.path);
    await afterOpen();
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

  handle('vault:tree', () => treeToDTO(getVaultTree(vaultService.requireContext())));
  handle('vault:rebuildIndex', () => rebuild(vaultService.requireContext()));
  handle('vault:query', (query) =>
    queryNotes(vaultService.requireContext(), query).map((n) => indexedToRefDTO(n)),
  );

  handle('note:get', async (path) => {
    const note = await getNote(vaultService.requireContext(), path);
    return note ? noteToDTO(note) : null;
  });
  handle('note:save', async (input) => {
    const note = await saveAuthoredNote(vaultService.requireContext(), input.path, input.body);
    return noteToDTO(note);
  });
  handle('note:saveFrontmatter', async (input) => {
    const parsed = parseFrontmatter(input.frontmatter);
    if (!parsed.ok || !parsed.data) throw new Error(`invalid frontmatter: ${parsed.error}`);
    const note = await saveFrontmatter(vaultService.requireContext(), input.path, parsed.data as Frontmatter);
    return noteToDTO(note);
  });
  handle('note:rename', async (input) => {
    const note = await renameNote(vaultService.requireContext(), input);
    return noteToDTO(note);
  });
  handle('note:delete', async (path) => {
    await deleteNote(vaultService.requireContext(), path);
    return { ok: true };
  });
  handle('note:backlinks', (path) =>
    getBacklinks(vaultService.requireContext(), path).map(backlinkToDTO),
  );
  handle('note:resolveLink', (target) => resolveLink(vaultService.requireContext(), target));

  handle('todos:capture', async (input) => {
    const note = await captureTodo(vaultService.requireContext(), input);
    return noteToDTO(note);
  });
  handle('todos:setStatus', async (path, status) => {
    const note = await setTodoStatus(vaultService.requireContext(), path, status);
    return noteToDTO(note);
  });

  handle('note:capture', async (input) => {
    const note = await captureNote(vaultService.requireContext(), input);
    return noteToDTO(note);
  });
  handle('capture:classify', (text, fileName) => classifyCapture(text, fileName));
  handle('capture:ingest', async (input) => {
    const { note, kind, followUp, extras } = await ingestCapture(vaultService.requireContext(), {
      ...input,
      attachment: input.attachment
        ? { name: input.attachment.name, data: Buffer.from(input.attachment.dataBase64, 'base64') }
        : undefined,
    });
    // Any further skills bound to the same capture event run headlessly alongside.
    for (const extra of extras ?? []) void fireSession(extra.sessionType, extra.prompt);
    // After-Meeting / External-Transcript run headlessly the moment the capture
    // lands — the gate is the review, not the run. The PO's first touch is the
    // cards in the Inbox (session:status settle pushes the badge + notification).
    if (followUp?.background) {
      void fireSession(followUp.sessionType, followUp.prompt);
      return {
        note: noteToDTO(note),
        kind,
        processing: { sessionType: followUp.sessionType, label: followUp.tabTitle },
      };
    }
    return { note: noteToDTO(note), kind, followUp };
  });

  handle('search:query', (query, limit) =>
    searchNotes(vaultService.requireContext(), query, limit).map(hitToDTO),
  );

  handle('problems:byHeat', () =>
    getProblemsByHeat(vaultService.requireContext()).map((r) => problemHeatToDTO(r)),
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
  // Resolving the last card of an after-meeting session closes the review:
  // the meeting flips new → processed. Best-effort — never blocks the resolve.
  const afterCardResolved = async (id: string): Promise<void> => {
    const ctx = vaultService.context();
    const rec = ctx?.proposals.get(id);
    if (!ctx || !rec) return;
    await completeMeetingReview(ctx, rec.sessionId).catch(() => {});
  };
  // Triggered reactions (Skills v2): approving a decision card that supersedes an
  // earlier one fires any skill bound to `decision.superseded` (e.g. a
  // supersede-sweep reaction). Depth-1 loop guard: the reaction's own writes never
  // re-trigger. Best-effort — never blocks the accept.
  const fireSupersedeReactions = async (id: string): Promise<void> => {
    const ctx = vaultService.context();
    const rec = ctx?.proposals.get(id);
    if (!ctx || !rec || rec.kind !== 'decision') return;
    const supersedes = (rec.payload as { supersedes?: string })?.supersedes;
    if (!supersedes) return;
    const skills = await skillsForEvent(ctx, 'decision.superseded', { target: supersedes });
    for (const s of skills) {
      void fireSession(
        s.sessionType,
        `A decision was just superseded (${supersedes}). Sweep the memory for notes, insights, and hubs that cite the old decision and propose updates to point at the new head, as approval cards.`,
      );
    }
  };
  handle('proposals:accept', async (id, edited) => {
    const result = await acceptProposal(vaultService.requireContext(), id, edited);
    if (result.ok) await fireSupersedeReactions(id).catch(() => {});
    await afterCardResolved(id);
    notifyProposals();
    return result;
  });
  handle('proposals:reject', async (id) => {
    const result = rejectProposal(vaultService.requireContext(), id);
    await afterCardResolved(id);
    notifyProposals();
    return result;
  });
  handle('proposals:stats', () => getProposalStats(vaultService.requireContext()));
  handle('librarian:report', () => getMaintenanceReport(vaultService.requireContext()));
  handle('golden:save', (input) => {
    const rec = saveGoldenAnswer(vaultService.requireContext(), input);
    notifyProposals();
    return proposalToDTO(rec);
  });
  handle('agent:run', async (input) => {
    const ctx = vaultService.requireContext();
    return agent.run(input, ctx, (streamId, chunk) => {
      pushEvent(getWindow(), { channel: 'agent:event', streamId, chunk });
    });
  });
  handle('agent:abort', (streamId) => agent.abort(streamId));

  handle('chats:list', () => agent.listChats());
  handle('chats:history', (sessionId) => ({ id: sessionId, messages: agent.chatHistory(sessionId) }));
  handle('chats:delete', async (sessionId) => {
    await agent.deleteChat(sessionId);
    return { ok: true };
  });
  handle('chats:setLifecycle', (sessionId, lifecycle) => {
    agent.setLifecycle(sessionId, lifecycle);
    return { ok: true };
  });
  handle('sessions:live', () => agent.listLive());

  handle('pings:list', () => listPings(vaultService.requireContext()).map(pingToDTO));
  handle('pings:open', (id) => {
    const rec = openPing(vaultService.requireContext(), id);
    notifyPings();
    return rec ? pingToDTO(rec) : null;
  });
  handle('pings:dismiss', (id) => {
    dismissPing(vaultService.requireContext(), id);
    notifyPings();
    return { ok: true };
  });
  handle('pings:resolveItem', async (pingId, itemId, action) => {
    const rec = await resolvePingItem(vaultService.requireContext(), pingId, itemId, action);
    notifyPings();
    return rec ? pingToDTO(rec) : null;
  });

  // Chats that touched this note: session receipts link reads/writes as
  // wikilinks, so the note's backlinks from sessions/ name the conversations.
  handle('chats:forNote', async (path) => {
    const ctx = vaultService.requireContext();
    const receipts = getBacklinks(ctx, path)
      .map((b) => b.from)
      .filter((n) => n.type === 'session');
    if (receipts.length === 0) return [];
    const ids = new Set<string>();
    const prefixes: string[] = [];
    for (const r of receipts) {
      const id = r.frontmatter['session_id'];
      if (typeof id === 'string') ids.add(id);
      else {
        // Pre-session_id receipts: the filename ends in the id's first 8 chars.
        const m = /-([0-9a-f]{8})\.md$/.exec(r.path);
        if (m) prefixes.push(m[1]!);
      }
    }
    const chats = await agent.listChats();
    return chats.filter((c) => ids.has(c.id) || prefixes.some((p) => c.id.startsWith(p)));
  });

  return {
    async onReady() {
      await settings.load();
      // Dev affordance: PM_VAULT opens a workspace without the picker.
      const saved = process.env['PM_VAULT'] ?? settings.get().vaultPath;
      if (saved) {
        try {
          const info = await vaultService.open(saved);
          await afterOpen();
          reconfigureAgent();
          console.log(`[pm] opened workspace "${info.name}" — ${info.noteCount} notes, git=${info.git}`);
          if (process.env['PM_SEED_PROPOSAL']) seedDemoProposal(vaultService.requireContext());
        } catch (err) {
          console.error('[pm] failed to open workspace:', err);
        }
      }
      // Start the app-open scheduler (idempotent; ticks no-op until a vault opens).
      scheduler.start();
      if (settings.get().mcpEnabled || process.env['PM_MCP']) {
        await mcp.start(settings.get().mcpPort);
        if (process.env['PM_MCP']) console.log(`[pm] MCP token: ${settings.get().mcpToken}`);
      }
    },
  };
}
