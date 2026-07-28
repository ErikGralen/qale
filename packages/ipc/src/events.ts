import type { SpawnRequestDTO } from './dtos.js';

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
  sessionType: string;
  title: string;
  status: 'running' | 'settled';
  /** Pending approval cards this session has open at emit time. */
  pendingCards: number;
  updated: number;
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

/** Fired when the agent-ping queue changes (created by a sweep, opened, dismissed). */
export interface PingsChangedEvent {
  channel: 'pings:changed';
  pendingCount: number;
}

/** Fired when an OS notification is clicked — the renderer opens that session. */
export interface SessionFocusEvent {
  channel: 'session:focus';
  sessionId: string;
  sessionType: string;
  title: string;
}

/** Fired when connection state or the shallow mirror index changes (a sync
 *  tick landed, a follow toggled, credentials changed). Renderer caches of
 *  chips/hover metadata invalidate on this — nothing polls. */
export interface ConnectionsChangedEvent {
  channel: 'connections:changed';
}

export type PushEvent =
  | AgentStreamEvent
  | VaultChangedEvent
  | ProposalsChangedEvent
  | SessionStatusEvent
  | SessionFilesChangedEvent
  | SpawnRequestEvent
  | PingsChangedEvent
  | SessionFocusEvent
  | ConnectionsChangedEvent;

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
  'session:files',
  'session:spawn',
  'pings:changed',
  'session:focus',
  'connections:changed',
] as const satisfies readonly PushChannel[];

// Compile-time completeness guard: every PushEvent channel must appear above.
type _AllPushListed = Exclude<PushChannel, (typeof PUSH_CHANNELS)[number]>;
const _pushExhaustive: _AllPushListed extends never ? true : ['missing channels', _AllPushListed] =
  true as never;
void _pushExhaustive;
