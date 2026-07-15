/**
 * DTOs — the leaf contract between main, preload and renderer.
 *
 * Everything here MUST be structured-clone-safe: plain objects, arrays and
 * primitives only. No class instances, functions, Dates, or streams. Domain
 * entities map to these at the IPC boundary; the renderer never sees a domain
 * object.
 */

export type NoteLayer = 'raw' | 'derived' | 'authored';

export type NoteType =
  | 'meeting'
  | 'decision'
  | 'insight'
  | 'customer'
  | 'problem'
  | 'release'
  | 'person'
  | 'session'
  | 'skill'
  | 'note';

export type ProblemStance = 'exploring' | 'watching' | 'committed' | 'wont-do';

export type DecisionStatus = 'active' | 'superseded';
export type ConfidenceLevel = 'high' | 'med' | 'low';

/** A source reference stored in frontmatter (raw provenance). */
export interface SourceRefDTO {
  system: string;
  author?: string;
  url?: string;
}

/** Computed freshness for a note (decay clock), sent alongside the note. */
export interface FreshnessDTO {
  tracked: boolean;
  freshForDays: number | null;
  lastVerified: string | null;
  ageDays: number | null;
  stale: boolean;
  unverified: boolean;
}

/** A note as the renderer sees it — frontmatter flattened + raw markdown body. */
export interface NoteDTO {
  /** Workspace-relative path, e.g. "decisions/adopt-workos.md". */
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
  freshness: FreshnessDTO;
  /** Whether this note type's body may be edited (false for decisions/sessions). */
  bodyEditable: boolean;
}

/** Lightweight note reference for lists/trees (no body). */
export interface NoteRefDTO {
  path: string;
  slug: string;
  type: NoteType;
  title: string;
  summary: string;
  mtime: number;
  status?: string | null;
  stale?: boolean;
}

export interface VaultInfoDTO {
  path: string;
  name: string;
  /** Whether the folder is (or was made into) a git repo. */
  git: boolean;
  noteCount: number;
}

export interface VaultTreeGroupDTO {
  /** Folder name, e.g. "meetings", "decisions". */
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

export interface ProblemHeatDTO extends NoteRefDTO {
  stance: ProblemStance;
  evidenceCount: number;
  newest: string | null;
}

export interface HealthDTO {
  total: number;
  fresh: number;
  stale: number;
  unverified: number;
  score: number;
}

export interface MaintenanceReportDTO {
  stale: number;
  orphans: { path: string; title: string }[];
  danglingLinks: { from: string; target: string }[];
}

/** Structured smart-view filter over the files table (no query syntax). */
export interface NoteQueryDTO {
  types?: NoteType[];
  status?: string;
  stale?: boolean;
  unverified?: boolean;
  recentDays?: number;
  customer?: string;
  limit?: number;
}

export interface CaptureNoteInput {
  body: string;
  summary?: string;
  source?: SourceRefDTO;
}

export interface CaptureMeetingInput {
  title: string;
  body: string;
  source?: SourceRefDTO;
  participants?: string[];
  safeSpace?: boolean;
}

export interface SaveNoteInput {
  path: string;
  body: string;
}

export interface SaveFrontmatterInput {
  path: string;
  frontmatter: Record<string, unknown>;
}

export interface ProposalPreviewDTO {
  before: string;
  after: string;
  stale: boolean;
}

// ---------------------------------------------------------------------------
// Proposals (approval cards) — the only write path for the agent.
// ---------------------------------------------------------------------------

export type ProposalKind = 'note' | 'update' | 'decision' | 'outbound';
export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'stale';
export type OutboundSystem = 'jira' | 'confluence' | 'message';

export interface EvidenceRefDTO {
  /** Wikilink target or external URL supporting the card. */
  ref: string;
  label?: string;
  resolved: boolean;
}

export interface NotePayloadDTO {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  rationale: string;
}

export interface DecisionPayloadDTO {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  rationale: string;
  supersedes?: string;
}

export interface UpdatePayloadDTO {
  path: string;
  /** Search/replace blocks (LLM-reliable patch format, PLAN-V2 §3.1). */
  patch: { search: string; replace: string }[];
  rationale: string;
}

export interface GoldenAnswerInput {
  question: string;
  answer: string;
  sources: string[];
}

export interface ProposalStatsDTO {
  pending: number;
  accepted: number;
  rejected: number;
  stale: number;
  edited: number;
  avgApproveMs: number | null;
  approvalRate: number | null;
  byType: Record<string, { accepted: number; rejected: number }>;
}

export interface OutboundPayloadDTO {
  system: OutboundSystem;
  action: string;
  projectKey?: string;
  issueType?: string;
  issueKey?: string;
  pageId?: string;
  title?: string;
  body: string;
  audience?: string;
  linkBackPath?: string;
  rationale: string;
}

export interface ProposalDTO {
  id: string;
  kind: ProposalKind;
  sessionId: string;
  targetPath: string | null;
  payload: NotePayloadDTO | DecisionPayloadDTO | UpdatePayloadDTO | OutboundPayloadDTO;
  rationale: string;
  evidence: EvidenceRefDTO[];
  inference: boolean;
  status: ProposalStatus;
  created: number;
  resolved: number | null;
}

// ---------------------------------------------------------------------------
// Agent / chat / sessions
// ---------------------------------------------------------------------------

/**
 * Session types are open strings — a session type is a skill file, so new ones
 * ship as content with zero code change (PLAN-V2 §8). These are the built-ins.
 */
export type SessionType = 'chat' | 'ask' | 'after-meeting' | 'weekly-update' | (string & {});

export interface AgentRunInput {
  sessionType: string;
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
  type: string;
  title: string;
  updated: number;
  state: 'working' | 'waiting' | 'done';
}

export interface ScheduleDTO {
  sessionType: string;
  dayOfWeek: number;
  hour: number;
  enabled: boolean;
  lastRun: string | null;
}

export interface SettingsDTO {
  vaultPath: string | null;
  modelId: string;
  hasAnthropicKey: boolean;
  hasAtlassianCreds: boolean;
  schedules: ScheduleDTO[];
  autoApplyTypes: string[];
  mcp: { enabled: boolean; port: number; token: string | null; running: boolean };
}

export interface ModelInfoDTO {
  id: string;
  label: string;
}
