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
 *  notes/mirrors) — always enum, never free text. Mirrors @qale/domain. */
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
  /** Meetings: the note mirrors a calendar event, so the app knows it happened
   *  whether or not anyone wrote anything down. */
  synced?: boolean;
  /** Meetings: anything was captured — a transcript ref, or a body somebody
   *  typed. False on a synced meeting nobody filled in. */
  captured?: boolean;
  /** Meetings: recurring-series slug, shared by every instance. */
  series?: string;
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
  /**
   * Windows only: the workspace folder is so deep that ordinary files inside it
   * would run past the 260-character path limit. Always false on macOS and
   * Linux, where no such limit exists.
   */
  pathTooDeep: boolean;
  noteCount: number;
}

/**
 * What a folder would be as a workspace, BEFORE anything is written to it
 * (docs/onboarding.md ONB-4). The opening asks this about the path it is about
 * to create so the sync warning lands before the scaffold, not after.
 */
export interface PathCheckDTO {
  /** Absolute, expanded — what the screen shows and what `vault:create` takes. */
  path: string;
  exists: boolean;
  /** Sync service whose folder this sits in ("iCloud Drive", …), or null. */
  syncedBy: string | null;
  /** It exists and already holds markdown — opening it adopts that material. */
  hasNotes: boolean;
  /** Windows only: too deep for the files inside it to stay under the path limit. */
  pathTooDeep: boolean;
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

/** Start a blank page of a chosen type. Main-side refuses the types nobody authors. */
export interface CreateNoteInputDTO {
  type: NoteType;
  title?: string;
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
// Arrival — the one door material comes in through (docs/arrival-agentic.md).
//
// The tray used to carry a plan: what each file was, where it would land, how
// many reads would start. All of that was guesswork done before anything had
// read the material, and it is gone. What crosses the wire now is bytes going
// in and one session id coming back.
// ---------------------------------------------------------------------------

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
}

/**
 * The only thing the tray still decides by itself: whether we can read these
 * bytes at all. A `.zip` is a `.zip` whoever looks at it, so no model is needed
 * to say so, and the refusal has to be visible before the button is pressed.
 */
export interface ArrivalCheckDTO {
  /** One row per input item, in input order. */
  items: { name: string; error?: string }[];
  /** Nothing in the batch can be read — the button has nothing to do. */
  empty: boolean;
}

/** What the tray gets back: the session now holding the material. */
export interface ArrivalHandoffDTO {
  /** The session the files were written into, and that is reading them. */
  sessionId: string;
  /** How many pieces of material landed in it. */
  landed: number;
  /** Files that could not be read, so never made it in. */
  refused: { name: string; error: string }[];
  /**
   * The session is running. False means the material landed but nothing is
   * reading it (no API key, or the skill is switched off) — the files are safe
   * in the session folder and `reason` says what to fix.
   */
  started: boolean;
  reason?: string;
}

export interface SaveNoteInput {
  path: string;
  body: string;
}

export interface SaveFrontmatterInput {
  path: string;
  frontmatter: Record<string, unknown>;
}

export interface RestoreVersionInput {
  path: string;
  /** The version to bring back, by its hash from `note:history`. */
  hash: string;
}

export interface RenameNoteInput {
  path: string;
  title: string;
}

export interface ProposalPreviewDTO {
  before: string;
  after: string;
  stale: boolean;
  /** Why this edit has nowhere to land: its anchor text is gone or now ambiguous
   *  (`unanchored`), the text it appends is already there (`duplicate`), or the
   *  note itself is gone (`missing`). */
  staleReason?: 'unanchored' | 'duplicate' | 'missing';
  /** The note was edited after the card was proposed, but the edit still fits.
   *  Said out loud next to the diff; never a reason to refuse. */
  moved?: boolean;
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
  /** Text added at the end of the body on approval — the lever for a note with
   *  nothing to anchor a patch in (a meeting page mirrored from the calendar). */
  append?: string;
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
  /** The agent worked this out and nothing in the workspace says it — the claim
   *  to double-check, and the card flags it. */
  inference: boolean;
  /**
   * The PM asked for this in the conversation. There is no note to cite because
   * the source is their own message, which is the opposite of an unsourced
   * guess, so the card says so plainly instead of raising a warning. Never both
   * this and `inference`: the card shows this one when they disagree.
   */
  asked: boolean;
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

/**
 * What the PO has already waved off, so the capture nudge never asks twice
 * (docs/capture-nudge.md). Durable, per workspace: the answer is about these
 * meetings, not about this window.
 */
export interface CaptureNudgeStateDTO {
  /** Meeting paths dismissed one by one. */
  dismissed: string[];
  /** Series slugs gone quiet for good — two dismissals from one series. */
  mutedSeries: string[];
}

/** A dismissal's outcome: the new state, plus the series it just silenced. */
export interface CaptureNudgeDismissDTO extends CaptureNudgeStateDTO {
  /** Set when this dismissal was the second in its series, so the row can say so. */
  mutedNow?: string;
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
  /**
   * Run this session on this model from here on. Remembered against the
   * session, so reopening it tomorrow does not switch models underneath the PM.
   * Absent means keep what the session already had, which for a new session is
   * the one Settings names.
   */
  modelId?: string;
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
  /** The model this session was moved to, or null when it follows Settings. */
  modelId: string | null;
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
  /**
   * Offered, not owed: a tidy pass nobody asked for wants to fan out. The spend
   * still needs approving before anything runs, but the app never interrupts
   * the PM about it.
   */
  offered: boolean;
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
  /**
   * Offered, not owed: an agent that tidies the workspace asked it on a run
   * nobody was there for. Such a question renders in the quiet section and
   * never counts toward a badge, the way the librarian's findings always have.
   * Main works this out; the renderer only reads it.
   */
  offered: boolean;
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

export interface ScheduleDTO {
  /** The skill this schedule runs. */
  skill: string;
  dayOfWeek: number;
  hour: number;
  enabled: boolean;
  lastRun: string | null;
}

/**
 * The opening's screens, in the order they are shown (docs/onboarding.md).
 * `telemetry` is the last one; finishing it sets `finishedAt`. Getting the
 * first transcript in is not a screen here — it is a First steps row, so the
 * opening ends and the app itself makes the ask.
 */
export type OpeningStepId = 'hello' | 'you' | 'files' | 'key' | 'connections' | 'telemetry';

export const OPENING_STEPS: readonly OpeningStepId[] = [
  'hello',
  'you',
  'files',
  'key',
  'connections',
  'telemetry',
] as const;

/**
 * The First steps rows whose completion is a MOMENT rather than a standing
 * fact: each is stamped once, with the one line saying what happened. The other
 * three rows (the key, the two connections) are derived from live state instead
 * — see {@link ConnectionProgress} — so a key added from Settings months later
 * still ticks its row.
 */
export type FirstStepId =
  | 'transcript'
  | 'proposal'
  | 'prep'
  | 'ask'
  /**
   * The interview drafted a picture of the product and the PM kept it
   * (docs/product-understanding.md U-4). `about-us` is the row it replaced,
   * kept in the union so a workspace that already ticked it stays ticked: the
   * lesson moved from "skills are files you edit" to "you talk, it drafts, you
   * approve", but somebody who did the old one has still told it about their
   * product.
   */
  | 'understanding'
  | 'about-us';

/** How far one provider got. Connected but following nothing reads nothing. */
export type ConnectionProgress = 'none' | 'connected' | 'following';

export interface OnboardingDTO {
  /**
   * When the opening finished. Null means it is still owed, and the Shell
   * renders it over everything. Set on migration for any install that already
   * had a workspace: they never see the opening, but they do get First steps.
   */
  finishedAt: string | null;
  /** Where a quit mid-flow resumes. */
  step: OpeningStepId;
  /** Screens the PM answered. */
  done: OpeningStepId[];
  /** Screens waved past — step ids, plus `connections:<providerId>` for the
   *  per-provider skips the connections screen records. */
  skipped: string[];
  /** Stamped First steps, id → when it happened and what to say about it. */
  checklist: Partial<Record<FirstStepId, { at: string; line: string }>>;
  /** The First steps card was put away for good. */
  dismissed: boolean;
  /** Telemetry consent (ONB-6). Nothing is sent while this is false. */
  telemetry: boolean;
  /** Live connection state, for the two rows that ask about it. */
  connections: { google: ConnectionProgress; atlassian: ConnectionProgress };
}

/** A merge-patch on the onboarding record — everything optional, one channel. */
export interface OnboardingPatchDTO {
  /** Move the opening to this screen. */
  step?: OpeningStepId;
  /** Mark a screen answered (and un-skip it, if it was skipped before). */
  done?: OpeningStepId;
  /** Record a skip: a step id, or `connections:<providerId>`. */
  skipped?: string;
  /** The opening is over — stamps `finishedAt`. */
  finished?: boolean;
  dismissed?: boolean;
  telemetry?: boolean;
}

/**
 * Whose API answers. The same two words pi uses, so nothing has to translate
 * between the app and the model layer. Structurally `LlmProvider` from
 * `@qale/domain`; restated here because the wire types stay dependency-free.
 */
export type LlmProviderDTO = 'anthropic' | 'google';

export interface SettingsDTO {
  vaultPath: string | null;
  /** Which build this is, so a bug report can say. Never Electron's version. */
  appVersion: string;
  /** Whose API answers. One at a time, and the model belongs to it. */
  provider: LlmProviderDTO;
  modelId: string;
  /** Whether the CHOSEN provider has a key. What every "can the agent run" check reads. */
  hasApiKey: boolean;
  /**
   * Which providers have a key stored, whether or not they are the chosen one.
   * Both are kept, so somebody trying the other one for a week does not have to
   * find the first key again to come back. Settings reads this to say which
   * choice is ready to go.
   */
  storedKeys: Record<LlmProviderDTO, boolean>;
  hasAtlassianCreds: boolean;
  /** False when the OS offers no secret store, so secrets are only obfuscated at rest. */
  secretsEncrypted: boolean;
  /**
   * True when a stored secret failed to decrypt, so the keys must be re-entered.
   * Two causes, one state: a denied or reset keychain on macOS, and settings
   * carried to another Windows account or machine, which DPAPI cannot unlock.
   */
  secretsUnreadable: boolean;
  schedules: ScheduleDTO[];
  /**
   * What this workspace is written in, as a bare language tag ("sv"). Never a
   * locale: a region is not a language, so sv-SE and sv-FI are the same setting
   * (OW5). Names for the tags live in `@qale/domain` (`LANGUAGE_NAMES`).
   */
  language: string;
  mcp: { enabled: boolean; port: number; token: string | null; running: boolean };
  /**
   * Who the PO is. `name` is what participant chips show for their own row;
   * `emails` are every address that means "me" — the connected accounts, plus
   * any aliases they added by hand (an invite may reach them at either).
   */
  identity: { name: string | null; emails: string[]; aliases: string[] };
  /** First run and what is left of it (docs/onboarding.md). */
  onboarding: OnboardingDTO;
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

/**
 * One built-in skill the PM edited, where the version we ship has since moved
 * on. Their file is untouched and still in force; this is the offer to look.
 * Both texts ride along so the page can show what changed without a second call.
 */
export interface SkillUpdateDTO {
  /** The shipped file's path — the key every action on this row is taken with. */
  file: string;
  /** What their copy calls itself, so the row names what they see in the list. */
  title: string;
  /** Their file as it stands. */
  yours: string;
  /** What we ship now. */
  ours: string;
}

/** A skill that stopped shipping, whose edited copy was kept rather than deleted. */
export interface RetiredSkillDTO {
  file: string;
  title: string;
  /** Where their copy is now. */
  keptAt: string;
}

/** Everything the Skills page has to tell the PM about the pack itself. */
export interface SkillPackReviewDTO {
  updates: SkillUpdateDTO[];
  retired: RetiredSkillDTO[];
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
export type CapabilityDTO = 'draft-outbound' | 'keep-working-files' | 'file-material';

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

/**
 * One container the survey says this person actually works in
 * (docs/product-understanding.md FL-2). `reason` is the whole feature: a
 * recommendation without one reads as a guess, and the count in it is the
 * provider's real total, never the page the survey happened to fetch.
 */
export interface ContainerRecommendationDTO {
  id: string;
  kind: 'ticket' | 'wikipage' | 'calendar';
  reason: string;
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
