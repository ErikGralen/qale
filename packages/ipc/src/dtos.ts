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
  | 'theme'
  | 'person'
  | 'session'
  | 'skill'
  | 'agent'
  | 'todo'
  | 'note'
  | 'ticket'
  | 'wikipage';

export type ThemeStance = 'exploring' | 'watching' | 'committed' | 'wont-do';

/** How far material has got through the workspace (sources/meetings/insights/
 *  notes/mirrors) — always enum, never free text. Mirrors @pm/domain. */
export type ProcessingState = 'new' | 'processed' | 'stale';

/** Whether a decision still stands. */
export type DecisionStanding = 'active' | 'superseded';
export type ConfidenceLevel = 'high' | 'med' | 'low';

/** Whether a commitment is outstanding — open until it lands; done/dropped stay
 *  on the ledger. */
export type TodoCommitment = 'open' | 'done' | 'dropped';

/** Normalized ticket state — the only state field UI logic may branch on;
 *  the raw provider `state` label is display-only. */
export type StateCategory = 'open' | 'in_progress' | 'blocked' | 'done';

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
  /** The type's own lifecycle value: a decision's `standing`, a customer's
   *  `relationship`, a todo's `commitment`, a source's `processing`. Null when
   *  the type carries no lifecycle at all (person, session, skill). */
  lifecycle?: string | null;
  /** Curated context tags (projects/products/areas) — the cross-cutting nav axis. */
  tags?: string[];
  /** Frontmatter date (decisions/meetings), when present. */
  date?: string;
  /** Meeting clock time "HH:MM" (24h), when present. */
  time?: string;
  /** Meeting length in minutes, when present. */
  durationMin?: number;
  /** Synced-meeting upstream state — cancelled rows strike through in lists. */
  eventStatus?: 'confirmed' | 'tentative' | 'cancelled';
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
  /** Ticket mirror: normalized workflow state — the Kanban grouping axis. */
  stateCategory?: StateCategory;
  /** Ticket mirror: raw provider state label the PO reads (e.g. "In Review"). */
  state?: string;
  /** Ticket mirror: assignee display name, when known. */
  assignee?: string;
  /** Ticket mirror: ISO timestamp of the last upstream change. */
  remoteUpdated?: string;
}

/** A meeting a person is (or was) in — the preview card's "last met"/"next" line. */
export interface PersonMeetingDTO {
  path: string;
  title: string;
  date: string;
}

/**
 * A person as the participant chips render them: the display name (never a
 * slug, never a raw `[[link]]`) plus everything the preview card shows, so the
 * card opens on the first click with no round trip.
 */
export interface PersonCardDTO {
  path: string;
  slug: string;
  name: string;
  summary: string;
  role?: string;
  email?: string;
  caresAbout?: string[];
  lastTold?: string;
  tags?: string[];
  customer?: { slug: string; title: string; path: string };
  lastMet?: PersonMeetingDTO;
  nextMeeting?: PersonMeetingDTO;
}

/**
 * The people directory + who "me" is. Participants written as raw addresses by
 * calendar sync resolve against `people`; the PO's own address resolves against
 * `self`, so their row reads as their name and never as an email.
 */
export interface PeopleDirectoryDTO {
  people: PersonCardDTO[];
  self: { name: string | null; emails: string[] };
}

export interface VaultInfoDTO {
  path: string;
  name: string;
  /** Whether the folder is (or was made into) a git repo. */
  git: boolean;
  /** git is installed — history can be enabled even when `git` is false. */
  gitAvailable: boolean;
  /**
   * Name of the sync service whose folder the workspace sits in ("iCloud
   * Drive", "Dropbox", …), or null. The renderer warns once: two programs
   * writing the same files is how edits and the index get lost.
   */
  syncedBy: string | null;
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
  /** Canonical link type of the inbound edge; absent = untyped mention. */
  type?: string;
  /**
   * Resolved human group label as read from the TARGET note ("Blocked by",
   * "Evidence for") — computed main-side so the renderer never needs the
   * registry. Absent = untyped ("Linked from").
   */
  typeLabel?: string;
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

export interface MaintenanceReportDTO {
  /** Workspace-owned notes with no links; mirrors of upstream records are never
   *  reported — nothing here owns them, so there is no action to offer. */
  orphans: { path: string; title: string }[];
  danglingLinks: { from: string; target: string }[];
}

/** Structured smart-view filter over the files table (no query syntax). */
export interface NoteQueryDTO {
  types?: NoteType[];
  /** Match the type's lifecycle value, e.g. `"superseded"` on decisions. */
  lifecycle?: string;
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
  /**
   * Anything in here to act on? False files the document and runs nothing over
   * it. The default keys off recency, not preference: extraction is
   * time-sensitive (this morning's call has commitments due this week), analysis
   * is not (an analysis session reads unprocessed sources perfectly well).
   */
  process?: boolean;
  /** External transcript only — whose meeting it was (e.g. "Jonas Palm"). */
  origin?: string;
  /** Transcript only — attach to this existing calendar-synced meeting note
   *  instead of creating a new one (capture matching). */
  attachTo?: string;
  attachment?: { name: string; dataBase64: string };
}

/** The synced meeting a fresh transcript most likely belongs to (capture
 *  matching): the meeting in progress, just ended, or starting shortly. The
 *  renderer turns the times into a human label ("ended 4 min ago"). */
export interface CaptureMeetingMatchDTO {
  notePath: string;
  title: string;
  /** ms epoch of the event's start and end. */
  startMs: number;
  endMs: number;
}

export interface IngestFollowUpDTO {
  /** The skill to invoke on the session's first turn. */
  skill: string;
  prompt: string;
  tabTitle: string;
  /** Tier the firing binding grants — the material's permissions, not the session's. */
  tier?: 'observe' | 'suggest' | 'outbound';
  /** Runs headlessly on ingest — the review lands in the Inbox; no tab opens. */
  background?: boolean;
}

export interface IngestCaptureResultDTO {
  note: NoteDTO;
  kind: CaptureKind;
  followUp?: IngestFollowUpDTO;
  /** A background session was fired for this capture (After-Meeting / External transcript).
   *  `sessionId` lets the renderer land the PO in that live session to watch it
   *  work and approve its cards inline. */
  processing?: { skill: string; label: string; sessionId?: string };
}

// ---------------------------------------------------------------------------
// Arrival — the one pipeline every piece of material enters through, whatever
// the door (docs/vision/arrival.md).
// ---------------------------------------------------------------------------

/** `capture` extracts what is still live; `catchup` files and runs nothing. */
export type ArrivalAmbitionDTO = 'capture' | 'catchup';

/**
 * One piece of material. Either a `path` the OS picker returned — main reads
 * it, so fifty files never cross IPC — or content the renderer already holds
 * from a drop or a paste.
 */
export interface ArrivalItemInputDTO {
  path?: string;
  name?: string;
  text?: string;
  dataBase64?: string;
  lastModified?: number;
  kind?: CaptureKind;
  external?: boolean;
  attachTo?: string;
}

export interface ArrivalPlanItemDTO {
  name: string;
  kind: CaptureKind;
  /** Where it will land — `meetings/`, `sources/`, `notes/`. */
  dir: string;
  title: string;
  date?: string;
  historical: boolean;
  /** Set when the file could not be read at all — it is dropped from the batch. */
  error?: string;
}

/** One session the batch would start, named the way a person names it. */
export interface ArrivalRunDTO {
  skill: string;
  title: string;
  count: number;
  verb: string;
}

export interface ArrivalPlanDTO {
  ambition: ArrivalAmbitionDTO;
  ambitionAuto: boolean;
  items: ArrivalPlanItemDTO[];
  /** Why catch-up was chosen, in the tray's own words. */
  reason: string;
  /** The agent work this batch would start — empty under catch-up. */
  runs: ArrivalRunDTO[];
  /** The synced meeting a single fresh transcript would attach to. */
  match?: CaptureMeetingMatchDTO;
}

export interface ArrivalOutcomeItemDTO {
  name: string;
  kind: CaptureKind;
  path?: string;
  dir?: string;
  title?: string;
  error?: string;
  /** The review this item kicked off, so the receipt can link straight to it. */
  session?: { id: string; label: string };
}

export interface ArrivalResultDTO {
  /** Ledger key for `arrival:undo` — session-scoped, so a receipt can take
   *  back exactly what it reported. */
  id: string;
  ambition: ArrivalAmbitionDTO;
  ambitionAuto: boolean;
  items: ArrivalOutcomeItemDTO[];
  /** How many reviews the batch started. */
  reviews: number;
  /** Reviews that were due but could not start (usually: no API key yet). The
   *  material still landed — saying "nothing to run" here would be a lie. */
  reviewsFailed: number;
}

export interface ArrivalUndoResultDTO {
  /** Paths deleted (created by the arrival) and paths rolled back. */
  removed: string[];
  restored: string[];
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
  /** Why it's stale, so the card can be honest: the note changed vs. the patch
   *  anchor couldn't be located on an otherwise-unchanged note. */
  staleReason?: 'changed' | 'unanchored';
  /** Frontmatter keys this update changes — the body diff hides frontmatter, so a
   *  metadata-only edit (reschedule/close a todo) is shown from here instead. */
  frontmatterChanges?: { key: string; before: unknown; after: unknown }[];
}

// ---------------------------------------------------------------------------
// Proposals (approval cards) — the only write path for the agent.
// ---------------------------------------------------------------------------

export type ProposalKind = 'note' | 'update' | 'decision' | 'outbound';
export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'stale';
export type OutboundProvider = 'jira' | 'confluence' | 'message' | 'google-calendar';
/** @deprecated legacy name for {@link OutboundProvider}. */
export type OutboundSystem = OutboundProvider;
/** Provider-generic outbound vocabulary — consumers branch on this, never on the provider.
 *  `update_ticket` is absent until an executor exists (never advertise what always fails). */
export type OutboundAction =
  | 'create_ticket'
  | 'comment_ticket'
  | 'update_page'
  | 'send_message'
  | 'create_event'
  | 'update_event'
  | 'respond_to_event';

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
  /** Body search/replace blocks (LLM-reliable patch format, PLAN-V2 §3.1).
   *  Optional: a card may change only frontmatter. */
  patch?: { search: string; replace: string }[];
  /** Frontmatter keys to set on approval (shallow-merged) — the card path for
   *  editing metadata like a todo's due/status or a person's last_told. */
  frontmatter?: Record<string, unknown>;
  rationale: string;
  /** Retitle applied on approval via rename semantics (Process-Note names a dump). */
  title?: string;
}

export interface OutboundPayloadDTO {
  provider: OutboundProvider;
  /** @deprecated mirror of `provider` (main normalizes both onto every payload). */
  system: OutboundProvider;
  action: OutboundAction;
  projectKey?: string;
  issueType?: string;
  issueKey?: string;
  pageId?: string;
  title?: string;
  body: string;
  /** update_page: localized in-place edit; absent ⇒ the body is appended as a section. */
  patch?: { search: string; replace: string };
  /** Canonical provenance line appended to the pushed content. */
  provenance?: string;
  /** Drafted-against snapshot of the mirror (staleness banner + accept check). */
  remote_updated?: string;
  version?: number;
  audience?: string;
  /** google-calendar events: target + scheduling fields (RFC3339 times). */
  calendarId?: string;
  eventId?: string;
  start?: string;
  end?: string;
  attendees?: string[];
  attendeeEmail?: string;
  responseStatus?: 'accepted' | 'declined' | 'tentative';
  linkBackPath?: string;
  rationale: string;
}

export interface ProposalDTO {
  id: string;
  kind: ProposalKind;
  sessionId: string;
  /** The skill in force when this card was produced — its provenance. */
  skill: string | null;
  targetPath: string | null;
  payload: NotePayloadDTO | DecisionPayloadDTO | UpdatePayloadDTO | OutboundPayloadDTO;
  /**
   * Agent-authored, plain-language statement of the change — the scannable line
   * the PO reads to know what they're approving. No paths, slugs, or jargon;
   * wraps, never clipped. Absent on older cards, where the renderer derives a
   * human headline mechanically instead.
   */
  headline?: string;
  /**
   * Present only when the app started the run on its own clock, and then it is
   * the sentence naming the real trigger: "Prepared itself, an hour before your
   * 14:00." A card the PO asked for never carries one, so a brief that prepared
   * itself can never read as one they requested.
   */
  selfStarted?: string;
  /**
   * Outbound cards only: one composed sentence pair saying what approving DOES
   * and who it reaches ("Posts a comment on PAY-142. Anyone watching the ticket
   * is notified."). Built from the payload and what the app already knows, never
   * written by the agent — `rationale` is where its own words go. Absent on
   * vault-only cards, where the diff is the effect.
   */
  effect?: string;
  rationale: string;
  evidence: EvidenceRefDTO[];
  inference: boolean;
  status: ProposalStatus;
  created: number;
  resolved: number | null;
}

/**
 * Comes back on the resolve that empties a session whose cards were ALL
 * discarded: nothing was kept, so nothing knows whether the meeting was read.
 * The Inbox asks in one line; the meeting stays in "needs review" until then.
 */
export interface MeetingReviewAskDTO {
  path: string;
  title: string;
}

// ---------------------------------------------------------------------------
// Agent / chat / sessions
// ---------------------------------------------------------------------------

export interface AgentRunInput {
  /** Existing pi session id to resume, or omit to start fresh. */
  sessionId?: string;
  /** The user's message (plain text for now). */
  prompt: string;
  /**
   * Bring this skill into the session before the turn runs (Sessions v2). It is
   * an instruction, not a mode: the session is the same session either way, and
   * a second skill can arrive after this one. Absent means a plain chat.
   * Carried beside the prompt rather than inside it so the chat still shows
   * what the PM actually typed.
   */
  skill?: string;
  /** Tier the arrival gets, when a triggered binding named one for this material. */
  tier?: 'observe' | 'suggest' | 'outbound';
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

/**
 * One file in a session's working folder (Sessions v2 Part 1). These are NOT
 * notes: never indexed, never searched, never citable, never committed — so they
 * have no NoteDTO and open in their own read-only viewer.
 */
export interface SessionFileDTO {
  /** Path relative to the session's folder, e.g. "per-item/kranelund.md". */
  path: string;
  bytes: number;
  mtime: number;
}

/**
 * One line of the spawn approval card (Sessions v2 Part 2). It lists the WORK,
 * not a target count: "9 targets" becomes a lie the moment two entries in the
 * batch do different things.
 */
export interface SpawnEntryDTO {
  label: string;
  count: number;
}

/**
 * A fan-out waiting on the PM. The only moment they steer before money is spent,
 * so it carries what will be asked (the brief) and what it will be asked ON
 * (the model), not just how many children.
 */
export interface SpawnRequestDTO {
  id: string;
  sessionId: string;
  entries: SpawnEntryDTO[];
  total: number;
  /** The brief every child reads — expandable, and the real quality lever. */
  brief: string | null;
  models: ModelInfoDTO[];
  defaultModelId: string;
}

/** One choice on a question card. The description carries the trade-off. */
export interface AskOptionDTO {
  label: string;
  description?: string;
}

/** One question on the card. */
export interface AskQuestionDTO {
  /** Short chip label ("Scope"), never a sentence. */
  header: string;
  question: string;
  options: AskOptionDTO[];
  /** Options aren't mutually exclusive — checkboxes rather than radios. */
  multiSelect: boolean;
}

/**
 * A session asking the PM something mid-turn (the ask_user tool). Rendered
 * inline in the chat, like the other cards: the run is parked on it, so it is
 * the only thing that can move the conversation forward.
 */
export interface AskRequestDTO {
  id: string;
  sessionId: string;
  questions: AskQuestionDTO[];
}

/**
 * What the PM chose for one question, in the order asked. Ticks and free text
 * are independent: on a multi-select question "these two, plus this other
 * thing" is one answer. Both empty means the question was skipped.
 */
export interface AskAnswerDTO {
  /** Chosen option labels — several only when the question was multi-select. */
  selected: string[];
  /** Free text the PM wrote, if any. Stands alone, or joins the ticks. */
  written?: string;
}

/** A session with a turn currently in flight (the sidebar rail's live rows). */
export interface LiveSessionDTO {
  sessionId: string;
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

/**
 * Why a note has no links — the cause decides which answers the row may offer.
 * `capture` is a raw dump the memory hasn't absorbed (the answer is Process),
 * `stray` is the workspace-owned hygiene case (the only one where Delete
 * belongs). Mirrors of upstream records are never reported as unlinked.
 */
export type OrphanKindDTO = 'capture' | 'stray';

/** One unlinked note, with plain-text mentions found elsewhere as link-here options. */
export interface PingOrphanItemDTO {
  id: string;
  path: string;
  title: string;
  kind: OrphanKindDTO;
  /** `term` rides along on older pings, which could match an alias. */
  mentions: { host: string; hostTitle: string; line: string; term?: string }[];
  /** Existing pages this note names in prose but never links. */
  names?: { slug: string; title: string }[];
  resolution?:
    | { action: 'fixed'; host: string }
    | { action: 'skipped' }
    | { action: 'processing' };
}

export type PingPayloadDTO =
  | { kind: 'link-choices'; items: PingLinkChoiceItemDTO[] }
  | { kind: 'orphans'; items: PingOrphanItemDTO[] };

/** The PO's one-tap answer to a suggestion item: apply a choice, hand it to a
 *  Process-Note session, or skip it. */
export type PingResolveActionDTO =
  | { action: 'fix'; choice: string }
  | { action: 'skip' }
  | { action: 'process' };

export interface AgentPingDTO {
  id: string;
  title: string;
  /** One-paragraph pitch: what was noticed and why it matters. */
  body: string;
  evidence: EvidenceRefDTO[];
  /** Skill to invoke when the PO takes the conversation. */
  skill: string;
  /** First message of the seeded session — the ping's full context. */
  seedPrompt: string;
  targetPath: string | null;
  /** One-tap suggestions; null when the finding genuinely needs a conversation. */
  payload: PingPayloadDTO | null;
  status: AgentPingStatus;
  created: number;
}

export interface ScheduleDTO {
  /** The skill this schedule runs. */
  skill: string;
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
  /** True when a stored secret failed to decrypt (keychain reset) — the keys must be re-entered. */
  secretsUnreadable: boolean;
  schedules: ScheduleDTO[];
  mcp: { enabled: boolean; port: number; token: string | null; running: boolean };
  /**
   * Who the PO is. `name` is what participant chips show for their own row;
   * `emails` are every address that means "me" — the connected accounts, plus
   * any aliases they added by hand (an invite may reach them at either).
   */
  identity: { name: string | null; emails: string[]; aliases: string[] };
}

/**
 * A skill file as the Skills view sees it: one `use` axis, one plain-language
 * sentence for how it applies, and any frontmatter errors to pin. Clicking a
 * row opens `path` — the file is the editor.
 */
export interface SkillDTO {
  path: string;
  slug: string;
  /** Invocation name — the bare filename the runtime resolves. Never displayed. */
  name: string;
  /** Display title ("Prep a meeting"), from frontmatter `title` or the filename. */
  title: string;
  summary: string;
  /** What puts it in force — the same shape an agent's row shows. */
  starts: StartDTO[];
  /** What it may do beyond reading and proposing cards. */
  can: CapabilityDTO[];
  /** The off switch's position, from the file's frontmatter. */
  enabled: boolean;
  /** Plain-language sentence: how this skill applies. */
  sentence: string;
  errors: string[];
  mtime: number;
  /**
   * Vault paths of the material beside the skill's `SKILL.md`. Shown on its
   * page as a list, never loaded with it: the agent reads one when the
   * instructions name its path, which is what lets a skill carry a long
   * checklist without every session paying for it.
   */
  files: string[];
  /** Epoch ms it was last in force in a session; null if it never has been. */
  lastUsedMs: number | null;
}

/** A workspace happening an agent watches for. The renderer holds the phrase. */
export type StartEvent = 'decision-superseded';

/**
 * What puts a runnable in force, as data rather than a sentence. A hand-written
 * "Every 5 minutes" drifts the moment the timer changes and can't be shown as
 * anything but prose; a start carries the same number the clock runs on, so
 * main states the mechanism and the renderer chooses the words.
 *
 * The first four a file declares for itself (`starts:` in its frontmatter); the
 * last three are the app's clockwork, merged in by main because only code knows
 * when a sweep fires.
 */
export type StartDTO =
  /** The PM picks it from the composer. */
  | { kind: 'you-run-it' }
  /** The agent pulls it in mid-session; it governs from there on. */
  | { kind: 'model-picks-it-up' }
  /** In force in every session, optionally scoped to an audience. */
  | { kind: 'always'; audience?: string }
  /** Never in force: material the agent reads when it becomes relevant. */
  | { kind: 'read-when-relevant' }
  /** The maintenance tick. `everyMs` IS the interval the timer is set to. */
  | { kind: 'interval'; everyMs: number }
  /** Fires within `leadMs` of a calendar-synced meeting's start. */
  | { kind: 'before-meeting'; leadMs: number }
  /** Fires when something lands in the workspace. */
  | { kind: 'event'; event: StartEvent };

/** What a runnable may do beyond reading the memory and proposing cards. */
export type CapabilityDTO = 'draft-outbound' | 'keep-working-files';

/**
 * An agent as the Agents view sees it. Every agent IS a file (`agents/<name>/AGENT.md`):
 * the row's title opens `path`, which is the editor — identity, instructions
 * and the off switch all live there. The row itself stays to one summary line
 * plus its triggers and a short activity line (last run, pending cards);
 * anything longer belongs in the file, not the list.
 */
export interface AgentDTO {
  /** The invocation name — the filename, what sessions and toggles key on. */
  id: string;
  title: string;
  /** The file's one-line `summary`, in the PM's words. */
  summary: string;
  /** The agent file the row opens — the editor for everything about it. */
  path: string;
  /** The off switch's position — what the PM set, not whether it can run. */
  enabled: boolean;
  /**
   * `blocked` is switched on but unable to run (no API key, or frontmatter
   * errors). It exists so an agent that has quietly stopped says so instead of
   * reading as "on".
   */
  status: 'on' | 'off' | 'blocked';
  /** Why it can't run, one plain sentence. Only set when `status` is 'blocked'. */
  blockedReason?: string;
  /**
   * Epoch ms of the last run that actually DID something — fired a session.
   * Null before the first. Kept apart from `lastCheckedMs` so a sweep that
   * looked and found nothing can't be reported as work. Survives a restart: the
   * app-run's own ledger answers first, and the durable last-used stamp behind
   * it fills in what this run has not seen yet.
   */
  lastRunMs: number | null;
  /**
   * Epoch ms its clock last came round and found nothing to do. Null for agents
   * whose every tick is work (the librarian sweeps whenever it runs).
   */
  lastCheckedMs: number | null;
  /**
   * Epoch ms of the last scheduled run that ran and had nothing to report (QM
   * ticket 2). That run leaves no receipt, no Sessions row and no badge, so this
   * page is where it is recorded. Only says something about the LAST run while
   * it is newer than `lastRunMs`; older than that, a later run did have
   * something to say.
   */
  lastQuietMs: number | null;
  /**
   * Epoch ms of the last scheduled run that stopped because it needed a decision
   * and nobody was there to make it (QM ticket 9). Read like `lastQuietMs`: it
   * describes the LAST run only while it is the newest of the three stamps.
   */
  lastStoppedMs: number | null;
  /**
   * What starts it: what the file declares, plus the app's clocks when one is
   * wired to this name. An agent with only file-declared starts is one the app
   * never begins on its own — the honest answer for any file the PM adds, since
   * the clocks are still code.
   */
  starts: StartDTO[];
  /** What it may do beyond reading and proposing cards. */
  can: CapabilityDTO[];
  /** Frontmatter problems, verbatim — the first one is the blocked reason. */
  errors: string[];
  /** Pending Inbox cards this agent produced — the row's sign of life. */
  pendingCards: number;
  /** Material beside its `AGENT.md`, same contract as a skill's. */
  files: string[];
}

export interface ModelInfoDTO {
  id: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Connections (external integrations, Area C) — the renderer's one door to
// connection state, followed containers, the shallow mirror index, and
// per-reference live metadata. Provider-generic: the provider contributes
// labels and auth fields only.
// ---------------------------------------------------------------------------

/** Mirrors connectors' ConnectorHealth: the two quiet failure states the UX
 *  designs for — never conflated, never a loud error. */
export type ConnectionHealth = 'ok' | 'auth-expired' | 'unreachable';

/** One credential field, rendered generically from the connector's authSchema. */
export interface AuthFieldDTO {
  key: string;
  label: string;
  placeholder?: string;
  /** Render as a password input and never echo back. */
  secret?: boolean;
  hint?: string;
}

/** A registered provider, before credentials exist. */
export interface ProviderDescriptorDTO {
  id: string;
  label: string;
  fields: AuthFieldDTO[];
  /** Which secret field(s) to re-collect on token expiry (subset of fields). */
  renewFieldKeys: string[];
  /** `oauth` = auth is a browser flow (no fields); the form renders a Connect
   *  button instead of inputs. Absent/`fields` = paste-credentials form. */
  authKind?: 'fields' | 'oauth';
}

export interface ConnectionContainerDTO {
  id: string;
  kind: 'ticket' | 'wikipage' | 'calendar';
  name: string;
  followed: boolean;
  /** ms epoch of the last successful pull, null before the first. */
  lastSync: number | null;
  /** Shallow-mirrored item count, when known. */
  itemCount?: number;
}

export interface ConnectionDTO {
  id: string;
  providerId: string;
  providerLabel: string;
  /** Human site handle, e.g. "tavla.atlassian.net". */
  siteLabel: string;
  /** Who the credentials authenticate as, when the probe got that far. */
  identity?: string;
  health: ConnectionHealth;
  lastSync: number | null;
  containers: ConnectionContainerDTO[];
}

export interface ConnectResultDTO {
  ok: boolean;
  health: ConnectionHealth;
  identity?: string;
  siteLabel?: string;
  /** Plain-language failure line for inline display — never a raw REST error. */
  error?: string;
  connection?: ConnectionDTO;
}

/** A shallow-mirror item for `[[` autocomplete and reference pickers. */
export interface ShallowIndexItemDTO {
  kind: 'ticket' | 'wikipage';
  /** The provider key shown to the PO, e.g. "PAY-142". */
  externalId: string;
  /** Mirror-note slug the wikilink should target, e.g. "tickets/PAY-142". */
  slug: string;
  container: string;
  containerName: string;
  title: string;
  /** Raw provider workflow label — display-only, never branch on it. */
  state?: string;
  stateCategory?: StateCategory;
  url: string;
}

/** Everything a reference chip / hover card shows for one external item. */
export interface ExternalRefMetaDTO {
  kind: 'ticket' | 'wikipage';
  externalId: string;
  slug: string;
  title: string;
  containerName: string;
  state?: string;
  stateCategory?: StateCategory;
  assignee?: string;
  url: string;
  /** ISO timestamp of the last upstream change (provider clock). */
  remoteUpdated: string;
  /** Last transition, when the mirror knows it. */
  lastChange?: { by?: string; from?: string; to?: string; at: string };
  /** ms epoch of the last successful sync serving this data. */
  syncedAt: number;
  /** Local data may be behind (offline / expired token) — chips show a quiet
   *  indicator, never an error. */
  stale: boolean;
  health: ConnectionHealth;
  /** Vault path of the mirror note once deep-tracked, else null. */
  notePath: string | null;
}

/** One at-risk external item and the vault notes its risk touches. Rendered in
 *  owning views (todo rows, meeting pages) — never as Inbox rows. */
export interface AtRiskLinkDTO {
  externalId: string;
  slug: string;
  title: string;
  state: string;
  stateCategory: StateCategory;
  reason: 'blocked' | 'stale-dependents';
  /** Human delta, e.g. "In Review → Blocked". */
  delta: string;
  changedBy?: string;
  changedAt: string;
  /** Vault note paths whose truth depends on this item. */
  linked: string[];
}

/** One "since last time" line for a meeting brief's delivery delta. */
export interface DeliveryDeltaDTO {
  externalId: string;
  slug: string;
  title: string;
  /** e.g. "In Review → Blocked" or "shipped". */
  line: string;
  stateCategory: StateCategory;
}
