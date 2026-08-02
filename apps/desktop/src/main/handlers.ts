import { app, BrowserWindow, dialog, Notification } from 'electron';
import { is } from '@electron-toolkit/utils';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type {
  AgentDTO,
  ArrivalItemInputDTO,
  ArrivalOutcomeItemDTO,
  MeetingReviewAskDTO,
  ModelInfoDTO,
  SettingsDTO,
} from '@pm/ipc';
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
  getVaultInfo,
  getVaultTree,
  generateIndexFiles,
  initVaultGit,
  listPeople,
  listSkills,
  listAgentFiles,
  migrateRunnableFolders,
  runnableEnabled,
  markMeetingReviewed,
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
  ingestArrival,
  ingestCapture,
  type ArrivalItem,
  planArrival,
  resolveRuns,
  undoArrival,
  renameNote,
  resolveLink,
  saveAuthoredNote,
  saveFrontmatter,
  searchNotes,
  setTodoStatus,
  type UseCaseContext,
} from '@pm/application';
import {
  classifyCapture,
  parseFrontmatter,
  readableAs,
  unreadableReason,
  type Frontmatter,
} from '@pm/domain';
import { atlassianAuthSchema } from '@pm/connectors';
import {
  buildKickoff,
  DEFAULT_SKILLS,
  DEFAULT_AGENTS,
  RETIRED_SKILL_FILES,
  MEETING_PREP_INSTRUCTION,
} from '@pm/sessions';
import { handle, pushEvent } from './ipc.js';
import { CODE_RUN_FACTS, MEETING_PREP_LEAD_MS, MEETING_PREP_LEAD_PHRASE } from './agents.js';
import { setDockBadge } from './dock-badge.js';
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
  agentFileToDTO,
  noteToDTO,
  outboundEffectFacts,
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

/**
 * Any of the PO's own open commitments due today or already slipped. `owner`
 * set means the commitment is waiting on someone else — that one is a follow-up
 * to make, not a debt the dock should nag about. A missing `status` reads as
 * open (hand-written todos don't always carry one).
 */
function hasDueTodos(ctx: UseCaseContext): boolean {
  const today = ctx.clock.now().slice(0, 10);
  return queryNotes(ctx, { types: ['todo'] }).some((n) => {
    const due = n.frontmatter['due'];
    return (
      (n.lifecycle ?? 'open') === 'open' &&
      !n.frontmatter['owner'] &&
      typeof due === 'string' &&
      due <= today
    );
  });
}

export function registerHandlers(getWindow: () => BrowserWindow | null): {
  onReady: () => Promise<void>;
  dispose: () => Promise<void>;
} {
  const settings = new SettingsService();
  const vaultService = new VaultService((paths) => {
    pushEvent(getWindow(), { channel: 'vault:changed', paths });
    // Todos are files: an edit in Obsidian (or by a session) can close the last
    // overdue one, and the dock has to follow.
    refreshDockBadge();
  });
  const agent = new AgentRuntime();

  /**
   * Sessions parked on a card that only the PO can clear — a mid-turn question
   * or a fan-out approval. Keyed per kind so a session holding both doesn't
   * lose its badge when one resolves.
   */
  const parked = new Set<string>();

  /**
   * "Something is waiting on you", as one bit for the dock: a pending approval
   * card, a session parked on a question, or one of the PO's OWN commitments
   * due today or already slipped (`owner` set means it's waiting on someone
   * else — the same rule the sidebar's todo count uses).
   *
   * Pings are deliberately left out. They are quiet workspace-maintenance rows
   * by design, and a dock badge is not a quiet surface.
   *
   * Declared as a function so it hoists over the VaultService callback above.
   */
  function refreshDockBadge(): void {
    const ctx = vaultService.context();
    if (!ctx) return setDockBadge(false);
    // The stored questions are asked as well as the in-memory ones: a question
    // parked before a quit is still waiting at the next launch (QM ticket 9),
    // and `parked` only knows about the runs THIS app run started.
    const asking = parked.size > 0 || (ctx.asks?.list().length ?? 0) > 0;
    setDockBadge(ctx.proposals.pendingCount() > 0 || asking || hasDueTodos(ctx));
  }

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

  /** When each background agent last actually FIRED, epoch ms. In memory: a
   *  relaunch has genuinely not run the sweep yet, and the view says so rather
   *  than quoting yesterday. */
  const agentLastRun = new Map<string, number>();
  /** When a sweep last came round and found nothing to do. Separate from the
   *  above because they answer different questions: meeting-prep looks every
   *  tick and preps almost never, and stamping "last ran" for a look claimed
   *  work that never happened. */
  const agentLastChecked = new Map<string, number>();

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
      // The librarian's off switch (its file's `enabled` frontmatter) is
      // enforced HERE, before the sweep is entered: off has to mean no
      // judgments and no cards, not a hidden pass whose output is filtered
      // later. Connector sync and the index maps below aren't the agent's
      // work, so they keep running.
      if (await runnableEnabled(ctx, 'librarian')) {
        const { pings, fixes } = await runLibrarianSweep(ctx);
        agentLastRun.set('librarian', Date.now());
        if (pings > 0) notifyPings();
        if (fixes > 0) notifyProposalsFor();
      }
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
        // Also the badge's heartbeat: the 5-minute tick is what carries a todo
        // over midnight from "due tomorrow" into "due today".
        refreshDockBadge();
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
      // Every skill and agent is a folder now. Move first, seed second: a
      // workspace still on flat files holds the PM's own edits under the old
      // name, and seeding before moving would write a pristine copy that
      // shadows theirs. The move is bytes-only and idempotent.
      const migrated = await migrateRunnableFolders(ctx);
      if (migrated.moved.length > 0)
        console.log(`[pm] moved ${migrated.moved.length / 2} skill/agent file(s) into folders`);
      for (const path of migrated.left)
        console.warn(`[pm] ${path} differs from its folder copy — left both in place, nothing lost`);
      await ensureDefaultSkills(ctx, [...DEFAULT_SKILLS, ...DEFAULT_AGENTS], RETIRED_SKILL_FILES);
      // One-time migration: agent off switches used to live in settings; the
      // frontmatter is the switch now. Carry the recorded intent over, once.
      const overrides = await settings.takeAgentOverrides();
      for (const [id, on] of Object.entries(overrides ?? {})) {
        if (on === false) await setAgentFileEnabled(ctx, id, false);
      }
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

  /** Write an agent's off switch into its file's frontmatter and reindex. */
  const setAgentFileEnabled = async (
    ctx: UseCaseContext,
    id: string,
    enabled: boolean,
  ): Promise<void> => {
    const file = (await listAgentFiles(ctx)).find((a) => a.name === id);
    if (!file) return;
    const existing = await ctx.vault.readNote(file.path);
    if (!existing) return;
    const note = await saveFrontmatter(ctx, file.path, {
      ...existing.frontmatter,
      enabled,
    } as Frontmatter);
    ctx.index.reindex(note);
    // An open editor tab on the agent file must show the flipped switch.
    pushEvent(getWindow(), { channel: 'vault:changed', paths: [file.path] });
  };

  /**
   * One Agents list — every agent is a file. Main merges on what only it
   * knows: the code-clocked facts (CODE_RUN_FACTS), whether a key exists to
   * judge with, when each last ran, and how many of its cards wait in the
   * Inbox.
   */
  const agentsDTO = async (): Promise<AgentDTO[]> => {
    const ctx = vaultService.context();
    if (!ctx) return [];
    const fromFiles = await listAgentFiles(ctx);
    const pending = ctx.proposals.list('pending');
    return fromFiles.map((a) =>
      agentFileToDTO(
        a,
        agentLastRun.get(a.name) ?? null,
        agentLastChecked.get(a.name) ?? null,
        CODE_RUN_FACTS[a.name],
        !!settings.getAnthropicKey(),
        // The sweep's cards carry `sessionId: 'librarian'`; a fired session's
        // cards carry the agent's name as their `skill`.
        pending.filter((p) => p.skill === a.name || p.sessionId === a.name).length,
      ),
    );
  };

  const notifyProposalsFor = (): void => {
    const ctx = vaultService.context();
    if (ctx) pushEvent(getWindow(), { channel: 'proposals:changed', pendingCount: ctx.proposals.pendingCount() });
    refreshDockBadge();
  };

  const notifyPings = (): void => {
    const ctx = vaultService.context();
    if (ctx?.pings) pushEvent(getWindow(), { channel: 'pings:changed', pendingCount: ctx.pings.pendingCount() });
  };

  const fireSession = async (
    skill: string,
    prompt: string,
    opts?: {
      /** Whether the firing trigger lets this arrival draft outbound (invariant 3). */
      outbound?: boolean;
      /**
       * A clock started this, not a person (QM ticket 2). Only the two triggers
       * that genuinely tick set it: a schedule's slot and the before-meeting
       * sweep. "Run now", a capture, an arrival and a reaction to an approved
       * card all have someone waiting, so none of them may go silent.
       */
      scheduled?: boolean;
    },
  ): Promise<{ sessionId: string } | null> => {
    const ctx = vaultService.context();
    if (!ctx) return null;
    // The off switch is a FLOOR, and this is its one door. Every path that
    // starts a session by name comes through here: the 5-minute sweep, a
    // schedule's slot, "Run now" in Settings, an Inbox card's "Re-run session",
    // a reaction to an approved decision. So switching a file off in the Agents
    // view stops all of them, not only the ones whose author remembered to look.
    // (The sweeps check first as well: they do judgment work before firing
    // anything, and off has to mean that work never happens either.)
    if (!(await runnableEnabled(ctx, skill))) {
      console.log(`[pm] ${skill} is switched off, not firing it`);
      return null;
    }
    try {
      // run() returns immediately with the session id; chunks + settle stream via
      // agent.onStatus. Handing the id back lets capture open a live watch tab.
      const handle = await agent.run(
        {
          skill,
          prompt,
          ...(opts?.outbound ? { outbound: true } : {}),
          ...(opts?.scheduled ? { scheduled: true } : {}),
        },
        ctx,
        () => {},
      );
      // A file agent's "last ran" stamp — same ledger the code watchers use, so
      // the Agents view answers "when did this last fire" for both kinds.
      agentLastRun.set(skill, Date.now());
      return { sessionId: handle.sessionId };
    } catch (err) {
      // Every caller is fire-and-forget (`void fireSession(...)`): a run that
      // dies here — most often "no API key yet" — must surface, not become an
      // unhandled rejection while the PO waits for cards that never come.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[pm] background ${skill} session failed:`, message);
      if (Notification.isSupported()) {
        new Notification({ title: 'Session failed', body: message, silent: true }).show();
      }
      return null;
    }
  };

  // Before-meeting auto-prep (the `meeting-prep` agent): synced meetings starting
  // within the lead window get their brief prepared on the meeting page — the
  // owning-view stance, never an Inbox ping. It never fires while a card is
  // already pending or a `## Prep` section has been accepted, and it is gated on
  // an API key so a keyless workspace never drips failure notifications.
  //
  // The once-per-meeting guard is a check-ledger row (app.db, beside the
  // librarian's), keyed by note path and holding the start time it prepped FOR:
  // a relaunch inside the lead window doesn't prep the same meeting twice, while
  // a meeting moved to a new time earns a fresh pass. One row per auto-prepped
  // meeting, upserted in place. Nothing clears them; a re-prep is a new value.
  const prepKey = (notePath: string): string => `meeting-prep:${notePath}`;
  /** Which session the app started by itself, and the words for why — read back
   *  onto the card (`proposals:list`) so a self-started brief still says so
   *  after a restart. */
  const selfPrepKey = (sessionId: string): string => `self-prep:${sessionId}`;
  /**
   * The provenance line the card carries, fixed at the moment the sweep fired:
   * the real trigger and the real meeting time, in the PO's own clock.
   */
  const prepProvenance = (startMs: number): string => {
    const at = new Date(startMs).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    return `Prepared itself, ${MEETING_PREP_LEAD_PHRASE} before your ${at}.`;
  };
  const runBeforeMeetingSweep = async (): Promise<void> => {
    const ctx = vaultService.context();
    if (!ctx || !ctx.checks) return;
    if (!settings.getAnthropicKey()) return;
    // The file holds the instructions and the switch; the app holds the clock.
    // The switch is read before any meeting is looked at — off costs nothing.
    if (!(await runnableEnabled(ctx, 'meeting-prep'))) return;
    const checks = ctx.checks;
    const now = Date.now();
    const pending = ctx.proposals.list('pending');
    // Old pending cards may still carry the name this agent had as a skill.
    const prepSkills = new Set(['before-meeting', 'meeting-prep']);
    for (const m of syncService.agenda(now, now + MEETING_PREP_LEAD_MS)) {
      if (m.cancelled || m.startMs <= now) continue; // upcoming, within the lead window
      const startIso = new Date(m.startMs).toISOString();
      if (checks.get(prepKey(m.notePath)) === startIso) continue;
      const note = await ctx.vault.readNote(m.notePath).catch(() => null);
      if (!note) continue;
      if (/^## Prep\b/m.test(note.body)) continue;
      if (pending.some((p) => prepSkills.has(p.skill ?? '') && p.targetPath === m.notePath)) continue;
      // Written BEFORE the run is fired: the ledger also covers the async window
      // between firing and the card landing.
      checks.set(prepKey(m.notePath), startIso, now);
      const provenance = prepProvenance(m.startMs);
      // Same contract as the manual "Brief me" button (renderer agent-nudges),
      // minus the person: this one the clock started, so a pass that finds
      // nothing worth briefing may end without a receipt (QM ticket 2). A pass
      // that DOES brief has proposed a card and can never count as silent.
      void fireSession(
        'meeting-prep',
        buildKickoff({ skill: 'meeting-prep', target: m.notePath, instruction: MEETING_PREP_INSTRUCTION }),
        { scheduled: true },
      ).then((handle) => {
        if (handle) checks.set(selfPrepKey(handle.sessionId), provenance, Date.now());
      });
    }
    // A look, not a run: fireSession stamps `agentLastRun` for the meetings it
    // actually prepped, and most sweeps prep nothing.
    agentLastChecked.set('meeting-prep', Date.now());
  };

  // Session files landing one at a time is the signature interaction — the tree
  // must fill live, not after the turn settles.
  agent.onFilesChanged = (sessionId) => {
    pushEvent(getWindow(), { channel: 'session:files', sessionId });
  };

  const setParked = (key: string, waiting: boolean): void => {
    if (waiting) parked.add(key);
    else parked.delete(key);
    refreshDockBadge();
  };

  // The fan-out approval card, inline in the chat. Nothing runs until it settles.
  agent.onSpawnRequest = (sessionId, request) => {
    pushEvent(getWindow(), { channel: 'session:spawn', sessionId, request });
    setParked(`spawn:${sessionId}`, !!request);
  };

  // The agent is asking the PM something mid-turn — the run is parked on it.
  agent.onAskRequest = (sessionId, request) => {
    pushEvent(getWindow(), { channel: 'session:ask', sessionId, request });
    setParked(`ask:${sessionId}`, !!request);
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
    // A scheduled run that had nothing to report leaves no receipt, no row and
    // no badge (QM ticket 2). A notification saying "Finished" would undo all
    // three at once, so it is the last thing to go.
    if (s.quiet) return;
    const win = getWindow();
    if ((win && win.isFocused()) || !Notification.isSupported()) return;
    const notification = new Notification({
      title: s.title || 'Session ready',
      body: pendingCards > 0 ? `${pendingCards} proposal${pendingCards === 1 ? '' : 's'} to review` : 'Finished',
      silent: true,
    });
    notification.on('click', () => {
      const w = getWindow();
      if (w) {
        if (w.isMinimized()) w.restore();
        w.show();
        w.focus();
      }
      pushEvent(getWindow(), { channel: 'session:focus', sessionId: s.sessionId, title: s.title });
    });
    notification.show();
  };

  const scheduler = new SchedulerService(
    () => vaultService.context(),
    settings,
    (skill, prompt, opts) => fireSession(skill, prompt, opts).then(() => undefined),
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
  handle('settings:setSchedule', async (skill, patch) => {
    // Enabling starts the schedule from now — otherwise the next tick sees
    // last week's slot and fires immediately.
    const existing = settings.get().schedules.find((s) => s.skill === skill);
    const stamped =
      patch.enabled && !existing?.enabled ? { ...patch, lastRun: new Date().toISOString() } : patch;
    await settings.setSchedule(skill, stamped);
    return settingsDTO();
  });
  handle('skills:list', async () => {
    const summaries = await listSkills(vaultService.requireContext());
    return summaries.map(skillToDTO);
  });
  handle('agents:list', () => agentsDTO());
  handle('agents:setEnabled', async (id, enabled) => {
    // An agent IS its file, so the switch is a frontmatter edit — visible in
    // the note, kept by git.
    const ctx = vaultService.requireContext();
    await setAgentFileEnabled(ctx, id, enabled);
    return agentsDTO();
  });
  handle('schedule:runNow', async (skill) => {
    await scheduler.runNow(skill);
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

  // Both write through the vault, so the watcher would catch them anyway —
  // half a second later. Ticking a todo off is exactly when the badge going
  // dark has to feel like the consequence of the click.
  handle('todos:capture', async (input) => {
    const note = await captureTodo(vaultService.requireContext(), input);
    refreshDockBadge();
    return noteToDTO(note);
  });
  handle('todos:setStatus', async (path, status) => {
    const note = await setTodoStatus(vaultService.requireContext(), path, status);
    refreshDockBadge();
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
    const { note, kind, followUp } = await ingestCapture(vaultService.requireContext(), {
      ...named,
      attachment: named.attachment
        ? { name: named.attachment.name, data: Buffer.from(named.attachment.dataBase64, 'base64') }
        : undefined,
    });
    // After-Meeting / External-Transcript run the moment the capture lands — the
    // gate is the review, not the run. We hand the session id back so the PO
    // lands in the live session, watches it work, and approves its cards inline;
    // the same cards also collect in the Inbox.
    if (followUp?.background) {
      const handle = await fireSession(followUp.skill, followUp.prompt, { outbound: followUp.outbound });
      return {
        note: noteToDTO(note),
        kind,
        processing: {
          skill: followUp.skill,
          label: followUp.tabTitle,
          ...(handle ? { sessionId: handle.sessionId } : {}),
        },
      };
    }
    return { note: noteToDTO(note), kind, followUp };
  });

  // -------------------------------------------------------------------------
  // Arrival (docs/vision/arrival.md)
  // -------------------------------------------------------------------------

  /**
   * Session-scoped undo ledger. An arrival's receipt can take back exactly what
   * it reported, for as long as that receipt is on screen; it is deliberately
   * not durable, because an undo affordance that outlives the thing offering it
   * would be a second, invisible history competing with git.
   */
  const arrivals = new Map<string, Awaited<ReturnType<typeof ingestArrival>>['ledger']>();
  let arrivalSeq = 0;

  /** One input item, either resolved to material or refused with a reason. */
  type ResolvedEntry = { name: string; item?: ArrivalItem; error?: string };

  /** A last line of defence for extensionless files: real text has no NULs. */
  const looksBinary = (buf: Buffer): boolean => {
    const head = buf.subarray(0, 8000);
    if (head.includes(0)) return true;
    const text = head.toString('utf8');
    let bad = 0;
    for (const ch of text) if (ch === '\uFFFD') bad++;
    return bad > text.length * 0.02;
  };

  /**
   * Turn wire items into material. A `path` (from the OS picker) is read here
   * so fifty files never cross IPC as base64; anything the renderer already
   * holds — a drop, a paste — rides in as it is. A file that cannot be read
   * reports itself and is dropped from the batch rather than failing it.
   */
  const resolveItems = async (items: ArrivalItemInputDTO[]): Promise<ResolvedEntry[]> => {
    const entries: ResolvedEntry[] = [];
    for (const item of items) {
      const common = {
        ...(item.kind ? { kind: item.kind } : {}),
        ...(item.external ? { external: item.external } : {}),
        ...(item.attachTo ? { attachTo: item.attachTo } : {}),
      };
      if (item.path) {
        const name = item.name ?? basename(item.path);
        try {
          const [buf, info] = await Promise.all([readFile(item.path), stat(item.path)]);
          const kind = readableAs(name);
          if (kind === 'image') {
            entries.push({ name, item: { name, lastModified: info.mtimeMs, data: new Uint8Array(buf), ...common } });
          } else if (kind === null || looksBinary(buf)) {
            entries.push({ name, error: unreadableReason(name) });
          } else {
            entries.push({
              name,
              item: { name, lastModified: info.mtimeMs, text: buf.toString('utf8'), ...common },
            });
          }
        } catch (err) {
          entries.push({ name, error: err instanceof Error ? err.message : 'could not be read' });
        }
        continue;
      }
      if (item.name && !item.text && !item.dataBase64) {
        entries.push({ name: item.name, error: unreadableReason(item.name) });
        continue;
      }
      entries.push({
        name: item.name ?? 'Pasted text',
        item: {
        ...(item.name ? { name: item.name } : {}),
        ...(item.text ? { text: item.text } : {}),
        ...(item.dataBase64 ? { data: new Uint8Array(Buffer.from(item.dataBase64, 'base64')) } : {}),
        ...(item.lastModified ? { lastModified: item.lastModified } : {}),
        ...common,
      },
      });
    }
    return entries;
  };

  handle('arrival:pick', async () => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Add material',
      buttonLabel: 'Add',
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return [];
    // Only the path and a name travel back; the bytes stay on this side.
    return result.filePaths.map((path) => ({ path, name: basename(path) }));
  });

  handle('arrival:inspect', async (items, ambition) => {
    const ctx = vaultService.requireContext();
    const entries = await resolveItems(items);
    const resolved = entries.flatMap((e) => (e.item ? [e.item] : []));
    const plan = planArrival(ctx, resolved, ambition);
    // The meeting a lone fresh transcript belongs to — offered here so the tray
    // can say "attaches to X" before anything is written, rather than minting a
    // duplicate of a slot the calendar already mirrored.
    const lone =
      plan.ambition === 'capture' &&
      resolved.length === 1 &&
      plan.items[0]?.kind === 'transcript' &&
      !resolved[0]?.external &&
      !resolved[0]?.attachTo;
    const m = lone ? syncService.matchMeetingForCapture(Date.now()) : null;
    // Input order, not resolved order: the tray renders row N against plan N,
    // so an unreadable file in the middle would otherwise shift every row under
    // it onto the wrong destination.
    let next = 0;
    const rows = entries.map((e) =>
      e.item
        ? plan.items[next++]!
        : { name: e.name, kind: 'note' as const, dir: '', title: e.name, historical: false, error: e.error },
    );
    return {
      ambition: plan.ambition,
      ambitionAuto: plan.ambitionAuto,
      reason: plan.reason,
      runs: await resolveRuns(ctx, { ...plan, items: rows }),
      items: rows,
      ...(m ? { match: { notePath: m.notePath, title: m.title, startMs: m.startMs, endMs: m.endMs } } : {}),
    };
  });

  handle('arrival:ingest', async (items, ambition) => {
    const ctx = vaultService.requireContext();
    const entries = await resolveItems(items);
    const resolved = entries.flatMap((e) => (e.item ? [e.item] : []));
    const failed = entries.flatMap((e) => (e.error ? [{ name: e.name, error: e.error }] : []));
    const plan = planArrival(ctx, resolved, ambition);

    // A pasted transcript has no file name, so its title would be slugified
    // from the first spoken line ("me-thanks-for-making-time…"). Name it from
    // the content instead — best-effort and bounded, and only where there is no
    // name to inherit, so a fifty-file batch never waits on fifty model calls.
    const named = await Promise.all(
      resolved.map(async (item, i) => {
        if (item.name || plan.items[i]?.kind !== 'transcript' || !item.text) return item;
        const title = await Promise.race([
          agent.generateTitle(item.text),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
        ]).catch(() => null);
        return title ? { ...item, name: title } : item;
      }),
    );

    // Attach a lone fresh transcript to the meeting the calendar already has.
    const lone =
      plan.ambition === 'capture' && named.length === 1 && plan.items[0]?.kind === 'transcript';
    if (lone && named[0] && !named[0].external && !named[0].attachTo) {
      const m = syncService.matchMeetingForCapture(Date.now());
      if (m) named[0] = { ...named[0], attachTo: m.notePath };
    }

    const result = await ingestArrival(ctx, { items: named, ambition });

    // Reviews start the moment the material lands — the gate is the review, not
    // the run. Fired per item so each one carries its own material's permissions
    // (Sessions v2 invariant 3): a colleague's sales call in the same batch as
    // your own standup cannot borrow your standup's permissions.
    const out: ArrivalOutcomeItemDTO[] = [];
    let reviewsFailed = 0;
    for (const item of result.items) {
      let session: { id: string; label: string } | undefined;
      if (item.followUp) {
        const handle = await fireSession(item.followUp.skill, item.followUp.prompt, { outbound: item.followUp.outbound });
        if (handle) session = { id: handle.sessionId, label: item.followUp.tabTitle };
        else reviewsFailed++;
      }
      out.push({
        name: item.name,
        kind: item.kind,
        ...(item.path ? { path: item.path } : {}),
        ...(item.dir ? { dir: item.dir } : {}),
        ...(item.title ? { title: item.title } : {}),
        ...(item.error ? { error: item.error } : {}),
        ...(session ? { session } : {}),
      });
    }
    for (const f of failed) out.push({ name: f.name, kind: 'note', error: f.error });

    const id = `arrival-${++arrivalSeq}`;
    arrivals.set(id, result.ledger);
    // Bounded so a long session's ledgers cannot grow without limit; the oldest
    // receipt is long gone from the screen by then.
    if (arrivals.size > 20) arrivals.delete(arrivals.keys().next().value!);

    return {
      id,
      ambition: result.ambition,
      ambitionAuto: result.ambitionAuto,
      items: out,
      reviews: out.filter((i) => i.session).length,
      reviewsFailed,
    };
  });

  handle('arrival:undo', async (id) => {
    const ledger = arrivals.get(id);
    if (!ledger) return { removed: [], restored: [] };
    const { removed, restored } = await undoArrival(vaultService.requireContext(), ledger);
    arrivals.delete(id);
    // Paths, not counts: the renderer has to close tabs that were showing a
    // note this just deleted, or the PO is left reading a file that is gone.
    return { removed, restored };
  });

  handle('search:query', (query, limit) =>
    searchNotes(vaultService.requireContext(), query, limit).map(hitToDTO),
  );

  handle('themes:byHeat', () =>
    getThemesByHeat(vaultService.requireContext()).map((r) => themeHeatToDTO(r)),
  );

  handle('proposals:list', (status) => {
    const ctx = vaultService.requireContext();
    // A card from a run the app started on its own clock carries the line that
    // says so. The ledger is the trail: no row ⇒ the PO asked for this one.
    // The effect facts are gathered once for the whole queue — an outbound card
    // needs the PO's own addresses to say who is outside their company.
    const effectFacts = outboundEffectFacts(ctx, settings.selfEmails());
    return listProposals(ctx, status).map((rec) =>
      proposalToDTO(rec, ctx.checks?.get(selfPrepKey(rec.sessionId)), effectFacts),
    );
  });
  handle('proposals:preview', (id) => previewProposal(vaultService.requireContext(), id));
  // Resolving the last card a session produced closes the review it was doing:
  // the meeting flips new → processed, as long as something was kept. When every
  // card was discarded nothing here knows the meeting was read, so it stays put
  // and the question comes back for the Inbox to ask. Best-effort: it never
  // blocks the resolve.
  const afterCardResolved = async (id: string): Promise<MeetingReviewAskDTO | undefined> => {
    const ctx = vaultService.context();
    const rec = ctx?.proposals.get(id);
    if (!ctx || !rec) return undefined;
    const review = await completeMeetingReview(ctx, rec.sessionId).catch(() => null);
    return review?.ask ?? undefined;
  };
  // Approving a decision card that supersedes an earlier one starts the
  // librarian to repoint whatever still cites the old decision. Hardcoded
  // dispatch — the file holds the instructions and the switch, the app holds
  // the trigger. The switch is not read here: fireSession is where it is
  // enforced, for every trigger at once. Depth-1 loop guard: the reaction's own
  // writes never re-trigger. Best-effort, and never blocks the accept.
  const fireSupersedeReactions = async (id: string): Promise<void> => {
    const ctx = vaultService.context();
    const rec = ctx?.proposals.get(id);
    if (!ctx || !rec || rec.kind !== 'decision') return;
    const supersedes = (rec.payload as { supersedes?: string })?.supersedes;
    if (!supersedes) return;
    void fireSession(
      'librarian',
      `Repoint references after a decision changed (${supersedes}). Search the memory for notes, insights, and hubs that still point at the old decision and propose updates pointing them at the new one, as approval cards. Write each card's reason in plain language — say "points at the newer decision", not "supersede".`,
    );
  };
  handle('proposals:accept', async (id, edited) => {
    const result = await acceptProposal(vaultService.requireContext(), id, edited);
    if (result.ok) await fireSupersedeReactions(id).catch(() => {});
    const review = await afterCardResolved(id);
    notifyProposalsFor();
    return review ? { ...result, review } : result;
  });
  handle('proposals:reject', async (id) => {
    const result = rejectProposal(vaultService.requireContext(), id);
    const review = await afterCardResolved(id);
    notifyProposalsFor();
    return review ? { ...result, review } : result;
  });
  handle('meeting:markReviewed', (path) => markMeetingReviewed(vaultService.requireContext(), path));
  handle('librarian:report', () => getMaintenanceReport(vaultService.requireContext()));
  handle('agent:run', async (input) => {
    const ctx = vaultService.requireContext();
    return agent.run(input, ctx, (streamId, chunk) => {
      pushEvent(getWindow(), { channel: 'agent:event', streamId, chunk });
    });
  });
  handle('agent:abort', (streamId) => agent.abort(streamId, vaultService.context() ?? undefined));

  handle('chats:list', () => agent.listChats());
  handle('chats:history', (sessionId) => ({ id: sessionId, messages: agent.chatHistory(sessionId) }));
  handle('chats:delete', async (sessionId) => {
    await agent.deleteChat(sessionId, vaultService.context() ?? undefined);
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
  handle('sessions:pendingAsk', (sessionId) =>
    agent.pendingAsk(sessionId, vaultService.context() ?? undefined),
  );
  handle('sessions:pendingAsks', () => agent.listPendingAsks(vaultService.context() ?? undefined));
  handle('sessions:resolveAsk', async (requestId, answers) => {
    // The context and the emitter are what let an answer reach a question whose
    // turn died with the last app run: without a live promise to resolve, the
    // session is reopened and the answer replayed into it (QM ticket 9).
    await agent.resolveAsk(requestId, { answers }, vaultService.context() ?? undefined, (streamId, chunk) => {
      pushEvent(getWindow(), { channel: 'agent:event', streamId, chunk });
    });
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

  /**
   * The same rule as main/index.ts: the PM_* variables are our verification
   * harness and a packaged build never reads them. Here that matters twice over
   * — PM_VAULT opens a folder with no picker, and PM_MCP starts the server and
   * prints its bearer token to the console.
   */
  const devEnv = (name: string): string | undefined => (is.dev ? process.env[name] : undefined);

  return {
    async onReady() {
      await settings.load();
      // Dev affordance: PM_VAULT opens a workspace without the picker.
      const saved = devEnv('PM_VAULT') ?? settings.get().vaultPath;
      if (saved) {
        try {
          const info = await vaultService.open(saved);
          void afterOpen();
          reconfigureAgent();
          console.log(`[pm] opened workspace "${info.name}" — ${info.noteCount} notes, git=${info.git}`);
          if (devEnv('PM_SEED_PROPOSAL')) void seedDemoProposal(vaultService.requireContext());
        } catch (err) {
          console.error('[pm] failed to open workspace:', err);
        }
      }
      // Start the app-open scheduler (idempotent; ticks no-op until a vault opens).
      scheduler.start();
      if (settings.get().mcpEnabled || devEnv('PM_MCP')) {
        await mcp.start(settings.get().mcpPort);
        if (devEnv('PM_MCP')) console.log(`[pm] MCP token: ${settings.get().mcpToken}`);
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
