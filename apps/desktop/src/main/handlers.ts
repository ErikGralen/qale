import { app, BrowserWindow, dialog, Notification } from 'electron';
import { is } from '@electron-toolkit/utils';
import { mkdir, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  AgentDTO,
  ArrivalItemInputDTO,
  ArrivalProgressDTO,
  ConnectionProgress,
  FirstStepId,
  MeetingReviewAskDTO,
  OpeningStepId,
  PathCheckDTO,
  SettingsDTO,
  TelemetryValue,
} from '@qale/ipc';
import { ageBand, countBand, durationBand, providerWord, skillWord, wantLineWord } from '@qale/ipc';
import {
  AgentRuntime,
  isOffered,
  sessionFilesRoot,
  summaryPrompt,
  writeSessionBinary,
  writeSessionFile,
  type SessionStatus,
} from '@qale/agent';
import {
  approveProposal,
  completeMeetingReview,
  captureNote,
  captureNudgeState,
  captureTodo,
  createDocumentFolder,
  createNote,
  createPerson,
  deleteDocumentFolder,
  dismissCaptureNudge,
  undoCaptureNudge,
  sidebarMeetingState,
  dismissSidebarMeeting,
  undoSidebarMeeting,
  deleteNote,
  renameDocumentFolder,
  ensureDefaultSkills,
  createSkill,
  createVoice,
  getBacklinks,
  getNote,
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
  migrateProductPagesToAbout,
  migrateRunnableFolders,
  migrateThemesToResearch,
  normalizeVaultFrontmatter,
  runSummaryPass,
  retireDefaultSkills,
  runnableEnabled,
  markMeetingReviewed,
  markNoteChecked,
  moveNote,
  queryNotes,
  planLibrarianSweep,
  librarianAsks,
  newContainerFinding,
  markLibrarianRun,
  settleLibrarianPass,
  vaultFingerprint,
  type LibrarianPassResult,
  listProposals,
  resolvedProposals,
  previewProposal,
  rebuild,
  rejectProposal,
  renameNote,
  resolveLink,
  restoreNoteVersion,
  revertNoteChange,
  saveAuthoredNote,
  saveFrontmatter,
  searchNotes,
  setTodoDue,
  setTodoStatus,
  type UseCaseContext,
} from '@qale/application';
import { detectSyncedFolder, isWindowsPathTooDeep } from '@qale/application';
import {
  isVoicePath,
  sourceModelId,
  parseFrontmatter,
  providerName,
  readableAs,
  refToSlug,
  isProductPicturePath,
  unreadableReason,
  wantListChange,
  APPROVED_REASON,
  type Frontmatter,
  type HandCreatableType,
} from '@qale/domain';
import { GitAdapter, gitInstallHint } from '@qale/vault';
import { sourceName } from './source-name.js';
import {
  ARRIVAL_AGENT_NAME,
  buildKickoff,
  DEFAULT_SKILLS,
  DEFAULT_AGENTS,
  DEFAULT_NOTES,
  DEFAULT_VOICES,
  RETIRED_SKILLS,
  isBaseSkillName,
  MAINTENANCE_AGENTS,
  MEETING_PREP_INSTRUCTION,
  TELL_QALE_NAME,
  wantLineId,
} from '@qale/sessions';
import { handle, pushEvent } from './ipc.js';
import { failureReport, type PassFailure } from './log.js';
import { appVersion, buildDiagnostics } from './diagnostics.js';
import {
  CODE_RUN_FACTS,
  FIRST_LOOK_KICK_MS,
  LIBRARIAN_SESSION_INTERVAL_MS,
  LIBRARIAN_SETTLE_MS,
  MEETING_PREP_LEAD_MS,
  MEETING_PREP_LEAD_PHRASE,
} from './agents.js';
import { setDockBadge } from './dock-badge.js';
import { isDemoBuild } from './build-env.js';
import { DemoService } from './demo/demo-service.js';
import { seedDemoProposal } from './dev-seed.js';
import { Telemetry } from './telemetry.js';
import { SettingsService } from './services/settings-service.js';
import { verifyProviderKey } from './services/verify-key.js';
import { GoogleOAuthService } from './services/google-oauth-service.js';
import { VaultService } from './services/vault-service.js';
import { makeOutbound, outboundConnections } from './services/outbound-service.js';
import { agentConnections } from './services/agent-connections.js';
import { CodebaseService } from './services/codebase-service.js';
import { SchedulerService } from './services/scheduler-service.js';
import { firstLookInstruction, SyncService } from './services/sync-service.js';
import { createFirstLookKick } from './services/first-look-kick.js';
import { McpService } from './services/mcp-service.js';
import {
  backlinkToDTO,
  hitToDTO,
  indexedToRefDTO,
  agentFileToDTO,
  noteToDTO,
  outboundEffectFacts,
  proposalToDTO,
  skillToDTO,
  treeToDTO,
  vaultInfoToDTO,
} from './dto.js';

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
   * The demo build's own machinery (docs/demo-mode.md), or null in the product.
   * Null is what keeps every branch below to one `demo &&`: an ordinary build
   * builds nothing, starts nothing and answers `demo:info` with `enabled: false`.
   */
  const demo = isDemoBuild()
    ? new DemoService({
        settings,
        vaultService,
        disposeAgent: () => agent.dispose(),
        onReset: () => afterDemoReset(),
      })
    : null;

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

  // Demo build only: the token refresh is answered by the fake Google Calendar,
  // so a demo build needs no OAuth client and opens no browser (docs/demo-mode.md).
  // Read through the getter on every call: the fake is built later, by
  // `demo.start()`, and a value captured here would still be undefined.
  const googleOAuth = demo
    ? new GoogleOAuthService(settings, (url, init) => (demo.googleFetch ?? fetch)(url, init))
    : new GoogleOAuthService(settings);
  const syncService = new SyncService(
    () => vaultService.context(),
    () => vaultService.syncStore(),
    settings,
    googleOAuth,
    (mirrorPaths) => {
      pushEvent(getWindow(), { channel: 'connections:changed' });
      if (mirrorPaths.length > 0)
        pushEvent(getWindow(), { channel: 'vault:changed', paths: mirrorPaths });
    },
    // The registry, left at its default. Named only so the demo's fetch can sit
    // last, where a new option belongs.
    undefined,
    // Demo build only: Jira and Confluence answer from a fixture in this
    // process, so the connector's own code runs unchanged against a site that
    // does not exist (docs/demo-mode.md DM-8).
    demo?.fetchImplFor,
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
   * Librarian passes whose session is still running, by session id: what the
   * run was handed, and the fingerprint the workspace had when it started
   * (OW3). Nothing is stamped at this end any more — `agent.onStatus` settles
   * the pass once the run is over and the question "did anything change" can
   * finally be answered.
   *
   * It is also the second reentrancy guard. The interval that used to keep two
   * librarian sessions apart is read off a stamp that is now written at the END
   * of a pass, so while one is in flight there is nothing on the ledger to stop
   * the next tick stacking another on top of it. A pass in this map is a pass
   * still happening.
   */
  const librarianPasses = new Map<
    string,
    LibrarianPassResult & { containers: string[]; counted?: boolean }
  >();

  /**
   * A librarian pass that has just parked a question, counted THERE rather than
   * when the run settles.
   *
   * A parked question is a turn that never ends, so its settle never comes: quit
   * the app with one on screen and nothing was ever written down, so the next
   * tick scans the same workspace, builds the same worklist and asks the same
   * question on a second card. Asking is the pass doing its job, so the moment
   * the question exists the findings are handed over, the run is stamped, and the
   * quiet week starts. `counted` is what stops the settle below doing it twice.
   */
  const countParkedLibrarianPass = (sessionId: string): void => {
    const pass = librarianPasses.get(sessionId);
    const ctx = vaultService.context();
    if (!pass || pass.counted || !ctx) return;
    pass.counted = true;
    const at = Date.now();
    settleLibrarianPass(ctx, { ...pass, asked: true }, at);
    agentLastRun.set('librarian', at);
    syncService.markContainersOffered(pass.containers);
  };

  /**
   * The knock at the end of the first read (docs/first-look-debrief.md).
   *
   * Connecting a system used to end at consent: the sync filled an index nobody
   * could see and nothing visible ever came of it. So the read now ends in one
   * unattended session that looks at what arrived, parks a single question and
   * stops. Answering it walks straight into the interview, in the same session.
   *
   * ONE knock over everything that is owed (CM-5). Two connections made in the
   * same onboarding are one haul to the PM, so every ready read goes into one
   * kickoff and the question names the lot.
   *
   * Three guards, and each one is a way of not asking too soon or twice:
   *
   * - **Once per connection, ever.** `markFirstLookDone` is stamped before the
   *   session fires, so the window between firing and the question landing
   *   cannot let the next tick raise the same knock.
   * - **Not while sources are still being read.** A backlog dropped a minute ago
   *   is the best thing the debrief could speak about, and a debrief that reads
   *   the index before it lands wastes its one opening. Nothing is stamped and
   *   nothing fires; the next maintenance tick tries again.
   * - **Not without a key**, which is not a guard so much as arithmetic: the
   *   flag stays `ready` and the knock happens once a key exists.
   *
   * A workspace that has already been told about the product used to be a fourth
   * guard, and it fired nothing at all. That made the picker's promise
   * ("it reads these, then comes back and tells you what it found") a lie for
   * anybody who had done First steps first, which is most people. So the knock
   * always happens now and the fact rides into the kickoff instead: the session
   * reports what it read and skips the interview (2026-08-31).
   */
  const runFirstLookDebriefs = async (failures: PassFailure[]): Promise<void> => {
    if (!settings.getActiveKey()) return;
    if (runInFlight(ARRIVAL_AGENT_NAME)) return;
    const reads = syncService.firstLookReads();
    if (reads.length === 0) return;
    for (const read of reads) syncService.markFirstLookDone(read.connectionId);
    const checklist = settings.getOnboarding().checklist;
    const told = Boolean(checklist['understanding'] || checklist['about-us']);
    await fireSession(
      TELL_QALE_NAME,
      buildKickoff({
        skill: TELL_QALE_NAME,
        instruction: firstLookInstruction(reads, told, {
          name: settings.getIdentity().name,
          emails: settings.selfEmails(),
        }),
      }),
      // Not `scheduled`: a clock did not start this, their connect did, and a
      // scheduled run refuses to park a question at all, and that question is
      // this run's whole output. `unattended` is the honest word: nobody is at the
      // screen right now, and they are coming back.
      { trigger: 'arrival', unattended: true },
    ).catch((err) => failures.push({ item: 'the first-look debrief', reason: err }));
  };

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
    // An arrival session is reading a drop: up to 25 cheap-model calls, and
    // maybe a whole librarian session, would land on the same key while the
    // PM waits for their transcript (docs/agent-speed.md AS-4). Scoped to the
    // arrival SKILL, not the `arrival` trigger: the first-look debrief and the
    // supersede reaction below both fire under that trigger too, and neither
    // is the run this guard is for. `runInFlight` reads `sessionRuns`, which
    // `fireSession` sets before the run starts and `agent.onStatus` clears the
    // moment it settles, however it ends, so the pause can never outlive the
    // run. The next tick, once the run settles, catches up. That is the same
    // thing the tick already does after the app opens, so this needs no
    // retry of its own.
    if (runInFlight(ARRIVAL_AGENT_NAME)) return Promise.resolve();
    // Collected, not logged one at a time: the pass reports every failure it
    // hit in a single scrubbed line at the end (OW3). A tick that fires every
    // five minutes is exactly where a row per failure becomes a wall of red,
    // and the alternative anyone reaches for instead — swallowing them — leaves
    // a workspace that quietly stopped being tidied with nothing to explain it.
    const failures: PassFailure[] = [];
    maintenanceInFlight = (async () => {
      await syncService
        .tick()
        .catch((err) => failures.push({ item: 'connector sync', reason: err }));
      const ctx = vaultService.context();
      if (!ctx) return;
      // Frontmatter first, before anything reads a note (OW4). Deterministic
      // machinery like the index.md maps below, and for the same reason: a
      // session that opens a note with no `type` and no summary spends its first
      // turn on the mess instead of on the work. What cannot be derived is left
      // as a marked placeholder the same run picks up through a card.
      const tidy = await normalizeVaultFrontmatter(ctx).catch((err) => {
        console.error(
          '[qale] frontmatter normalize failed:',
          err instanceof Error ? err.message : err,
        );
        return null;
      });
      if (tidy && tidy.written.length > 0)
        pushEvent(getWindow(), { channel: 'vault:changed', paths: tidy.written });
      // Before the librarian block, and outside its off switch: the first look
      // is not maintenance, and a workspace with the librarian switched off
      // still deserves to hear what its new connection just read.
      await runFirstLookDebriefs(failures);
      // The librarian's off switch (its file's `enabled` frontmatter) is
      // enforced HERE, before the scan is entered: off has to mean nothing is
      // even looked at, not a hidden pass whose output is filtered later. The
      // key is read in the same breath and for the same reason the meeting
      // sweep reads it: without one the session cannot start, and a keyless
      // workspace would drip a failure notification every five minutes.
      // Connector sync and the index maps below aren't the agent's work, so
      // they keep running.
      // A librarian session from an earlier tick is still going: nothing on the
      // ledger says so until it settles, so the guard has to be this map.
      if (
        librarianPasses.size === 0 &&
        settings.getActiveKey() &&
        (await runnableEnabled(ctx, 'librarian'))
      ) {
        const now = Date.now();
        // A question this agent parked is offered, never owed, so it can wait
        // for weeks. The scan below refuses to start a pass while one waits (one
        // open question at a time), and this is the other half of that rule: a
        // question nobody answered in a week is stale, because the note behind
        // it has had a week to change. Drop it, which resolves the run holding
        // it as dismissed, and let the passes carry on.
        for (const id of librarianAsks(ctx, now).stale) {
          await agent
            .resolveAsk(id, { answers: null }, ctx)
            .catch((err) => failures.push({ item: 'dropping a stale question', reason: err }));
        }
        // The scan and the ledger, and nothing else: what a finding MEANS is
        // read out of the notes, which is the session's job below.
        // A new space full of the PM's own work is a question the scan cannot
        // see: it is a fact about the connected site, not about the notes. It
        // rides in as an ordinary finding so the settle and quiet windows, the
        // interval and the cap all apply to it unchanged
        // (docs/product-understanding.md FL-3).
        const offers = await syncService.containerOffers(now).catch((err) => {
          failures.push({ item: 'new-space survey', reason: err });
          return [];
        });
        const work = await planLibrarianSweep(ctx, now, {
          settleMs: LIBRARIAN_SETTLE_MS,
          intervalMs: LIBRARIAN_SESSION_INTERVAL_MS,
          extra: offers.map(newContainerFinding),
        });
        if (work) {
          // Taken before the run, and the whole of OW3's first half: what the
          // workspace said a moment ago, to be compared with what it says when
          // the run is over.
          const before = vaultFingerprint(ctx);
          // `unattended: true`, and NOT `scheduled: true`. The two are not
          // interchangeable here: a scheduled run refuses to park a question at
          // all (AskParking.park returns straight away), and asking when it
          // cannot tell is half of what this agent is for. Unattended still
          // buys the quiet ending a pass that found nothing needs
          // (settleQuietly reads scheduled OR unattended) and leaves ask_user
          // working. `trigger` is only the word the finished run reports.
          //
          // `deferAnnounce`: a pass announces itself on the first thing it
          // actually works, never on starting. Which for a run that may turn
          // out to have found nothing worth doing means not at all.
          const started = await fireSession(
            'librarian',
            buildKickoff({ skill: 'librarian', instruction: work.worklist }),
            {
              trigger: 'scheduled',
              unattended: true,
              modelId: BACKGROUND_MODEL_ID,
              deferAnnounce: true,
            },
          );
          // Nothing is stamped here any more. A run that started still has to
          // do something before it counts as having run, and only its own
          // settle knows whether it did — see the librarian branch in
          // `agent.onStatus`. A run that never started (no key, switched off
          // between the check and the fire) leaves every finding where it was.
          if (started) {
            librarianPasses.set(started.sessionId, {
              findings: work.findings,
              before,
              cards: 0,
              asked: false,
              // Offered means asked: once the pass counts, the container is not
              // raised again from here, whatever the PM ends up answering — a
              // question they left sitting is still a question they were asked.
              containers: work.findings
                .filter((f) => f.kind === 'new-container')
                .map((f) => f.key.slice('librarian:container:'.length)),
            });
          }
        } else {
          // A look, not a run — the same distinction meeting-prep makes, and
          // most ticks are looks.
          agentLastChecked.set('librarian', Date.now());
        }
      }
      // The summary pass (docs/index-maps.md IM-6, and ticket 3 of
      // docs/background-system.md): one line per document from a cheap model,
      // plus the tags a note with none should carry, written straight to the
      // file the way normalize writes its fields. Gated on a key exactly as the librarian is: without one
      // nothing can answer, so the pass is skipped quietly. It runs before the
      // maps below so what it wrote lands in them. A failure joins the pass
      // report like a refused map does; the tick never throws over it.
      if (settings.getActiveKey()) {
        const summaries = await runSummaryPass(ctx, {
          summarise: (c) => {
            const p = summaryPrompt(c);
            return agent.summarise(p.system, p.user);
          },
        }).catch((err) => {
          failures.push({ item: 'summaries', reason: err });
          return null;
        });
        if (summaries && summaries.written.length > 0)
          pushEvent(getWindow(), { channel: 'vault:changed', paths: summaries.written });
      }
      // Refresh the OKF index.md orientation maps from the (now reconciled)
      // index. Idempotent — no write, no commit when nothing changed.
      //
      // A map it could not write throws, and the throw already names every
      // refused map with its reason: "orientation is missing for a folder" is a
      // diagnosis, and the alternative is retrieval quietly getting worse with
      // nothing in the log to explain it. It joins the pass report rather than
      // taking a line of its own — same rule as everything else here, and the
      // reasons survive either way. Whatever DID land is already committed and
      // the watcher pushes it.
      const idx = await generateIndexFiles(ctx).catch((err) => {
        failures.push({ item: 'orientation maps', reason: err });
        return null;
      });
      if (idx && idx.written.length > 0)
        pushEvent(getWindow(), { channel: 'vault:changed', paths: idx.written });
    })()
      .catch((err) => {
        // The tick must never surface as an unhandledRejection (it fires every
        // 5 minutes — offline would mean a steady drip of them).
        failures.push({ item: 'the pass itself', reason: err });
      })
      .finally(() => {
        // One line, at the end, already scrubbed — or no line at all when the
        // pass went through clean (OW3).
        const report = failureReport('maintenance', failures);
        if (report) console.error(report);
        maintenanceInFlight = null;
        // Also the badge's heartbeat: the 5-minute tick is what carries a todo
        // over midnight from "due tomorrow" into "due today".
        refreshDockBadge();
      });
    return maintenanceInFlight;
  };

  /**
   * The knock chases the sync (docs/first-look-debrief.md FD-2, amended
   * 2026-08-31). Confirming the follow picker used to end in silence: the
   * confirm starts a sync tick, but the debrief only fires from the maintenance
   * pass, and that pass is on a five-minute clock.
   *
   * `setFollow` starts its tick before it returns, so a kick can never land
   * ahead of it. And `tick()` joins a run in flight rather than skipping it, so
   * the pass below waits for the confirm's own sync to finish, and finishing is
   * what arms the first-look flag. The pass then reads it in the same breath.
   *
   * `stillOwed` covers the one gap the wait does not: a maintenance pass already
   * past its first-look step is joined, not queued, so the kick would resolve
   * with nothing said. One more pass settles that. With no key nothing will fire
   * whatever we do, so that case is left to the ordinary tick.
   */
  const firstLookKick = createFirstLookKick({
    delayMs: FIRST_LOOK_KICK_MS,
    pass: runMaintenance,
    stillOwed: () => Boolean(settings.getActiveKey()) && syncService.firstLookReads().length > 0,
    onError: (err) =>
      console.error('[qale] first-look kick failed:', err instanceof Error ? err.message : err),
  });

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
        console.warn(
          `[qale] ${path} differs from its folder copy — left both in place, nothing lost`,
        );
      // Themes and understanding pages are research pages now (MT-8). Move
      // them before the seed runs, so a seeded research page never shadows the
      // PM's own copy still sitting in the old folder. One commit, one Activity
      // row; a workspace that has already moved returns at once.
      const research = await migrateThemesToResearch(ctx);
      if (research.changed.length > 0) {
        console.log(
          `[qale] moved ${research.themes.length} theme(s) and ${research.understanding.length} understanding page(s) into research/`,
        );
        pushEvent(getWindow(), { channel: 'vault:changed', paths: research.changed });
      }
      for (const path of research.left)
        console.warn(`[qale] ${path} stayed: research/ already has a page by that name`);
      // The three company pages have their own shelf now (ticket 16). This runs
      // after the fold above, so a workspace still on `understanding/` lands in
      // `research/` first and then in `about/`. One commit, one Activity row; a
      // workspace that has already moved returns at once.
      const about = await migrateProductPagesToAbout(ctx);
      if (about.changed.length > 0) {
        console.log(`[qale] moved ${about.moved.length} product page(s) into about/`);
        pushEvent(getWindow(), { channel: 'vault:changed', paths: about.changed });
      }
      for (const path of about.left)
        console.warn(`[qale] ${path} stayed: about/ already has a page by that name`);
      // Take out of force what the pack has stopped shipping. Renamed, never
      // deleted, so a file the PM edited keeps every word (see
      // `retireDefaultSkills`). The name still resolves, through its alias.
      const retired = await retireDefaultSkills(ctx, RETIRED_SKILLS);
      if (retired.length > 0)
        console.log(`[qale] retired ${retired.length / 2} skill file(s) the pack no longer ships`);
      // Seed what is missing: the skills, the agents, and the notes the pack
      // ships into the memory (SK-5). Anything already there is the PM's and is
      // left exactly as it is, whatever we ship today.
      const seeded = await ensureDefaultSkills(ctx, [
        ...DEFAULT_SKILLS,
        ...DEFAULT_AGENTS,
        ...DEFAULT_VOICES,
        ...DEFAULT_NOTES,
      ]);
      const changed = [...retired, ...seeded];
      if (changed.length > 0) pushEvent(getWindow(), { channel: 'vault:changed', paths: changed });
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

  /**
   * Hand the open workspace the codebase port, or take it away. It is read as
   * `!!ctx.codebase` every time a session builds its toolbox, so this has to be
   * a live field and not a value captured at launch: the probe answers a second
   * after startup, and every session built after that reads it. Exactly the
   * rule `ctx.outbound` follows below.
   */
  const refreshCodebasePort = (): void => {
    const ctx = vaultService.context();
    if (ctx) ctx.codebase = codebaseService.port();
  };

  /**
   * The `claude` probe answered, from wherever it was started. This is the
   * moment the feature can turn on, so the port goes onto the context and the
   * agent is reconfigured: a session's tools are fixed when it is built, and
   * the reconfigure is what rebuilds a chat that opened before the answer
   * landed. Cheap when nothing changed, because `agent.configure` compares the
   * config it is handed against the one it holds.
   */
  const onCodebaseSettled = (): void => reconfigureAgent();
  const codebaseService = new CodebaseService(settings, onCodebaseSettled);

  const reconfigureAgent = (): void => {
    const ctx = vaultService.context();
    if (!ctx) return;
    const s = settings.get();
    // The card-application layer writes outbound by provider, through whichever
    // connections have a credential right now. Google's write scope is secured
    // via incremental consent at push time, never pre-emptively.
    ctx.outbound = makeOutbound(
      outboundConnections(
        settings,
        {
          getAccessToken: () => googleOAuth.getAccessToken(),
          ensureWriteScope: () => googleOAuth.ensureWriteScope(),
        },
        undefined,
        // Demo build only: writes go to the fakes, like the sync reads do.
        demo?.fetchImplFor,
      ),
    );
    // Whether a codebase question is even possible: a configured folder AND a
    // `claude` on the machine. The probe is async, so this sets what is known
    // now and `warm` calls back with the rest.
    codebaseService.warm();
    refreshCodebasePort();
    agent.configure({
      vaultDir: ctx.vault.root(),
      userDataDir: app.getPath('userData'),
      modelId: s.modelId,
      provider: settings.getProvider(),
      apiKey: settings.getActiveKey(),
      // Demo build only: every model call goes to the local replay server
      // instead of the provider. Spread, so an ordinary build's config has no
      // such field and nothing about it changes.
      ...(demo?.baseUrl ? { baseUrl: demo.baseUrl } : {}),
      connections: agentConnections(settings),
      // Which repos the sessions were built against. A change here rebuilds the
      // live ones, because a session's tool set is fixed when it is built and a
      // folder added mid-conversation would otherwise reach nothing until the
      // next chat. Same rule as the connections list.
      codebase: codebaseService.fingerprint(),
      language: settings.getLanguage(),
      selfName: settings.getIdentity().name,
      trackExternal: (kind, externalId) => syncService.trackExternal(kind, externalId),
      answerContainerOffer: (containerId, follow) =>
        syncService.answerContainerOffer(containerId, follow),
      outboundContainers: () => syncService.outboundContainers(),
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
    // One flag per registered provider, true when a stored connection of that
    // provider decrypts. The read matters as much as the answer: decryption is
    // what raises `secretsUnreadable` below, so this runs before it.
    const stored = settings.listConnections();
    const connected = Object.fromEntries(
      syncService
        .providers()
        .map(
          (p) =>
            [
              p.id,
              stored.some((c) => c.providerId === p.id && !!settings.getConnection(c.connectionId)),
            ] as const,
        ),
    );
    return {
      vaultPath: vaultService.currentVaultPath() ?? s.vaultPath,
      appVersion: appVersion(),
      modelId: s.modelId,
      provider: settings.getProvider(),
      hasApiKey: !!settings.getActiveKey(),
      storedKeys: {
        anthropic: !!settings.getKey('anthropic'),
        google: !!settings.getKey('google'),
      },
      connected,
      secretsEncrypted: settings.secretsEncrypted(),
      // Read AFTER the secret getters above: they are what trips the flag.
      secretsUnreadable: settings.secretsUnreadable(),
      schedules: s.schedules,
      language: settings.getLanguage(),
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
        // One entry per registered provider, so a new connector gets its First
        // steps row without an edit here or in the card.
        connections: Object.fromEntries(
          syncService.providers().map((p) => [p.id, connectionProgress(p.id)] as const),
        ),
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
   * Reset has finished: the workspace is a new folder, the databases are new
   * files and the renderer's local storage is gone. Everything the page holds
   * is about the demo that just ended, so it is reloaded rather than patched.
   * A function declaration, because the demo service is built above it.
   */
  function afterDemoReset(): void {
    reconfigureAgent();
    pushSettings();
    pushEvent(getWindow(), { channel: 'connections:changed' });
    // Reset deleted the workspace database, and the follow flag went with it,
    // so the demo calendar is followed again and the week is pulled back in.
    if (demo) {
      void demo
        .followCalendar(syncService)
        .then(() => syncService.tick())
        .catch((err) => console.error('[qale] demo: sync after reset failed:', err));
    }
    getWindow()?.webContents.reload();
  }

  /**
   * What this install looks like as counts and flags — the facts the person
   * record and `app.launched` both want, read live rather than stored. All the
   * counts leave as bands, and the skill count is the number of skills the PM
   * wrote themselves (any skill or agent whose name is not one of ours), which
   * answers "are people building on this" without ever carrying a name.
   *
   * The connection flags are built from the registry, one per provider under
   * the word it reports itself by. Which of them actually leave is the
   * allowlist's call in `@qale/ipc`, and it names two: the consent screen
   * renders those names, so the sending side stays closed while this side
   * needs no edit when a connector arrives.
   */
  const telemetryFacts = (): Record<string, TelemetryValue> => {
    const index = vaultService.context()?.index;
    const openTodos = index
      ? index.listByType('todo').filter((n) => (n.lifecycle ?? 'open') === 'open').length
      : 0;
    const customSkills = index
      ? [...index.listByType('skill'), ...index.listByType('agent')].filter(
          (n) => !isVoicePath(n.path) && skillWord(n.slug) === 'custom',
        ).length
      : 0;
    return {
      hasKey: !!settings.getActiveKey(),
      ...Object.fromEntries(
        syncService
          .providers()
          .map((p) => [providerWord(p.id), connectionProgress(p.id) !== 'none'] as const),
      ),
      notes: countBand(index?.count() ?? 0),
      meetings: countBand(index?.listByType('meeting').length ?? 0),
      people: countBand(index?.listByType('person').length ?? 0),
      todos: countBand(openTodos),
      customSkills: countBand(customSkills),
    };
  };

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
   * judge with, when each last ran, and how many of its cards are still
   * waiting.
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
        !!settings.getActiveKey(),
        // The sweep's cards carry `sessionId: 'librarian'`; a fired session's
        // cards carry the agent's name as their `skill`.
        pending.filter((p) => p.skill === a.name || p.sessionId === a.name).length,
      ),
    );
  };

  const notifyProposalsFor = (): void => {
    const ctx = vaultService.context();
    if (ctx)
      pushEvent(getWindow(), {
        channel: 'proposals:changed',
        pendingCount: ctx.proposals.pendingCount(),
      });
    refreshDockBadge();
  };

  /**
   * When a session started, and what started it. Neither rides on the status
   * signal, and both are wanted at the far end of a run that can take minutes.
   * In memory only: a run that spans a quit reports no duration rather than a
   * made-up one.
   *
   * `sessionRuns` holds an entry from the moment a run is fired until it
   * settles, so it also answers "is a run of this skill in flight" for anyone
   * who asks. `runFirstLookDebriefs` asks it (CM-5), and so does `runMaintenance`
   * above, to pause the tick while an arrival is live (docs/agent-speed.md AS-4).
   */
  const sessionStarted = new Map<string, number>();
  const sessionRuns = new Map<string, { skill: string; trigger: string }>();

  /** Whether a run of this skill is still going. In-memory, like the map: a run
   *  that did not survive a quit is not in flight, and nothing waits for it. */
  const runInFlight = (skill: string): boolean =>
    [...sessionRuns.values()].some((r) => r.skill === skill);

  /**
   * Dropped batches and how far they have got (docs/critical-mass.md CM-2). A
   * pile of transcripts takes minutes, so the one line the PM is watching
   * counts pieces off as they are filed.
   *
   * Every number is counted from a filing that happened. In memory only, and
   * bounded: this feeds one line in one tab, and a batch nobody watched is not
   * worth keeping over a quit.
   */
  const arrivalBatches = new Map<string, ArrivalProgressDTO>();
  const MAX_ARRIVAL_BATCHES = 20;

  const pushBatch = (progress: ArrivalProgressDTO): void => {
    pushEvent(getWindow(), { channel: 'arrival:progress', progress });
  };

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
       * two clock-started paths, so this only has to be set where a source
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
       * so it can write the sources into the session's folder before any model
       * call; the session it starts has to be that one.
       */
      sessionId?: string;
      /**
       * Hold the "last ran" stamp back; the caller sets it once the run has
       * actually worked something (OW3). Background work announces itself on
       * the first item it really does, never on starting — a tidy pass that
       * turns out to have had nothing to do must not leave "ran just now"
       * behind it on the agent's page.
       */
      deferAnnounce?: boolean;
    },
  ): Promise<{ sessionId: string } | null> => {
    // What started this, decided once and used for both the settle report and
    // the Automatic filter. Only a clock's own run is automatic: a source the
    // PM dropped is unattended (nobody is at the screen) but they asked for it,
    // so it belongs on the Sessions list and the rail like any other session.
    const trigger = opts?.trigger ?? (opts?.scheduled ? 'scheduled' : 'manual');
    const ctx = vaultService.context();
    if (!ctx) return null;
    // The off switch is a FLOOR, and this is its one door. Every path that
    // starts a session by name comes through here: the 5-minute sweep, a
    // schedule's slot, "Run now" in Settings, a reaction to an approved decision. So switching a file off in the Agents
    // view stops all of them, not only the ones whose author remembered to look.
    // (The sweeps check first as well: they do judgment work before firing
    // anything, and off has to mean that work never happens either.)
    if (!(await runnableEnabled(ctx, skill))) {
      console.log(`[qale] ${skill} is switched off, not firing it`);
      return null;
    }
    // Same door, the other floor: while the provider is refusing everything for
    // a reason only the PM can clear, the clock stops asking. A person's own
    // request always goes through, and getting an answer to one is what lifts
    // this (see `clockBlocked`).
    if (trigger === 'scheduled' && clockBlocked) {
      console.log(`[qale] not firing ${skill}: ${clockBlocked}`);
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
          automatic: trigger === 'scheduled',
        },
        ctx,
        () => {},
      );
      // A file agent's "last ran" stamp — same ledger the code watchers use, so
      // the Agents view answers "when did this last fire" for both kinds. A
      // deferred one is stamped by the caller, at the far end of the run, and
      // only if the run turned out to be one.
      if (!opts?.deferAnnounce) agentLastRun.set(skill, Date.now());
      // Recorded against the id rather than threaded through the runtime: a
      // session that settles minutes later has to be able to say what started
      // it, and the runtime has no reason to carry that.
      sessionRuns.set(handle.sessionId, { skill, trigger });
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
    if (!settings.getActiveKey()) return;
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
      if (!m.withOthers) continue; // a solo block is a note, not a meeting to prep for
      const startIso = new Date(m.startMs).toISOString();
      if (checks.get(prepKey(m.notePath)) === startIso) continue;
      const note = await ctx.vault.readNote(m.notePath).catch(() => null);
      if (!note) continue;
      if (/^## Prep\b/m.test(note.body)) continue;
      if (pending.some((p) => prepSkills.has(p.skill ?? '') && p.targetPath === m.notePath))
        continue;
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
        buildKickoff({
          skill: 'meeting-prep',
          targets: [m.notePath],
          instruction: MEETING_PREP_INSTRUCTION,
        }),
        { scheduled: true },
      )
        .then((handle) => {
          if (handle) checks.set(selfPrepKey(handle.sessionId), provenance, Date.now());
        })
        .catch((err: unknown) => {
          console.error(
            `[qale] meeting-prep ledger update failed for ${m.notePath}:`,
            err instanceof Error ? err.message : err,
          );
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

  // One more piece off the pile. Only a drop the tray handed over is counted:
  // every other session that files sources was never a batch, so there is no
  // line waiting for its number.
  agent.onSourceFiled = (sessionId, filed) => {
    const batch = arrivalBatches.get(sessionId);
    if (!batch) return;
    // Never past the total: a run that files one piece twice must not report
    // more sources than the PM handed over.
    batch.filed = Math.min(batch.total, batch.filed + filed.pieces);
    if (filed.matched) batch.matched = Math.min(batch.filed, batch.matched + filed.pieces);
    pushBatch(batch);
  };

  // A write that landed without a card. The queue never saw it, so this is
  // where a list line the PM added in the chat gets counted, by id only
  // (docs/learning-how-you-work.md ticket 15).
  agent.onProposalApplied = (_sessionId, filed) => {
    const want = wantFacts(filed.rec.id);
    if (want) telemetry.send('want_list.changed', want);
  };

  // A conversation named itself a moment after its first message. Nothing else
  // to do here: the name is already in the transcript, so the tab, the rail and
  // the Sessions row all follow from this one push.
  agent.onRename = ({ sessionId, title }) => {
    pushEvent(getWindow(), { channel: 'session:renamed', sessionId, title });
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

  /**
   * What each codebase card would run, held until the PM answers it (CC-10).
   *
   * The resolve handler is handed a request id and a decision, and the two
   * facts the report needs live on the request: whether the run continues an
   * earlier Claude Code session, and which model it would use when the decision
   * carries none. Bounded, because a run that is abandoned rather than answered
   * leaves its row behind.
   */
  const codebaseCards = new Map<string, { sessionId: string; resumed: boolean; model: string }>();
  const MAX_CODEBASE_CARDS = 50;

  // The codebase approval card. Same rule as the fan-out: the question runs on
  // somebody else's machine and costs real minutes, so nothing goes until the
  // PM says yes, and a pass nobody asked for still may not badge the dock.
  agent.onCodebaseRequest = (sessionId, request) => {
    pushEvent(getWindow(), { channel: 'session:codebase', sessionId, request });
    setParked(`codebase:${sessionId}`, !!request && !request.offered);
    if (!request) {
      // The card is gone: answered, or cancelled by Stop. An answer deletes its
      // own row on the way through the resolve handler; a cancel goes through
      // here and nowhere else, so it has to clear the row too or a stopped
      // question would sit in this map until it pushed a live one out.
      for (const [id, card] of codebaseCards)
        if (card.sessionId === sessionId) codebaseCards.delete(id);
      return;
    }
    const oldest = codebaseCards.keys().next();
    if (codebaseCards.size >= MAX_CODEBASE_CARDS && !oldest.done)
      codebaseCards.delete(oldest.value);
    codebaseCards.set(request.id, {
      sessionId,
      resumed: request.resume,
      model: request.suggestedModelId,
    });
  };

  // The agent is asking the PM something mid-turn — the run is parked on it.
  // An offered question is drawn like any other but never counted: nobody asked
  // for that run, so nothing it asks is owed. Clearing goes through either way,
  // and a key that was never added deletes to nothing.
  agent.onAskRequest = (sessionId, request) => {
    pushEvent(getWindow(), { channel: 'session:ask', sessionId, request });
    setParked(`ask:${sessionId}`, !!request && !request.offered);
    // A question is a pass that got somewhere, and it may be the last thing this
    // run ever does. Count it now, or a quit while it waits loses the record and
    // the next tick asks the same thing again.
    if (request) countParkedLibrarianPass(sessionId);
  };

  /**
   * The last blocking refusal we interrupted for, and when. An account with no
   * credit left fails every run, and the app fires plenty of them: a tidy pass, a
   * meeting brief, whatever the PM types next. Notifying per failure would turn
   * one billing problem into a stream of identical banners, so the same sentence
   * is worth saying at most once every few hours.
   */
  let lastFaultNotice = { text: '', at: 0 };
  const FAULT_NOTICE_QUIET_HOURS = 4 * 60 * 60 * 1000;

  /**
   * The provider is refusing everything for a reason only the PM can clear, so
   * the clock stops asking. Set when a run settles on a blocking fault, cleared
   * when they change the key or when anything gets an answer back.
   *
   * Backing off to the librarian's own half-hour interval was not enough on its
   * own: an empty account fails a meeting sweep, a schedule's slot and a tidy
   * pass alike, and every one of those is a request the PM is billed nothing for
   * and told nothing about. Nothing they started is ever held back — a message
   * they type, a "Run now" they click, a source they drop — because retrying by
   * hand is exactly how somebody checks whether they have fixed it, and the
   * answer to that clears the latch.
   */
  let clockBlocked: string | null = null;
  const unblockClock = (): void => {
    if (!clockBlocked) return;
    console.log('[qale] the model is answering again, so scheduled work resumes');
    clockBlocked = null;
  };

  /**
   * Say it out loud when the provider stops the app for a reason only the PM can
   * clear: no credit, a key that is not accepted. Being overloaded or rate
   * limited is not this — that fixes itself, and interrupting somebody over it
   * teaches them to ignore the next one (`blocking` in api-errors.ts).
   *
   * A run they started, with the window in front of them, already says it in the
   * chat. Everything else has no surface at all: a scheduled pass that dies at
   * 3am used to leave nothing behind anywhere, so the first sign was a meeting
   * brief that never appeared.
   */
  const notifyBlockingFault = (s: SessionStatus, trigger: string): void => {
    if (!s.fault?.blocking) return;
    const win = getWindow();
    if (trigger === 'manual' && win?.isFocused()) return;
    const now = Date.now();
    if (
      s.fault.text === lastFaultNotice.text &&
      now - lastFaultNotice.at < FAULT_NOTICE_QUIET_HOURS
    )
      return;
    lastFaultNotice = { text: s.fault.text, at: now };
    console.error(`[qale] sessions are blocked: ${s.fault.text}`);
    if (!Notification.isSupported()) return;
    const notification = new Notification({
      title: 'Qale has stopped: it cannot reach the model',
      body: s.fault.text,
      silent: true,
    });
    notification.on('click', () => {
      const w = getWindow();
      if (!w) return;
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
    });
    notification.show();
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
    // The batch is final. The counts stay in the map after this: the receipt
    // that replaces the running line reads the same row.
    const batch = arrivalBatches.get(s.sessionId);
    if (batch && !batch.done) {
      batch.done = true;
      pushBatch(batch);
    }
    notifyProposalsFor();
    // Whether the clock keeps asking, decided on the way past. A settle with no
    // fault at all is the proof the latch was waiting for.
    if (s.fault?.blocking) clockBlocked ??= s.fault.text;
    else if (!s.fault) unblockClock();
    // OW3's byte snapshot, and the end of the librarian pass this session was:
    // do the work, THEN decide whether it counts as a run. A pass that left the
    // workspace byte-identical with no card and no question writes nothing at
    // all — no handled rows, no run stamp, no "last ran" — and is
    // indistinguishable from not having run. (The receipt and the Sessions row
    // are already gone by then: an unattended run that produced nothing settles
    // quiet, and a quiet run files no receipt. A run the provider refused settles
    // quiet too, and leaves the same nothing for a worse reason.)
    const pass = librarianPasses.get(s.sessionId);
    // Dropped whatever comes next, including the workspace having closed under
    // the run: the map is also what stops the next tick starting a second
    // librarian, and an entry nothing can ever settle would stop it for good.
    librarianPasses.delete(s.sessionId);
    // Already counted when it parked its question, so the run stamp and the
    // handled rows are down. Settling again here would only move them forward
    // and lend a failed run a "last ran" it never earned.
    if (pass && ctx && !pass.counted) {
      const at = Date.now();
      const counted = settleLibrarianPass(
        ctx,
        {
          ...pass,
          cards: pendingCards,
          asked: !!ctx.asks?.forSession(s.sessionId),
          failed: !!s.fault,
        },
        at,
      );
      if (s.fault) {
        // The one place this run leaves a trace, now that it leaves no row and
        // no receipt. The notification below is for the PM; this is for whoever
        // reads the log afterwards wondering why the workspace went quiet.
        console.error(`[qale] the librarian pass could not run: ${s.fault.text}`);
        agentLastChecked.set('librarian', at);
      } else if (counted) {
        // The first thing it actually worked has now been worked, so the pass
        // may say so — and the containers it asked about stop being offered.
        agentLastRun.set('librarian', at);
        syncService.markContainersOffered(pass.containers);
      } else {
        // A look, not a run. Same word the tick uses for a tick that found
        // nothing, because this is the same thing one step later.
        agentLastChecked.set('librarian', at);
      }
    }
    const startedAt = sessionStarted.get(s.sessionId);
    sessionStarted.delete(s.sessionId);
    const trigger = sessionRuns.get(s.sessionId)?.trigger ?? 'manual';
    sessionRuns.delete(s.sessionId);
    telemetry.send('session.finished', {
      // Folded to something we wrote: a PM's own skill is named in their own
      // words, so the name itself is their material.
      skill: skillWord(s.skill),
      trigger,
      // Omitted rather than guessed when the start is gone.
      ...(startedAt ? { duration: durationBand(Date.now() - startedAt) } : {}),
      // A provider refusal is the one failure the runtime names (api-errors.ts).
      // Everything else it cannot yet tell from a finish, so false stays the
      // honest answer for those.
      failed: !!s.fault,
      cards: countBand(pendingCards),
      // Whether it parked a question for the PM, read off the same signal the
      // librarian ledger uses. The flag only, never the question.
      asked: !!ctx?.asks?.forSession(s.sessionId),
    });
    notifyBlockingFault(s, trigger);
    // Two First steps are "a session of this kind finished" (ONB-8): a meeting
    // prepped, and a question asked of the memory. Read off the signal that
    // already fires rather than a second ledger that could disagree with it.
    if (s.skill === 'meeting-prep') {
      markFirstStep(
        'prep',
        pendingCards > 0
          ? `Prepped a meeting, and the brief waits in its session`
          : `Prepped a meeting and found nothing worth briefing`,
      );
      // The base skill by either name: `chat` is what a session opened with
      // before the two built-in defaults merged into `ask`.
    } else if (isBaseSkillName(s.skill ?? '') && !s.quiet) {
      markFirstStep('ask', 'Answered a question from your own notes');
    }
    // A scheduled run that had nothing to report leaves no receipt, no row and
    // no badge (QM ticket 2). A notification saying "Finished" would undo all
    // three at once, so it is the last thing to go.
    //
    // A tidy pass that DID find something is not quiet, and still says nothing
    // here: a notification is the loudest thing the app can do, and what the
    // librarian leaves behind is the one kind of work that is never owed. It
    // waits in its session, where it costs nothing to find later.
    if (s.quiet || MAINTENANCE_AGENTS.has(s.skill ?? '')) return;
    const win = getWindow();
    if ((win && win.isFocused()) || !Notification.isSupported()) return;
    const notification = new Notification({
      title: s.title || 'Session ready',
      body:
        pendingCards > 0
          ? `${pendingCards} proposal${pendingCards === 1 ? '' : 's'} to review`
          : 'Finished',
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

  // A folder picker for any panel that needs one. It reads nothing and opens
  // nothing: the path travels back and the caller decides what it means.
  handle('app:pickFolder', async (title) => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title,
      buttonLabel: 'Choose',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0]!;
  });

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
      secretStore: settings.secretsEncrypted(),
      hasApiKey: !!settings.getActiveKey(),
      // Read after the key getter above: that read is what trips the flag.
      secretsUnreadable: settings.secretsUnreadable(),
      provider: providerName(settings.getProvider()),
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
  // The language is baked into every session's system prompt, so the runtime has
  // to be told: live sessions are rebuilt on it, the way a model change is.
  handle('settings:setLanguage', async (language) => {
    await settings.setLanguage(language);
    reconfigureAgent();
    return settingsDTO();
  });
  handle('settings:setProviderKey', async (provider, key) => {
    await settings.setKey(provider, key);
    reconfigureAgent();
    // They have done the thing the refusal asked for, or at least tried. Either
    // way the next tick gets to find out for itself rather than staying stopped
    // on the strength of an answer from before the fix.
    unblockClock();
    return settingsDTO();
  });
  handle('settings:setProvider', async (provider) => {
    await settings.setProvider(provider);
    reconfigureAgent();
    // Same reason as a new key: the workspace now has a credential it did not
    // have a moment ago, so a clock stopped on the old one gets to try again.
    unblockClock();
    return settingsDTO();
  });
  handle('settings:verifyProviderKey', (provider, key) =>
    // The demo build's key is the word "demo" and the replay server never looks
    // at it, so there is nothing to ask anyone. A real check here would put a
    // red "that key is wrong" under a key that works fine.
    demo ? { ok: true } : verifyProviderKey(provider, key),
  );
  // Connections (Area C): the renderer's one door to external-system state.
  handle('connections:providers', () => syncService.providers());
  handle('connections:list', () => syncService.list());
  handle('connections:connect', async (providerId, values) => {
    const result = await syncService.connect(providerId, values);
    if (result.ok) {
      reconfigureAgent();
      // The First steps connect rows read connection state live: a connect made
      // from Settings months later still ticks its row (ONB-8).
      pushSettings();
      // Which connectors exist is part of who this install is, so the person
      // record follows the connect rather than waiting for the next launch.
      syncTelemetryConsent();
      // The provider id is a name we wrote in the registry, so it goes out as
      // itself. The two that already ship keep their old words (providerWord).
      telemetry.send('connection.added', {
        provider: providerWord(providerId),
        // Connected is not the finish line: how much they follow is the thing
        // worth knowing, and it is a band like every other count.
        following: countBand(
          syncService.list().reduce((n, c) => n + c.containers.filter((k) => k.followed).length, 0),
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
  handle('connections:recommend', (connectionId) => syncService.recommend(connectionId));
  handle('connections:setFollow', async (connectionId, containerId, followed) => {
    await syncService.setFollow(connectionId, containerId, followed);
    // Following the first container is what turns "connected" into a row that
    // can honestly tick — half-done counts as not done.
    pushSettings();
    // And the read now ends in a knock a few seconds later, not on the next
    // five-minute tick. One confirm sends one of these per container, and the
    // debounce collapses them into a single pass.
    firstLookKick.follow(followed);
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
  handle('connections:pageBody', async (externalIdOrSlug) => {
    const ctx = vaultService.context();
    if (!ctx) return null;
    const path = syncService.pageBody(externalIdOrSlug);
    if (!path) return null;
    const note = await ctx.vault.readNote(path);
    return note?.body ?? null;
  });
  // Codebase (docs/claude-code-tickets.md). Only the settings panel asks.
  handle('codebase:get', () => settings.getCodebasePaths());
  handle('codebase:set', async (paths) => {
    await settings.setCodebasePaths(paths);
    // The folder list is what decides whether a session gets the tool at all,
    // so the agent wiring has to hear about the change before the next turn.
    reconfigureAgent();
    return codebaseService.status();
  });
  handle('codebase:status', () => codebaseService.status());

  // Demo build only (docs/demo-mode.md DM-9). In the product `demo` is null, so
  // `demo:info` reports that it is off and the Settings section is not drawn.
  handle('demo:info', () => demo?.info() ?? { enabled: false, today: '', anchor: '', steps: [] });
  handle('demo:reset', async () => {
    await demo?.reset();
  });
  handle('demo:openSamples', async () => {
    await demo?.openSamples();
  });
  handle('demo:applyStep', async (id) => {
    const steps = demo?.applyStep(id) ?? [];
    // The step changed the fake tracker; the mirror in the workspace has to
    // follow, or the presenter shows a ticket that still reads the old status.
    await syncService.tick().catch((err) => console.error('[qale] demo: sync failed:', err));
    return steps;
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
  handle('skills:create', async (title) => {
    const ctx = vaultService.requireContext();
    const { path } = await createSkill(ctx, title);
    pushEvent(getWindow(), { channel: 'vault:changed', paths: [path] });
    return { path };
  });
  handle('voices:create', async (title) => {
    const ctx = vaultService.requireContext();
    const { path } = await createVoice(ctx, title);
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
    // The name is also who a draft is signed as, and that sits in the system
    // prompt, so a session opened before it was set has to be rebuilt.
    reconfigureAgent();
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
      telemetry.send('onboarding.step', {
        step: settings.getOnboarding().step,
        action: 'finished',
      });
    // Other windows and the Settings mirror of the telemetry switch follow the
    // same record; the caller gets the DTO back directly either way.
    pushSettings();
    return settingsDTO();
  });
  // Which parts of the app get opened — the one thing only the renderer knows
  // (TEL-5). A view kind and nothing else; the allowlist refuses anything that
  // is not one of ours, so a wrong string is dropped rather than sent.
  handle('telemetry:view', (view, tabs) => {
    // Remembered first, so this event and every one after it carries the view
    // as context, then reported as the open it is. The tab count arrives as a
    // number and leaves as a band, like every count.
    telemetry.setView(view);
    telemetry.send('view.opened', { view, tabs: countBand(tabs) });
  });
  // Which meeting tool the backlog row's guide was opened for (CM-1). One word
  // from our own list; anything else is dropped by the allowlist rather than
  // sent.
  handle('telemetry:meetingTool', (tool) => {
    telemetry.send('source.tool', { tool });
  });
  // Which update style the PM picked, and for which voice (ticket 15). Three
  // words, folded renderer-side and folded again by the allowlist here, so a
  // heading the PM rewrote in their own voice file lands as `custom`.
  handle('telemetry:stylePick', (voice, style, answer) => {
    telemetry.send('style.picked', { voice, style, answer });
  });
  // The chosen provider's shortlist. No key needed: the list is what the app
  // OFFERS, so Settings can show it before anybody has pasted anything.
  handle('models:list', () => agent.listModels());

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
   *
   * The Windows path-length check rides along for the same reason, and it is the
   * one warning here that can only be given at this moment: a folder too deep for
   * MAX_PATH cannot be fixed later without moving the whole workspace, and the
   * failure it causes never says "path too long" out loud. It arrives as one
   * session that could not write a working file, or a note that saves everywhere
   * except one folder.
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
    // Measured on the literal path, not the canonical one: what Windows counts
    // against MAX_PATH is the path the app actually opens files through, and
    // resolving a junction can hand back a longer or shorter route than the one
    // that will be used.
    return {
      path,
      exists,
      hasNotes,
      syncedBy: detectSyncedFolder(canonical),
      pathTooDeep: isWindowsPathTooDeep(path),
    };
  };

  // ~/Documents is the folder people already keep documents in, and on a Mac
  // with Desktop & Documents syncing it is inside iCloud — which the check
  // above catches and says so, rather than us quietly picking somewhere the
  // PM would never think to look for their own files.
  handle('vault:suggestPath', () => checkPath(join(app.getPath('documents'), 'Qale')));
  handle('vault:checkPath', (path) => checkPath(path));

  // Only "where", never "open": the new-workspace form needs a parent folder
  // while the current workspace stays open behind it.
  handle('vault:pickLocation', async () => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Where should the new workspace go?',
      buttonLabel: 'Choose',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0]!;
  });

  handle('vault:create', async (path) => {
    // Recursive and forgiving: an existing folder is opened as it stands (an
    // Obsidian vault arrives this way too), a missing one is made.
    await mkdir(path, { recursive: true });
    let info = await vaultService.open(path);
    await settings.setVaultPath(info.path);
    // E-1: history starts with the workspace, and nobody is asked. The question
    // the History panel asks ("shall I make this a git repo?") is a real one for
    // a folder the PM has been keeping notes in for a year; for a workspace made
    // one second ago there is nothing to weigh, and every "you can undo this"
    // the app says later is only true once this has run. A machine with no git
    // opens the workspace anyway and says where history is offered why there is
    // none.
    info = await initVaultGit(vaultService.requireContext()).catch((err) => {
      console.warn(
        '[qale] this workspace starts without version history:',
        err instanceof Error ? err.message : err,
      );
      return info;
    });
    void afterOpen();
    reconfigureAgent();
    return vaultInfoToDTO(info);
  });

  handle('vault:current', async () => {
    const ctx = vaultService.context();
    return ctx ? vaultInfoToDTO(await getVaultInfo(ctx)) : null;
  });

  // Still here for the workspace that predates E-1, or one whose folder was
  // opened on a machine that had no git at the time. Everything made from now
  // on is a repo before the PM sees it.
  handle('vault:initGit', async () => {
    const info = await initVaultGit(vaultService.requireContext());
    return vaultInfoToDTO(info);
  });

  /**
   * Asked fresh every time, and answerable with no workspace open: git can be
   * installed while the app runs, and the probe re-asks a few minutes after a
   * "no" for that exact reason. `userData` is only a folder for git to be run
   * in; nothing is read from it and nothing is written.
   */
  handle('git:status', async () => {
    const ctx = vaultService.context();
    const git = ctx?.git ?? new GitAdapter(app.getPath('userData'));
    const available = await git.available();
    const repo = available && !!ctx && (await git.isRepo());
    return { available, repo, hint: available ? null : gitInstallHint() };
  });

  handle('vault:tree', async () => treeToDTO(await getVaultTree(vaultService.requireContext())));
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
    const note = await saveFrontmatter(
      vaultService.requireContext(),
      input.path,
      parsed.data as Frontmatter,
    );
    return noteToDTO(note);
  });
  // A blank page of a chosen type, straight from the Memory shelves. The use
  // case is the gate on which types that's allowed for — the renderer only
  // offers four, and this refuses the rest whatever calls it.
  handle('note:create', async (input) => {
    const note = await createNote(vaultService.requireContext(), {
      type: input.type as HandCreatableType,
      ...(input.title ? { title: input.title } : {}),
      ...(input.folder ? { folder: input.folder } : {}),
    });
    pushEvent(getWindow(), { channel: 'vault:changed', paths: [note.path] });
    return noteToDTO(note);
  });
  handle('note:rename', async (input) => {
    const note = await renameNote(vaultService.requireContext(), input);
    return noteToDTO(note);
  });
  // Documents is the one screen where the PM's own folders count (E-14). A
  // folder is a persistent object: it exists when its index.md exists or a
  // document is in it, so a move can still name a folder nobody made first.
  handle('note:move', async (input) => {
    const note = await moveNote(vaultService.requireContext(), input);
    pushEvent(getWindow(), { channel: 'vault:changed', paths: [input.path, note.path] });
    return noteToDTO(note);
  });
  handle('note:delete', async (path) => {
    await deleteNote(vaultService.requireContext(), path);
    return { ok: true };
  });
  // Folders in Documents (docs/documents-folders.md DF-1). Each pushes the
  // same vault:changed the moves do, so the tree repaints at once.
  handle('folder:create', async (input) => {
    const made = await createDocumentFolder(vaultService.requireContext(), input);
    pushEvent(getWindow(), { channel: 'vault:changed', paths: [made.path] });
    return { folder: made.folder };
  });
  handle('folder:delete', async (input) => {
    const gone = await deleteDocumentFolder(vaultService.requireContext(), input);
    pushEvent(getWindow(), { channel: 'vault:changed', paths: [gone.path] });
    return { ok: true };
  });
  handle('folder:rename', async (input) => {
    const renamed = await renameDocumentFolder(vaultService.requireContext(), input);
    pushEvent(getWindow(), { channel: 'vault:changed', paths: renamed.paths });
    return { folder: renamed.folder };
  });
  // Who "checked" it is the PO themselves: the name from Settings → You, else
  // the first address that means them, else the word the button already used.
  // The actor string never ends up empty: an unnamed reviewer is still a human
  // reviewer, and that is the fact the tier turns on.
  handle('note:markChecked', async (path) => {
    const identity = settings.getIdentity();
    const who = identity.name ?? settings.selfEmails()[0] ?? 'you';
    return markNoteChecked(vaultService.requireContext(), path, `human:${who}`);
  });
  handle('note:backlinks', (path) =>
    getBacklinks(vaultService.requireContext(), path).map(backlinkToDTO),
  );
  handle('note:resolveLink', (target) => resolveLink(vaultService.requireContext(), target));
  handle('note:history', (path) => getNoteHistory(vaultService.requireContext(), path));
  handle('note:versionAt', (path, hash) =>
    getNoteVersion(vaultService.requireContext(), path, hash),
  );
  handle('note:restoreVersion', async (input) => {
    const note = await restoreNoteVersion(vaultService.requireContext(), input);
    return noteToDTO(note);
  });
  /**
   * The one undo (E-2). The event is pushed by hand rather than left to the
   * watcher: an undelete puts a file back that every open list believes is
   * gone, and the row has to appear the moment the button is clicked.
   */
  handle('history:revert', async (input) => {
    const result = await revertNoteChange(vaultService.requireContext(), input);
    pushEvent(getWindow(), { channel: 'vault:changed', paths: [result.path] });
    return result;
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
    // Null means the file is gone: dropping a todo Qale only heard deletes it
    // (FA-7). The tree still has to hear about the path that left.
    if (!note) {
      pushEvent(getWindow(), { channel: 'vault:changed', paths: [path] });
      return null;
    }
    return noteToDTO(note);
  });
  handle('todos:setDue', async (path, due) => {
    const note = await setTodoDue(vaultService.requireContext(), path, due);
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

  /** One source, resolved to bytes or refused with a reason. */
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

  /** Read one file off disk into a source, or refuse it by name. */
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
   * Turn wire items into sources. A `path` (from the picker, or from a drop —
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
        out.push({
          name: item.name ?? 'image.png',
          data: new Uint8Array(Buffer.from(item.dataBase64, 'base64')),
        });
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
      title: 'Add source',
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

  handle('arrival:ingest', async (items, instruction, modelId) => {
    const ctx = vaultService.requireContext();
    const landed = await resolveItems(items);
    const good = landed.filter((l) => !l.error);
    const refused = landed.flatMap((l) => (l.error ? [{ name: l.name, error: l.error }] : []));

    // The session id is minted here, before anything runs, because the folder is
    // named after it: the sources have to be on disk before a model is asked for
    // anything, so a missing API key costs nothing but a delay.
    const sessionId = randomUUID();
    const root = sessionFilesRoot(ctx.vault.root(), sessionId);
    const taken = new Set<string>();
    const written: { file: string; original: string; bytes: number }[] = [];
    for (const piece of good) {
      const name = sourceName(piece.name, taken);
      const file = `source/${name}`;
      if (piece.data) await writeSessionBinary(root, file, piece.data);
      else await writeSessionFile(root, file, piece.text ?? '');
      written.push({
        file,
        original: piece.name,
        bytes: piece.data?.byteLength ?? (piece.text ?? '').length,
      });
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
      .map(
        (m) =>
          `- ${m.notePath} — “${m.title}”, ${new Date(m.startMs).toISOString().slice(0, 16).replace('T', ' ')}`,
      );

    // A manifest, so the agent starts from a list rather than a directory walk,
    // and so the PM opening the session folder tomorrow can see what arrived.
    const manifest = [
      `# What arrived`,
      ``,
      `${written.length} source${written.length === 1 ? '' : 's'}, handed over ${ctx.clock.now()}.`,
      ``,
      ...written.map((w) => `- \`${w.file}\` — dropped as "${w.original}", ${w.bytes} bytes`),
      ...(refused.length
        ? [
            '',
            'Could not be read, so they are not here:',
            ...refused.map((r) => `- ${r.name}: ${r.error}`),
          ]
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
    await writeSessionFile(root, 'input.md', `${manifest}\n`);
    pushEvent(getWindow(), { channel: 'session:files', sessionId });

    // One event per drop, saying how it arrived and nothing about what is in it.
    const kind = good.some((g) => g.data)
      ? 'image'
      : items.some((i) => i.text && !i.path)
        ? 'text'
        : 'file';
    telemetry.send('source.added', {
      kind,
      count: countBand(written.length),
      startedSession: written.length > 0,
    });

    if (written.length === 0) {
      return {
        sessionId,
        landed: 0,
        refused,
        started: false,
        reason: 'Nothing in that batch could be read.',
      };
    }

    const prompt = buildKickoff({
      skill: ARRIVAL_AGENT_NAME,
      instruction: [
        `${written.length} source${written.length === 1 ? '' : 's'} just landed in your session folder, unfiled.`,
        `Read \`input.md\` for the list, work out what each thing is, file it, and read what is worth reading.`,
        instruction?.trim()
          ? `What I asked for when I handed them over, which takes precedence: ${instruction.trim()}`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
    });
    // What reads the pile. The tray sends the model the PM chose; without one
    // (a drop from an older window, a path that never opened the tray) the
    // provider's own filing model is the default, so a Gemini workspace never
    // gets a Claude id it cannot route (docs/critical-mass.md CM-2).
    const readWith = modelId?.trim() || sourceModelId(settings.getProvider());
    const started = await fireSession(ARRIVAL_AGENT_NAME, prompt, {
      trigger: 'arrival',
      unattended: true,
      sessionId,
      modelId: readWith,
    });
    if (!started) {
      return {
        sessionId,
        landed: written.length,
        refused,
        started: false,
        reason: settings.getActiveKey()
          ? 'Handle new sources is switched off, so nothing is reading these yet.'
          : `Set a ${providerName(settings.getProvider())} API key in Settings and these will be read.`,
      };
    }

    // The batch, so the counts have somewhere to land. Only a started run gets
    // a row: nothing is reading a batch that never began, and a line counting
    // from zero for good is worse than no line.
    if (arrivalBatches.size >= MAX_ARRIVAL_BATCHES) {
      const oldest = arrivalBatches.keys().next();
      if (!oldest.done) arrivalBatches.delete(oldest.value);
    }
    arrivalBatches.set(sessionId, {
      sessionId,
      total: written.length,
      filed: 0,
      matched: 0,
      done: false,
    });

    // The First step the whole product hangs off: a real source went in, and
    // something started reading it.
    markFirstStep(
      'transcript',
      written.length === 1
        ? `Handed over “${written[0]!.original}”. It is being filed and read now`
        : `Handed over ${written.length} sources. They are being filed and read now`,
    );
    return { sessionId, landed: written.length, refused, started: true };
  });

  // What a window that missed the pushes needs: the batches this process knows,
  // running and settled alike.
  handle('arrival:batches', () => [...arrivalBatches.values()]);

  handle('search:query', (query, limit) =>
    searchNotes(vaultService.requireContext(), query, limit).map(hitToDTO),
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
  // One session's judged cards, for the receipt its chat shows once the queue is
  // gone (docs/closing-beat.md). Same DTO as the queue itself, so the receipt
  // reads a card the same way the card did.
  handle('proposals:resolved', (sessionId) => {
    const ctx = vaultService.requireContext();
    const effectFacts = outboundEffectFacts(ctx, settings.selfEmails());
    return resolvedProposals(ctx, sessionId).map((rec) => {
      const dto = proposalToDTO(rec, ctx.checks?.get(selfPrepKey(rec.sessionId)), effectFacts);
      // The Activity row the write left, read back by the card's own id so the
      // receipt still offers Put back in a chat reopened next week. A row
      // already put back is left off: the way back is gone with it. The row's
      // reason says whether the PM approved the card or it landed on its own.
      const row = ctx.activity?.forProposal(rec.id);
      if (!row) return dto;
      const silent = row.reason !== APPROVED_REASON;
      return {
        ...dto,
        ...(row.reverted ? {} : { activityId: row.id }),
        ...(silent ? { silent: true } : {}),
      };
    });
  });
  handle('proposals:preview', (id) => previewProposal(vaultService.requireContext(), id));
  // Resolving the last card a session produced closes the review it was doing:
  // the meeting flips new → processed, as long as something was kept. When every
  // card was discarded nothing here knows the meeting was read, so it stays put
  // and the question comes back for the review to ask. Best-effort: it never
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
      // A reaction to a source the PO just kept, not a run they asked for.
      // `unattended: true`, because nobody is at the screen for it: without
      // the flag the runtime reads this as a chat with a person waiting
      // (docs/agent-speed.md AS-2). The skill fired here is `librarian`, not
      // the arrival skill, so this run never trips the arrival-in-flight
      // guard `runMaintenance` checks above, even though it shares the
      // `arrival` trigger.
      { trigger: 'arrival', unattended: true },
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
  /**
   * Did this card add a line to, or take one off, the "What you want from
   * Qale" list (docs/learning-how-you-work.md ticket 15)? Null when it did
   * neither, which is almost every card.
   *
   * Read before the accept for the same reason {@link cardFacts} is, and it
   * reports the line by id only. The text is the PM's own words: they edit the
   * file, so even a shipped line can come back rewritten. A line we cannot
   * match reports as `custom`. Catches like the one above, for the same reason.
   */
  const wantFacts = (id: string): { line: string; change: string; asked: boolean } | null => {
    try {
      const rec = vaultService.context()?.proposals.get(id);
      if (!rec) return null;
      const change = wantListChange((rec.payload ?? {}) as Parameters<typeof wantListChange>[0]);
      if (!change) return null;
      return {
        line: wantLineWord(wantLineId(change.line)),
        change: change.op === 'add' ? 'added' : 'removed',
        asked: rec.asked === true,
      };
    } catch {
      return null;
    }
  };
  handle('proposals:accept', async (id, edited) => {
    const card = cardFacts(id);
    const want = wantFacts(id);
    // Read before the accept: the record is resolved by the time it returns.
    const target = vaultService.context()?.proposals.get(id)?.targetPath ?? null;
    // The approve path, not the bare accept: an approved write leaves an
    // Activity row so the chat and Activity can put it back
    // (docs/receipt-redesign.md RC-4).
    const result = await approveProposal(vaultService.requireContext(), id, edited);
    if (result.ok) {
      // A card handed back with `edited` is one they changed before keeping.
      telemetry.send('card.decided', {
        decision: 'accepted',
        edited: edited !== undefined,
        ...(card ?? {}),
      });
      // The write has landed, so the list now reads the new way. This is how we
      // learn what PMs want; the id says which line, never the sentence.
      if (want) telemetry.send('want_list.changed', want);
      await fireSupersedeReactions(id).catch(() => {});
      // Demo build only: the scheduler is off (DM-7), so an approved Jira or
      // Confluence write would sit in the fake tracker with nothing to bring it
      // back into the mirror. One sync, right here, is that missing tick.
      if (demo)
        await syncService.tick().catch((err) => console.error('[qale] demo: sync failed:', err));
    }
    const review = await afterCardResolved(id);
    notifyProposalsFor();
    if (result.ok)
      markFirstStep('proposal', 'Approved its first proposal, and it went into the memory');
    // Keeping the first thing the interview drafted is what "tell it about your
    // product" now means (docs/product-understanding.md U-4). The step is the
    // approval, not a file save: you talk, it drafts, you approve.
    if (result.ok && target && isProductPicturePath(target)) {
      markFirstStep(
        'understanding',
        'Told it about your product, and every session reads this now',
      );
    }
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
    markFirstStep('proposal', 'Passed on its first proposal, so nothing was written');
    return review ? { ...result, review } : result;
  });
  handle('meeting:markReviewed', (path) =>
    markMeetingReviewed(vaultService.requireContext(), path),
  );
  // What the agent did without asking (docs/easier-tickets.md E-9). The row is
  // flattened here rather than in dto.ts because it is the proposal channels'
  // own receipt: a silent write is a proposal that applied on the spot, and this
  // is the only surface that shows it. A workspace with no app.db has no log, so
  // an empty list is the honest answer rather than a throw.
  handle('activity:list', (limit) => {
    const ctx = vaultService.requireContext();
    return (ctx.activity?.list(limit) ?? []).map((row) => ({
      id: row.id,
      action: row.action,
      line: row.line,
      reason: row.reason,
      path: row.path,
      proposalId: row.proposalId,
      sessionId: row.sessionId,
      at: new Date(row.at).toISOString(),
      revertable: row.revert.commit !== null && row.reverted === null,
      reverted: row.reverted ? new Date(row.reverted).toISOString() : null,
    }));
  });
  // The last thing Qale learned about each file it learns into, for the line
  // under every row on the Skills page (docs/learning-how-you-work.md ticket
  // 13). One row per file, so the page reads what it shows and nothing else.
  handle('activity:latestByPath', () => {
    const ctx = vaultService.requireContext();
    return (ctx.activity?.latestLearned() ?? []).map((row) => ({
      path: row.path,
      line: row.line,
      at: new Date(row.at).toISOString(),
    }));
  });
  // Put one row back. The commit comes from the row itself, never from the
  // renderer: a row can only undo the write it is the receipt for, so no click
  // in the app can aim an undo at a note nobody named. The use-case is the same
  // one `history:revert` runs, and it stamps the row once the files are back.
  handle('activity:revert', async (id) => {
    const ctx = vaultService.requireContext();
    const row = ctx.activity?.get(id);
    if (!row) throw new Error('that row is no longer here');
    if (row.reverted !== null) throw new Error('that one is already undone');
    if (!row.path || !row.revert.commit)
      throw new Error('this workspace kept no history of that write, so it cannot be undone');
    const result = await revertNoteChange(ctx, {
      path: row.path,
      hash: row.revert.commit,
      activityId: row.id,
      // The card behind the row, when there was one: the accept marked the
      // sources it cited as read, and the undo puts those back with the page.
      ...(row.proposalId ? { proposalId: row.proposalId } : {}),
    });
    pushEvent(getWindow(), { channel: 'vault:changed', paths: [result.path] });
    return result;
  });

  // The capture nudge's memory. Reads are cheap and local; the renderer holds
  // the derivation and only asks here what the PO already answered.
  handle('captureNudge:state', () => captureNudgeState(vaultService.requireContext()));
  handle('captureNudge:dismiss', (path) =>
    dismissCaptureNudge(vaultService.requireContext(), path, Date.now()),
  );
  handle('captureNudge:undo', (path, series) =>
    undoCaptureNudge(vaultService.requireContext(), path, series),
  );
  handle('sidebarMeeting:state', () => sidebarMeetingState(vaultService.requireContext()));
  handle('sidebarMeeting:dismiss', (path) =>
    dismissSidebarMeeting(vaultService.requireContext(), path, Date.now()),
  );
  handle('sidebarMeeting:undo', (path) => undoSidebarMeeting(vaultService.requireContext(), path));
  handle('librarian:report', () => getMaintenanceReport(vaultService.requireContext()));
  handle('agent:run', async (input) => {
    const ctx = vaultService.requireContext();
    return agent.run(input, ctx, (streamId, chunk) => {
      pushEvent(getWindow(), { channel: 'agent:event', streamId, chunk });
    });
  });
  handle('agent:abort', (streamId) => agent.abort(streamId, vaultService.context() ?? undefined));

  handle('chats:list', () => agent.listChats());
  handle('chats:history', (sessionId) => ({
    id: sessionId,
    messages: agent.chatHistory(sessionId),
  }));
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
  handle('sessions:pendingCodebase', (sessionId) => agent.pendingCodebase(sessionId));
  handle('sessions:resolveCodebase', (requestId, decision) => {
    const card = codebaseCards.get(requestId);
    codebaseCards.delete(requestId);
    agent.resolveCodebase(requestId, decision);
    // Both answers are worth having: a card the PM passes on says as much about
    // what the agent asks for as one they run. The model is what WOULD run, so
    // a resume, which carries no choice, reports the one its session started on.
    if (card) {
      telemetry.send('codebase.asked', {
        model: decision.modelId ?? card.model,
        resumed: card.resumed,
        approved: decision.approved,
      });
    }
    return { ok: true };
  });
  handle('sessions:pendingAsk', (sessionId) =>
    agent.pendingAsk(sessionId, vaultService.context() ?? undefined),
  );
  handle('sessions:pendingAsks', () => agent.listPendingAsks(vaultService.context() ?? undefined));
  handle('sessions:resolveAsk', async (requestId, answers) => {
    const ctx = vaultService.context() ?? undefined;
    // The context and the emitter are what let an answer reach a question whose
    // turn died with the last app run: without a live promise to resolve, the
    // session is reopened and the answer replayed into it (QM ticket 9).
    await agent.resolveAsk(requestId, { answers }, ctx, (streamId, chunk) => {
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
      // Demo build only (docs/demo-mode.md). Both calls come before the
      // workspace opens: the replay server has to exist before the agent is
      // configured against it, and first launch writes the `vaultPath` the open
      // below reads.
      if (demo) {
        await demo.start();
        await demo.firstLaunch();
      }
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
          if (devEnv('QALE_SEED_PROPOSAL'))
            void seedDemoProposal(vaultService.requireContext(), (id, title, text) =>
              agent.seedStoredSession(id, title, text),
            );
        } catch (err) {
          console.error('[qale] failed to open workspace:', err);
        }
      }
      // Start the app-open scheduler (idempotent; ticks no-op until a vault opens).
      // Not in the demo build: the tick fires the librarian, the summary pass
      // and meeting prep, and none of those requests is recorded, so each one
      // would file the fallback text as its answer (DM-7). "Run now" still
      // works, and the connector sync the tick would have run happens here.
      if (demo) {
        // The one calendar the fake serves is followed for him, once, so the
        // launch sync has a week to pull.
        await demo.followCalendar(syncService);
        void syncService
          .tick()
          .catch((err) => console.error('[qale] demo: launch sync failed:', err));
      } else {
        scheduler.start();
      }
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
      await demo?.stop().catch(() => {});
      await mcp.stop().catch(() => {});
      agent.dispose();
      // No codebase run outlives the app.
      codebaseService.dispose();
      // Flush what is batched, bounded inside itself so a dead network cannot
      // slow the quit past the watchdog.
      await telemetry.shutdown().catch(() => {});
      await vaultService.dispose().catch(() => {});
    },
    telemetry,
  };
}
