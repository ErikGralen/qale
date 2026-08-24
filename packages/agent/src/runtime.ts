import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createAgentSession,
  ModelRuntime,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from '@earendil-works/pi-coding-agent';
import {
  markRunnableQuiet,
  markRunnableStopped,
  markRunnableUsed,
  normalizeNoteFrontmatter,
  sessionCards,
  type UseCaseContext,
} from '@qale/application';
import {
  DEFAULT_LANGUAGE,
  DEFAULT_PROVIDER,
  providerModels,
  providerName,
  runnableCandidates,
  runnableNameFromPath,
  type LlmProvider,
} from '@qale/domain';
import type { ProviderReadTool } from '@qale/connectors';
import {
  createVaultTools,
  createProposeTools,
  createWithdrawTool,
  createDraftTools,
  createTextTools,
  createVoiceGate,
  createReadTools,
  createTrackTools,
  createUseSkillTool,
  listLoadableSkills,
  TRACK_TOOL_NAMES,
  VAULT_TOOL_NAMES,
  PROPOSE_TOOL_NAMES,
  WITHDRAW_TOOL_NAME,
  DRAFT_TOOL_NAMES,
  CALENDAR_TOOL_NAMES,
  DRAFT_TEXT_TOOL_NAME,
  GET_VOICE_TOOL_NAME,
  USE_SKILL_TOOL_NAME,
  type AnswerContainerOffer,
  type ListOutboundContainers,
  type TrackExternal,
} from './tools.js';
import { listVoices } from './voices.js';
import { providerFault, type ProviderFault } from './api-errors.js';
import { withCardState } from './card-state.js';
import { withDecodedArgs } from './tool-args.js';
import {
  cheapestModel,
  cleanTitle,
  namingSystemPrompt,
  namingUserPrompt,
  type SessionSubject,
} from './naming.js';
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
  isOffered,
  ASK_TOOL_NAME,
  type AskDecision,
  type AskPlan,
  type AskRequestDraft,
  type AskRequestInfo,
  type StoredAsk,
} from './ask.js';
import {
  createCodebaseTool,
  codebasePrompt,
  codebaseRequestId,
  CODEBASE_REPORTS_DIR,
  CODEBASE_TOOL_NAME,
  type CodebaseAsk,
  type CodebaseDecision,
} from './codebase.js';
import { CODEBASE_MODELS, isCodebaseModel } from './codebase-models.js';
import {
  createCommentsTool,
  commentRequestId,
  commentsReplayPrompt,
  COMMENTS_TOOL_NAME,
} from './comments.js';
import type { CommentPlan } from './slots.js';
import { createFilingTools, FILING_TOOL_NAMES } from './filing.js';
import { createDeferralTool, DEFER_TOOL_NAME } from './deferrals.js';
import { createEndQuietlyTool, ranSilent, END_QUIETLY_TOOL_NAME } from './quiet.js';
import {
  CHILD_PREAMBLE,
  SHARED_PREAMBLE,
  datePreamble,
  languagePreamble,
  notePropertiesPreamble,
  selfPreamble,
  unattendedNote,
} from './prompts.js';
import {
  parseRunnable,
  buildSystemPrompt,
  buildSkillBrief,
  buildSessionReceipt,
  parseKickoff,
  SessionHarness,
  DEFAULT_SKILL_BY_NAME,
  BASE_SKILL_NAME,
  HOUSE_RULES,
  HOUSE_RULES_NAME,
  type Runnable,
} from '@qale/sessions';

import { PiUiBridge, type Chunk } from './bridge.js';
import { entriesToUiMessages, type UiMessage } from './history.js';

/** The file every child reads before starting. One write, N smarter readers. */
const BRIEF_FILE = 'brief.md';

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

/**
 * One live connection, as the runtime sees it (PD-8). The runtime receives
 * PREPARED capabilities: the host holds the credential and builds the tools,
 * this package never learns what a provider's client needs. That is what keeps
 * a second tracker from being a second field on this config.
 */
export interface AgentConnection {
  /** The stored connection's id, e.g. 'atlassian'. */
  connectionId: string;
  /** Which provider it is, for {@link sameConfig} and nothing else here. */
  providerId: string;
  /** The provider's agent-facing reads, already bound to the credential. */
  readTools: ProviderReadTool[];
  /** Whether this connection can start watching one item by its key. Today the
   *  connectors that implement `pullByKeys`; the sync engine does the work. */
  canTrack: boolean;
  /**
   * Opaque fingerprint of the credential behind those tools. A new token
   * rebuilds sessions the way a new API key does, and the runtime compares this
   * instead of ever holding the secret itself.
   */
  fingerprint: string;
}

export interface AgentRuntimeConfig {
  vaultDir: string;
  /** Electron userData dir — pi auth/models/sessions live under here, off the vault. */
  userDataDir: string;
  /**
   * Whose API answers. One provider is configured at a time and there is no
   * fallback to the other: the key below belongs to THIS provider, and a
   * workspace with the wrong pair of them has no model at all.
   */
  provider?: LlmProvider;
  modelId: string;
  apiKey: string | null;
  /**
   * The workspace's live connections. Tool exposure follows this list, not a
   * named provider: a session gets every connection's reads, and the sync-state
   * tools once any connection can track. Absent or empty means nothing is
   * connected, which is a workspace with no external reads at all.
   */
  connections?: AgentConnection[];
  /**
   * Which repos a session may ask about, as one comparable string, or empty
   * when there are none (the host builds it; see the codebase service's
   * `fingerprint`). Part of {@link sameConfig} for the reason the connections
   * list is: a session's tools are fixed when it is built, so pointing Qale at
   * a folder while a chat is open has to rebuild that chat before the tool can
   * appear in it.
   */
  codebase?: string;
  /**
   * What this workspace is written in (OW5), as a bare language tag ("sv"). A
   * setting rather than something each run infers from what it happens to read,
   * which is what kept producing a Swedish summary next to an English one.
   * Absent means English. Part of {@link sameConfig}: it is baked into the
   * system prompt, so changing it has to rebuild the sessions that carry it.
   */
  language?: string;
  /**
   * The PM's own name, from Settings ("You"). Absent means they have not set
   * one, which is a different instruction and not a missing one: an unsigned
   * draft rather than an invented name. Part of {@link sameConfig} for the same
   * reason the language is: it is baked into the system prompt.
   */
  selfName?: string | null;
  /**
   * Host callback behind the `track_external` tool — it reaches the sync engine,
   * which lives in the desktop main process, not here. Identity-stable, so it is
   * deliberately absent from `sameConfig`: swapping it must not tear down live
   * sessions the way a credential or model change does.
   */
  trackExternal?: TrackExternal;
  /** Host callback behind `follow_container` (FL-3), for the same reason as
   *  {@link trackExternal}: it is sync state, not a provider call. */
  answerContainerOffer?: AnswerContainerOffer;
  /**
   * Where a draft may be addressed, with the provider that owns each container
   * (PD-9). This is how `draft_ticket` stays provider-blind: the model names a
   * project, the host says who holds it. Injected and identity-stable, so it
   * stays out of `sameConfig` like the two callbacks above.
   */
  outboundContainers?: ListOutboundContainers;
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
   * The model the PM chose for this session. Remembered against the session
   * from here on, so reopening it tomorrow does not silently switch models.
   * Absent means "keep what this session already had", which for a fresh
   * session is the workspace default. Deliberately NOT part of
   * {@link AgentRuntimeConfig}: the model is resolved per run, so changing it
   * cannot tear down a live session the way a credential change does.
   */
  modelId?: string;
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
  /**
   * Nobody is at the screen for this turn, but somebody will come back to it
   * (docs/arrival-agentic.md, rung 0). A person started it — they dropped
   * material and walked away — so it is not `scheduled`, and the two differ in
   * exactly one place that matters: a question here PARKS and waits for them,
   * where a scheduled run must stop instead because nothing will ever answer it.
   * What the two share is the licence to say nothing: a drop that turned out to
   * be pure filing must not cost a notification, a row and a receipt.
   */
  unattended?: boolean;
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
  /**
   * The model this session was pinned to, if the PM ever picked one. Null means
   * it follows the workspace default, including when that default later changes.
   */
  modelId: string | null;
}

/** Lifecycle signal — fired when a run starts and when it settles (any outcome). */
export interface SessionStatus {
  sessionId: string;
  title: string;
  status: 'running' | 'settled';
  updated: number;
  /**
   * The skill this session is ABOUT (the harness's primary), so a listener can
   * tell a meeting brief from a chat without reopening the session. `chat` is
   * the base skill — a plain question with nothing invoked over it.
   */
  skill: string;
  /**
   * The run ended with nothing to report (QM ticket 2), so it leaves no row and
   * no receipt. Main reads it to hold back the "finished" notification: a
   * notification is exactly the cost silence is supposed to save.
   */
  quiet?: boolean;
  /**
   * The provider refused this turn, and why (api-errors.ts). Set on the settle
   * only. The chat renders its own copy from the error chunk; this is here for
   * the runs with nobody in front of them, where a settle signal is the only
   * thing that leaves the runtime at all.
   */
  fault?: ProviderFault;
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
  /**
   * Offered rather than owed (see `isOffered` in ask.ts). A tidy pass nobody
   * asked for can want to fan out, and the spend still needs approving, but it
   * is not something the app may go and interrupt the PM about.
   */
  offered: boolean;
}

interface PendingSpawn {
  request: SpawnRequestInfo;
  resolve: (decision: SpawnDecision) => void;
}

/**
 * The codebase approval card (docs/claude-code-tickets.md CC-7), as the
 * renderer draws it. Same shape of decision as the spawn card, and for the same
 * reason: this is the one moment the PM steers before minutes are spent.
 *
 * `resume` is what makes the card different. A run that continues an earlier
 * Claude Code session keeps that session's model, so the card offers no picker
 * and the decision carries no model. Switching models means the session asks
 * again without `resume`, which raises a card with the picker back.
 */
export interface CodebaseRequestInfo {
  id: string;
  sessionId: string;
  /** Exactly what will be asked, expandable on the card. */
  question: string;
  /** The repo, by the name it is set up under. */
  repo: string;
  suggestedModelId: string;
  /** One line: why the session suggests that model. */
  why: string;
  models: ModelInfo[];
  /** This continues an earlier Claude Code session: no picker, no model. */
  resume: boolean;
  /**
   * Offered rather than owed (see `isOffered` in ask.ts). A tidy pass nobody
   * asked for can want to ask the code, and the spend still needs approving,
   * but it is not something the app may go and interrupt the PM about.
   */
  offered: boolean;
}

interface PendingCodebase {
  request: CodebaseRequestInfo;
  resolve: (decision: CodebaseDecision) => void;
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
  /** A person started it and walked away (see {@link RunInput.unattended}). */
  unattended: boolean;
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
  /** What this conversation is called everywhere it appears. */
  title: string;
  /**
   * The name above is the conversation's own, not the first-message heuristic:
   * either a model wrote it (see ./naming.ts) or it was read back off the
   * transcript at open. Naming happens once per session, so this is also what
   * stops a second turn spending a second call.
   */
  named: boolean;
  /**
   * The name currently in the transcript, whatever wrote it. A run nobody
   * started never spends a call on naming itself and keeps the deterministic
   * one, and that name only lived in memory: every list read off disk fell back
   * to the first message, so the app's own kickoff prose ("Run the librarian
   * skill: The scan found 12 things that may…") became the row, the tab and the
   * notification. Storing it costs nothing and it is the name the session
   * already answers to.
   */
  titleStored: boolean;
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
 * Was there nobody at the screen when this turn put a card up? True for both
 * ways a run starts without a person: a clock's slot, and material arriving
 * while the PM was away. Without a live session to read, the answer is "somebody
 * was there", because a card that waits for the PM is the safe way to be wrong.
 */
function nobodyStarted(state: SessionState | undefined): boolean {
  return !!state && (state.turn.scheduled || state.turn.unattended);
}

/** Every connection's read tools, in registration order. Two providers with the
 *  same tool name would be a registry bug, so nothing dedupes here. */
function readToolNames(connections: readonly AgentConnection[]): string[] {
  return connections.flatMap((c) => c.readTools.map((t) => t.name));
}

/** Whether any connection can start watching a single item. */
function canTrack(connections: readonly AgentConnection[]): boolean {
  return connections.some((c) => c.canTrack);
}

/**
 * What the session may do RIGHT NOW — read off the harness, not off the file it
 * opened with, because a runnable that arrives mid-conversation brings its own
 * capabilities. Also where the workspace's outbound floor is applied: a
 * capability becomes a tool here and nowhere else, so this is the one place that
 * has to know what the workspace will actually let a draft reach.
 *
 * Module-level and exported rather than a method, though only the runtime calls
 * it, because it is the whole permission boundary in one function: every line
 * below decides what an unattended run is allowed to do, and that is worth being
 * able to assert directly instead of reading carefully.
 */
export function toolNamesFor(
  harness: SessionHarness,
  /** The workspace's live connections; their reads are the session's reads. */
  connections: readonly AgentConnection[],
  canInvokeSkills: boolean,
  /** Whether the workspace has any outbound connector at all (`ctx.outbound`). */
  connected: boolean,
  /** Whether a repo is set up and Claude Code is on the machine (`ctx.codebase`). */
  codebaseActive: boolean,
): string[] {
  // Asking the PM is available to every session, under every skill: it grants
  // no capability the session didn't already have (it writes nothing, reads
  // nothing) — it only decides which of two allowed paths to take.
  // Proposing is likewise always on: every propose_* lands as an approval
  // card, so the gate is the review. The one earned permission is outbound.
  // `end_quietly` is on everywhere too, and deliberately: it is a no-op on an
  // interactive turn, and a tool that appeared and disappeared between kinds
  // of session would only teach the model to guess which kind it is in.
  // Taking a card back rides with proposing, and for the same reason: it
  // writes nothing and decides nothing. A session that may put a card in front
  // of the PM must be able to say "ignore that one" without leaving a second
  // card beside the first for them to sort out.
  // Recording a deferral is on everywhere for the same reason `end_quietly`
  // is: it writes nothing, decides nothing, and grants no permission the
  // session did not already have. It only makes the "I looked at this and
  // chose not to act" that every run already performs silently into something
  // the next run can read (OW6).
  // Writing text into the chat is on everywhere too: `draft_text` draws a panel
  // in the conversation and files nothing, and `get_voice` reads a file the
  // workspace already holds. Neither can fail for want of a connector, and
  // neither writes, so there is nothing for a capability to protect. Behind
  // `draft-outbound` they made a skill claim the right to reach Jira and
  // Confluence in order to write a paragraph nobody sends.
  const names = [
    ...VAULT_TOOL_NAMES,
    ASK_TOOL_NAME,
    END_QUIETLY_TOOL_NAME,
    DEFER_TOOL_NAME,
    ...PROPOSE_TOOL_NAMES,
    WITHDRAW_TOOL_NAME,
    DRAFT_TEXT_TOOL_NAME,
    GET_VOICE_TOOL_NAME,
  ];
  // Outbound is two permissions in series and a file only holds the first:
  // `can: [draft-outbound]` says this session may draft, the workspace's
  // connectors say whether a draft can reach anything. With nothing connected
  // these could only ever produce cards that fail on approval ("no outbound
  // integration configured"), so a skill file does not get to grant them over
  // the workspace's head. WHICH connector a given card needs stays an
  // approval-time question: Google's write scope is granted by incremental
  // consent at push time, so it is not knowable here.
  if (harness.outbound && connected) names.push(...DRAFT_TOOL_NAMES);
  // The calendar drafts sit under the same connector floor and their own
  // capability. One skill in the workspace books meetings; the other outbound
  // skills were carrying three tool schemas they never called, which is context
  // spent on every turn to describe work they do not do.
  if (harness.draftCalendar && connected) names.push(...CALENDAR_TOOL_NAMES);
  // Filing is the one write that is not a card, so it is the one write a skill
  // has to claim by name (`can: [file-material]`). See ./filing.ts.
  if (harness.fileMaterial) names.push(...FILING_TOOL_NAMES);
  if (canInvokeSkills) names.push(USE_SKILL_TOOL_NAME);
  // Fan-out rides with session files: children write into the folder, and
  // reading their output back is the whole point of having one. Asking for
  // comments rides with them too, and by the same reading: it hands the PM a
  // file from that folder, so without one there is nothing it could point at.
  if (harness.sessionFiles)
    names.push(...SESSION_FILE_TOOL_NAMES, SPAWN_TOOL_NAME, COMMENTS_TOOL_NAME);
  // Reading an external system rides on the connection alone. A plain chat
  // opens on the base skill, which declares no capabilities, so a capability
  // here would mean "what is the status of PAY-142?" could not be answered in
  // an ordinary conversation. Changing what the workspace WATCHES is a
  // different thing and is claimed by name: it writes sync state that outlives
  // the session (see TRACK_TOOL_NAMES in ./tools.ts).
  names.push(...readToolNames(connections));
  if (canTrack(connections) && harness.trackExternal) names.push(...TRACK_TOOL_NAMES);
  // Asking the code rides on the setup alone, like the Jira reads above. It
  // writes nothing, in the repo or in the workspace, and every run goes past
  // the PM on a card, so there is nothing left for a `can:` line to protect. A
  // capability would only mean "what does the importer actually do?" could not
  // be answered in an ordinary conversation.
  if (codebaseActive) names.push(CODEBASE_TOOL_NAME);
  return names;
}

/**
 * Embeds pi in the main process in full-control mode (PLAN §3.3): its own
 * AuthStorage/SessionManager/SettingsManager paths (off the user's ~/.pi), a
 * DefaultResourceLoader that suppresses skills/prompts/AGENTS.md, and NO built-in
 * tools — only our vault-scoped custom tools.
 */
export class AgentRuntime {
  private config: AgentRuntimeConfig | null = null;
  /**
   * pi's model + credential runtime, still building. Everything that needs a
   * model goes through {@link models} and awaits it (see `configure`).
   */
  private modelRuntimeReady: Promise<ModelRuntime> | null = null;
  private readonly sessions = new Map<string, SessionState>();
  /** sessionId → in-flight createSession — two rapid runs must share one session. */
  private readonly creating = new Map<string, Promise<SessionState>>();
  private readonly streamToSession = new Map<string, string>();
  /** sessionId → shelf state; only non-active entries are stored. */
  private lifecycles: Record<string, StoredLifecycle> = {};
  /** sessionId → the model the PM pinned to it; only pinned sessions are stored. */
  private sessionModels: Record<string, string> = {};
  /**
   * listChats() re-reads and replays every transcript in full — cache the result
   * keyed by a cheap stat signature of the sessions dir so the frequent sidebar
   * refresh with nothing changed costs a readdir + stats, not N file reads.
   */
  private chatListCache: { sig: string; chats: ChatRef[] } | null = null;
  /** Lifecycle hook — main pushes these to the renderer as `session:status`. */
  onStatus: ((status: SessionStatus) => void) | null = null;
  /**
   * A session took its own name (see ./naming.ts) — main pushes it on as
   * `session:renamed`. Its own event rather than another `session:status`:
   * status says a run started or settled, and both of those move rails, badges,
   * telemetry and the librarian's ledger. A rename moves a word.
   */
  onRename: ((rename: { sessionId: string; title: string }) => void) | null = null;
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
   * A codebase question is waiting on the PM (`request`), or its card has
   * settled (`null`). Same hook and same rule as the fan-out: nothing runs, and
   * nothing is spent, until it settles.
   */
  onCodebaseRequest: ((sessionId: string, request: CodebaseRequestInfo | null) => void) | null =
    null;
  /** requestId → the card in flight and the promise `ask_codebase` is parked on. */
  private readonly pendingCodebases = new Map<string, PendingCodebase>();
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
    this.sessionModels = this.loadSessionModels();
    // pi folded AuthStorage and ModelRegistry into one ModelRuntime whose
    // construction is async, and configure() has a dozen synchronous callers.
    // So the build is kicked off here and awaited by whatever needs a model.
    this.modelRuntimeReady = ModelRuntime.create({
      authPath: join(config.userDataDir, 'pi', 'auth.json'),
      modelsPath: join(config.userDataDir, 'pi', 'models.json'),
    }).then(async (runtime) => {
      // In-memory only, never written to disk (PLAN §2). `allowNetwork: false`
      // because the catalogue we ship with is the one we mean: a refresh over
      // the wire here would stall the first turn behind an HTTP round trip.
      //
      // Only the chosen provider is given a key. The other one is left
      // unconfigured on purpose, so `getAvailableSnapshot` cannot offer its
      // models and `resolveModel` cannot quietly step down onto one.
      if (config.apiKey) {
        await runtime.setRuntimeApiKey(providerFor(config), config.apiKey, {
          allowNetwork: false,
        });
      }
      return runtime;
    });
    // A config change invalidates existing sessions (built with the old model/tools).
    this.disposeSessions();
  }

  /** The model runtime, once it has finished building. */
  private models(): Promise<ModelRuntime> {
    const ready = this.modelRuntimeReady;
    if (!ready) return Promise.reject(new Error('agent runtime not configured'));
    return ready;
  }

  async isReady(): Promise<boolean> {
    return !!this.config?.apiKey && (await this.listModels()).length > 0;
  }

  /**
   * What the app offers: the shortlist for the chosen provider, and nothing
   * else. pi carries dozens of models per provider and most of them are dated
   * snapshots, retired families or preview builds for jobs this product never
   * does. The full catalogue is still reachable underneath (`resolveModel` will
   * honour a session pinned to an older id, and the namer still shops the whole
   * list for the cheapest model); it is only what we PUT IN FRONT of somebody
   * that is cut down.
   *
   * Not gated on a key, so Settings can say what is on offer before one is
   * pasted. An id pi cannot route is dropped and named on the console: this
   * table follows pi's catalogue, and a pi upgrade is where it goes stale.
   */
  async listModels(): Promise<ModelInfo[]> {
    const provider = providerFor(this.config);
    const shortlist = providerModels(provider);
    try {
      const runtime = await this.models();
      const routable = new Set(runtime.getModels(provider).map((m) => m.id));
      const offered = shortlist.filter((m) => routable.has(m.id));
      for (const model of shortlist) {
        if (!routable.has(model.id))
          console.error(`[qale] pi no longer carries "${model.id}", dropped from the picker`);
      }
      // Everything gone means the catalogue moved under us, and an empty picker
      // helps nobody: offer the list and let the run report the real failure.
      if (offered.length > 0) return offered.map((m) => ({ id: m.id, label: m.label }));
    } catch {
      // No runtime yet (no workspace open). The shortlist is static, so it can
      // still be shown.
    }
    return shortlist.map((m) => ({ id: m.id, label: m.label }));
  }

  /**
   * Which model this run uses. Four steps down, in order: the model the PM
   * pinned to this session, the workspace default, the provider's default, then
   * whatever that provider has at all. The later steps are what makes a
   * settings file (or a session sidecar) naming a model pi has since dropped
   * degrade into a working session instead of a broken one, and it says so on
   * the console rather than silently.
   *
   * Every step stays inside the CHOSEN provider. pi treats an API key in the
   * environment as a configured provider, so a machine with `ANTHROPIC_API_KEY`
   * exported would otherwise let a workspace set to Gemini answer on Claude
   * with a credential nobody in the app pasted.
   */
  private async resolveModel(pinned?: string | null) {
    const runtime = await this.models();
    if (!this.config) throw new Error('agent runtime not configured');
    const provider = providerFor(this.config);
    const available = runtime.getAvailableSnapshot().filter((m) => m.provider === provider);
    if (available.length === 0)
      throw new Error(`No model available. Set a ${providerName(provider)} API key in Settings.`);
    // The provider's own default is the last named step, ahead of "anything
    // that answers": one configured provider still offers dozens of models, and
    // the first of those is as likely to be a robotics preview as a chat model.
    const tried = new Set<string>();
    for (const wanted of [pinned, this.config.modelId, providerModels(provider)[0]?.id]) {
      if (!wanted || tried.has(wanted)) continue;
      tried.add(wanted);
      const found = available.find((m) => m.id === wanted);
      if (found) return found;
      console.error(`[qale] model "${wanted}" is not available, falling back`);
    }
    return available[0]!;
  }

  /**
   * One short non-streaming completion on the cheapest model this workspace can
   * reach — for the small jobs that are not the conversation: naming it, so far.
   * Strictly best-effort: no key, no model or any error returns null and the
   * caller keeps what it had. Never throws into a run.
   */
  private async completeCheaply(systemPrompt: string, prompt: string): Promise<string | null> {
    try {
      const runtime = await this.models();
      // The chosen provider's catalogue, not the shortlist: the cheapest thing
      // that can write four words is rarely a model worth putting in a picker,
      // and this job never touches the workspace. Bounded by the provider for
      // the same reason `resolveModel` is: the key we hold is theirs alone.
      const provider = providerFor(this.config);
      const catalogue = runtime.getAvailableSnapshot().filter((m) => m.provider === provider);
      // Falls back to the session's own model rather than giving up: an
      // expensive name beats no name, and this is one sentence in either case.
      const model = cheapestModel(catalogue) ?? (await this.resolveModel());
      // Through the runtime rather than the bare pi-ai helper: the helper falls
      // back to env vars, and a packaged build has no ANTHROPIC_API_KEY. The
      // runtime holds the key the PM pasted into Settings.
      const msg = await runtime.completeSimple(model, {
        systemPrompt,
        messages: [{ role: 'user' as const, content: prompt, timestamp: 0 }],
      });
      const out = (msg.content ?? [])
        .filter(
          (c): c is { type: 'text'; text: string } => (c as { type?: string }).type === 'text',
        )
        .map((c) => c.text)
        .join(' ');
      return out.trim() || null;
    } catch (err) {
      console.error('[qale] a cheap completion failed:', err instanceof Error ? err.message : err);
      return null;
    }
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
   * The house rules (SK-3): one file, `skills/house-rules/SKILL.md`, in every
   * session's system prompt and in every fan-out child's.
   *
   * One file, and no way for a second one to join it. Any file could once
   * declare `starts: [always]` and ride along, which made "what is in force
   * right now" a question you answered by reading every skill in the workspace,
   * and made the prompt grow every time somebody wrote a rule down. The PM edits
   * this one document instead, and what it costs is what always-on costs.
   *
   * A workspace that has not been seeded yet (or where the file was deleted)
   * falls back to the shipped text, because a session with no rules at all
   * writes in whatever voice it likes and nothing says so.
   */
  private async houseRules(ctx: UseCaseContext): Promise<string> {
    let raw: string | null = null;
    for (const path of runnableCandidates(HOUSE_RULES_NAME)) {
      raw = await ctx.vault.readRaw(path);
      if (raw !== null) break;
    }
    const body = parseRunnable(raw ?? HOUSE_RULES, HOUSE_RULES_NAME).body.trim();
    return body ? `\n\n## House rules (always in effect)\n${body}` : '';
  }

  /**
   * The on-demand skill index (Sessions v2 Part 3.1): every skill the model may
   * reach for, listed by name + summary so it knows what it can pull in via
   * `use_skill` without paying for the bodies until one is relevant. Returns
   * null when nothing is loadable.
   */
  private async skillIndex(ctx: UseCaseContext, current: string): Promise<string | null> {
    const skills = (await listLoadableSkills(ctx)).filter((s) => s.config.name !== current);
    if (skills.length === 0) return null;
    return [
      '\n\n## Skills available on demand',
      'Call `use_skill` with one of these names when the conversation turns into the work it describes. ' +
        'A skill takes over how you work from that point on — its instructions and the cards it may ' +
        'produce. Load one rather than improvising a workflow it already describes.',
      skills.map((s) => this.indexEntry(s.config)).join('\n'),
    ].join('\n');
  }

  /**
   * One line of the index, and the second line the routing actually turns on.
   * The summary is picker copy written for a person; on its own it is a weak
   * trigger, and a skill that never fires fails silently because the session
   * just works freehand. `scenarios` is the trigger signal: each entry is a
   * short "use when" clause plus the verbatim sentence a PM would type, so the
   * model can match on the shape of the task and on the wording. A file that
   * carries none is listed exactly as it was before.
   */
  private indexEntry(config: Runnable): string {
    const head = `- \`${config.name}\` — ${config.summary}`;
    return config.scenarios.length ? `${head}\n  Use when: ${config.scenarios.join('; ')}` : head;
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
      const parsed = JSON.parse(readFileSync(this.lifecycleFile(), 'utf8')) as Record<
        string,
        unknown
      >;
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
      console.error('[qale] session lifecycle save failed:', err);
    }
  }

  /**
   * Which model a session runs on, kept beside the shelf state and for the same
   * reason: it is a fact the PM set about a conversation, and pi's own files are
   * pi's. Absent means the session follows the workspace default, so a PM who
   * never touches the picker keeps getting whatever Settings says today.
   */
  private sessionModelFile(): string {
    if (!this.config) throw new Error('agent runtime not configured');
    return join(this.config.userDataDir, 'session-models.json');
  }

  private loadSessionModels(): Record<string, string> {
    try {
      const parsed = JSON.parse(readFileSync(this.sessionModelFile(), 'utf8')) as Record<
        string,
        unknown
      >;
      const out: Record<string, string> = {};
      for (const [id, v] of Object.entries(parsed)) if (typeof v === 'string' && v) out[id] = v;
      return out;
    } catch {
      return {};
    }
  }

  getSessionModel(sessionId: string): string | null {
    return this.sessionModels[sessionId] ?? null;
  }

  setSessionModel(sessionId: string, modelId: string | null): void {
    if (this.sessionModels[sessionId] === (modelId ?? undefined)) return;
    if (modelId) this.sessionModels[sessionId] = modelId;
    else delete this.sessionModels[sessionId];
    // Same reason as the lifecycle sidecar: the sessions-dir signature can't
    // see this file, so the list cache has to be dropped by hand.
    this.chatListCache = null;
    try {
      writeFileSync(this.sessionModelFile(), JSON.stringify(this.sessionModels));
    } catch (err) {
      console.error('[qale] session model save failed:', err);
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
    /** Whether the person who opened it walked away — the quieter preamble. */
    unattended: boolean,
  ): Promise<SessionState> {
    if (!this.config) throw new Error('agent runtime not configured');
    const modelRuntime = await this.models();
    const model = await this.resolveModel(this.getSessionModel(id));

    /**
     * Every session opens on the SAME skill (Sessions v2 Part 4). A session type
     * is not a mode any more: the requested one arrives as the first invocation
     * (see `run`), which is what lets a second one arrive after it. The entry
     * points are unchanged — the button on a meeting, the Landing tiles, the
     * Skills view — they just mean "start a session and invoke this" now.
     */
    const skillConfig = await this.resolveSkill(BASE_SKILL_NAME, ctx);
    const harness = new SessionHarness(id, skillConfig, ctx.clock.now());
    // The house rules ride along unconditionally: they say how everything this
    // session writes is written, filed and worded.
    const rules = await this.houseRules(ctx);
    const skillIndex = await this.skillIndex(ctx, skillConfig.name);
    // The voices, for the drafting tools' descriptions only (SK-6). No voice
    // text enters the system prompt: a session that never drafts never sees a
    // line of it, and one that does fetches the brief at the moment it applies.
    const voices = await listVoices(ctx);
    const voiceGate = createVoiceGate(ctx, voices, harness);
    const vaultMap = await this.vaultMap(ctx);
    const filesRoot = sessionFilesRoot(this.config.vaultDir, id);
    const files = harness.sessionFiles ? sessionFilesPrompt(sessionFilesRelRoot(id)) : '';
    // The repo names have to be in the prompt, so they are fetched here rather
    // than at the tool's own read-fresh-each-call seam: the chain is composed
    // once, at creation, and so is the tool set. A folder added while this chat
    // is open does not reach it in place; it changes `config.codebase`, which
    // tears the live sessions down (`sameConfig`) so the next turn is built with
    // the tool and these names in it. No repos, no section: the tool would
    // refuse anyway, and an empty list is a line of nothing on every turn.
    const repos = (await ctx.codebase?.repos()) ?? [];
    const codebase = repos.length > 0 ? codebasePrompt(repos) : '';
    // The licence to say nothing, and the four rules that go with it (QM ticket
    // 2, SK-4), only where they apply. Baked in at creation because that is where
    // the system prompt is composed; the TOOL asks per turn, so a PM writing into
    // a scheduled run still gets an answer rather than silence.
    const scheduledNote = unattendedNote(scheduled, unattended);
    const baseSystemPrompt =
      buildSystemPrompt(SHARED_PREAMBLE, skillConfig) +
      languagePreamble(this.config.language ?? DEFAULT_LANGUAGE) +
      datePreamble(ctx.clock.now()) +
      selfPreamble(this.config.selfName) +
      notePropertiesPreamble() +
      rules +
      (skillIndex ?? '') +
      files +
      codebase +
      vaultMap +
      scheduledNote;

    // The tracker seam is available whenever a connection is configured. It used
    // to be the `ask` session's alone; with types dissolved there is no "the ask
    // session" to hang it on, and every read it offers is silent and
    // non-mutating — `track_external` only starts a local mirror.
    const connections = this.config.connections ?? [];
    const canInvokeSkills = !!skillIndex;

    /**
     * The one hard change of Sessions v2 (Part 3): the tool set is no longer
     * fixed at session creation. Every tool a skill could ever turn on is
     * REGISTERED here — pi's `tools` allowlist filters the registry itself, so
     * a tool absent from it can never be activated later — while only the ones
     * the current skill grants are ACTIVE. `applyActivation` moves that line.
     */
    // Reset at the top of every run(); read at the bottom of it.
    const turn: TurnFlags = {
      scheduled,
      unattended,
      ended: false,
      asked: false,
      blocked: false,
      failed: false,
    };

    const registry = [
      ...VAULT_TOOL_NAMES,
      ASK_TOOL_NAME,
      END_QUIETLY_TOOL_NAME,
      DEFER_TOOL_NAME,
      ...PROPOSE_TOOL_NAMES,
      WITHDRAW_TOOL_NAME,
      DRAFT_TEXT_TOOL_NAME,
      GET_VOICE_TOOL_NAME,
      ...DRAFT_TOOL_NAMES,
      ...CALENDAR_TOOL_NAMES,
      ...FILING_TOOL_NAMES,
      ...(canInvokeSkills ? [USE_SKILL_TOOL_NAME] : []),
      ...SESSION_FILE_TOOL_NAMES,
      SPAWN_TOOL_NAME,
      COMMENTS_TOOL_NAME,
      CODEBASE_TOOL_NAME,
      ...readToolNames(connections),
      ...(canTrack(connections) ? TRACK_TOOL_NAMES : []),
    ];
    const customTools = withDecodedArgs([
      ...createVaultTools(ctx, harness, this.config.language ?? DEFAULT_LANGUAGE),
      createAskTool({ requestAnswer: (plan, signal) => this.askThePm(id, ctx, plan, signal) }),
      createEndQuietlyTool({
        // Both kinds of nobody-is-watching turn may end in silence; only the
        // scheduled one also loses `ask_user`.
        scheduled: () => turn.scheduled || turn.unattended,
        endQuietly: () => {
          turn.ended = true;
        },
      }),
      createDeferralTool(ctx),
      ...createProposeTools(ctx, id, harness),
      createWithdrawTool(ctx, id, harness),
      // One voice gate per session, shared: `get_voice` is one tool, and the
      // set of voices it has handed over is what every drafting tool checks.
      ...createTextTools(voiceGate),
      ...createDraftTools(
        ctx,
        id,
        harness,
        voiceGate,
        this.config.outboundContainers ?? (() => []),
      ),
      ...createFilingTools(ctx, harness, filesRoot),
      ...(canInvokeSkills ? [createUseSkillTool(ctx, harness, () => applyActivation())] : []),
      ...createSessionFileTools(filesRoot, () => this.onFilesChanged?.(id)),
      createCommentsTool({
        read: (path) => readSessionFile(filesRoot, path),
        requestComments: (plan, signal) => this.askForComments(id, ctx, plan, signal),
      }),
      createSpawnTool({
        readBrief: () => readSessionFile(filesRoot, BRIEF_FILE),
        requestApproval: (plan, brief) => this.askToSpawn(id, plan, brief),
        runChild: (child, opts) => this.runChild(id, child, opts, ctx, harness),
      }),
      // `ctx.codebase` is read on every call rather than snapshotted, the same
      // way `ctx.outbound` is: the port can be taken away underneath a session
      // (the folder removed, the binary gone), and a call is the last honest
      // moment to find out.
      createCodebaseTool({
        repos: async () => (await ctx.codebase?.repos()) ?? [],
        requestApproval: (ask) => this.askTheCodebase(id, ask),
        run: (req) => {
          const port = ctx.codebase;
          if (!port) throw new Error('no codebase is set up any more');
          return port.run(req);
        },
        filed: async () =>
          (await listSessionFiles(filesRoot))
            .map((f) => f.path)
            .filter((p) => p.startsWith(`${CODEBASE_REPORTS_DIR}/`)),
        write: async (path, content) => {
          await writeSessionFile(filesRoot, path, content);
          this.onFilesChanged?.(id);
        },
        now: () => ctx.clock.now(),
      }),
      ...createReadTools(connections.flatMap((c) => c.readTools)),
      ...(canTrack(connections)
        ? createTrackTools(this.config.trackExternal, this.config.answerContainerOffer)
        : []),
    ]);

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
    const storedName = manager.getSessionName();

    const { session } = await createAgentSession({
      cwd: this.config.vaultDir,
      model,
      noTools: 'all',
      tools: registry,
      customTools,
      modelRuntime,
      resourceLoader: loader,
      sessionManager: manager,
      settingsManager: SettingsManager.inMemory(),
    });

    /**
     * Narrow the registry to what the skills currently in force actually grant,
     * bounded by what the workspace allows. `ctx.outbound` is read on every call
     * rather than snapshotted: connecting a tracker rebuilds sessions, but a
     * Google grant only reassigns it on the shared context, and a live session
     * should pick that up on its next turn.
     */
    const applyActivation = (): void => {
      session.setActiveToolsByName(
        toolNamesFor(harness, connections, canInvokeSkills, !!ctx.outbound, !!ctx.codebase).filter(
          (n) => registry.includes(n),
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
      // A conversation reopened after a restart keeps the name it took the first
      // time: the transcript is where that name lives, and re-deriving one here
      // would spend a call to arrive back at the same words.
      title: storedName ?? '',
      named: !!storedName,
      titleStored: !!storedName,
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
  private async fileReceipt(
    state: SessionState,
    ctx: UseCaseContext,
    quiet = false,
  ): Promise<void> {
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
      console.error('[qale] session receipt filing failed:', err);
    }
  }

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

  /**
   * What a conversation calls itself the second it starts, before the namer has
   * answered (see {@link nameSession}). A message the PM typed IS the title; a
   * kickoff the app composed ("Run the arrival skill on
   * sources/2026-07-30-i-have-a-meeting…") is machine prose that makes a useless
   * row in the sessions list, so those get named after what they are — the skill
   * and the page it ran on. It is also the name that stands for good on a run
   * nobody started, which never spends a call on naming itself.
   */
  private titleFor(prompt: string, state: SessionState, ctx: UseCaseContext): string {
    const kickoff = parseKickoff(prompt);
    if (!kickoff) return truncate(prompt, 60) ?? 'Session';
    const skill =
      state.harness.invoked.find((c) => c.name === kickoff.skill)?.title ?? kickoff.skill;
    // One page earns its name in the title; several are a count, because three
    // titles joined by commas is unreadable at tab width and truncates to the
    // first one, which reads as a run over only that page.
    const targets = kickoff.targets ?? [];
    const target =
      targets.length === 1
        ? ctx.index.get(targets[0]!)?.title
        : targets.length > 1
          ? `${targets.length} documents`
          : undefined;
    return truncate(target ? `${skill} — ${target}` : skill, 60) ?? skill;
  }

  /**
   * Give the conversation its own name, off the first thing said into it, on the
   * cheapest model available (see ./naming.ts). Runs beside the turn rather than
   * before it: the heuristic name is already on screen, so this is a word
   * changing under a session that is answering, never a session waiting.
   */
  private async nameSession(
    state: SessionState,
    prompt: string,
    ctx: UseCaseContext,
  ): Promise<void> {
    const answer = await this.completeCheaply(
      namingSystemPrompt(this.config?.language),
      namingUserPrompt(this.subjectOf(prompt, state, ctx)),
    );
    const title = answer ? cleanTitle(answer) : null;
    if (!title || title === state.title) return;
    state.title = title;
    this.storeTitle(state, title);
    this.onRename?.({ sessionId: state.id, title });
  }

  /**
   * Write the session's name into its transcript, which is the only place a name
   * survives a restart — `listChats` reads it back ahead of the first message,
   * and without it every list falls back to the opening prose. Appending mid-turn
   * is what pi's own naming does: a session_info entry is metadata, invisible to
   * the context the model sees and to the messages the chat replays.
   */
  private storeTitle(state: SessionState, title: string): void {
    try {
      state.manager.appendSessionInfo(title);
      state.titleStored = true;
      this.chatListCache = null;
    } catch (err) {
      console.error(
        '[qale] could not store the session name:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  /**
   * What the namer is told the session is about. A message a person typed IS the
   * subject; a kickoff the app composed ("Run the arrival skill on
   * sources/2026-07-30-…") is machine prose that would name the conversation
   * after a path, so those hand over the facts underneath it instead — the skill
   * in the PM's words, and the pages by title.
   */
  private subjectOf(prompt: string, state: SessionState, ctx: UseCaseContext): SessionSubject {
    const kickoff = parseKickoff(prompt);
    if (!kickoff) return { prompt };
    return {
      skill: state.harness.invoked.find((c) => c.name === kickoff.skill)?.title ?? kickoff.skill,
      targets: (kickoff.targets ?? []).map((path) => ctx.index.get(path)?.title ?? path),
    };
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
    if (!this.config?.apiKey)
      throw new Error(
        `Set a ${providerName(providerFor(this.config))} API key in Settings to start a session.`,
      );
    const sessionId = input.sessionId ?? randomUUID();
    // Written down before the session is built, so a first turn that names a
    // model opens on it rather than switching a beat later. A run that names
    // none (every background and scheduled one) leaves the pin as it was.
    if (input.modelId) this.setSessionModel(sessionId, input.modelId);
    let state = this.sessions.get(sessionId);
    if (!state) {
      let pending = this.creating.get(sessionId);
      if (!pending) {
        pending = this.createSession(sessionId, ctx, !!input.scheduled, !!input.unattended).finally(
          () => {
            this.creating.delete(sessionId);
          },
        );
        this.creating.set(sessionId, pending);
      }
      state = await pending;
    }
    // One turn at a time per session: a second run would reroute the live
    // bridge mid-stream and interleave pi prompts on the same session.
    if (state.activeStreamId)
      throw new Error('This session is still responding — wait or stop it first.');
    // A new message on a done/dismissed session reopens it. A quiet run reopens
    // the same way: the moment anything is said into it, it has a reader.
    if (this.getLifecycle(sessionId) !== 'active') this.setLifecycle(sessionId, 'active');
    // Whose turn this is gets decided here, once, for everything downstream: the
    // `end_quietly` tool, and the settle below. Mutated in place, never
    // replaced — the tool closed over this exact object at session creation.
    state.turn.scheduled = !!input.scheduled;
    // Per turn, like `scheduled`: the moment the PM writes into an arrival
    // session, somebody is waiting and silence stops being an outcome.
    state.turn.unattended = !!input.unattended;
    state.turn.ended = false;
    state.turn.asked = false;
    state.turn.blocked = false;
    state.turn.failed = false;
    // The model is settled per RUN, never through `configure` — a live session
    // swapping models must not go through the teardown that a credential change
    // does. What already happened stays as it was: pi writes the switch into the
    // transcript, and the turns before it keep the model they ran on.
    await this.applyModel(state);
    // Tidy the pages this run is ABOUT before the model opens one (OW4).
    await this.normalizeTargets(input, ctx);
    // Invoking the same skill twice is a no-op, so a caller that keeps passing
    // one across turns stacks nothing.
    if (input.skill) await this.invokeSkillInto(state, input.skill, ctx, input.outbound);
    state.harness.beginTurn(input.prompt, ctx.clock.now());
    const opening = this.openingPrompt(state) ?? input.prompt;
    if (!state.title) state.title = this.titleFor(opening, state, ctx);
    // Then a cheap model gives it a real name, once, off that same first
    // message. Not on a turn nobody started: a clock's tick and material
    // arriving while the PM is away keep the deterministic name and spend
    // nothing. The moment a person writes into one of those, it gets named like
    // any other conversation, because now somebody is reading the row.
    if (!state.named && !input.scheduled && !input.unattended) {
      state.named = true;
      void this.nameSession(state, opening, ctx).catch((err) => {
        console.error(
          '[qale] naming this session failed:',
          err instanceof Error ? err.message : err,
        );
      });
    } else if (!state.titleStored && state.title) {
      // A run nobody started keeps the deterministic name, and now keeps it
      // where it can be read back: "Librarian" rather than the first sixty
      // characters of the worklist the app handed it.
      this.storeTitle(state, state.title);
    }

    const streamId = randomUUID();
    const bridge = new PiUiBridge((chunk) => emit(streamId, chunk));
    state.bridge = bridge;
    state.activeStreamId = streamId;
    state.runStartedAt = Date.now();
    this.streamToSession.set(streamId, sessionId);
    bridge.start();
    this.emitStatus(state, 'running');

    // What became of this session's cards, told to it fresh every turn (see
    // ./card-state.ts). Only the model sees it: `beginTurn` above and the title
    // took the prompt as the PM wrote it, and both display paths unwrap it, so
    // the receipt and the chat keep the sentence they actually typed.
    // Set by the catch below, read by the finally: a rejected prompt has no
    // ended message for the bridge to have seen.
    let thrownFault: ProviderFault | null = null;
    void state.session
      .prompt(withCardState(input.prompt, sessionCards(ctx, sessionId)))
      .catch((err) => {
        // A scheduled run that broke has to stay visible, so the failure is
        // remembered here and read by `ranQuiet` below.
        state.turn.failed = true;
        // The other half of the refusal path: a throw rather than an ended
        // message. Same sentence, same "is this the PM's to fix" answer, so a
        // key rejected at connect time notifies exactly like one rejected mid-turn.
        thrownFault = providerFault(err instanceof Error ? err.message : String(err));
        emit(streamId, { type: 'error', errorText: thrownFault.text });
      })
      .finally(() => {
        bridge.finish();
        if (state.activeStreamId === streamId) {
          state.activeStreamId = null;
          state.bridge = null;
        }
        this.streamToSession.delete(streamId);
        // A refusal reaches us two ways and only one of them threw. The common
        // one does not: pi ends the turn with an assistant message carrying
        // `stopReason: error` and nothing in it, which resolves the promise
        // above and left `failed` reading false — so a run that never got a word
        // out of the provider looked exactly like a run that had nothing to say.
        const fault = bridge.fault ?? thrownFault;
        if (fault) state.turn.failed = true;
        // Decided before the status goes out: main suppresses the "finished"
        // notification on a quiet run, and the renderer must not draw a row it
        // is about to lose on the next refresh.
        const quiet = this.settleQuietly(state, bridge.finalText);
        this.emitStatus(state, 'settled', quiet, fault);
        // File/refresh the session receipt after each settled turn.
        void this.fileReceipt(state, ctx, quiet);
      });

    return { streamId, sessionId };
  }

  /**
   * Put the run's own pages in shape before the turn starts (OW4). A kickoff
   * names the notes it is about, and those are the ones the model opens first,
   * so a missing `type` or an absent summary is fixed by rule here rather than
   * costing the run a turn to notice. Whatever could not be derived is left as a
   * marked placeholder for the same run to replace through a card.
   *
   * The vault-wide pass runs in the maintenance tick, which is what covers a
   * background run whose worklist names no targets at all.
   *
   * Never fatal: a tidy that failed leaves the notes exactly as they were, and
   * the PM's message still gets an answer.
   */
  private async normalizeTargets(input: RunInput, ctx: UseCaseContext): Promise<void> {
    const targets = parseKickoff(input.prompt)?.targets;
    if (!targets?.length) return;
    try {
      await normalizeNoteFrontmatter(ctx, targets);
    } catch (err) {
      console.error(
        '[qale] frontmatter normalize failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  /**
   * Point a live session at the model it should be running on now. A no-op in
   * the ordinary case; never fatal, because a session that cannot switch is
   * still a session that can answer on the model it already has.
   */
  private async applyModel(state: SessionState): Promise<void> {
    try {
      const model = await this.resolveModel(this.getSessionModel(state.id));
      if (state.session.model?.id === model.id) return;
      await state.session.setModel(model);
    } catch (err) {
      console.error('[qale] could not switch this session to the chosen model:', err);
    }
  }

  private emitStatus(
    state: SessionState,
    status: SessionStatus['status'],
    quiet = false,
    fault: ProviderFault | null = null,
  ): void {
    this.onStatus?.({
      sessionId: state.id,
      title: state.title,
      status,
      updated: Date.now(),
      skill: state.harness.primarySkillName,
      ...(quiet ? { quiet } : {}),
      ...(fault ? { fault } : {}),
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
      // "May end in silence", which both kinds of unwatched turn may.
      scheduled: t.scheduled || t.unattended,
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
      console.error(`[qale] skill "${name}" could not be resolved — invoking it was skipped`);
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
  private async askToSpawn(
    sessionId: string,
    plan: SpawnPlan,
    brief: string | null,
  ): Promise<SpawnDecision> {
    const state = this.sessions.get(sessionId);
    const request: SpawnRequestInfo = {
      id: spawnRequestId(),
      sessionId,
      entries: plan.entries.map((e) => ({ label: e.label, count: e.count })),
      total: plan.total,
      brief,
      models: await this.listModels(),
      // Children start on whatever the parent is running on, so a session the
      // PM moved to a cheaper model fans out on that one too.
      defaultModelId: this.getSessionModel(sessionId) ?? this.config?.modelId ?? '',
      // Worked out here, where the run's facts are, and by the same rule the
      // question card uses: one answer, so the two cards can never disagree
      // about whose time this run is spending.
      offered: isOffered(state?.harness.primarySkillName, nobodyStarted(state)),
    };
    // Same rule as `askThePm`: a card the PM had to answer, and a spend they had
    // to approve, is attention already spent. The turn cannot end as if it left
    // nothing (QM ticket 2).
    if (state) state.turn.asked = true;
    return new Promise<SpawnDecision>((resolve) => {
      this.pendingSpawns.set(request.id, { request, resolve });
      this.onSpawnRequest?.(sessionId, request);
    });
  }

  /**
   * Park `ask_codebase` on a card and wait for the PM (CC-7). Same shape as the
   * fan-out card, with one rule of its own: a run that resumes a Claude Code
   * session keeps that session's model, so the card gets no picker.
   *
   * A run a clock started is refused instead of parked, the same way `ask_user`
   * is (ask.ts): there is nobody at the screen to approve a spend, and a card
   * recovered later would be asking about a turn that stopped days ago.
   */
  private async askTheCodebase(sessionId: string, ask: CodebaseAsk): Promise<CodebaseDecision> {
    const state = this.sessions.get(sessionId);
    if (state?.turn.scheduled) {
      state.turn.blocked = true;
      return { approved: false, unattended: true };
    }
    const request: CodebaseRequestInfo = {
      id: codebaseRequestId(),
      sessionId,
      question: ask.question,
      repo: ask.repo.name,
      suggestedModelId: ask.modelId,
      why: ask.why,
      // Not the workspace's own models: these are the aliases the `claude` tool
      // takes, and the two catalogues never mix (see ./codebase-models.ts).
      models: CODEBASE_MODELS.map((m) => ({ id: m.id, label: m.label })),
      resume: !!ask.resumeSessionId,
      offered: isOffered(state?.harness.primarySkillName, nobodyStarted(state)),
    };
    // Same rule as the spawn card: a spend the PM had to approve is attention
    // already spent, so the turn cannot end as if it left nothing.
    if (state) state.turn.asked = true;
    return new Promise<CodebaseDecision>((resolve) => {
      this.pendingCodebases.set(request.id, { request, resolve });
      this.onCodebaseRequest?.(sessionId, request);
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
    return this.parkCard(
      sessionId,
      ctx,
      { id: askRequestId(sessionId, plan), sessionId, questions: plan.questions },
      signal,
    );
  }

  /**
   * Park `request_comments` on a round file and wait. Everything that makes it
   * work is {@link askThePm}'s: the same parking, the same refusal on a run a
   * clock started, the same stamps. What differs is what the PM is handed, and
   * that is a difference the renderer settles.
   */
  private askForComments(
    sessionId: string,
    ctx: UseCaseContext,
    plan: CommentPlan,
    signal?: AbortSignal,
  ): Promise<AskDecision> {
    return this.parkCard(
      sessionId,
      ctx,
      {
        id: commentRequestId(sessionId, plan),
        sessionId,
        // A round asks for comments, never for an answer to a question. The
        // empty list is what says which of the two the renderer is drawing.
        questions: [],
        comments: plan,
      },
      signal,
    );
  }

  /** The park both cards share: the run's own facts, stamped once. */
  private parkCard(
    sessionId: string,
    ctx: UseCaseContext,
    request: AskRequestDraft,
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
    const skill = state?.harness.primarySkillName ?? null;
    // The skill rides along so an answer that arrives tomorrow resumes under the
    // instructions the question was asked under, not as a plain chat. Who
    // started the run rides along with it, because the two together are what
    // says whether an answer is owed: the same agent asks the same question
    // very differently when a person is sitting there waiting for the reply.
    return this.parking.park(
      ctx.asks,
      request,
      { scheduled, unattended: nobodyStarted(state), skill, outbound: state?.harness.outbound },
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
        // Which card it was decides which prompt says so. Both open the same
        // way ("you asked this in an earlier run"); only one of them can read
        // back what the PM wrote.
        prompt: asked.comments
          ? commentsReplayPrompt(asked.comments, decision.comments ?? null)
          : askReplayPrompt({ questions: asked.questions }, decision.answers),
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
    if (!this.config) throw new Error('agent runtime not configured');
    const modelRuntime = await this.models();
    // The child's own model, then whatever the parent is running on.
    const model = await this.resolveModel(opts.modelId ?? this.getSessionModel(parentId));
    const filesRoot = sessionFilesRoot(this.config.vaultDir, parentId);

    // The language setting reaches the children for the same reason the house
    // rules below do: a fan-out over Swedish transcripts must not hand back
    // Swedish working files that the parent then files as they are.
    const parts = [
      CHILD_PREAMBLE,
      languagePreamble(this.config.language ?? DEFAULT_LANGUAGE).trim(),
    ];
    // The house rules reach the children too. A rule that is always in effect
    // cannot stop at the parent: a fan-out over Swedish transcripts would hand
    // back Swedish working files, and the parent files what it was handed.
    const rules = (await this.houseRules(ctx)).trim();
    if (rules) parts.push(rules);
    if (opts.brief)
      parts.push(`## The brief (what everyone working on this was told)\n${opts.brief.trim()}`);
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
      customTools: withDecodedArgs([
        // Reads land in the parent's receipt: the ledger must be honest about
        // what the session as a whole read, children included.
        ...createVaultTools(ctx, harness, this.config.language ?? DEFAULT_LANGUAGE),
        ...createChildFileTools(filesRoot, child.writeTo, () => {
          wrote = true;
          this.onFilesChanged?.(parentId);
        }),
      ]),
      modelRuntime,
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
    for (const p of this.pendingSpawns.values())
      if (p.request.sessionId === sessionId) return p.request;
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

  /** The same, for codebase cards. A cancelled question never ran, so nothing was spent. */
  private cancelCodebases(sessionId?: string): void {
    for (const [id, pending] of [...this.pendingCodebases]) {
      if (sessionId && pending.request.sessionId !== sessionId) continue;
      this.pendingCodebases.delete(id);
      this.onCodebaseRequest?.(pending.request.sessionId, null);
      pending.resolve({ approved: false });
    }
  }

  /**
   * A pending codebase card, for a tab that reopened while the question waited.
   * Without this the card would exist only in the push that announced it.
   */
  pendingCodebase(sessionId: string): CodebaseRequestInfo | null {
    for (const p of this.pendingCodebases.values())
      if (p.request.sessionId === sessionId) return p.request;
    return null;
  }

  /** The PM answered the codebase card. Unknown ids are ignored (already settled). */
  resolveCodebase(requestId: string, decision: CodebaseDecision): void {
    const pending = this.pendingCodebases.get(requestId);
    if (!pending) return;
    this.pendingCodebases.delete(requestId);
    this.onCodebaseRequest?.(pending.request.sessionId, null);
    pending.resolve(decided(pending.request, decision));
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

  /**
   * The number the Sessions row prints: grouped the way the transcript renders,
   * so a tool-calling turn counts once. Falls back to pi's raw entry count only
   * if the file can't be replayed — a number that's too big beats no row.
   */
  private uiMessageCount(sessionId: string, file: string, fallback: number): number {
    try {
      const live = this.sessions.get(sessionId);
      const messages = live
        ? entriesToUiMessages(live.manager.buildContextEntries())
        : this.storedUiMessages(file);
      return messages.length;
    } catch {
      return fallback;
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
        // Not info.messageCount: pi counts raw transcript entries, so one agent
        // turn with 13 tool calls reads as 41 "messages". The row has to match
        // what opening the session shows, which is what chatHistory() builds.
        messageCount: this.uiMessageCount(info.id, info.path, info.messageCount),
        preview: truncate(info.allMessagesText, 140) ?? '',
        lifecycle: this.getLifecycle(info.id),
        modelId: this.getSessionModel(info.id),
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
    return this.storedUiMessages(file);
  }

  private storedUiMessages(file: string): UiMessage[] {
    if (!this.config) return [];
    const manager = SessionManager.open(file, this.sessionsDir(), this.config.vaultDir);
    return entriesToUiMessages(manager.buildContextEntries());
  }

  async deleteChat(sessionId: string, ctx?: UseCaseContext): Promise<void> {
    this.cancelSpawns(sessionId);
    this.cancelCodebases(sessionId);
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
    this.setSessionModel(sessionId, null);
  }

  async abort(streamId: string, ctx?: UseCaseContext): Promise<void> {
    const sessionId = this.streamToSession.get(streamId);
    if (!sessionId) return;
    // Stop also answers a spawn card the turn is parked on — otherwise Stop
    // looks dead while the tool waits for an approval nobody will give. Same
    // for a codebase card, and for a question card: the PM chose to stop
    // instead of answering, so the written-down copy goes with the promise.
    this.cancelSpawns(sessionId);
    this.cancelCodebases(sessionId);
    this.cancelAsks(sessionId, ctx);
    const state = this.sessions.get(sessionId);
    if (!state) return;
    await state.session.abort().catch(() => undefined);
    state.bridge?.finish();
  }

  private disposeSessions(): void {
    this.cancelSpawns();
    this.cancelCodebases();
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

/**
 * Whose API this config talks to. pi's provider ids and ours are the same two
 * words (`anthropic`, `google`), so this is a default, not a translation.
 */
function providerFor(config: AgentRuntimeConfig | null): LlmProvider {
  return config?.provider ?? DEFAULT_PROVIDER;
}

/**
 * The codebase decision as it is allowed to be. The card is drawn in the
 * renderer and the model it carries ends up in a `--model` flag on somebody
 * else's machine, so the two rules the card draws are checked again here rather
 * than trusted: a resume carries no model at all, because its Claude Code
 * session keeps the one it started on, and a model that is not in the catalogue
 * is dropped. Dropping it falls the run back to the model the session suggested
 * and the PM read on the card, which is the only other model in play.
 */
function decided(request: CodebaseRequestInfo, decision: CodebaseDecision): CodebaseDecision {
  if (!decision.approved) return { approved: false };
  if (request.resume || !decision.modelId || !isCodebaseModel(decision.modelId))
    return { approved: true };
  return { approved: true, modelId: decision.modelId };
}

function sameConfig(a: AgentRuntimeConfig, b: AgentRuntimeConfig): boolean {
  return (
    a.vaultDir === b.vaultDir &&
    a.userDataDir === b.userDataDir &&
    // Changing provider changes the credential, so it tears sessions down for
    // the same reason a new key does.
    providerFor(a) === providerFor(b) &&
    a.modelId === b.modelId &&
    a.apiKey === b.apiKey &&
    (a.language ?? DEFAULT_LANGUAGE) === (b.language ?? DEFAULT_LANGUAGE) &&
    (a.selfName ?? null) === (b.selfName ?? null) &&
    (a.codebase ?? '') === (b.codebase ?? '') &&
    connectionsFingerprint(a.connections) === connectionsFingerprint(b.connections)
  );
}

/**
 * The connections list as one comparable string: which connection, what it can
 * do, which tools it brings, and which credential is behind them. A change in
 * any of those changes the tools a session was built with, so it has to tear
 * the live sessions down. Order is the registry's, so it is stable. The two
 * separators are control characters no id or tool name can hold, so two
 * different lists cannot produce one string.
 */
function connectionsFingerprint(connections: readonly AgentConnection[] | undefined): string {
  return (connections ?? [])
    .map((c) =>
      [
        c.connectionId,
        c.providerId,
        c.canTrack ? 'track' : '',
        c.readTools.map((t) => t.name).join(','),
        c.fingerprint,
      ].join('\u0000'),
    )
    .join('\u0001');
}

function truncate(s: string | undefined, n: number): string | undefined {
  const flat = s?.replace(/\s+/g, ' ').trim();
  if (!flat) return undefined;
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}
