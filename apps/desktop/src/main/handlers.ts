import { app, BrowserWindow, dialog, Notification } from 'electron';
import { is } from '@electron-toolkit/utils';
import { mkdir, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  AgentDTO,
  ArrivalItemInputDTO,
  ConnectionProgress,
  FirstStepId,
  MeetingReviewAskDTO,
  ModelInfoDTO,
  OpeningStepId,
  PathCheckDTO,
  SettingsDTO,
  SkillPackReviewDTO,
} from '@qale/ipc';
import { ageBand, countBand, durationBand, skillWord } from '@qale/ipc';
import {
  AgentRuntime,
  isOffered,
  sessionFilesRoot,
  writeSessionBinary,
  writeSessionFile,
} from '@qale/agent';
import {
  acceptProposal,
  completeMeetingReview,
  captureNote,
  captureNudgeState,
  captureTodo,
  createPerson,
  dismissCaptureNudge,
  undoCaptureNudge,
  deleteNote,
  ensureDefaultSkills,
  reviewSkillPack,
  applyShippedSkill,
  dismissSkillNotice,
  createSkill,
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
  planLibrarianSweep,
  markLibrarianHandled,
  markLibrarianRun,
  listProposals,
  previewProposal,
  rebuild,
  rejectProposal,
  renameNote,
  resolveLink,
  restoreNoteVersion,
  saveAuthoredNote,
  saveFrontmatter,
  searchNotes,
  setTodoStatus,
  type UseCaseContext,
} from '@qale/application';
import { detectSyncedFolder } from '@qale/application';
import { parseFrontmatter, readableAs, refToSlug, unreadableReason, type Frontmatter } from '@qale/domain';
import { atlassianAuthSchema } from '@qale/connectors';
import {
  ARRIVAL_AGENT_NAME,
  buildKickoff,
  DEFAULT_SKILLS,
  DEFAULT_AGENTS,
  RETIRED_SKILL_FILES,
  MAINTENANCE_AGENTS,
  MEETING_PREP_INSTRUCTION,
} from '@qale/sessions';
import { handle, pushEvent } from './ipc.js';
import { appVersion, buildDiagnostics } from './diagnostics.js';
import {
  CODE_RUN_FACTS,
  LIBRARIAN_SESSION_INTERVAL_MS,
  LIBRARIAN_SETTLE_MS,
  MEETING_PREP_LEAD_MS,
  MEETING_PREP_LEAD_PHRASE,
} from './agents.js';
import { setDockBadge } from './dock-badge.js';
import { seedDemoProposal } from './dev-seed.js';
import { Telemetry } from './telemetry.js';
import { SettingsService } from './services/settings-service.js';
import { verifyAnthropicKey } from './services/verify-key.js';
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
  themeHeatToDTO,
  proposalToDTO,
  skillToDTO,
  treeToDTO,
  vaultInfoToDTO,
} from './dto.js';

// Placeholder model list until pi's model runtime has a live key.
const MODELS: ModelInfoDTO[] = [
  { id: 'claude-opus-5', label: 'Claude Opus 5' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
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
  telemetry: Telemetry;
} {
  const settings = new SettingsService();
  /**
   * The one sender (docs/telemetry-posthog.md). It is built here because every
   * moment worth reporting already flows through these handlers; index.ts takes
   * it back off the return value for the crash hooks and the quit flush.
   *
   * Nothing it is handed may ever change, delay or fail what it observes. That
   * is the sender's own rule too — `send` swallows everything — so no call
   * below is awaited and none of them is wrapped in a try.
   */
  const telemetry = new Telemetry({
    appVersion: appVersion(),
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
  });
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
   * A question from a tidy pass nobody asked for is left out: it is offered
   * rather than owed, and a dock badge is not a surface anything gets offered
   * on. A librarian session the PM started themselves is owed like any other,
   * which is why the rule reads who started the run and not only which agent
   * asked.
   *
   * Declared as a function so it hoists over the VaultService callback above.
   */
  function refreshDockBadge(): void {
    const ctx = vaultService.context();
    if (!ctx) return setDockBadge(false);
    // The stored questions are asked as well as the in-memory ones: a question
    // parked before a quit is still waiting at the next launch (QM ticket 9),
    // and `parked` only knows about the runs THIS app run started.
    const asking =
      parked.size > 0 || !!ctx.asks?.list().some((a) => !isOffered(a.skill, a.unattended));
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
   * reentrancy fix: sync and the scan both take real time, and two overlapping
   * passes would each read the ledger before either had written it, then hand
   * the same findings to two sessions. Sync runs first so the scan sees fresh
   * mirrors.
   */
  let maintenanceInFlight: Promise<void> | null = null;
  const runMaintenance = (): Promise<void> => {
    if (maintenanceInFlight) return maintenanceInFlight;
    maintenanceInFlight = (async () => {
      await syncService.tick().catch((err) => {
        console.error('[qale] sync tick failed:', err instanceof Error ? err.message : err);
      });
      const ctx = vaultService.context();
      if (!ctx) return;
      // The librarian's off switch (its file's `enabled` frontmatter) is
      // enforced HERE, before the scan is entered: off has to mean nothing is
      // even looked at, not a hidden pass whose output is filtered later. The
      // key is read in the same breath and for the same reason the meeting
      // sweep reads it: without one the session cannot start, and a keyless
      // workspace would drip a failure notification every five minutes.
      // Connector sync and the index maps below aren't the agent's work, so
      // they keep running.
      if (settings.getAnthropicKey() && (await runnableEnabled(ctx, 'librarian'))) {
        const now = Date.now();
        // The scan and the ledger, and nothing else: what a finding MEANS is
        // read out of the notes, which is the session's job below.
        const work = await planLibrarianSweep(ctx, now, {
          settleMs: LIBRARIAN_SETTLE_MS,
          intervalMs: LIBRARIAN_SESSION_INTERVAL_MS,
        });
        if (work) {
          // `unattended: true`, and NOT `scheduled: true`. The two are not
          // interchangeable here: a scheduled run refuses to park a question at
          // all (AskParking.park returns straight away), and asking when it
          // cannot tell is half of what this agent is for. Unattended still
          // buys the quiet ending a pass that found nothing needs
          // (settleQuietly reads scheduled OR unattended) and leaves ask_user
          // working. `trigger` is only the word the finished run reports.
          const started = await fireSession(
            'librarian',
            buildKickoff({ skill: 'librarian', instruction: work.worklist }),
            { trigger: 'scheduled', unattended: true, modelId: BACKGROUND_MODEL_ID },
          );
          // Stamped only once a session really started. A run blocked by a
          // missing key must leave every finding for the next pass rather than
          // marking them handled by something that never read them.
          if (started) {
            markLibrarianHandled(ctx, work.findings, now);
            markLibrarianRun(ctx, now);
          }
        } else {
          // A look, not a run — the same distinction meeting-prep makes, and
          // most ticks are looks.
          agentLastChecked.set('librarian', Date.now());
        }
      }
      // Refresh the OKF index.md orientation maps from the (now reconciled)
      // index. Idempotent — no write, no commit when nothing changed.
      const idx = await generateIndexFiles(ctx);
      if (idx.written.length > 0) pushEvent(getWindow(), { channel: 'vault:changed', paths: idx.written });
    })()
      .catch((err) => {
        // The tick must never surface as an unhandledRejection (it fires every
        // 5 minutes — offline would mean a steady drip of them).
        console.error('[qale] maintenance pass failed:', err instanceof Error ? err.message : err);
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
        console.log(`[qale] moved ${migrated.moved.length / 2} skill/agent file(s) into folders`);
      for (const path of migrated.left)
        console.warn(`[qale] ${path} differs from its folder copy — left both in place, nothing lost`);
      // Seed what is missing, quietly update what nobody has touched, and take
      // retired files out of force. Anything the PM edited is left exactly as it
      // is; the Skills page offers those as a review (`skills:review`).
      const pack = await ensureDefaultSkills(ctx, [...DEFAULT_SKILLS, ...DEFAULT_AGENTS], RETIRED_SKILL_FILES);
      const touched = [...pack.seeded, ...pack.updated, ...pack.removed];
      if (touched.length > 0) pushEvent(getWindow(), { channel: 'vault:changed', paths: touched });
      // One-time migration: agent off switches used to live in settings; the
      // frontmatter is the switch now. Carry the recorded intent over, once.
      const overrides = await settings.takeAgentOverrides();
      for (const [id, on] of Object.entries(overrides ?? {})) {
        if (on === false) await setAgentFileEnabled(ctx, id, false);
      }
      await runMaintenance();
      notifyProposalsFor();
    } catch (err) {
      console.error('[qale] post-open sweep failed:', err instanceof Error ? err.message : err);
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

  /**
   * How far one provider got, read live off the sync engine rather than stored
   * (docs/onboarding.md ONB-8). "Connected" is not the finish line: a
   * connection with nothing followed reads nothing at all, so its First step
   * row stays unticked and says so.
   */
  const connectionProgress = (providerId: string): ConnectionProgress => {
    const conns = syncService.list().filter((c) => c.providerId === providerId);
    if (conns.length === 0) return 'none';
    return conns.some((c) => c.containers.some((k) => k.followed)) ? 'following' : 'connected';
  };

  const settingsDTO = (): SettingsDTO => {
    const s = settings.get();
    const onboarding = settings.getOnboarding();
    return {
      vaultPath: vaultService.currentVaultPath() ?? s.vaultPath,
      appVersion: appVersion(),
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
      onboarding: {
        ...onboarding,
        step: onboarding.step as OpeningStepId,
        done: onboarding.done as OpeningStepId[],
        connections: {
          google: connectionProgress('google-calendar'),
          atlassian: connectionProgress('atlassian'),
        },
      },
    };
  };

  /**
   * Settings moved without anyone asking for them — a First step ticking
   * itself off, a connection verifying, a key saved in another window. Every
   * mutation that the renderer did not itself invoke goes out this way, which
   * is what lets the First steps card check a row the moment the thing happens
   * rather than at the next reload.
   */
  const pushSettings = (): void => {
    pushEvent(getWindow(), { channel: 'settings:changed', settings: settingsDTO() });
  };

  /**
   * What this install looks like as counts and flags — the same four facts the
   * person record and `app.launched` both want, read live rather than stored.
   */
  const telemetryFacts = (): { hasKey: boolean; google: boolean; atlassian: boolean; notes: string } => ({
    hasKey: !!settings.getAnthropicKey(),
    google: connectionProgress('google-calendar') !== 'none',
    atlassian: connectionProgress('atlassian') !== 'none',
    notes: countBand(vaultService.context()?.index.count() ?? 0),
  });

  /**
   * Hand the sender the consent switch and who this is (TEL-4, TEL-6).
   *
   * `answered` is the half that is easy to get wrong: the switch defaults to
   * true, so on a first run it would read as "on" for five screens before
   * anyone had been asked. Only reaching the telemetry screen counts, and
   * events raised before that wait in memory for the answer. An install
   * grandfathered past the opening carries `finishedAt`, so it is answered from
   * launch — it kept the default it was given.
   */
  const syncTelemetryConsent = (): void => {
    const onboarding = settings.getOnboarding();
    const answered =
      !!onboarding.finishedAt ||
      onboarding.done.includes('telemetry') ||
      onboarding.skipped.includes('telemetry');
    telemetry.setConsent(onboarding.telemetry, answered);
    const identity = settings.getIdentity();
    // The first alias is the work address screen 2 asked for. The connected
    // accounts' addresses are not offered here: they arrived as a side effect
    // of a grant, and TEL-4's promise is about the one they typed in.
    const email = identity.aliases[0];
    telemetry.describe({
      ...(identity.name ? { name: identity.name } : {}),
      ...(email ? { email } : {}),
      ...telemetryFacts(),
    });
  };

  /**
   * Stamp a First step, once, with the line that says what happened. Fire and
   * forget from wherever the real event already flows — none of these may ever
   * block or fail the thing they are observing.
   */
  const markFirstStep = (id: FirstStepId, line: string): void => {
    void settings
      .markFirstStep(id, line)
      .then((landed) => {
        if (landed) pushSettings();
      })
      .catch(() => {});
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

  /**
   * When a session started, and what started it. Neither rides on the status
   * signal, and both are wanted at the far end of a run that can take minutes.
   * In memory only: a run that spans a quit reports no duration rather than a
   * made-up one.
   */
  const sessionStarted = new Map<string, number>();
  const sessionTrigger = new Map<string, string>();

  /**
   * What a run the app started for ITSELF opens on. A background tidy pass is
   * quick, repetitive reading over a worklist, which is exactly the work the
   * fast model is good at and exactly the work nobody wants to pay top rate for
   * every half hour. Sessions a person started keep the model they chose in
   * Settings.
   */
  const BACKGROUND_MODEL_ID = 'claude-sonnet-5';

  const fireSession = async (
    skill: string,
    prompt: string,
    opts?: {
      /** Whether the firing trigger lets this arrival draft outbound (invariant 3). */
      outbound?: boolean;
      /**
       * What to report this run as when it settles. Only the caller knows; the
       * status signal carries no trigger. `scheduled` below already names the
       * two clock-started paths, so this only has to be set where material
       * arriving is what started the run.
       */
      trigger?: 'manual' | 'scheduled' | 'arrival';
      /**
       * A clock started this, not a person (QM ticket 2). Only the two triggers
       * that genuinely tick set it: a schedule's slot and the before-meeting
       * sweep. "Run now", a capture, an arrival and a reaction to an approved
       * card all have someone waiting, so none of them may go silent.
       */
      scheduled?: boolean;
      /**
       * Nobody is at the screen right now, but somebody will come back (an
       * arrival). It buys silence for a run that turned out to be pure filing
       * and keeps `ask_user` working, which `scheduled` does not.
       */
      unattended?: boolean;
      /**
       * Which model to open on. The pin outlives the run: `run()` writes it to
       * the session's model sidecar, so a librarian session the PM opens
       * tomorrow is still on the quick model until they pick another one in
       * that session's own picker.
       */
      modelId?: string;
      /**
       * Run in THIS session rather than a fresh one. Arrival mints the id first
       * so it can write the material into the session's folder before any model
       * call; the session it starts has to be that one.
       */
      sessionId?: string;
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
      console.log(`[qale] ${skill} is switched off, not firing it`);
      return null;
    }
    try {
      // run() returns immediately with the session id; chunks + settle stream via
      // agent.onStatus. Handing the id back lets capture open a live watch tab.
      const handle = await agent.run(
        {
          skill,
          prompt,
          ...(opts?.sessionId ? { sessionId: opts.sessionId } : {}),
          ...(opts?.modelId ? { modelId: opts.modelId } : {}),
          ...(opts?.outbound ? { outbound: true } : {}),
          ...(opts?.scheduled ? { scheduled: true } : {}),
          ...(opts?.unattended ? { unattended: true } : {}),
        },
        ctx,
        () => {},
      );
      // A file agent's "last ran" stamp — same ledger the code watchers use, so
      // the Agents view answers "when did this last fire" for both kinds.
      agentLastRun.set(skill, Date.now());
      // Recorded against the id rather than threaded through the runtime: a
      // session that settles minutes later has to be able to say what started
      // it, and the runtime has no reason to carry that.
      sessionTrigger.set(
        handle.sessionId,
        opts?.trigger ?? (opts?.scheduled ? 'scheduled' : 'manual'),
      );
      return { sessionId: handle.sessionId };
    } catch (err) {
      // Every caller is fire-and-forget (`void fireSession(...)`): a run that
      // dies here — most often "no API key yet" — must surface, not become an
      // unhandled rejection while the PO waits for cards that never come.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[qale] background ${skill} session failed:`, message);
      if (Notification.isSupported()) {
        new Notification({ title: 'Session failed', body: message, silent: true }).show();
      }
      return null;
    }
  };

  // Before-meeting auto-prep (the `meeting-prep` agent): synced meetings starting
  // within the lead window get their brief prepared on the meeting page — the
  // owning-view stance: a nudge belongs where the work it is about lives. It
  // never fires while a card is already pending or a `## Prep` section has been
  // accepted, and it is gated on an API key so a keyless workspace never drips
  // failure notifications.
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
        buildKickoff({ skill: 'meeting-prep', targets: [m.notePath], instruction: MEETING_PREP_INSTRUCTION }),
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

  // The fan-out approval card, inline in the chat. Nothing runs until it
  // settles. A tidy pass nobody asked for may not badge the dock over its own
  // spending, though, any more than it may over its own questions.
  agent.onSpawnRequest = (sessionId, request) => {
    pushEvent(getWindow(), { channel: 'session:spawn', sessionId, request });
    setParked(`spawn:${sessionId}`, !!request && !request.offered);
  };

  // The agent is asking the PM something mid-turn — the run is parked on it.
  // An offered question is drawn like any other but never counted: nobody asked
  // for that run, so nothing it asks is owed. Clearing goes through either way,
  // and a key that was never added deletes to nothing.
  agent.onAskRequest = (sessionId, request) => {
    pushEvent(getWindow(), { channel: 'session:ask', sessionId, request });
    setParked(`ask:${sessionId}`, !!request && !request.offered);
  };

  // Session lifecycle → renderer rail/badges, plus an OS notification when a
  // background run finishes while the PO is elsewhere (nothing silent).
  agent.onStatus = (s) => {
    const ctx = vaultService.context();
    const pendingCards = ctx
      ? ctx.proposals.list('pending').filter((p) => p.sessionId === s.sessionId).length
      : 0;
    pushEvent(getWindow(), { channel: 'session:status', ...s, pendingCards });
    // The clock for `session.finished`. First `running` only: a run parked on a
    // mid-turn question comes back through here when it resumes, and the second
    // start would report a fraction of the time it actually took.
    if (s.status === 'running' && !sessionStarted.has(s.sessionId))
      sessionStarted.set(s.sessionId, Date.now());
    if (s.status !== 'settled') return;
    notifyProposalsFor();
    const startedAt = sessionStarted.get(s.sessionId);
    sessionStarted.delete(s.sessionId);
    const trigger = sessionTrigger.get(s.sessionId) ?? 'manual';
    sessionTrigger.delete(s.sessionId);
    telemetry.send('session.finished', {
      // Folded to something we wrote: a PM's own skill is named in their own
      // words, so the name itself is their material.
      skill: skillWord(s.skill),
      trigger,
      // Omitted rather than guessed when the start is gone.
      ...(startedAt ? { duration: durationBand(Date.now() - startedAt) } : {}),
      // `SessionStatus` reports "settled, any outcome" and nothing here can
      // tell a run that failed from one that finished. False is the honest
      // answer until the runtime carries the distinction.
      failed: false,
      cards: countBand(pendingCards),
    });
    // Two First steps are "a session of this kind finished" (ONB-8): a meeting
    // prepped, and a question asked of the memory. Read off the signal that
    // already fires rather than a second ledger that could disagree with it.
    if (s.skill === 'meeting-prep') {
      markFirstStep(
        'prep',
        pendingCards > 0
          ? `Prepped a meeting, and the brief is waiting as a card`
          : `Prepped a meeting and found nothing worth briefing`,
      );
    } else if (s.skill === 'chat' && !s.quiet) {
      markFirstStep('ask', 'Answered a question from your own notes');
    }
    // A scheduled run that had nothing to report leaves no receipt, no row and
    // no badge (QM ticket 2). A notification saying "Finished" would undo all
    // three at once, so it is the last thing to go.
    //
    // A tidy pass that DID find something is not quiet, and still says nothing
    // here: a notification is the loudest thing the app can do, and what the
    // librarian leaves behind is the one kind of work that is never owed. It
    // waits in the Inbox, where it costs nothing to find later.
    if (s.quiet || MAINTENANCE_AGENTS.has(s.skill ?? '')) return;
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

  // Everything a bug report needs and nothing that says who sent it: counts and
  // booleans off the open workspace, provider labels off the connections (never
  // their site or account), and the scrubbed log tail.
  handle('diagnostics:report', async () => {
    const ctx = vaultService.context();
    const info = ctx ? await getVaultInfo(ctx).catch(() => null) : null;
    const s = settings.get();
    return buildDiagnostics({
      workspace: info
        ? {
            noteCount: info.noteCount,
            git: info.git,
            gitAvailable: info.gitAvailable,
            synced: info.syncedBy !== null,
          }
        : null,
      keychainAvailable: settings.secretsEncrypted(),
      hasApiKey: !!settings.getAnthropicKey(),
      // Read after the key getter above: that read is what trips the flag.
      secretsUnreadable: settings.secretsUnreadable(),
      modelId: s.modelId,
      connectors: syncService.list().map((c) => ({ label: c.providerLabel, health: c.health })),
      mcp: { enabled: s.mcpEnabled, port: s.mcpPort, running: mcp.isRunning() },
      // The one id in the block, and the reason a pasted report can be lined up
      // against its own event stream (TEL-4).
      installId: settings.getInstallId(),
    });
  });

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
  handle('settings:verifyAnthropicKey', (key) => verifyAnthropicKey(key));
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
      throw new Error('Check the site URL, email and API token. One of them looks malformed.');
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
    if (result.ok) {
      reconfigureAgent();
      // The two First steps rows read connection state live — a connect made
      // from Settings months later still ticks its row (ONB-8).
      pushSettings();
      // Which connectors exist is part of who this install is, so the person
      // record follows the connect rather than waiting for the next launch.
      syncTelemetryConsent();
      // The provider ids are ours; anything the allowlist has no word for is
      // not reported at all rather than reported as something else.
      const provider =
        providerId === 'google-calendar' ? 'google' : providerId === 'atlassian' ? 'atlassian' : null;
      if (provider)
        telemetry.send('connection.added', {
          provider,
          // Connected is not the finish line — how much they follow is the
          // thing worth knowing, and it is a band like every other count.
          following: countBand(
            syncService
              .list()
              .reduce((n, c) => n + c.containers.filter((k) => k.followed).length, 0),
          ),
        });
    }
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
    pushSettings();
  });
  handle('connections:setFollow', async (connectionId, containerId, followed) => {
    await syncService.setFollow(connectionId, containerId, followed);
    // Following the first container is what turns "connected" into a row that
    // can honestly tick — half-done counts as not done.
    pushSettings();
  });
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
  // The pack review. Agents are in the same list on purpose: they are the same
  // kind of file, shipped the same way, and the PM meets both on the Skills page
  // rather than being sent to two places for one set of changes.
  const packFiles = [...DEFAULT_SKILLS, ...DEFAULT_AGENTS];
  const packReview = (): Promise<SkillPackReviewDTO> =>
    reviewSkillPack(vaultService.requireContext(), packFiles, RETIRED_SKILL_FILES);
  handle('skills:review', packReview);
  handle('skills:applyUpdate', async (file) => {
    const ctx = vaultService.requireContext();
    if (await applyShippedSkill(ctx, packFiles, file))
      pushEvent(getWindow(), { channel: 'vault:changed', paths: [file] });
    return packReview();
  });
  handle('skills:dismissUpdate', async (file) => {
    dismissSkillNotice(vaultService.requireContext(), packFiles, file);
    return packReview();
  });
  handle('skills:create', async (title) => {
    const ctx = vaultService.requireContext();
    const { path } = await createSkill(ctx, title);
    pushEvent(getWindow(), { channel: 'vault:changed', paths: [path] });
    return { path };
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
    // The name and work email ARE the person record (TEL-4), so editing them
    // has to reach the sender in the same tick.
    syncTelemetryConsent();
    return settingsDTO();
  });
  handle('settings:setOnboarding', async (patch) => {
    await settings.patchOnboarding(patch);
    // The consent switch lives in this record, and so does whether it has been
    // answered yet. Both go first: the step events below are themselves subject
    // to the answer this patch may have just given.
    syncTelemetryConsent();
    if (patch.done) telemetry.send('onboarding.step', { step: patch.done, action: 'done' });
    else if (patch.skipped)
      telemetry.send('onboarding.step', {
        // The connections screen records its skips per provider
        // (`connections:<id>`), and the screen is what we asked about.
        step: patch.skipped.startsWith('connections:') ? 'connections' : patch.skipped,
        action: 'skipped',
      });
    // The screen they finished on, which is the last one. A patch that only
    // flips the switch or puts the First steps card away says nothing about
    // progress, so it sends nothing at all.
    if (patch.finished)
      telemetry.send('onboarding.step', { step: settings.getOnboarding().step, action: 'finished' });
    // Other windows and the Settings mirror of the telemetry switch follow the
    // same record; the caller gets the DTO back directly either way.
    pushSettings();
    return settingsDTO();
  });
  // Which parts of the app get opened — the one thing only the renderer knows
  // (TEL-5). A view kind and nothing else; the allowlist refuses anything that
  // is not one of ours, so a wrong string is dropped rather than sent.
  handle('telemetry:view', (view) => {
    telemetry.send('view.opened', { view });
  });
  handle('models:list', async () => {
    const live = await agent.listModels();
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

  /**
   * What a folder would be as a workspace, asked BEFORE anything is written to
   * it. The sync warning has to land before the scaffold, not after: telling
   * someone their workspace is in iCloud once we have already put files there
   * is a report, not a choice (ONB-4).
   */
  const checkPath = async (path: string): Promise<PathCheckDTO> => {
    let exists = false;
    let hasNotes = false;
    try {
      const info = await stat(path);
      exists = info.isDirectory();
      if (exists) {
        const entries = await readdir(path).catch(() => []);
        hasNotes = entries.some((e) => e.toLowerCase().endsWith('.md'));
      }
    } catch {
      // Not there yet is the ordinary case for the suggested path.
    }
    // The sync check is path-shaped, and the give-away segment is often behind
    // a symlink: with "Desktop & Documents in iCloud" on, ~/Documents IS a link
    // into the iCloud container, and the literal path says nothing. Resolve the
    // deepest ancestor that exists, then check the whole thing.
    let canonical = path;
    try {
      const anchor = exists ? path : join(path, '..');
      canonical = join(await realpath(anchor), exists ? '.' : basename(path));
    } catch {
      // An unresolvable parent just means we check the literal path.
    }
    return { path, exists, hasNotes, syncedBy: detectSyncedFolder(canonical) };
  };

  // ~/Documents is the folder people already keep documents in, and on a Mac
  // with Desktop & Documents syncing it is inside iCloud — which the check
  // above catches and says so, rather than us quietly picking somewhere the
  // PM would never think to look for their own files.
  handle('vault:suggestPath', () => checkPath(join(app.getPath('documents'), 'Qale')));
  handle('vault:checkPath', (path) => checkPath(path));
  handle('vault:create', async (path) => {
    // Recursive and forgiving: an existing folder is opened as it stands (an
    // Obsidian vault arrives this way too), a missing one is made.
    await mkdir(path, { recursive: true });
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
    // Editing the about-us skill is the step that teaches the biggest idea in
    // the product: the instructions are files, and they are yours to change.
    if (input.path.startsWith('skills/_about-us/')) {
      markFirstStep('about-us', 'Told it about your product, and every session reads this now');
    }
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
  handle('note:restoreVersion', async (input) => {
    const note = await restoreNoteVersion(vaultService.requireContext(), input);
    return noteToDTO(note);
  });

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
  // -------------------------------------------------------------------------
  // Arrival (docs/arrival-agentic.md)
  //
  // Landing is mechanical and judgment is the skill's. Everything below is
  // bytes: read the files, refuse the ones that are not text, write what is
  // left into a fresh session folder, and start the agent that reads them. What
  // each thing IS, where it belongs, and whether it earns a full read are all
  // decided inside that session, out loud, where a correction is just typing.
  // -------------------------------------------------------------------------

  /** One piece of material, resolved to bytes or refused with a reason. */
  type Landing = { name: string; text?: string; data?: Uint8Array; error?: string };

  /** A last line of defence for extensionless files: real text has no NULs. */
  const looksBinary = (buf: Buffer): boolean => {
    const head = buf.subarray(0, 8000);
    if (head.includes(0)) return true;
    const text = head.toString('utf8');
    let bad = 0;
    for (const ch of text) if (ch === '�') bad++;
    return bad > text.length * 0.02;
  };

  /**
   * How many files one drop may pull in. A dropped folder is the front door of
   * the backlog story, and it is also how somebody accidentally hands over their
   * whole Downloads directory. Everything past the cap is reported rather than
   * silently dropped.
   */
  const FOLDER_FILE_CAP = 200;

  /** Every file under a dropped folder, breadth-first, skipping dotfiles. */
  const walkFolder = async (dir: string): Promise<string[]> => {
    const found: string[] = [];
    const queue = [dir];
    while (queue.length > 0 && found.length < FOLDER_FILE_CAP) {
      const current = queue.shift()!;
      const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.')) continue;
        const abs = join(current, entry.name);
        if (entry.isDirectory()) queue.push(abs);
        else if (entry.isFile() && found.length < FOLDER_FILE_CAP) found.push(abs);
      }
    }
    return found;
  };

  /** Read one file off disk into material, or refuse it by name. */
  const readOne = async (path: string, name: string): Promise<Landing> => {
    try {
      const buf = await readFile(path);
      const kind = readableAs(name);
      if (kind === 'image') return { name, data: new Uint8Array(buf) };
      if (kind === null || looksBinary(buf)) return { name, error: unreadableReason(name) };
      const text = buf.toString('utf8');
      // An honest empty-file message: "0 bytes" is a fact the PM can act on,
      // where "not readable text" sends them looking for a converter (AR-14).
      if (!text.trim()) return { name, error: 'the file is empty' };
      return { name, text };
    } catch (err) {
      return { name, error: err instanceof Error ? err.message : 'could not be read' };
    }
  };

  /**
   * Turn wire items into material. A `path` (from the picker, or from a drop —
   * the preload hands back the real path) is read here, so fifty files never
   * cross IPC as base64 and a dropped FOLDER can be walked at all. Anything the
   * renderer already holds rides in as it is.
   */
  const resolveItems = async (items: ArrivalItemInputDTO[]): Promise<Landing[]> => {
    const out: Landing[] = [];
    for (const item of items) {
      if (item.path) {
        const info = await stat(item.path).catch(() => null);
        if (info?.isDirectory()) {
          const files = await walkFolder(item.path);
          if (files.length === 0) {
            out.push({ name: basename(item.path), error: 'the folder has nothing readable in it' });
            continue;
          }
          for (const file of files) out.push(await readOne(file, basename(file)));
          if (files.length >= FOLDER_FILE_CAP) {
            out.push({
              name: basename(item.path),
              error: `only the first ${FOLDER_FILE_CAP} files were taken — drop the rest separately`,
            });
          }
          continue;
        }
        out.push(await readOne(item.path, item.name ?? basename(item.path)));
        continue;
      }
      if (item.dataBase64) {
        out.push({ name: item.name ?? 'image.png', data: new Uint8Array(Buffer.from(item.dataBase64, 'base64')) });
        continue;
      }
      if (item.text?.trim()) {
        out.push({ name: item.name ?? 'pasted.md', text: item.text });
        continue;
      }
      out.push({ name: item.name ?? 'unnamed', error: unreadableReason(item.name ?? '') });
    }
    return out;
  };

  handle('arrival:pick', async () => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Add material',
      buttonLabel: 'Add',
      // Folders too: a quarter of old interviews is a folder, not forty
      // shift-clicks, and it is the front door of the backlog story.
      properties: ['openFile', 'openDirectory', 'multiSelections'],
    });
    if (result.canceled) return [];
    // Only the path and a name travel back; the bytes stay on this side.
    return result.filePaths.map((path) => ({ path, name: basename(path) }));
  });

  handle('arrival:check', async (items) => {
    const landed = await resolveItems(items);
    return {
      items: landed.map((l) => ({ name: l.name, ...(l.error ? { error: l.error } : {}) })),
      empty: landed.length > 0 && landed.every((l) => l.error),
    };
  });

  /**
   * A file name safe to write inside the session folder, and unique within it.
   * The original name is worth keeping — it is often the only date and title the
   * material carries — so this only takes out what a path cannot hold.
   */
  const materialName = (raw: string, taken: Set<string>): string => {
    const base = (raw.split(/[\\/]/).pop() ?? 'material').replace(/[^\p{L}\p{N}._ -]+/gu, '-').slice(0, 120);
    let name = base || 'material';
    let n = 2;
    while (taken.has(name.toLowerCase())) {
      name = base.replace(/(\.[a-z0-9]+)$|$/i, `-${n}$1`);
      n++;
    }
    taken.add(name.toLowerCase());
    return name;
  };

  handle('arrival:ingest', async (items, instruction) => {
    const ctx = vaultService.requireContext();
    const landed = await resolveItems(items);
    const good = landed.filter((l) => !l.error);
    const refused = landed.flatMap((l) => (l.error ? [{ name: l.name, error: l.error }] : []));

    // The session id is minted here, before anything runs, because the folder is
    // named after it: the material has to be on disk before a model is asked for
    // anything, so a missing API key costs nothing but a delay.
    const sessionId = randomUUID();
    const root = sessionFilesRoot(ctx.vault.root(), sessionId);
    const taken = new Set<string>();
    const written: { file: string; original: string; bytes: number }[] = [];
    for (const piece of good) {
      const name = materialName(piece.name, taken);
      const file = `material/${name}`;
      if (piece.data) await writeSessionBinary(root, file, piece.data);
      else await writeSessionFile(root, file, piece.text ?? '');
      written.push({ file, original: piece.name, bytes: piece.data?.byteLength ?? (piece.text ?? '').length });
    }

    /**
     * Meetings the calendar holds around now, offered as CANDIDATES and said to
     * be a hint (AR-1). The old pipeline picked one of these by clock and
     * attached the transcript to it before anything had read a line, which put
     * a call that ran long onto the meeting after it. Handing over the list
     * costs nothing and leaves the decision where it can actually be made.
     */
    const candidates = syncService
      .meetingCandidates(Date.now(), 7 * 24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000)
      .map((m) => `- ${m.notePath} — “${m.title}”, ${new Date(m.startMs).toISOString().slice(0, 16).replace('T', ' ')}`);

    // A manifest, so the agent starts from a list rather than a directory walk,
    // and so the PM opening the session folder tomorrow can see what arrived.
    const manifest = [
      `# What arrived`,
      ``,
      `${written.length} piece${written.length === 1 ? '' : 's'} of material, handed over ${ctx.clock.now()}.`,
      ``,
      ...written.map((w) => `- \`${w.file}\` — dropped as "${w.original}", ${w.bytes} bytes`),
      ...(refused.length
        ? ['', 'Could not be read, so they are not here:', ...refused.map((r) => `- ${r.name}: ${r.error}`)]
        : []),
      ...(instruction?.trim() ? ['', '## What the PM asked for', '', instruction.trim()] : []),
      ...(candidates.length
        ? [
            '',
            '## Meetings on the calendar near now',
            '',
            'A hint and nothing more. Match a transcript on its own date, title and who speaks in it;',
            'if the clock and the transcript disagree, the transcript is right.',
            '',
            ...candidates,
          ]
        : []),
    ].join('\n');
    await writeSessionFile(root, 'arrival.md', `${manifest}\n`);
    pushEvent(getWindow(), { channel: 'session:files', sessionId });

    // One event per drop, saying how it arrived and nothing about what is in it.
    const kind = good.some((g) => g.data) ? 'image' : items.some((i) => i.text && !i.path) ? 'text' : 'file';
    telemetry.send('material.added', {
      kind,
      count: countBand(written.length),
      startedSession: written.length > 0,
    });

    if (written.length === 0) {
      return { sessionId, landed: 0, refused, started: false, reason: 'Nothing in that batch could be read.' };
    }

    const prompt = buildKickoff({
      skill: ARRIVAL_AGENT_NAME,
      instruction: [
        `${written.length} piece${written.length === 1 ? '' : 's'} of material just landed in your session folder, unfiled.`,
        `Read \`arrival.md\` for the list, work out what each thing is, file it, and read what is worth reading.`,
        instruction?.trim() ? `What I asked for when I handed them over, which takes precedence: ${instruction.trim()}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    });
    const started = await fireSession(ARRIVAL_AGENT_NAME, prompt, {
      trigger: 'arrival',
      unattended: true,
      sessionId,
    });
    if (!started) {
      return {
        sessionId,
        landed: written.length,
        refused,
        started: false,
        reason: settings.getAnthropicKey()
          ? 'Handle new material is switched off, so nothing is reading these yet.'
          : 'Set an Anthropic API key in Settings and these will be read.',
      };
    }

    // The First step the whole product hangs off: real material went in, and
    // something started reading it.
    markFirstStep(
      'transcript',
      written.length === 1
        ? `Handed over “${written[0]!.original}”. It is being filed and read now`
        : `Handed over ${written.length} pieces of material. They are being filed and read now`,
    );
    return { sessionId, landed: written.length, refused, started: true };
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
    // The accept that just ran parsed this payload, so both slugs are here as
    // the spine wrote them: the replaced decision, and the one that landed.
    const payload = rec.payload as { supersedes?: string; path?: string };
    const replaced = refToSlug(payload.supersedes);
    const landed = refToSlug(payload.path);
    if (!replaced || !landed) return;
    // The kickoff is the event and nothing more. What a repoint is, that the
    // spine is append-only, and that a note contradicting the new decision gets
    // flagged rather than rewritten all live in the librarian's own file now,
    // where the PM can read them and change them.
    void fireSession(
      'librarian',
      buildKickoff({
        skill: 'librarian',
        instruction: `[[${replaced}]] was replaced by [[${landed}]]. Repoint what still cites the old one.`,
      }),
      // A reaction to material the PO just kept, not a run they asked for.
      { trigger: 'arrival' },
    )
      .then((started) => {
        // The scheduled sweep paces itself off this stamp, so a session started
        // here has to count as the librarian having just run. Without it the
        // next tick would happily stack a second session on top of this one.
        if (started) markLibrarianRun(ctx, Date.now());
      })
      // This runs long after the accept returned, so the caller's own catch is
      // no longer around to hold it. Closing the workspace between the two is
      // enough to throw here, and a stamp that missed is worth one line in the
      // log, never a crash.
      .catch((err) => {
        console.error(
          '[qale] recording the supersede reaction failed:',
          err instanceof Error ? err.message : err,
        );
      });
  };
  /**
   * What a card was before the decision landed. Read first because accept and
   * reject both rewrite the row, and its age stops being answerable the moment
   * they do. Nothing it does may reach the decision: a lookup added for
   * reporting that could throw the handler would be the exact failure the
   * sender's own rules are written to prevent.
   */
  const cardFacts = (id: string): { kind: string; age: string } | null => {
    try {
      const rec = vaultService.context()?.proposals.get(id);
      return rec ? { kind: rec.kind, age: ageBand(Date.now() - rec.created) } : null;
    } catch {
      return null;
    }
  };
  handle('proposals:accept', async (id, edited) => {
    const card = cardFacts(id);
    const result = await acceptProposal(vaultService.requireContext(), id, edited);
    if (result.ok) {
      // A card handed back with `edited` is one they changed before keeping.
      telemetry.send('card.decided', {
        decision: 'accepted',
        edited: edited !== undefined,
        ...(card ?? {}),
      });
      await fireSupersedeReactions(id).catch(() => {});
    }
    const review = await afterCardResolved(id);
    notifyProposalsFor();
    if (result.ok) markFirstStep('proposal', 'Approved your first card, and it went into the memory');
    return review ? { ...result, review } : result;
  });
  handle('proposals:reject', async (id) => {
    const card = cardFacts(id);
    const result = rejectProposal(vaultService.requireContext(), id);
    // Nothing was edited on the way to passing on a card.
    if (result.ok)
      telemetry.send('card.decided', { decision: 'rejected', edited: false, ...(card ?? {}) });
    const review = await afterCardResolved(id);
    notifyProposalsFor();
    // Passing on a card teaches the loop exactly as well as keeping one: the
    // step is "you decided", not "you agreed".
    markFirstStep('proposal', 'Passed on your first card, so nothing was written');
    return review ? { ...result, review } : result;
  });
  handle('meeting:markReviewed', (path) => markMeetingReviewed(vaultService.requireContext(), path));

  // The capture nudge's memory. Reads are cheap and local; the renderer holds
  // the derivation and only asks here what the PO already answered.
  handle('captureNudge:state', () => captureNudgeState(vaultService.requireContext()));
  handle('captureNudge:dismiss', (path) =>
    dismissCaptureNudge(vaultService.requireContext(), path, Date.now()),
  );
  handle('captureNudge:undo', (path, series) =>
    undoCaptureNudge(vaultService.requireContext(), path, series),
  );
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
   * The same rule as main/index.ts: the QALE_* variables are our verification
   * harness and a packaged build never reads them. Here that matters twice over
   * — QALE_VAULT opens a folder with no picker, and QALE_MCP starts the server and
   * prints its bearer token to the console.
   */
  const devEnv = (name: string): string | undefined => (is.dev ? process.env[name] : undefined);

  return {
    async onReady() {
      await settings.load();
      // Who the events are from. Nothing can go out before this, so it happens
      // the moment settings exist and before anything else here can report.
      telemetry.bind(settings.getInstallId());
      // Straight away, and again at the end: until the switch has been read,
      // the sender drops rather than holds, and opening a large workspace is
      // long enough for something to happen in that gap.
      syncTelemetryConsent();
      // Read before the workspace opens: an install that has never been set up
      // has neither a finished opening nor a folder to point at.
      const firstRun = !settings.getOnboarding().finishedAt && !settings.get().vaultPath;
      // Dev affordance: QALE_VAULT opens a workspace without the picker.
      const saved = devEnv('QALE_VAULT') ?? settings.get().vaultPath;
      if (saved) {
        try {
          const info = await vaultService.open(saved);
          void afterOpen();
          reconfigureAgent();
          // Not the workspace name: this line is captured for diagnostics, and
          // the folder someone names their product memory after is theirs.
          console.log(`[qale] opened workspace: ${info.noteCount} notes, git=${info.git}`);
          if (devEnv('QALE_SEED_PROPOSAL')) void seedDemoProposal(vaultService.requireContext());
        } catch (err) {
          console.error('[qale] failed to open workspace:', err);
        }
      }
      // Start the app-open scheduler (idempotent; ticks no-op until a vault opens).
      scheduler.start();
      if (settings.get().mcpEnabled || devEnv('QALE_MCP')) {
        await mcp.start(settings.get().mcpPort);
        if (devEnv('QALE_MCP')) console.log(`[qale] MCP token: ${settings.get().mcpToken}`);
      }
      // Again here so the person's note count is the one the opened workspace
      // actually has, and the launch event carries the same number. On a first
      // run the consent screen is still several steps away, so this event waits
      // in memory for the answer rather than going out ahead of it.
      syncTelemetryConsent();
      telemetry.send('app.launched', {
        firstRun,
        onboardingFinished: !!settings.getOnboarding().finishedAt,
        ...telemetryFacts(),
      });
    },
    // Quit-time teardown: stop timers and the server, dispose live sessions,
    // then close the watcher/index/DB so nothing writes against a closing app.
    async dispose() {
      scheduler.stop();
      await mcp.stop().catch(() => {});
      agent.dispose();
      // Flush what is batched, bounded inside itself so a dead network cannot
      // slow the quit past the watchdog.
      await telemetry.shutdown().catch(() => {});
      await vaultService.dispose().catch(() => {});
    },
    telemetry,
  };
}
