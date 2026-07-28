import { app, BrowserWindow, dialog, Notification } from 'electron';
import type { AgentRunInput, ModelInfoDTO, SettingsDTO } from '@pm/ipc';
import { AgentRuntime } from '@pm/agent';
import {
  acceptProposal,
  completeMeetingReview,
  captureNote,
  captureTodo,
  createPerson,
  deleteNote,
  ensureDefaultSkills,
  getBacklinks,
  getNote,
  getThemesByHeat,
  getMaintenanceReport,
  getNoteHistory,
  getNoteVersion,
  getProposalStats,
  getVaultInfo,
  getVaultTree,
  generateIndexFiles,
  initVaultGit,
  listPeople,
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
  saveAuthoredNote,
  saveFrontmatter,
  searchNotes,
  setTodoStatus,
} from '@pm/application';
import { classifyCapture, parseFrontmatter, type Frontmatter } from '@pm/domain';
import { atlassianAuthSchema } from '@pm/connectors';
import { DEFAULT_SKILLS, RETIRED_SKILL_FILES } from '@pm/sessions';
import { handle, pushEvent } from './ipc.js';
import { seedDemoProposal } from './dev-seed.js';
import { SettingsService } from './services/settings-service.js';
import { GoogleOAuthService } from './services/google-oauth-service.js';
import { VaultService } from './services/vault-service.js';
import { makeOutbound } from './services/outbound-service.js';
import { SchedulerService } from './services/scheduler-service.js';
import { SyncService } from './services/sync-service.js';
import { McpService } from './services/mcp-service.js';
import {
  backlinkToDTO,
  hitToDTO,
  indexedToRefDTO,
  noteToDTO,
  pingToDTO,
  themeHeatToDTO,
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

export function registerHandlers(getWindow: () => BrowserWindow | null): {
  onReady: () => Promise<void>;
  dispose: () => Promise<void>;
} {
  const settings = new SettingsService();
  const vaultService = new VaultService((paths) => {
    pushEvent(getWindow(), { channel: 'vault:changed', paths });
  });
  const agent = new AgentRuntime();

  const googleOAuth = new GoogleOAuthService(settings);
  const syncService = new SyncService(
    () => vaultService.context(),
    () => vaultService.syncStore(),
    settings,
    googleOAuth,
    (mirrorPaths) => {
      pushEvent(getWindow(), { channel: 'connections:changed' });
      if (mirrorPaths.length > 0) pushEvent(getWindow(), { channel: 'vault:changed', paths: mirrorPaths });
    },
  );

  /**
   * The librarian maintenance pass, ONE entry point for every trigger
   * (app-open catch-up AND the 5-minute tick). The in-flight guard is the
   * reentrancy fix: sweeps span minutes of LLM latency, and two overlapping
   * sweeps each snapshot pending cards once — both would file the same
   * redline. Sync runs first so the sweep sees fresh mirrors.
   */
  let maintenanceInFlight: Promise<void> | null = null;
  const runMaintenance = (): Promise<void> => {
    if (maintenanceInFlight) return maintenanceInFlight;
    maintenanceInFlight = (async () => {
      await syncService.tick().catch((err) => {
        console.error('[pm] sync tick failed:', err instanceof Error ? err.message : err);
      });
      const ctx = vaultService.context();
      if (!ctx) return;
      const { pings, fixes } = await runLibrarianSweep(ctx);
      if (pings > 0) notifyPings();
      if (fixes > 0) notifyProposalsFor();
      // Refresh the OKF index.md orientation maps from the (now reconciled and
      // swept) index. Idempotent — no write, no commit when nothing changed.
      const idx = await generateIndexFiles(ctx);
      if (idx.written.length > 0) pushEvent(getWindow(), { channel: 'vault:changed', paths: idx.written });
    })()
      .catch((err) => {
        // The tick must never surface as an unhandledRejection (it fires every
        // 5 minutes — offline would mean a steady drip of them).
        console.error('[pm] librarian sweep failed:', err instanceof Error ? err.message : err);
      })
      .finally(() => {
        maintenanceInFlight = null;
      });
    return maintenanceInFlight;
  };

  // Runs in the BACKGROUND after a vault opens (`void afterOpen()`): seeding
  // skills and the launch maintenance pass must never block first paint or the
  // vault-picker response. Badge pushes land once it settles. Maintenance goes
  // through the SAME guarded entry as the scheduler tick — never a second,
  // concurrent sweep.
  const afterOpen = async (): Promise<void> => {
    try {
      const ctx = vaultService.context();
      if (!ctx) return;
      await ensureDefaultSkills(ctx, DEFAULT_SKILLS, RETIRED_SKILL_FILES);
      await runMaintenance();
      notifyPings();
      notifyProposalsFor();
    } catch (err) {
      console.error('[pm] post-open sweep failed:', err instanceof Error ? err.message : err);
    }
  };

  const reconfigureAgent = (): void => {
    const ctx = vaultService.context();
    if (!ctx) return;
    const s = settings.get();
    // The card-application layer writes outbound by provider: Atlassian when its
    // creds are set, Google Calendar when a grant exists (write scope is secured
    // via incremental consent at push time, never pre-emptively).
    ctx.outbound = makeOutbound(
      settings.getAtlassian(),
      settings.getGoogle()
        ? {
            getAccessToken: () => googleOAuth.getAccessToken(),
            ensureWriteScope: () => googleOAuth.ensureWriteScope(),
          }
        : null,
    );
    // Background judgments (librarian stewardship) get a one-shot completion
    // seam only when a key exists — absent, the sweep skips silently.
    ctx.completions = settings.getAnthropicKey()
      ? {
          complete: async (input) => {
            const out = await agent.completeText(input);
            if (out === null) throw new Error('no model available for background judgment');
            return out;
          },
        }
      : undefined;
    agent.configure({
      vaultDir: ctx.vault.root(),
      userDataDir: app.getPath('userData'),
      modelId: s.modelId,
      apiKey: settings.getAnthropicKey(),
      atlassian: settings.getAtlassian(),
      trackExternal: (kind, externalId) => syncService.trackExternal(kind, externalId),
    });
    syncService.reconfigure();
  };

  const settingsDTO = (): SettingsDTO => {
    const s = settings.get();
    return {
      vaultPath: vaultService.currentVaultPath() ?? s.vaultPath,
      modelId: s.modelId,
      hasAnthropicKey: !!settings.getAnthropicKey(),
      hasAtlassianCreds: !!settings.getAtlassian(),
      secretsEncrypted: settings.secretsEncrypted(),
      // Read AFTER the two secret getters above — they are what trips the flag.
      secretsUnreadable: settings.secretsUnreadable(),
      schedules: s.schedules,
      mcp: { enabled: s.mcpEnabled, port: s.mcpPort, token: s.mcpToken, running: mcp.isRunning() },
      identity: {
        name: settings.getIdentity().name,
        emails: settings.selfEmails(),
        aliases: settings.getIdentity().aliases,
      },
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
    arrival: 'Arrival',
    'after-meeting': 'After-Meeting',
    'before-meeting': 'Before-Meeting',
    'external-transcript': 'External transcript',
    intake: 'Intake',
    'weekly-update': 'Weekly update',
    synthesis: 'Synthesis',
    'supersede-sweep': 'Repoint references',
    librarian: 'Librarian',
  };
  const sessionLabel = (type: string): string => SESSION_LABEL[type] ?? type.replace(/-/g, ' ');

  const fireSession = async (
    sessionType: string,
    prompt: string,
    /** Tier the firing binding grants this arrival (Sessions v2 invariant 3). */
    tier?: 'observe' | 'suggest' | 'outbound',
  ): Promise<{ sessionId: string } | null> => {
    const ctx = vaultService.context();
    if (!ctx) return null;
    try {
      // run() returns immediately with the session id; chunks + settle stream via
      // agent.onStatus. Handing the id back lets capture open a live watch tab.
      const handle = await agent.run(
        { sessionType: sessionType as AgentRunInput['sessionType'], prompt, ...(tier ? { invokeTier: tier } : {}) },
        ctx,
        () => {},
      );
      return { sessionId: handle.sessionId };
    } catch (err) {
      // Every caller is fire-and-forget (`void fireSession(...)`): a run that
      // dies here — most often "no API key yet" — must surface, not become an
      // unhandled rejection while the PO waits for cards that never come.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[pm] background ${sessionType} session failed:`, message);
      if (Notification.isSupported()) {
        new Notification({ title: `${sessionLabel(sessionType)} failed`, body: message, silent: true }).show();
      }
      return null;
    }
  };

  // Before-meeting auto-prep (google-calendar phase 2, job 2): synced meetings
  // starting within the hour get their brief prepared on the meeting page — the
  // owning-view stance, never an Inbox ping. Fires once per meeting per app-run
  // (the in-memory guard covers the async window before a card lands), and never
  // while a card is already pending or a `## Prep` section has been accepted.
  // Gated on an API key so a keyless workspace never drips failure notifications.
  const PREP_LEAD_MS = 60 * 60 * 1000;
  const autoPrepped = new Set<string>();
  const runBeforeMeetingSweep = async (): Promise<void> => {
    const ctx = vaultService.context();
    if (!ctx || !settings.getAnthropicKey()) return;
    const now = Date.now();
    const pending = ctx.proposals.list('pending');
    for (const m of syncService.agenda(now, now + PREP_LEAD_MS)) {
      if (m.cancelled || m.startMs <= now) continue; // upcoming, within the lead window
      if (autoPrepped.has(m.notePath)) continue;
      const note = await ctx.vault.readNote(m.notePath).catch(() => null);
      if (!note) continue;
      if (/^## Prep\b/m.test(note.body)) continue;
      if (pending.some((p) => p.sessionType === 'before-meeting' && p.targetPath === m.notePath)) continue;
      autoPrepped.add(m.notePath);
      // Same contract as the manual "Brief me" button (renderer agent-nudges).
      void fireSession(
        'before-meeting',
        `Run the Before-Meeting session on ${m.notePath}: read the participants' people pages (last_told), the customer/theme hubs this meeting touches, and the previous meeting in its series, then propose a ## Prep section for the meeting page as one approval card.`,
      );
    }
  };

  // Session files landing one at a time is the signature interaction — the tree
  // must fill live, not after the turn settles.
  agent.onFilesChanged = (sessionId) => {
    pushEvent(getWindow(), { channel: 'session:files', sessionId });
  };

  // The fan-out approval card, inline in the chat. Nothing runs until it settles.
  agent.onSpawnRequest = (sessionId, request) => {
    pushEvent(getWindow(), { channel: 'session:spawn', sessionId, request });
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
    (sessionType, prompt) => fireSession(sessionType, prompt).then(() => undefined),
    notifyProposalsFor,
    // Sync + librarian sweep, through the one guarded entry point — a tick
    // that overlaps a still-running pass is skipped, and rejections land in
    // runMaintenance's catch, never as unhandledRejection.
    () => void runMaintenance(),
    runBeforeMeetingSweep,
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
    // An empty token is a disconnect, not a credential — a truthy-but-empty
    // record here would make every downstream `hasAtlassianCreds` check lie.
    if (!creds.token.trim() || !creds.baseUrl.trim() || !creds.email.trim()) {
      await settings.clearAtlassian();
      reconfigureAgent();
      return settingsDTO();
    }
    const site = /^https?:\/\//i.test(creds.baseUrl.trim())
      ? creds.baseUrl.trim().replace(/\/+$/, '')
      : `https://${creds.baseUrl.trim().replace(/\/+$/, '')}`;
    const parsed = atlassianAuthSchema.safeParse({ siteUrl: site, email: creds.email.trim(), apiToken: creds.token.trim() });
    if (!parsed.success) {
      throw new Error('Check the site URL, email and API token — one of them looks malformed.');
    }
    await settings.setAtlassian(parsed.data.siteUrl, parsed.data.email, parsed.data.apiToken);
    reconfigureAgent();
    return settingsDTO();
  });

  // Connections (Area C): the renderer's one door to external-system state.
  handle('connections:providers', () => syncService.providers());
  handle('connections:list', () => syncService.list());
  handle('connections:connect', async (providerId, values) => {
    const result = await syncService.connect(providerId, values);
    if (result.ok) reconfigureAgent();
    return result;
  });
  handle('connections:renewAuth', async (connectionId, values) => {
    const result = await syncService.renewAuth(connectionId, values);
    if (result.ok) reconfigureAgent();
    return result;
  });
  handle('connections:cancelOAuth', () => syncService.cancelOAuth());
  handle('connections:disconnect', async (connectionId) => {
    await syncService.disconnect(connectionId);
    reconfigureAgent();
  });
  handle('connections:setFollow', (connectionId, containerId, followed) =>
    syncService.setFollow(connectionId, containerId, followed),
  );
  handle('connections:syncNow', async () => {
    try {
      await syncService.tick();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  handle('connections:searchIndex', (query, limit) => syncService.searchIndex(query, limit ?? 6));
  handle('connections:refMeta', (slug) => syncService.refMeta(slug));
  handle('connections:atRisk', () => syncService.atRisk());
  handle('connections:deliveryDelta', (meetingPath) => syncService.deliveryDelta(meetingPath));
  handle('connections:pageBody', async (externalIdOrSlug) => {
    const ctx = vaultService.context();
    if (!ctx) return null;
    const path = syncService.pageBody(externalIdOrSlug);
    if (!path) return null;
    const note = await ctx.vault.readNote(path);
    return note?.body ?? null;
  });
  handle('settings:setSchedule', async (sessionType, patch) => {
    // Enabling starts the schedule from now — otherwise the next tick sees
    // last week's slot and fires immediately.
    const existing = settings.get().schedules.find((s) => s.sessionType === sessionType);
    const stamped =
      patch.enabled && !existing?.enabled ? { ...patch, lastRun: new Date().toISOString() } : patch;
    await settings.setSchedule(sessionType, stamped);
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
  handle('settings:setIdentity', async (patch) => {
    await settings.setIdentity(patch);
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
    void afterOpen();
    reconfigureAgent();
    return vaultInfoToDTO(info);
  });

  handle('vault:open', async (path) => {
    const info = await vaultService.open(path);
    await settings.setVaultPath(info.path);
    void afterOpen();
    reconfigureAgent();
    return vaultInfoToDTO(info);
  });

  handle('vault:current', async () => {
    const ctx = vaultService.context();
    return ctx ? vaultInfoToDTO(await getVaultInfo(ctx)) : null;
  });

  handle('vault:initGit', async () => {
    const info = await initVaultGit(vaultService.requireContext());
    return vaultInfoToDTO(info);
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
  handle('note:history', (path) => getNoteHistory(vaultService.requireContext(), path));
  handle('note:versionAt', (path, hash) => getNoteVersion(vaultService.requireContext(), path, hash));

  // People: the directory participant chips resolve against, and the one-click
  // "make a page for them" that turns a raw invite address into a person the
  // next calendar sync can match on.
  handle('people:directory', () => ({
    people: listPeople(vaultService.requireContext()),
    self: { name: settings.getIdentity().name, emails: settings.selfEmails() },
  }));
  handle('people:create', async (input) => {
    const card = await createPerson(vaultService.requireContext(), input);
    pushEvent(getWindow(), { channel: 'vault:changed', paths: [card.path] });
    return card;
  });

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
  // Capture matching (job 3): the synced meeting a fresh transcript most likely
  // belongs to, so the dialog can offer "Attach to …" instead of a blank title.
  handle('capture:matchMeeting', () => {
    const m = syncService.matchMeetingForCapture(Date.now());
    return m ? { notePath: m.notePath, title: m.title, startMs: m.startMs, endMs: m.endMs } : null;
  });
  handle('capture:ingest', async (input) => {
    // A titleless transcript would otherwise be slugified from its first spoken
    // line ("me-thanks-for-making-time…"). Name it from the content instead —
    // a quick model call, best-effort: if the key's unset or it errors, the
    // classifier's cleaned title carries it (never the raw first line).
    let named = input;
    // Attaching to a synced meeting reuses that note's title — don't spend a
    // model call naming a transcript whose title we'll ignore.
    if (!input.attachment && !input.attachTo && !input.title?.trim()) {
      const kindGuess = input.kind ?? classifyCapture(input.text).kind;
      if (kindGuess === 'transcript') {
        // Bounded so a slow model never holds the capture open — the heuristic
        // title carries it if the call times out or errors.
        const title = await Promise.race([
          agent.generateTitle(input.text),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
        ]).catch(() => null);
        if (title) named = { ...input, title };
      }
    }
    const { note, kind, followUp, extras } = await ingestCapture(vaultService.requireContext(), {
      ...named,
      attachment: named.attachment
        ? { name: named.attachment.name, data: Buffer.from(named.attachment.dataBase64, 'base64') }
        : undefined,
    });
    // Any further skills bound to the same capture event run headlessly alongside.
    for (const extra of extras ?? []) void fireSession(extra.sessionType, extra.prompt, extra.tier);
    // After-Meeting / External-Transcript run the moment the capture lands — the
    // gate is the review, not the run. We hand the session id back so the PO
    // lands in the live session, watches it work, and approves its cards inline;
    // the same cards also collect in the Inbox.
    if (followUp?.background) {
      const handle = await fireSession(followUp.sessionType, followUp.prompt, followUp.tier);
      return {
        note: noteToDTO(note),
        kind,
        processing: {
          sessionType: followUp.sessionType,
          label: followUp.tabTitle,
          ...(handle ? { sessionId: handle.sessionId } : {}),
        },
      };
    }
    return { note: noteToDTO(note), kind, followUp };
  });

  handle('search:query', (query, limit) =>
    searchNotes(vaultService.requireContext(), query, limit).map(hitToDTO),
  );

  handle('themes:byHeat', () =>
    getThemesByHeat(vaultService.requireContext()).map((r) => themeHeatToDTO(r)),
  );

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
        `Repoint references after a decision changed (${supersedes}). Search the memory for notes, insights, and hubs that still point at the old decision and propose updates pointing them at the new one, as approval cards. Write each card's reason in plain language — say "points at the newer decision", not "supersede".`,
      );
    }
  };
  handle('proposals:accept', async (id, edited) => {
    const result = await acceptProposal(vaultService.requireContext(), id, edited);
    if (result.ok) await fireSupersedeReactions(id).catch(() => {});
    await afterCardResolved(id);
    notifyProposalsFor();
    return result;
  });
  handle('proposals:reject', async (id) => {
    const result = rejectProposal(vaultService.requireContext(), id);
    await afterCardResolved(id);
    notifyProposalsFor();
    return result;
  });
  handle('proposals:stats', () => getProposalStats(vaultService.requireContext()));
  handle('librarian:report', () => getMaintenanceReport(vaultService.requireContext()));
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
  handle('sessions:files', (sessionId) => agent.listFiles(sessionId));
  handle('sessions:fileText', (sessionId, path) => agent.readFile(sessionId, path));
  handle('sessions:pendingSpawn', (sessionId) => agent.pendingSpawn(sessionId));
  handle('sessions:resolveSpawn', (requestId, decision) => {
    agent.resolveSpawn(requestId, decision);
    return { ok: true };
  });

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
          void afterOpen();
          reconfigureAgent();
          console.log(`[pm] opened workspace "${info.name}" — ${info.noteCount} notes, git=${info.git}`);
          if (process.env['PM_SEED_PROPOSAL']) void seedDemoProposal(vaultService.requireContext());
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
    // Quit-time teardown: stop timers and the server, dispose live sessions,
    // then close the watcher/index/DB so nothing writes against a closing app.
    async dispose() {
      scheduler.stop();
      await mcp.stop().catch(() => {});
      agent.dispose();
      await vaultService.dispose().catch(() => {});
    },
  };
}
