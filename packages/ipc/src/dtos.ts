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
  | 'source'
  | 'meeting'
  | 'decision'
  | 'insight'
  | 'customer'
  | 'problem'
  | 'release'
  | 'person'
  | 'session'
  | 'skill'
  | 'todo'
  | 'note';

export type ProblemStance = 'exploring' | 'watching' | 'committed' | 'wont-do';

/** Generic note lifecycle (sources/meetings/insights/notes) — always enum, never free text. */
export type NoteStatus = 'new' | 'processed' | 'active' | 'stale';

export type DecisionStatus = 'active' | 'superseded';
export type ConfidenceLevel = 'high' | 'med' | 'low';

/** Todo lifecycle — open until it lands; done/dropped stay on the ledger. */
export type TodoStatus = 'open' | 'done' | 'dropped';

/** A source reference stored in frontmatter (raw provenance). */
export interface SourceRefDTO {
  system: string;
  author?: string;
  url?: string;
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
  /** Curated context tags (projects/products/areas) — the cross-cutting nav axis. */
  tags?: string[];
  /** Frontmatter date (decisions/meetings/releases), when present. */
  date?: string;
  /** Meeting clock time "HH:MM" (24h), when present. */
  time?: string;
  /** Meeting length in minutes, when present. */
  durationMin?: number;
  /** Wikilink ref this decision replaced — renders the spine inline in lists. */
  supersedes?: string;
  supersededBy?: string;
  /** Todo due date "YYYY-MM-DD", when present. */
  due?: string;
  /** Todo owner — set only on external commitments (waiting-on items). */
  owner?: string;
  /** Todo close date "YYYY-MM-DD" (done/dropped), when present. */
  resolvedOn?: string;
  /** First `sources` ref (todos) — the note the commitment came from. */
  sourceRef?: string;
}

export interface VaultInfoDTO {
  path: string;
  name: string;
  /** Whether the folder is (or was made into) a git repo. */
  git: boolean;
  /** git is installed — history can be enabled even when `git` is false. */
  gitAvailable: boolean;
  noteCount: number;
}

/** One commit in a note's version history. */
export interface NoteCommitDTO {
  hash: string;
  date: string;
  message: string;
  author: string;
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

export interface MaintenanceReportDTO {
  orphans: { path: string; title: string }[];
  danglingLinks: { from: string; target: string }[];
}

/** Structured smart-view filter over the files table (no query syntax). */
export interface NoteQueryDTO {
  types?: NoteType[];
  status?: string;
  recentDays?: number;
  customer?: string;
  limit?: number;
}

export interface CaptureNoteInput {
  body: string;
  summary?: string;
  source?: SourceRefDTO;
}

/** Quick-add todo — parsed renderer-side from the smart one-liner. */
export interface CaptureTodoInputDTO {
  title: string;
  /** "YYYY-MM-DD". */
  due?: string;
  /** External commitment: who owes it ("[[people/…]]" ref or plain name). */
  owner?: string;
  /** Ref to the note the commitment came from, e.g. "[[meetings/…]]". */
  source?: string;
}

// ---------------------------------------------------------------------------
// Universal capture — dump anything; the system classifies, files, processes.
// ---------------------------------------------------------------------------

export type CaptureKind = 'transcript' | 'link' | 'screenshot' | 'note';

/** The classifier's live guess, shown as an overridable chip in the capture UI. */
export interface CaptureClassificationDTO {
  kind: CaptureKind;
  confidence: 'high' | 'low';
  title: string;
  url?: string;
}

export interface IngestCaptureInputDTO {
  /** Omit to let the classifier decide (attachment present ⇒ screenshot). */
  kind?: CaptureKind;
  /** Transcript body, note text, link + comment, or a screenshot caption. */
  text: string;
  title?: string;
  url?: string;
  /** Transcript only — someone else's meeting: filed as a source (signal), not a meeting. */
  external?: boolean;
  /** External transcript only — whose meeting it was (e.g. "Jonas Palm"). */
  origin?: string;
  attachment?: { name: string; dataBase64: string };
}

export interface IngestFollowUpDTO {
  sessionType: string;
  prompt: string;
  tabTitle: string;
  /** Runs headlessly on ingest — the review lands in the Inbox; no tab opens. */
  background?: boolean;
}

export interface IngestCaptureResultDTO {
  note: NoteDTO;
  kind: CaptureKind;
  followUp?: IngestFollowUpDTO;
  /** A background session was fired for this capture (After-Meeting / External transcript). */
  processing?: { sessionType: string; label: string };
}

export interface SaveNoteInput {
  path: string;
  body: string;
}

export interface SaveFrontmatterInput {
  path: string;
  frontmatter: Record<string, unknown>;
}

export interface RenameNoteInput {
  path: string;
  title: string;
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
  /** The skill that produced this card — lets the Inbox group cards by session. */
  sessionType: string | null;
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

/**
 * User-set shelf state for a conversation. `active` is the default; `done`
 * means the outcome landed, `dismissed` means it won't be useful. Both closed
 * states leave the active list but keep the transcript; a new message reopens.
 */
export type SessionLifecycle = 'active' | 'done' | 'dismissed';

/** A stored conversation (pi JSONL) — what the chat history list shows. */
export interface ChatRefDTO {
  id: string;
  sessionType: string;
  title: string;
  created: number;
  updated: number;
  messageCount: number;
  preview: string;
  lifecycle: SessionLifecycle;
}

/**
 * A replayed transcript. Messages are AI SDK UIMessage JSON — the renderer
 * feeds them straight into useChat as initial messages.
 */
export interface ChatHistoryDTO {
  id: string;
  messages: unknown[];
}

/** A session with a turn currently in flight (the sidebar rail's live rows). */
export interface LiveSessionDTO {
  sessionId: string;
  sessionType: string;
  title: string;
  /** The in-flight stream — lets any tab abort the run, not just the one that started it. */
  streamId: string;
  startedAt: number;
}

// ---------------------------------------------------------------------------
// Agent pings — findings the librarian surfaces with a prepared answer
// ("noticed X — here's the fix, or chat about it").
// ---------------------------------------------------------------------------

export type AgentPingStatus = 'pending' | 'opened' | 'dismissed' | 'resolved';

/** One dangling link with ranked "did you mean…?" candidates. */
export interface PingLinkChoiceItemDTO {
  id: string;
  /** Note whose body carries the dangling link. */
  from: string;
  /** The dangling wikilink target text. */
  target: string;
  options: { slug: string; title: string }[];
  resolution?: { action: 'fixed'; slug: string } | { action: 'skipped' };
}

/** One unlinked note, with plain-text mentions found elsewhere as link-here options. */
export interface PingOrphanItemDTO {
  id: string;
  path: string;
  title: string;
  mentions: { host: string; hostTitle: string; line: string }[];
  resolution?: { action: 'fixed'; host: string } | { action: 'skipped' };
}

export type PingPayloadDTO =
  | { kind: 'link-choices'; items: PingLinkChoiceItemDTO[] }
  | { kind: 'orphans'; items: PingOrphanItemDTO[] };

/** The PO's one-tap answer to a suggestion item: apply a choice, or skip it. */
export type PingResolveActionDTO = { action: 'fix'; choice: string } | { action: 'skip' };

export interface AgentPingDTO {
  id: string;
  title: string;
  /** One-paragraph pitch: what was noticed and why it matters. */
  body: string;
  evidence: EvidenceRefDTO[];
  /** Session type to open when the PO takes the conversation. */
  sessionType: string;
  /** First message of the seeded session — the ping's full context. */
  seedPrompt: string;
  targetPath: string | null;
  /** One-tap suggestions; null when the finding genuinely needs a conversation. */
  payload: PingPayloadDTO | null;
  status: AgentPingStatus;
  created: number;
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
  /** False when the OS keychain is unavailable — secrets are only obfuscated at rest. */
  secretsEncrypted: boolean;
  schedules: ScheduleDTO[];
  mcp: { enabled: boolean; port: number; token: string | null; running: boolean };
}

/** One binding, plus the plain-language sentence the Skills view renders. */
export interface SkillBindingDTO {
  mode: 'forced' | 'triggered' | 'dynamic';
  event?: string;
  sentence: string;
}

/**
 * A skill file as the Skills view sees it (Skills v2): its kind, how it attaches
 * (bindings as readable sentences), and any frontmatter errors to pin. Clicking a
 * row opens `path` — the file is the editor.
 */
export interface SkillDTO {
  path: string;
  slug: string;
  name: string;
  kind: 'session' | 'voice' | 'filing' | 'guide' | 'reaction';
  summary: string;
  tier?: 'observe' | 'suggest' | 'outbound';
  bindings: SkillBindingDTO[];
  errors: string[];
  mtime: number;
}

export interface ModelInfoDTO {
  id: string;
  label: string;
}
