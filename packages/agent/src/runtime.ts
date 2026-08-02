import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createAgentSession,
  AuthStorage,
  ModelRegistry,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from '@earendil-works/pi-coding-agent';
import { completeSimple } from '@earendil-works/pi-ai/compat';
import {
  markRunnableQuiet,
  markRunnableStopped,
  markRunnableUsed,
  type UseCaseContext,
} from '@pm/application';
import { runnableCandidates, runnableNameFromPath } from '@pm/domain';
import { AtlassianClient } from '@pm/atlassian';
import {
  createVaultTools,
  createProposeTools,
  createDraftTools,
  createAtlassianTools,
  createUseSkillTool,
  listLoadableSkills,
  ATLASSIAN_TOOL_NAMES,
  VAULT_TOOL_NAMES,
  PROPOSE_TOOL_NAMES,
  DRAFT_TOOL_NAMES,
  USE_SKILL_TOOL_NAME,
  type TrackExternal,
} from './tools.js';
import {
  createChildFileTools,
  createSessionFileTools,
  listSessionFiles,
  readSessionFile,
  writeSessionFile,
  sessionFilesPrompt,
  sessionFilesRelRoot,
  sessionFilesRoot,
  CHILD_FILE_TOOL_NAMES,
  SESSION_FILE_TOOL_NAMES,
  type SessionFileEntry,
} from './session-files.js';
import {
  createSpawnTool,
  spawnRequestId,
  SPAWN_TOOL_NAME,
  type SpawnChild,
  type SpawnDecision,
  type SpawnPlan,
} from './spawn.js';
import {
  createAskTool,
  askRequestId,
  askReplayPrompt,
  AskParking,
  ASK_TOOL_NAME,
  type AskDecision,
  type AskPlan,
  type AskRequestInfo,
  type StoredAsk,
} from './ask.js';
import { createEndQuietlyTool, ranSilent, END_QUIETLY_TOOL_NAME } from './quiet.js';
import { CHILD_PREAMBLE, SCHEDULED_PREAMBLE, SHARED_PREAMBLE } from './prompts.js';
import {
  parseRunnable,
  buildSystemPrompt,
  buildSkillBrief,
  governs,
  buildSessionReceipt,
  parseKickoff,
  SessionHarness,
  DEFAULT_SKILL_BY_NAME,
  BASE_SKILL_NAME,
  type Runnable,
} from '@pm/sessions';

import { PiUiBridge, type Chunk } from './bridge.js';
import { entriesToUiMessages, type UiMessage } from './history.js';

/** The file every child reads before starting. One write, N smarter readers. */
const BRIEF_FILE = 'brief.md';

/**
 * The draft tools a workspace with nothing connected may still offer. Only one:
 * an approved `draft_message` card is written into the memory, never sent, so
 * it needs no connector. Every other draft tool addresses a system outside the
 * workspace and is withheld until one exists (see `toolNamesFor`).
 */
const needsNoConnector = (tool: string): boolean => tool === 'draft_message';

/** Structural slice of a pi assistant message — enough to pull its closing text. */
interface PiLikeMessage {
  role: string;
  content: string | { type: string; text?: string }[];
}

/** The last thing the assistant said — a child's answer to its parent. */
function lastAssistantText(messages: PiLikeMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== 'assistant') continue;
    const text =
      typeof m.content === 'string'
        ? m.content
        : m.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text ?? '')
            .join('\n');
    if (text.trim()) return text.trim();
  }
  return '';
}

export interface AgentRuntimeConfig {
  vaultDir: string;
  /** Electron userData dir — pi auth/models/sessions live under here, off the vault. */
  userDataDir: string;
  modelId: string;
  apiKey: string | null;
  atlassian?: { baseUrl: string; email: string; token: string } | null;
  /**
   * Host callback behind the `track_external` tool — it reaches the sync engine,
   * which lives in the desktop main process, not here. Identity-stable, so it is
   * deliberately absent from `sameConfig`: swapping it must not tear down live
   * sessions the way a credential or model change does.
   */
  trackExternal?: TrackExternal;
}

export interface RunInput {
  sessionId?: string;
  prompt: string;
  /**
   * Bring this skill into the session before the turn runs. Not a mode and not
   * a kind of session: an instruction, applied through the same path as the
   * agent's own `use_skill`, and a second skill may arrive after it. Absent
   * means a plain chat.
   */
  skill?: string;
  /**
   * Whether the arrival may draft outbound, from the trigger that fired it
   * (Sessions v2 Part 5). The material's permission, not the session's: one
   * arrival agent serves both the PM's own meeting and a colleague's sales
   * call, and only the first may draft outbound. Enforced by the tool set, not
   * by the model remembering.
   */
  outbound?: boolean;
  /**
   * A clock started this turn, not a person (QM ticket 2). It licences the
   * scheduled preamble and makes `end_quietly` real; without it the same tool
   * is a no-op, because somebody is waiting for the reply. Per TURN, not per
   * session: the PM can write into a scheduled run that did produce something,
   * and from that message on it is an ordinary conversation.
   */
  scheduled?: boolean;
}

export interface RunHandle {
  streamId: string;
  sessionId: string;
}

export interface ModelInfo {
  id: string;
  label: string;
}

/**
 * User-set shelf state: `active` (default), `done` (outcome landed), or
 * `dismissed` (won't be useful). Stored off the pi files in a sidecar map;
 * a new message on a closed conversation flips it back to active.
 */
export type SessionLifecycle = 'active' | 'done' | 'dismissed';

/**
 * What the sidecar can hold: the three shelf states a PM sets, plus one the app
 * sets. `quiet` means a scheduled run finished with nothing to say (QM ticket
 * 2). It is a SUCCESS, not a failure and not a shelving: the transcript stays on
 * disk so a schedule that goes wrongly silent can still be read, but the session
 * never reaches {@link AgentRuntime.listChats}, so it leaves no row, no unread
 * result and no badge. A run that BROKE is never marked this way.
 *
 * Kept out of the wire `SessionLifecycle` on purpose. The three shelf states are
 * a control the PM operates; this is a fact about a run, and the only surface
 * that reports it is the agent's own page.
 */
type StoredLifecycle = SessionLifecycle | 'quiet';

/** A past (or live) conversation, listed from the pi JSONL store. */
export interface ChatRef {
  id: string;
  title: string;
  created: number;
  updated: number;
  messageCount: number;
  preview: string;
  lifecycle: SessionLifecycle;
}

/** Lifecycle signal — fired when a run starts and when it settles (any outcome). */
export interface SessionStatus {
  sessionId: string;
  title: string;
  status: 'running' | 'settled';
  updated: number;
  /**
   * The run ended with nothing to report (QM ticket 2), so it leaves no row and
   * no receipt. Main reads it to hold back the "finished" notification: a
   * notification is exactly the cost silence is supposed to save.
   */
  quiet?: boolean;
}

/** A session with a turn in flight right now. */
export interface LiveSession {
  sessionId: string;
  title: string;
  streamId: string;
  startedAt: number;
}

/**
 * One line of the spawn card. It lists the WORK, not a target count: "9 targets"
 * becomes a lie the moment two entries do different things.
 */
export interface SpawnEntryInfo {
  label: string;
  count: number;
}

/** The spawn approval card, as the renderer draws it. */
export interface SpawnRequestInfo {
  id: string;
  sessionId: string;
  entries: SpawnEntryInfo[];
  total: number;
  /**
   * The brief every child will read. Expandable on the card and it matters more
   * than the count: approving *what they'll be asked* is the real quality lever.
   */
  brief: string | null;
  models: ModelInfo[];
  defaultModelId: string;
}

interface PendingSpawn {
  request: SpawnRequestInfo;
  resolve: (decision: SpawnDecision) => void;
}

/**
 * Facts about the TURN rather than the session, and the whole of what deciding
 * "did this run leave anything" needs (QM ticket 2). A mutable box because the
 * `end_quietly` tool closes over it at session creation, before the state it
 * hangs off exists.
 */
interface TurnFlags {
  /** A clock started this turn, not a person. */
  scheduled: boolean;
  /** The model called `end_quietly` on a turn where that meant something. */
  ended: boolean;
  /**
   * The turn put a card in front of the PM: a question, or a fan-out to
   * approve. Attention already spent, so the turn cannot end as if it left
   * nothing.
   */
  asked: boolean;
  /**
   * The turn needed a decision that is the PM's to make, on a run nobody was
   * watching (QM ticket 9). It leaves no card and no row, and one line on the
   * agent's own page saying it stopped and why.
   */
  blocked: boolean;
  /** The turn threw. A scheduled run that broke is never treated as silent. */
  failed: boolean;
}

interface SessionState {
  id: string;
  session: AgentSession;
  harness: SessionHarness;
  manager: SessionManager;
  unsubscribe: () => void;
  bridge: PiUiBridge | null;
  activeStreamId: string | null;
  /** First user prompt, truncated — the session's display title everywhere. */
  title: string;
  runStartedAt: number;
  /**
   * What is true of the turn in flight (QM ticket 2). Reset field by field at
   * the top of every `run` — never replaced, because `end_quietly` closed over
   * this object when the session was built.
   */
  readonly turn: TurnFlags;
  /** Bring a skill into this live session (the PM picked it). */
  invoke: (skill: Runnable) => Promise<void>;
  /** Re-narrow the active tool set to what the harness now grants. */
  reactivate: () => void;
}

/**
 * Embeds pi in the main process in full-control mode (PLAN §3.3): its own
 * AuthStorage/SessionManager/SettingsManager paths (off the user's ~/.pi), a
 * DefaultResourceLoader that suppresses skills/prompts/AGENTS.md, and NO built-in
 * tools — only our vault-scoped custom tools.
 */
export class AgentRuntime {
  private config: AgentRuntimeConfig | null = null;
  private authStorage: AuthStorage | null = null;
  private modelRegistry: ModelRegistry | null = null;
  private atlassian: AtlassianClient | null = null;
  private readonly sessions = new Map<string, SessionState>();
  /** sessionId → in-flight createSession — two rapid runs must share one session. */
  private readonly creating = new Map<string, Promise<SessionState>>();
  private readonly streamToSession = new Map<string, string>();
  /** sessionId → shelf state; only non-active entries are stored. */
  private lifecycles: Record<string, StoredLifecycle> = {};
  /**
   * listChats() re-reads every transcript in full — cache the result keyed by a
   * cheap stat signature of the sessions dir so the frequent sidebar refresh
   * with nothing changed costs a readdir + stats, not N file reads.
   */
  private chatListCache: { sig: string; chats: ChatRef[] } | null = null;
  /** Lifecycle hook — main pushes these to the renderer as `session:status`. */
  onStatus: ((status: SessionStatus) => void) | null = null;
  /** Fired when a session writes a working file — main pushes `session:files`. */
  onFilesChanged: ((sessionId: string) => void) | null = null;
  /**
   * A fan-out is waiting on the PM (`request`), or its card has settled
   * (`null`). The only moment the PM steers before money is spent.
   */
  onSpawnRequest: ((sessionId: string, request: SpawnRequestInfo | null) => void) | null = null;
  /** requestId → the card in flight and the promise the `spawn` tool is parked on. */
  private readonly pendingSpawns = new Map<string, PendingSpawn>();
  /**
   * A session is asking the PM something (`request`), or its card has settled
   * (`null`). Same shape as the spawn hook, and the same rule: the turn is
   * still running underneath it, so nothing else in that conversation moves.
   */
  onAskRequest: ((sessionId: string, request: AskRequestInfo | null) => void) | null = null;
  /**
   * Where parked questions wait — the promise while this process is up, the row
   * in `app.db` for after it is not (QM ticket 9). The hook above is fired from
   * inside it, so a card announced and a card written down can never disagree.
   */
  private readonly parking = new AskParking({
    onChange: (sessionId, request) => this.onAskRequest?.(sessionId, request),
  });

  configure(config: AgentRuntimeConfig): void {
    // Re-applying identical settings must not kill live sessions mid-stream.
    if (this.config && sameConfig(this.config, config)) return;
    this.config = config;
    this.chatListCache = null;
    this.lifecycles = this.loadLifecycles();
    this.authStorage = AuthStorage.create(join(config.userDataDir, 'pi', 'auth.json'));
    if (config.apiKey) {
      // In-memory only — never written to disk (PLAN §2).
      this.authStorage.setRuntimeApiKey('anthropic', config.apiKey);
    }
    this.modelRegistry = ModelRegistry.create(this.authStorage, join(config.userDataDir, 'pi', 'models.json'));
    this.atlassian = config.atlassian
      ? new AtlassianClient(config.atlassian)
      : null;
    // A config change invalidates existing sessions (built with the old model/tools).
    this.disposeSessions();
  }

  isReady(): boolean {
    return !!this.config?.apiKey && this.listModels().length > 0;
  }

  listModels(): ModelInfo[] {
    if (!this.modelRegistry) return [];
    try {
      return this.modelRegistry.getAvailable().map((m) => ({ id: m.id, label: m.name }));
    } catch {
      return [];
    }
  }

  private resolveModel() {
    if (!this.modelRegistry || !this.config) throw new Error('agent runtime not configured');
    const available = this.modelRegistry.getAvailable();
    if (available.length === 0) throw new Error('No model available — set an Anthropic API key in Settings.');
    return available.find((m) => m.id === this.config!.modelId) ?? available[0]!;
  }

  /**
   * A short, human title for a titleless capture (a dropped transcript) — so it
   * files as `meetings/2026-07-20-nordkap-sso-checkin.md`, not a slug of its
   * first spoken line. One cheap non-streaming completion; strictly best-effort:
   * no key, no model, or any error returns null and the caller keeps its
   * heuristic title. Never throws into the capture path.
   */
  async generateTitle(text: string): Promise<string | null> {
    let model;
    try {
      model = this.resolveModel();
    } catch {
      return null;
    }
    const excerpt = text.replace(/\s+/g, ' ').trim().slice(0, 3000);
    if (excerpt.length < 40) return null;
    const context = {
      systemPrompt:
        'You title meeting notes. Reply with ONLY a short, specific title in Title Case ' +
        '(3–8 words) — the customer or topic, no quotes, no trailing punctuation, no preamble. ' +
        'Example: Nordkap SSO Go-Live Check-in',
      messages: [{ role: 'user' as const, content: `Transcript excerpt:\n\n${excerpt}`, timestamp: 0 }],
    };
    try {
      // pi-ai falls back to env vars without an explicit apiKey — pass the
      // configured key so a Settings-pasted key works in packaged builds (no
      // ANTHROPIC_API_KEY in the environment).
      const msg = await completeSimple(model as Parameters<typeof completeSimple>[0], context, {
        apiKey: this.config?.apiKey ?? undefined,
      });
      const out = (msg.content ?? [])
        .filter((c): c is { type: 'text'; text: string } => (c as { type?: string }).type === 'text')
        .map((c) => c.text)
        .join(' ');
      const title = out
        .replace(/^["'`\s]+|["'`.\s]+$/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 80)
        .trim();
      return title.length >= 2 ? title : null;
    } catch {
      return null;
    }
  }

  /**
   * One-shot, non-streaming completion for background judgments (the
   * librarian's page-contradiction checks). Returns null when no model/key is
   * configured — the caller treats that as "cannot judge, skip quietly".
   * Unlike generateTitle, API errors THROW: the sweep must know the judgment
   * didn't happen so it can retry next tick instead of recording a verdict.
   */
  async completeText(input: { system: string; prompt: string }): Promise<string | null> {
    let model;
    try {
      model = this.resolveModel();
    } catch {
      return null;
    }
    const context = {
      systemPrompt: input.system,
      messages: [{ role: 'user' as const, content: input.prompt, timestamp: 0 }],
    };
    const msg = await completeSimple(model as Parameters<typeof completeSimple>[0], context, {
      apiKey: this.config?.apiKey ?? undefined,
    });
    // completeSimple resolves (never rejects) on API failure, with an error
    // stop reason. Surface that as a throw — returning the empty text here
    // would be ledgered as a verdict and permanently suppress the check.
    if (msg.stopReason === 'error' || msg.stopReason === 'aborted') {
      throw new Error(msg.errorMessage ?? 'completion failed');
    }
    return (msg.content ?? [])
      .filter((c): c is { type: 'text'; text: string } => (c as { type?: string }).type === 'text')
      .map((c) => c.text)
      .join('\n');
  }

  /**
   * Resolve an invocation by NAME. A skill (or agent) IS its folder, so the name
   * is the folder name: the workspace's `skills/<name>/SKILL.md` wins (a
   * customised copy beats the shipped one), then `agents/<name>/AGENT.md` — a
   * fired agent is invoked into a session through this same door — then the
   * built-in pack. `runnableCandidates` holds that order, and the legacy flat
   * file after each folder form, so a vault mid-migration resolves either way
   * without the skills-over-agents precedence changing.
   *
   * Only the entry file is read here. Whatever sits beside it stays on disk
   * until the instructions name it and the model calls `vault_read`.
   */
  private async resolveSkill(name: string, ctx: UseCaseContext): Promise<Runnable> {
    let raw: string | null = null;
    for (const path of runnableCandidates(name)) {
      raw = await ctx.vault.readRaw(path);
      if (raw !== null) break;
    }
    return parseRunnable(raw ?? DEFAULT_SKILL_BY_NAME[name] ?? '', name);
  }

  /**
   * Stamp every runnable this session actually put to work, so the Skills and
   * Agents views can say which files are alive and which are dead weight.
   * Written once per settled turn (upserted in place, so re-running a turn costs
   * one row, not a history). Reference material counts as used too: it arrives
   * as a read rather than an arrival, and a reference nobody reads is exactly
   * the thing worth spotting.
   */
  private markUsed(state: SessionState, ctx: UseCaseContext, quiet: boolean): void {
    const names = new Set(state.harness.invoked.map((c) => c.name));
    for (const path of state.harness.reads) {
      const name = runnableNameFromPath(path);
      if (name) names.add(name);
    }
    const at = Date.now();
    for (const name of names) markRunnableUsed(ctx, name, at);
    // A run that left nothing anywhere else leaves this: one stamp, on the file
    // the schedule actually fired, read back by its own page as "ran, nothing to
    // report" (QM ticket 2). Only the primary one — a house rule that happened
    // to be in force did not go quiet, the agent did.
    //
    // A run that STOPPED for want of a decision gets the more specific stamp
    // instead of that one (QM ticket 9), never both: they would carry the same
    // timestamp, and the page would have to guess which of the two happened.
    if (state.turn.blocked) markRunnableStopped(ctx, state.harness.primarySkillName, at);
    else if (quiet) markRunnableQuiet(ctx, state.harness.primarySkillName, at);
  }

  /**
   * What the session may do RIGHT NOW — read off the harness, not off the file
   * it opened with, because a runnable that arrives mid-conversation brings its
   * own capabilities. Also where the workspace's outbound floor is applied: a
   * capability becomes a tool here and nowhere else, so this is the one place
   * that has to know what the workspace will actually let a draft reach.
   */
  private toolNamesFor(
    harness: SessionHarness,
    atlassianActive: boolean,
    canInvokeSkills: boolean,
    /** Whether the workspace has any outbound connector at all (`ctx.outbound`). */
    connected: boolean,
  ): string[] {
    // Asking the PM is available to every session, under every skill: it grants
    // no capability the session didn't already have (it writes nothing, reads
    // nothing) — it only decides which of two allowed paths to take.
    // Proposing is likewise always on: every propose_* lands as an approval
    // card, so the gate is the review. The one earned permission is outbound.
    // `end_quietly` is on everywhere too, and deliberately: it is a no-op on an
    // interactive turn, and a tool that appeared and disappeared between kinds
    // of session would only teach the model to guess which kind it is in.
    const names = [...VAULT_TOOL_NAMES, ASK_TOOL_NAME, END_QUIETLY_TOOL_NAME, ...PROPOSE_TOOL_NAMES];
    // Outbound is two permissions in series and a file only holds the first:
    // `can: [draft-outbound]` says this session may draft, the workspace's
    // connectors say whether a draft can reach anything. With nothing connected
    // these could only ever produce cards that fail on approval ("no outbound
    // integration configured"), so a skill file does not get to grant them over
    // the workspace's head. WHICH connector a given card needs stays an
    // approval-time question: Google's write scope is granted by incremental
    // consent at push time, so it is not knowable here.
    if (harness.outbound)
      names.push(...(connected ? DRAFT_TOOL_NAMES : DRAFT_TOOL_NAMES.filter(needsNoConnector)));
    if (canInvokeSkills) names.push(USE_SKILL_TOOL_NAME);
    // Fan-out rides with session files: children write into the folder, and
    // reading their output back is the whole point of having one.
    if (harness.sessionFiles) names.push(...SESSION_FILE_TOOL_NAMES, SPAWN_TOOL_NAME);
    if (atlassianActive) names.push(...ATLASSIAN_TOOL_NAMES);
    return names;
  }

  /**
   * Always-on skills (`starts: [always]`) injected into every session's system
   * prompt: voice registers, filing rules — the house rules. Driven by what the
   * file declares rather than a filename regex; the Skills view says "Always in
   * effect", and this is the line that makes that sentence true.
   */
  private async alwaysOnGuides(ctx: UseCaseContext): Promise<string> {
    const skills = ctx.index.all().filter((n) => n.type === 'skill');
    const bodies: string[] = [];
    for (const g of skills) {
      const raw = await ctx.vault.readRaw(g.path);
      if (!raw) continue;
      const cfg = parseRunnable(raw, g.slug.split('/').pop() ?? g.slug);
      if (!cfg.starts.includes('always')) continue;
      // A house rule someone switched off is off — the same edit that silences
      // an agent silences a rule.
      if (!cfg.enabled) continue;
      const note = await ctx.vault.readNote(g.path);
      if (!note) continue;
      // The audience scope, stated where the model reads the rule — the Skills
      // view describes this scoping, so the prompt must carry it too.
      const scope = cfg.audience ? ` (applies when drafting for ${cfg.audience})` : '';
      // The heading names the rule the way the Skills view does; the gloss
      // only earns a line when it says something the title doesn't.
      const gloss = cfg.summary.trim() && cfg.summary.trim() !== cfg.name ? ` — ${cfg.summary.trim()}` : '';
      bodies.push(`### ${cfg.title}${scope}${gloss}\n${note.body.trim()}`);
    }
    return bodies.length ? `\n\n## House rules (always in effect)\n${bodies.join('\n\n')}` : '';
  }

  /**
   * The on-demand skill index (Sessions v2 Part 3.1): every playbook and every
   * reference skill, listed by name + summary so the model knows what it can
   * pull in via `use_skill` without paying for the bodies until one is
   * relevant. Returns null when nothing is loadable.
   */
  private async skillIndex(ctx: UseCaseContext, current: string): Promise<string | null> {
    const skills = (await listLoadableSkills(ctx)).filter((s) => s.config.name !== current);
    if (skills.length === 0) return null;
    const reference = skills.filter((s) => !governs(s.config));
    const playbooks = skills.filter((s) => governs(s.config));
    const parts = [
      '\n\n## Skills available on demand',
      'Call `use_skill` with one of these names when the conversation turns into the work it describes. ' +
        'A playbook takes over how you work from that point on — its instructions and the cards it may ' +
        'produce. Load one rather than improvising a workflow it already describes.',
    ];
    if (playbooks.length > 0)
      parts.push(playbooks.map((s) => `- \`${s.config.name}\` — ${s.config.summary}`).join('\n'));
    if (reference.length > 0)
      parts.push(`Reference (read-only):\n${reference.map((g) => `- \`${g.config.name}\` — ${g.config.summary}`).join('\n')}`);
    return parts.join('\n');
  }

  /**
   * Seed the root `index.md` vault map into the session context (OKF §8, the
   * strongest of the three retrieval levers): because the map is compact (one
   * line per folder), injecting it means the agent starts every session already
   * holding the whole-vault orientation, then drills into folder maps via
   * `vault_read` — never spending a tool call just to find the map. Absent (a
   * fresh vault before the first librarian pass) contributes nothing.
   */
  private async vaultMap(ctx: UseCaseContext): Promise<string> {
    const raw = await ctx.vault.readRaw('index.md');
    if (!raw || !raw.trim()) return '';
    return `\n\n## Vault map (root index.md)\nYour orientation layer. Each folder also has its own index.md; read the relevant one, then vault_read the notes it points to.\n\n${raw.trim()}`;
  }

  /** Where the pi JSONL transcripts live — the machine replay store (off the vault). */
  private sessionsDir(): string {
    if (!this.config) throw new Error('agent runtime not configured');
    return join(this.config.userDataDir, 'sessions');
  }

  /** Shelf-state sidecar (off the pi files, so pi's store stays untouched). */
  private lifecycleFile(): string {
    if (!this.config) throw new Error('agent runtime not configured');
    return join(this.config.userDataDir, 'session-lifecycle.json');
  }

  private loadLifecycles(): Record<string, StoredLifecycle> {
    try {
      const parsed = JSON.parse(readFileSync(this.lifecycleFile(), 'utf8')) as Record<string, unknown>;
      const out: Record<string, StoredLifecycle> = {};
      for (const [id, v] of Object.entries(parsed)) {
        if (v === 'done' || v === 'dismissed' || v === 'quiet') out[id] = v;
      }
      return out;
    } catch {
      return {};
    }
  }

  getLifecycle(sessionId: string): StoredLifecycle {
    return this.lifecycles[sessionId] ?? 'active';
  }

  setLifecycle(sessionId: string, lifecycle: StoredLifecycle): void {
    if (lifecycle === 'active') delete this.lifecycles[sessionId];
    else this.lifecycles[sessionId] = lifecycle;
    // Lifecycle lives in a sidecar, not the sessions dir — the dir signature
    // won't notice this change, so drop the cache by hand.
    this.chatListCache = null;
    try {
      writeFileSync(this.lifecycleFile(), JSON.stringify(this.lifecycles));
    } catch (err) {
      console.error('[pm] session lifecycle save failed:', err);
    }
  }

  /** pi names session files `<timestamp>_<id>.jsonl`; find by id, newest first. */
  private findSessionFile(sessionId: string): string | null {
    try {
      const files = readdirSync(this.sessionsDir())
        .filter((f) => f.endsWith(`_${sessionId}.jsonl`))
        .sort()
        .reverse();
      return files[0] ? join(this.sessionsDir(), files[0]) : null;
    } catch {
      return null;
    }
  }

  private async createSession(
    id: string,
    ctx: UseCaseContext,
    /** Whether a clock opened this session — it earns the scheduled preamble. */
    scheduled: boolean,
  ): Promise<SessionState> {
    if (!this.config || !this.authStorage || !this.modelRegistry) {
      throw new Error('agent runtime not configured');
    }
    const model = this.resolveModel();

    /**
     * Every session opens on the SAME skill (Sessions v2 Part 4). A session type
     * is not a mode any more: the requested one arrives as the first invocation
     * (see `run`), which is what lets a second one arrive after it. The entry
     * points are unchanged — the button on a meeting, the Landing tiles, the
     * Skills view — they just mean "start a session and invoke this" now.
     */
    const skillConfig = await this.resolveSkill(BASE_SKILL_NAME, ctx);
    const harness = new SessionHarness(id, skillConfig, ctx.clock.now());
    // House rules (always-on skills) ride along unconditionally: a voice guide
    // is inert until something drafts outbound, and the filing rules apply to
    // every proposal.
    const voice = await this.alwaysOnGuides(ctx);
    const skillIndex = await this.skillIndex(ctx, skillConfig.name);
    const vaultMap = await this.vaultMap(ctx);
    const filesRoot = sessionFilesRoot(this.config.vaultDir, id);
    const files = harness.sessionFiles ? sessionFilesPrompt(sessionFilesRelRoot(id)) : '';
    // The licence to say nothing, and only where it applies (QM ticket 2). Baked
    // in at creation because that is where the system prompt is composed; the
    // TOOL asks per turn, so a PM writing into a scheduled run still gets an
    // answer rather than silence.
    const scheduledNote = scheduled ? SCHEDULED_PREAMBLE : '';
    const baseSystemPrompt =
      buildSystemPrompt(SHARED_PREAMBLE, skillConfig) +
      voice +
      (skillIndex ?? '') +
      files +
      vaultMap +
      scheduledNote;

    // The tracker seam (Jira/Confluence) is available whenever it is configured.
    // It used to be the `ask` session's alone; with types dissolved there is no
    // "the ask session" to hang it on, and every read it offers is silent and
    // non-mutating — `track_external` only starts a local mirror.
    const atlassianActive = !!this.atlassian;
    const canInvokeSkills = !!skillIndex;

    /**
     * The one hard change of Sessions v2 (Part 3): the tool set is no longer
     * fixed at session creation. Every tool a skill could ever turn on is
     * REGISTERED here — pi's `tools` allowlist filters the registry itself, so
     * a tool absent from it can never be activated later — while only the ones
     * the current skill grants are ACTIVE. `applyActivation` moves that line.
     */
    // Reset at the top of every run(); read at the bottom of it.
    const turn: TurnFlags = { scheduled, ended: false, asked: false, blocked: false, failed: false };

    const registry = [
      ...VAULT_TOOL_NAMES,
      ASK_TOOL_NAME,
      END_QUIETLY_TOOL_NAME,
      ...PROPOSE_TOOL_NAMES,
      ...DRAFT_TOOL_NAMES,
      ...(canInvokeSkills ? [USE_SKILL_TOOL_NAME] : []),
      ...SESSION_FILE_TOOL_NAMES,
      SPAWN_TOOL_NAME,
      ...(atlassianActive ? ATLASSIAN_TOOL_NAMES : []),
    ];
    const customTools = [
      ...createVaultTools(ctx, harness),
      createAskTool({ requestAnswer: (plan, signal) => this.askThePm(id, ctx, plan, signal) }),
      createEndQuietlyTool({
        scheduled: () => turn.scheduled,
        endQuietly: () => {
          turn.ended = true;
        },
      }),
      ...createProposeTools(ctx, id, harness),
      ...createDraftTools(ctx, id, harness),
      ...(canInvokeSkills ? [createUseSkillTool(ctx, harness, () => applyActivation())] : []),
      ...createSessionFileTools(filesRoot, () => this.onFilesChanged?.(id)),
      createSpawnTool({
        readBrief: () => readSessionFile(filesRoot, BRIEF_FILE),
        requestApproval: (plan, brief) => this.askToSpawn(id, plan, brief),
        runChild: (child, opts) => this.runChild(id, child, opts, ctx, harness),
      }),
      ...(atlassianActive ? createAtlassianTools(this.atlassian!, this.config.trackExternal) : []),
    ];

    // Mutable so an arriving skill's instructions can join the system prompt and
    // stay there — a tool result is one message that compaction may drop, but
    // the rules the session is now working under have to survive the turn.
    let systemPrompt = baseSystemPrompt;
    const loader = new DefaultResourceLoader({
      cwd: this.config.vaultDir,
      agentDir: join(this.config.userDataDir, 'pi', 'agent'),
      // Full control: don't load the user's ~/.pi resources or the vault's AGENTS.md.
      systemPrompt,
      noSkills: true,
      noPromptTemplates: true,
      noContextFiles: true,
      noThemes: true,
      noExtensions: true,
      systemPromptOverride: () => systemPrompt,
      agentsFilesOverride: () => ({ agentsFiles: [] }),
    });
    await loader.reload();

    // The JSONL is keyed by our session id: a chat survives restarts, and
    // resuming reopens the same file with its full model context (PLAN §Phase 3).
    const existingFile = this.findSessionFile(id);
    const manager = existingFile
      ? SessionManager.open(existingFile, this.sessionsDir(), this.config.vaultDir)
      : SessionManager.create(this.config.vaultDir, this.sessionsDir(), { id });

    const { session } = await createAgentSession({
      cwd: this.config.vaultDir,
      model,
      noTools: 'all',
      tools: registry,
      customTools,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      resourceLoader: loader,
      sessionManager: manager,
      settingsManager: SettingsManager.inMemory(),
    });

    /**
     * Narrow the registry to what the skills currently in force actually grant,
     * bounded by what the workspace allows. `ctx.outbound` is read on every call
     * rather than snapshotted: connecting Atlassian rebuilds sessions, but a
     * Google grant only reassigns it on the shared context, and a live session
     * should pick that up on its next turn.
     */
    const applyActivation = (): void => {
      session.setActiveToolsByName(
        this.toolNamesFor(harness, !!atlassianActive, canInvokeSkills, !!ctx.outbound).filter((n) =>
          registry.includes(n),
        ),
      );
    };
    applyActivation();

    const state: SessionState = {
      id,
      session,
      harness,
      manager,
      bridge: null,
      activeStreamId: null,
      title: '',
      runStartedAt: 0,
      turn,
      unsubscribe: () => undefined,
      /**
       * Explicit invocation (Sessions v2 Part 3.2): the PM picked a skill, so no
       * tool call carried its body into context. Append it to the system prompt,
       * reload so the loader recomputes, and re-activate — `setActiveToolsByName`
       * rebuilds the prompt from the loader, so the two must happen together.
       */
      invoke: async (skill: Runnable) => {
        harness.invokeSkill(skill);
        systemPrompt = `${systemPrompt}\n\n${buildSkillBrief(skill)}`;
        await loader.reload();
        applyActivation();
      },
      reactivate: applyActivation,
    };
    state.unsubscribe = session.subscribe((event) => {
      state.bridge?.handle(event);
    });
    this.sessions.set(id, state);
    return state;
  }

  /** File the session receipt to sessions/ — the human-auditable reads/writes ledger. */
  private async fileReceipt(state: SessionState, ctx: UseCaseContext, quiet = false): Promise<void> {
    if (state.harness.turns.length === 0 && state.harness.writes.length === 0) return;
    this.markUsed(state, ctx, quiet);
    // A run with nothing to report leaves no receipt (QM ticket 2). Not written
    // then removed: a note that exists for a second is a note the librarian can
    // index, git can commit and a watcher can push to the renderer, and undoing
    // all three is strictly harder than not starting. What it DOES leave is the
    // stamp `markUsed` just wrote, which is what the agent's page reads.
    if (quiet) return;
    try {
      const files = state.harness.sessionFiles ? (await this.listFiles(state.id)).length : 0;
      const receipt = buildSessionReceipt(state.harness, ctx.clock.now(), undefined, files);
      const note = await ctx.vault.writeNote(receipt.path, receipt.frontmatter, receipt.body);
      ctx.index.reindex(note);
      await ctx.git.commitPaths([receipt.path], `session: ${state.harness.primarySkillName}`);
    } catch (err) {
      console.error('[pm] session receipt filing failed:', err);
    }
  }

  /**
   * What a conversation calls itself, from its first message. A message the PM
   * typed IS the title; a kickoff the app composed ("Run the arrival skill on
   * sources/2026-07-30-i-have-a-meeting…") is machine prose that makes a useless
   * row in the sessions list, so those get named after what they are — the skill
   * and the page it ran on.
   */
  /**
   * The first thing ever said into this conversation, off the transcript. A
   * session resumed after a restart has no title in memory, and naming it after
   * whatever reopened it would rename an old conversation after a new sentence —
   * most visibly when what reopens it is a replayed answer (QM ticket 9).
   */
  private openingPrompt(state: SessionState): string | null {
    for (const m of entriesToUiMessages(state.manager.buildContextEntries())) {
      if (m.role !== 'user') continue;
      const text = m.parts.find((p) => p.type === 'text');
      if (text && 'text' in text && text.text.trim()) return text.text;
    }
    return null;
  }

  private titleFor(prompt: string, state: SessionState, ctx: UseCaseContext): string {
    const kickoff = parseKickoff(prompt);
    if (!kickoff) return truncate(prompt, 60) ?? 'Session';
    const skill =
      state.harness.invoked.find((c) => c.name === kickoff.skill)?.title ?? kickoff.skill;
    const target = kickoff.target ? ctx.index.get(kickoff.target)?.title : undefined;
    return truncate(target ? `${skill} — ${target}` : skill, 60) ?? skill;
  }

  /**
   * Start a run. Returns immediately with {streamId, sessionId}; chunks stream via
   * `emit(streamId, chunk)` (main pumps them over IPC). The terminal `finish`
   * chunk always fires — on success, error, or abort.
   */
  async run(
    input: RunInput,
    ctx: UseCaseContext,
    emit: (streamId: string, chunk: Chunk) => void,
  ): Promise<RunHandle> {
    if (!this.config?.apiKey) throw new Error('Set an Anthropic API key in Settings to start a session.');
    const sessionId = input.sessionId ?? randomUUID();
    let state = this.sessions.get(sessionId);
    if (!state) {
      let pending = this.creating.get(sessionId);
      if (!pending) {
        pending = this.createSession(sessionId, ctx, !!input.scheduled).finally(() => {
          this.creating.delete(sessionId);
        });
        this.creating.set(sessionId, pending);
      }
      state = await pending;
    }
    // One turn at a time per session: a second run would reroute the live
    // bridge mid-stream and interleave pi prompts on the same session.
    if (state.activeStreamId) throw new Error('This session is still responding — wait or stop it first.');
    // A new message on a done/dismissed session reopens it. A quiet run reopens
    // the same way: the moment anything is said into it, it has a reader.
    if (this.getLifecycle(sessionId) !== 'active') this.setLifecycle(sessionId, 'active');
    // Whose turn this is gets decided here, once, for everything downstream: the
    // `end_quietly` tool, and the settle below. Mutated in place, never
    // replaced — the tool closed over this exact object at session creation.
    state.turn.scheduled = !!input.scheduled;
    state.turn.ended = false;
    state.turn.asked = false;
    state.turn.blocked = false;
    state.turn.failed = false;
    // Invoking the same skill twice is a no-op, so a caller that keeps passing
    // one across turns stacks nothing.
    if (input.skill) await this.invokeSkillInto(state, input.skill, ctx, input.outbound);
    state.harness.beginTurn(input.prompt, ctx.clock.now());
    if (!state.title) state.title = this.titleFor(this.openingPrompt(state) ?? input.prompt, state, ctx);

    const streamId = randomUUID();
    const bridge = new PiUiBridge((chunk) => emit(streamId, chunk));
    state.bridge = bridge;
    state.activeStreamId = streamId;
    state.runStartedAt = Date.now();
    this.streamToSession.set(streamId, sessionId);
    bridge.start();
    this.emitStatus(state, 'running');

    void state.session
      .prompt(input.prompt)
      .catch((err) => {
        // A scheduled run that broke has to stay visible, so the failure is
        // remembered here and read by `ranQuiet` below.
        state.turn.failed = true;
        emit(streamId, { type: 'error', errorText: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        bridge.finish();
        if (state.activeStreamId === streamId) {
          state.activeStreamId = null;
          state.bridge = null;
        }
        this.streamToSession.delete(streamId);
        // Decided before the status goes out: main suppresses the "finished"
        // notification on a quiet run, and the renderer must not draw a row it
        // is about to lose on the next refresh.
        const quiet = this.settleQuietly(state, bridge.finalText);
        this.emitStatus(state, 'settled', quiet);
        // File/refresh the session receipt after each settled turn.
        void this.fileReceipt(state, ctx, quiet);
      });

    return { streamId, sessionId };
  }

  private emitStatus(state: SessionState, status: SessionStatus['status'], quiet = false): void {
    this.onStatus?.({
      sessionId: state.id,
      title: state.title,
      status,
      updated: Date.now(),
      ...(quiet ? { quiet } : {}),
    });
  }

  /**
   * Did this turn genuinely leave nothing (QM ticket 2), and if so, shelve the
   * session out of every list before anyone reads one. The rule itself is
   * {@link ranSilent}; what this adds is where "produced" is read from — the
   * harness's own writes ledger, which every propose_* and draft_* appends to.
   */
  private settleQuietly(state: SessionState, finalText: string): boolean {
    const t = state.turn;
    const quiet = ranSilent({
      scheduled: t.scheduled,
      failed: t.failed,
      produced: t.asked || state.harness.writes.length > 0,
      ended: t.ended,
      blocked: t.blocked,
      finalText,
    });
    if (quiet) this.setLifecycle(state.id, 'quiet');
    return quiet;
  }

  /**
   * Bring a named skill into a live session. Resolves the same way session
   * creation does — workspace file first, built-in pack as the fallback — so a
   * customised skill wins over the shipped one here too. A name that resolves to
   * nothing is skipped rather than thrown: a stale picker entry must not kill
   * the PM's message.
   */
  private async invokeSkillInto(
    state: SessionState,
    name: string,
    ctx: UseCaseContext,
    outbound?: boolean,
  ): Promise<void> {
    if (state.harness.invoked.some((c) => c.name === name)) return; // already in force
    // The base skill is loaded at creation. Invoking it AS an arrival would
    // append its body to the system prompt a second time and make an ordinary
    // chat file a receipt claiming a skill arrived — a caller naming it is
    // asking for a plain chat, which is what it already has.
    if (name === BASE_SKILL_NAME) return;
    const config = await this.resolveSkill(name, ctx);
    if (!config.name || !config.body.trim()) {
      console.error(`[pm] skill "${name}" could not be resolved — invoking it was skipped`);
      return;
    }
    // The firing trigger can GRANT outbound the file didn't claim (invariant 3):
    // arrival never removes a capability, only adds one.
    const granted =
      outbound && !config.can.includes('draft-outbound')
        ? { ...config, can: [...config.can, 'draft-outbound' as const] }
        : config;
    await state.invoke(granted);
  }

  /**
   * Park the `spawn` tool on a card and wait for the PM (invariant 6: spend is
   * always approved). No timeout: the answer is "yes", "no", or the PM stops the
   * run, and every one of those settles the promise. `cancelSpawns` covers abort,
   * delete and reconfigure.
   */
  private askToSpawn(sessionId: string, plan: SpawnPlan, brief: string | null): Promise<SpawnDecision> {
    const request: SpawnRequestInfo = {
      id: spawnRequestId(),
      sessionId,
      entries: plan.entries.map((e) => ({ label: e.label, count: e.count })),
      total: plan.total,
      brief,
      models: this.listModels(),
      defaultModelId: this.config?.modelId ?? '',
    };
    // Same rule as `askThePm`: a card the PM had to answer, and a spend they had
    // to approve, is attention already spent. The turn cannot end as if it left
    // nothing (QM ticket 2).
    const state = this.sessions.get(sessionId);
    if (state) state.turn.asked = true;
    return new Promise<SpawnDecision>((resolve) => {
      this.pendingSpawns.set(request.id, { request, resolve });
      this.onSpawnRequest?.(sessionId, request);
    });
  }

  /**
   * Park `ask_user` on a card and wait for the PM. No timeout, by design: the
   * exits are answer, skip, and stopping the run — all three visible on screen,
   * all three settling the promise. The turn stays alive underneath, which is
   * the whole point of asking here instead of ending it.
   *
   * On a run a clock started, none of that is true: nothing on screen, nobody to
   * settle it. So it fails closed instead (QM ticket 9), and the tool tells the
   * model to stop rather than to guess.
   */
  private askThePm(
    sessionId: string,
    ctx: UseCaseContext,
    plan: AskPlan,
    signal?: AbortSignal,
  ): Promise<AskDecision> {
    const state = this.sessions.get(sessionId);
    const scheduled = !!state?.turn.scheduled;
    // Read once, so the flag the settle reads and the decision the parking makes
    // can never disagree. A turn that put a card in front of the PM has already
    // spent their attention and can never end as if it left nothing (QM ticket
    // 2); a turn that was refused one stopped instead, and says so on its own
    // page (QM ticket 9).
    if (state) {
      if (scheduled) state.turn.blocked = true;
      else state.turn.asked = true;
    }
    const request: AskRequestInfo = {
      id: askRequestId(sessionId, plan),
      sessionId,
      questions: plan.questions,
    };
    // The skill rides along so an answer that arrives tomorrow resumes under the
    // instructions the question was asked under, not as a plain chat.
    return this.parking.park(
      ctx.asks,
      request,
      { scheduled, skill: state?.harness.primarySkillName ?? null, outbound: state?.harness.outbound },
      signal,
    );
  }

  /**
   * A pending question card, for a tab that reopened while the turn waited — or
   * for an app that was quit while it did.
   */
  pendingAsk(sessionId: string, ctx?: UseCaseContext): AskRequestInfo | null {
    return this.parking.pendingFor(ctx?.asks, sessionId);
  }

  /** Every question still waiting on the PM, this app run's and the last one's. */
  listPendingAsks(ctx?: UseCaseContext): AskRequestInfo[] {
    return this.parking.all(ctx?.asks);
  }

  /**
   * The PM answered (or skipped). A question whose turn is still parked resolves
   * it in place; one whose turn died with the process is REPLAYED — the session
   * is reopened and the answer arrives as a message. Answering an already
   * settled question does nothing, whichever of the two it was.
   *
   * Replaying needs a context to run in and somewhere to send the resumed run's
   * chunks, so the two arrive together or not at all: without them an orphaned
   * question is only cleared, which is all a caller with no vault open could
   * honestly do with it anyway.
   */
  async resolveAsk(
    requestId: string,
    decision: AskDecision,
    ctx?: UseCaseContext,
    emit?: (streamId: string, chunk: Chunk) => void,
  ): Promise<void> {
    await this.parking.resolve(
      ctx?.asks,
      requestId,
      decision,
      ctx && emit ? (asked, settled) => this.replayAnswer(asked, settled, ctx, emit) : undefined,
    );
  }

  /**
   * Answer a question whose turn is gone: reopen the session and say it as a
   * message. What the turn had already done is not re-done — pi persisted every
   * tool result as it happened, so reopening hands the model its own reading
   * back, and any card it proposed before asking is still in the Inbox. What it
   * cannot have back is the tool call it was parked on, so the answer comes in
   * through the front door instead of that one.
   */
  private async replayAnswer(
    asked: StoredAsk,
    decision: AskDecision,
    ctx: UseCaseContext,
    emit: (streamId: string, chunk: Chunk) => void,
  ): Promise<void> {
    await this.run(
      {
        sessionId: asked.sessionId,
        prompt: askReplayPrompt({ questions: asked.questions }, decision.answers),
        ...(asked.skill ? { skill: asked.skill } : {}),
        ...(asked.outbound ? { outbound: true } : {}),
      },
      ctx,
      emit,
    );
  }

  /** Dismiss every question card on this session (abort, delete, reconfigure). */
  private cancelAsks(sessionId?: string, ctx?: UseCaseContext): void {
    this.parking.cancel(ctx?.asks, sessionId);
  }

  /**
   * One fan-out child (Sessions v2 Part 2): a throwaway in-memory session with
   * vault read + session-folder read + exactly one output file. It inherits a
   * SUBSET of the parent's tools, never a superset — which is what makes future
   * non-vault cases safe by construction rather than by a decision nobody
   * remembers making. Returns its closing text for the parent's rollup.
   */
  private async runChild(
    parentId: string,
    child: SpawnChild,
    opts: { modelId?: string; brief: string | null },
    ctx: UseCaseContext,
    harness: SessionHarness,
  ): Promise<string> {
    if (!this.config || !this.authStorage || !this.modelRegistry) throw new Error('agent runtime not configured');
    const available = this.modelRegistry.getAvailable();
    const model = available.find((m) => m.id === opts.modelId) ?? this.resolveModel();
    const filesRoot = sessionFilesRoot(this.config.vaultDir, parentId);

    const parts = [CHILD_PREAMBLE, ''];
    if (opts.brief) parts.push(`## The brief (what everyone working on this was told)\n${opts.brief.trim()}`);
    parts.push(`## Your output\nWrite exactly one file with write_result: \`${child.writeTo}\`.`);
    if (child.read.length > 0) {
      parts.push(`## Read first\n${child.read.map((p) => `- ${p}`).join('\n')}`);
    }
    const systemPrompt = parts.join('\n\n');

    const loader = new DefaultResourceLoader({
      cwd: this.config.vaultDir,
      agentDir: join(this.config.userDataDir, 'pi', 'agent'),
      systemPrompt,
      noSkills: true,
      noPromptTemplates: true,
      noContextFiles: true,
      noThemes: true,
      noExtensions: true,
      systemPromptOverride: () => systemPrompt,
      agentsFilesOverride: () => ({ agentsFiles: [] }),
    });
    await loader.reload();

    let wrote = false;
    const { session } = await createAgentSession({
      cwd: this.config.vaultDir,
      model,
      noTools: 'all',
      tools: [...VAULT_TOOL_NAMES, ...CHILD_FILE_TOOL_NAMES],
      customTools: [
        // Reads land in the parent's receipt: the ledger must be honest about
        // what the session as a whole read, children included.
        ...createVaultTools(ctx, harness),
        ...createChildFileTools(filesRoot, child.writeTo, () => {
          wrote = true;
          this.onFilesChanged?.(parentId);
        }),
      ],
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      resourceLoader: loader,
      // Throwaway: a child leaves its FILE behind, never a transcript. Its
      // reasoning is scratch by definition, and thirty of them in the chat list
      // would bury the conversations the PM actually had.
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.inMemory(),
    });

    try {
      await session.prompt(child.prompt);
      const closing = lastAssistantText(session.messages as unknown as PiLikeMessage[]);
      // A child that reasoned but never called write_result still has an answer
      // worth keeping — the parent asked for a file, so file it rather than
      // losing the work to a missed tool call.
      if (!wrote && closing.trim()) {
        await writeSessionFile(filesRoot, child.writeTo, closing);
        this.onFilesChanged?.(parentId);
      }
      return closing || `(no closing summary; see ${child.writeTo})`;
    } finally {
      session.dispose();
    }
  }

  /**
   * A pending spawn approval card, for a tab that reopened while the fan-out was
   * waiting. Without this the card would exist only in the push that announced it.
   */
  pendingSpawn(sessionId: string): SpawnRequestInfo | null {
    for (const p of this.pendingSpawns.values()) if (p.request.sessionId === sessionId) return p.request;
    return null;
  }

  /** The PM answered the spawn card. Unknown ids are ignored (already settled). */
  resolveSpawn(requestId: string, decision: SpawnDecision): void {
    const pending = this.pendingSpawns.get(requestId);
    if (!pending) return;
    this.pendingSpawns.delete(requestId);
    this.onSpawnRequest?.(pending.request.sessionId, null);
    pending.resolve(decision);
  }

  /** Cancel every card waiting on this session (abort, delete, reconfigure). */
  private cancelSpawns(sessionId?: string): void {
    for (const [id, pending] of [...this.pendingSpawns]) {
      if (sessionId && pending.request.sessionId !== sessionId) continue;
      this.pendingSpawns.delete(id);
      this.onSpawnRequest?.(pending.request.sessionId, null);
      pending.resolve({ approved: false });
    }
  }

  /**
   * A session's working files (Sessions v2 Part 1) — what the right-panel tree
   * shows, filling live as the session writes. Off the index by construction, so
   * this is the only door to them; a session that never wrote returns [].
   */
  async listFiles(sessionId: string): Promise<SessionFileEntry[]> {
    if (!this.config) return [];
    return listSessionFiles(sessionFilesRoot(this.config.vaultDir, sessionId));
  }

  /** One session file's text, read-only. Null when it escapes the folder or is gone. */
  async readFile(sessionId: string, path: string): Promise<string | null> {
    if (!this.config) return null;
    return readSessionFile(sessionFilesRoot(this.config.vaultDir, sessionId), path);
  }

  /** Sessions with a turn in flight — the sidebar rail's running rows. */
  listLive(): LiveSession[] {
    const live: LiveSession[] = [];
    for (const state of this.sessions.values()) {
      if (!state.activeStreamId) continue;
      live.push({
        sessionId: state.id,
        title: state.title,
        streamId: state.activeStreamId,
        startedAt: state.runStartedAt,
      });
    }
    return live;
  }

  /** name:mtime:size per transcript — changes iff a full re-list would differ. */
  private sessionsDirSignature(): string | null {
    try {
      const dir = this.sessionsDir();
      return readdirSync(dir)
        .filter((f) => f.endsWith('.jsonl'))
        .sort()
        .map((f) => {
          const s = statSync(join(dir, f));
          return `${f}:${s.mtimeMs}:${s.size}`;
        })
        .join('|');
    } catch {
      return null;
    }
  }

  /** All stored conversations for this vault, newest first. */
  async listChats(): Promise<ChatRef[]> {
    if (!this.config) return [];
    const sig = this.sessionsDirSignature();
    if (sig !== null && this.chatListCache?.sig === sig) return this.chatListCache.chats;
    let infos;
    try {
      infos = await SessionManager.list(this.config.vaultDir, this.sessionsDir());
    } catch {
      return [];
    }
    const chats = infos
      .filter((info) => info.messageCount > 0)
      .map((info) => ({
        id: info.id,
        title: info.name ?? truncate(info.firstMessage, 64) ?? 'Untitled session',
        created: info.created.getTime(),
        updated: info.modified.getTime(),
        messageCount: info.messageCount,
        preview: truncate(info.allMessagesText, 140) ?? '',
        lifecycle: this.getLifecycle(info.id),
      }))
      // The one door to the Sessions list, the rail, the unread-result count and
      // every badge derived from them (renderer `lib/attention.ts`). A scheduled
      // run that found nothing leaves its transcript on disk and nothing here.
      .filter((c): c is ChatRef => c.lifecycle !== 'quiet');
    if (sig !== null) this.chatListCache = { sig, chats };
    return chats;
  }

  /** Replay a stored conversation as UI messages (live sessions read their open manager). */
  chatHistory(sessionId: string): UiMessage[] {
    const live = this.sessions.get(sessionId);
    if (live) return entriesToUiMessages(live.manager.buildContextEntries());
    const file = this.findSessionFile(sessionId);
    if (!file || !this.config) return [];
    const manager = SessionManager.open(file, this.sessionsDir(), this.config.vaultDir);
    return entriesToUiMessages(manager.buildContextEntries());
  }

  async deleteChat(sessionId: string, ctx?: UseCaseContext): Promise<void> {
    this.cancelSpawns(sessionId);
    this.cancelAsks(sessionId, ctx);
    const live = this.sessions.get(sessionId);
    if (live) {
      await live.session.abort().catch(() => undefined);
      live.bridge?.finish();
      live.unsubscribe();
      live.session.dispose();
      this.sessions.delete(sessionId);
      if (live.activeStreamId) this.streamToSession.delete(live.activeStreamId);
    }
    const file = this.findSessionFile(sessionId);
    if (file) rmSync(file, { force: true });
    if (this.lifecycles[sessionId]) this.setLifecycle(sessionId, 'active');
  }

  async abort(streamId: string, ctx?: UseCaseContext): Promise<void> {
    const sessionId = this.streamToSession.get(streamId);
    if (!sessionId) return;
    // Stop also answers a spawn card the turn is parked on — otherwise Stop
    // looks dead while the tool waits for an approval nobody will give. Same
    // for a question card: the PM chose to stop instead of answering, so the
    // written-down copy goes with the promise.
    this.cancelSpawns(sessionId);
    this.cancelAsks(sessionId, ctx);
    const state = this.sessions.get(sessionId);
    if (!state) return;
    await state.session.abort().catch(() => undefined);
    state.bridge?.finish();
  }

  private disposeSessions(): void {
    this.cancelSpawns();
    // No context, deliberately: reconfiguring or quitting kills the turns, but
    // the questions they were parked on are exactly what has to survive that.
    // The rows stay, and the next answer to one of them replays instead.
    this.cancelAsks();
    for (const state of this.sessions.values()) {
      state.unsubscribe();
      state.session.dispose();
    }
    this.sessions.clear();
    this.streamToSession.clear();
  }

  dispose(): void {
    this.disposeSessions();
  }
}

function sameConfig(a: AgentRuntimeConfig, b: AgentRuntimeConfig): boolean {
  return (
    a.vaultDir === b.vaultDir &&
    a.userDataDir === b.userDataDir &&
    a.modelId === b.modelId &&
    a.apiKey === b.apiKey &&
    (a.atlassian?.baseUrl ?? null) === (b.atlassian?.baseUrl ?? null) &&
    (a.atlassian?.email ?? null) === (b.atlassian?.email ?? null) &&
    (a.atlassian?.token ?? null) === (b.atlassian?.token ?? null)
  );
}

function truncate(s: string | undefined, n: number): string | undefined {
  const flat = s?.replace(/\s+/g, ' ').trim();
  if (!flat) return undefined;
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}
