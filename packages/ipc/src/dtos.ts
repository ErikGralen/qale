/**
 * DTOs — the leaf contract between main, preload and renderer.
 *
 * Everything here MUST be structured-clone-safe: plain objects, arrays and
 * primitives only. No class instances, functions, Dates, or streams (PLAN §6.11).
 * Domain entities map to these at the IPC boundary; the renderer never sees a
 * domain object.
 */

export type NoteLayer = 'raw' | 'derived' | 'authored';

export type NoteType =
  | 'signal'
  | 'transcript'
  | 'meeting-summary'
  | 'theme'
  | 'decision'
  | 'action'
  | 'open-question'
  | 'note';

export type ThemeStance = 'exploring' | 'watching' | 'committed' | 'wont-do';

export type SignalStatus = 'new' | 'linked' | 'discarded';

/** A source reference stored in frontmatter (raw provenance). */
export interface SourceRefDTO {
  system: string;
  author?: string;
  url?: string;
}

/** A note as the renderer sees it — frontmatter flattened + raw markdown body. */
export interface NoteDTO {
  /** Vault-relative path, e.g. "signals/2026-07-12-gong-sso.md". */
  path: string;
  /** Slug = path without extension, used as wikilink target. */
  slug: string;
  type: NoteType;
  layer: NoteLayer;
  title: string;
  summary: string;
  /** Full parsed frontmatter as a plain object (already validated main-side). */
  frontmatter: Record<string, unknown>;
  /** Raw markdown body (no frontmatter). */
  body: string;
  mtime: number;
}

/** Lightweight note reference for lists/trees (no body). */
export interface NoteRefDTO {
  path: string;
  slug: string;
  type: NoteType;
  title: string;
  summary: string;
  mtime: number;
}

export interface VaultInfoDTO {
  path: string;
  name: string;
  /** Whether the folder is (or was made into) a git repo. */
  git: boolean;
  noteCount: number;
}

export interface VaultTreeGroupDTO {
  /** Folder name = layer bucket, e.g. "signals", "themes". */
  dir: string;
  type: NoteType;
  layer: NoteLayer;
  notes: NoteRefDTO[];
}

export interface VaultTreeDTO {
  groups: VaultTreeGroupDTO[];
}

export interface BacklinkDTO {
  /** Note that links to the target. */
  from: NoteRefDTO;
  /** The line context of the link, if known. */
  context?: string;
}

export interface SearchHitDTO {
  path: string;
  slug: string;
  type: NoteType;
  title: string;
  summary: string;
  snippet: string;
  score: number;
}

export interface ThemeHeatDTO extends NoteRefDTO {
  stance: ThemeStance;
  evidenceCount: number;
  newest: string | null;
}

export interface CaptureSignalInput {
  /** Free text body of the signal. */
  body: string;
  summary?: string;
  source?: SourceRefDTO;
}

export interface SaveNoteInput {
  path: string;
  body: string;
}

// ---------------------------------------------------------------------------
// Proposals (Phases 3–5) — the only write path for the agent.
// ---------------------------------------------------------------------------

export type ProposalKind = 'triage' | 'note' | 'update';
export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'stale';
export type TriageAction = 'link' | 'new-theme' | 'discard';

export interface EvidenceRefDTO {
  /** Wikilink target or external URL supporting the proposal. */
  ref: string;
  label?: string;
  resolved: boolean;
}

export interface TriagePayloadDTO {
  signalPaths: string[];
  action: TriageAction;
  /** Existing theme wikilink for `link`. */
  themeRef?: string;
  /** New theme spec for `new-theme`. */
  newTheme?: { summary: string; stance: ThemeStance };
  groupId?: string;
  rationale: string;
}

export interface NotePayloadDTO {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  rationale: string;
}

export interface UpdatePayloadDTO {
  path: string;
  /** Search/replace blocks (LLM-reliable patch format, PLAN §3.5). */
  patch: { search: string; replace: string }[];
  rationale: string;
}

export interface ProposalDTO {
  id: string;
  kind: ProposalKind;
  sessionId: string;
  targetPath: string | null;
  payload: TriagePayloadDTO | NotePayloadDTO | UpdatePayloadDTO;
  rationale: string;
  evidence: EvidenceRefDTO[];
  inference: boolean;
  status: ProposalStatus;
  created: number;
  resolved: number | null;
}

// ---------------------------------------------------------------------------
// Agent / chat
// ---------------------------------------------------------------------------

export type SessionType = 'chat' | 'triage' | 'ingest-transcript' | 'ask';

export interface AgentRunInput {
  sessionType: SessionType;
  /** Existing pi session id to resume, or omit to start fresh. */
  sessionId?: string;
  /** The user's message (plain text for now). */
  prompt: string;
}

export interface AgentRunHandle {
  streamId: string;
  sessionId: string;
}

export interface SessionRefDTO {
  id: string;
  type: SessionType;
  title: string;
  updated: number;
  state: 'working' | 'waiting' | 'done';
}

export interface SettingsDTO {
  vaultPath: string | null;
  modelId: string;
  hasAnthropicKey: boolean;
  hasAtlassianCreds: boolean;
}

export interface ModelInfoDTO {
  id: string;
  label: string;
}
