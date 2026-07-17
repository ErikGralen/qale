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

export type PushEvent =
  | AgentStreamEvent
  | VaultChangedEvent
  | ProposalsChangedEvent
  | SessionStatusEvent
  | PingsChangedEvent
  | SessionFocusEvent;

export type PushChannel = PushEvent['channel'];
