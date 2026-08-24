import type { AskRequestDTO, CodebaseRequestDTO, SettingsDTO, SpawnRequestDTO } from './dtos.js';

/**
 * Push events from main → renderer (webContents.send). These are the flattened,
 * structured-clone-safe stream chunks (PLAN §3.2, §6.11): the pi agent stream is
 * turned into AI SDK `UIMessageChunk`s main-side and pushed here, correlated by
 * `streamId`. The renderer's IpcChatTransport reassembles them into a ReadableStream.
 */

/**
 * A single AI SDK UIMessageChunk. We keep it as an opaque JSON object at the IPC
 * layer — the renderer's transport re-types it as `UIMessageChunk` from `ai`.
 * Typing it structurally here would couple the leaf DTO package to `ai`.
 */
export type UIMessageChunkJSON = Record<string, unknown>;

export interface AgentStreamEvent {
  channel: 'agent:event';
  streamId: string;
  chunk: UIMessageChunkJSON;
}

/** Fired when the vault index changes (external Obsidian edit, watcher tick). */
export interface VaultChangedEvent {
  channel: 'vault:changed';
  /** Paths that were added/updated/removed, if known. */
  paths: string[];
}

/** Fired when a proposal is created or its status changes (review queue badge). */
export interface ProposalsChangedEvent {
  channel: 'proposals:changed';
  pendingCount: number;
}

/**
 * Session lifecycle push — fired when a run starts and when it settles, whether
 * or not its tab is open. This is what makes background agents visible: the
 * sidebar rail, badges, and Inbox all derive from it (nothing silent).
 */
export interface SessionStatusEvent {
  channel: 'session:status';
  sessionId: string;
  title: string;
  status: 'running' | 'settled';
  /** The skill the session is about; `chat` is a plain question. */
  skill: string;
  /** Pending approval cards this session has open at emit time. */
  pendingCards: number;
  updated: number;
  /**
   * The run was started by a clock and ended with nothing to report (QM ticket
   * 2). Set on the settle only. The session is already out of `chats:list` by
   * the time this arrives, so the refresh this event triggers drops its row.
   */
  quiet?: boolean;
  /**
   * The model provider refused this turn, said in one sentence with the fix in
   * it. `blocking` means nothing runs until the PM does something (no credit, a
   * rejected key) as opposed to something that clears on its own (overloaded,
   * rate limited); main only interrupts for the first kind.
   */
  fault?: { text: string; blocking: boolean };
}

/**
 * A session took its own name, a second or so into its first turn: a cheap
 * model read the first message and named the conversation after it. Separate
 * from `session:status` on purpose — status starting or settling drives the
 * rail, the badges, telemetry and the librarian's ledger, and none of that is
 * true of a word changing. The name is already on disk when this fires.
 */
export interface SessionRenamedEvent {
  channel: 'session:renamed';
  sessionId: string;
  title: string;
}

/**
 * A session wrote to its working folder (Sessions v2 Part 1). The tree fills
 * live off this: files landing one at a time as work finishes is the signature
 * interaction — honest progress, and visible proof the agent read each item
 * rather than skimming a blob. Hide it behind a spinner and the feature feels
 * like the agent wandered off with your machine.
 */
export interface SessionFilesChangedEvent {
  channel: 'session:files';
  sessionId: string;
}

/**
 * A fan-out is waiting on the PM (`request`), or its card has settled
 * (`request: null`). Rendered inline in the chat, never as a modal: it is the
 * same approve/cancel vocabulary as the other cards, at the one moment that
 * decides whether money gets spent.
 */
export interface SpawnRequestEvent {
  channel: 'session:spawn';
  sessionId: string;
  request: SpawnRequestDTO | null;
}

/**
 * A codebase question is waiting on the PM (`request`), or its card has settled
 * (`request: null`). Same shape and same place as the fan-out card: inline in
 * the chat, and nothing in that conversation moves until it settles.
 */
export interface CodebaseRequestEvent {
  channel: 'session:codebase';
  sessionId: string;
  request: CodebaseRequestDTO | null;
}

/**
 * A session is asking the PM a question mid-turn (`request`), or its card has
 * settled (`request: null`). Inline in the chat, never a modal — but unlike the
 * other cards the turn is PARKED on this one: nothing else in that conversation
 * moves until it is answered, skipped, or the run is stopped.
 */
export interface AskRequestEvent {
  channel: 'session:ask';
  sessionId: string;
  request: AskRequestDTO | null;
}

/** Fired when an OS notification is clicked — the renderer opens that session. */
export interface SessionFocusEvent {
  channel: 'session:focus';
  sessionId: string;
  title: string;
}

/** Fired when connection state or the shallow mirror index changes (a sync
 *  tick landed, a follow toggled, credentials changed). Renderer caches of
 *  chips/hover metadata invalidate on this — nothing polls. */
export interface ConnectionsChangedEvent {
  channel: 'connections:changed';
}

/**
 * Settings changed somewhere other than the call that changed them — a First
 * step ticking itself off, a key saved in one window, a connection verifying.
 * Carries the whole DTO because it is small and because a renderer that has to
 * ask again after every push would flicker through a stale render first.
 */
export interface SettingsChangedEvent {
  channel: 'settings:changed';
  settings: SettingsDTO;
}

export type PushEvent =
  | AgentStreamEvent
  | VaultChangedEvent
  | ProposalsChangedEvent
  | SessionStatusEvent
  | SessionRenamedEvent
  | SessionFilesChangedEvent
  | SpawnRequestEvent
  | CodebaseRequestEvent
  | AskRequestEvent
  | SessionFocusEvent
  | ConnectionsChangedEvent
  | SettingsChangedEvent;

export type PushChannel = PushEvent['channel'];

/**
 * Runtime list of every push channel — the preload subscribes from THIS, so a
 * new event type can't silently never reach the renderer. The `_AllPushListed`
 * check fails to compile if the list and the union drift.
 */
export const PUSH_CHANNELS = [
  'agent:event',
  'vault:changed',
  'proposals:changed',
  'session:status',
  'session:renamed',
  'session:files',
  'session:spawn',
  'session:codebase',
  'session:ask',
  'session:focus',
  'connections:changed',
  'settings:changed',
] as const satisfies readonly PushChannel[];

// Compile-time completeness guard: every PushEvent channel must appear above.
type _AllPushListed = Exclude<PushChannel, (typeof PUSH_CHANNELS)[number]>;
const _pushExhaustive: _AllPushListed extends never ? true : ['missing channels', _AllPushListed] =
  true as never;
void _pushExhaustive;
