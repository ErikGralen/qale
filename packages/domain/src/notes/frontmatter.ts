import { z } from 'zod';

/**
 * Frontmatter schemas — THE single source of truth for note shape (PLAN-V2 §3.1).
 * Types are derived via `z.infer`; nothing else defines a note's fields. A note is
 * a discriminated union on `type`, which drives its folder, layer and permissions.
 *
 * The workspace is OKF-conformant: `type` is required, each folder has its own
 * schema, and consumers tolerate unknown keys — {@link parseFrontmatter} preserves
 * any frontmatter field it doesn't recognise rather than stripping it.
 */

export const NOTE_TYPES = [
  'source',
  'meeting',
  'decision',
  'insight',
  'customer',
  'theme',
  'person',
  'session',
  'skill',
  'todo',
  'note',
  'ticket',
  'wikipage',
] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

/**
 * Generic note lifecycle — a small, enum-valued vocabulary for scripting and
 * filtering (never free text):
 * - `new` — just captured/synced, not yet analyzed;
 * - `processed` — analyses ran, derived notes exist;
 * - `active` — current and relied upon;
 * - `stale` — needs review (a source it cites was superseded upstream).
 * Types with their own lifecycle (decision/customer/theme) keep their enums.
 */
export const NOTE_STATUSES = ['new', 'processed', 'active', 'stale'] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

/**
 * Layer governs edit permissions (see invariant.ts):
 * - `raw` — provenance is immutable (meeting transcripts, session receipts);
 * - `derived` — written/refreshed by the agent-harness, human-editable;
 * - `authored` — hub/spine pages the human owns.
 */
export const NOTE_LAYERS = ['raw', 'derived', 'authored'] as const;
export type NoteLayer = (typeof NOTE_LAYERS)[number];

/**
 * Theme stance — the durable-belief vocabulary. A theme is the thing worth
 * solving (a problem, a pain, an opportunity, an idea); the stance is what we
 * currently believe about it. `watching` is the someday shelf and `wont-do` is
 * a deliberate decline that KEEPS accreting evidence — neither has a ticket,
 * which is precisely why they need a home the workspace owns.
 */
export const THEME_STANCES = ['exploring', 'watching', 'committed', 'wont-do'] as const;
export type ThemeStance = (typeof THEME_STANCES)[number];

/** A decision's lifecycle: it is superseded, never edited (append-only spine). */
export const DECISION_STATUSES = ['active', 'superseded'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const CONFIDENCE_LEVELS = ['high', 'med', 'low'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const CUSTOMER_STATUSES = ['prospect', 'active', 'churned'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/**
 * A todo's lifecycle: `open` until it lands. `done` and `dropped` both close it
 * but stay in the workspace — the commitment ledger accretes, it never deletes.
 */
export const TODO_STATUSES = ['open', 'done', 'dropped'] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

/** A wikilink string like "[[decisions/adopt-workos]]" or an external URL. */
export const zRef = z.string().min(1);

export const zSource = z.object({
  system: z.string().min(1),
  author: z.string().optional(),
  url: z.string().url().optional(),
});
export type SourceRef = z.infer<typeof zSource>;

/**
 * One verification record (OKF §5.2). `by` follows the actor convention (§7):
 * `human:<id>`, `process:<id>`, or `<agent>/<version>`; `at` is when the check
 * happened. The presence and kind of these entries derive the trust tier — see
 * {@link ./trust.ts}. Optional and purely additive: absence means "unverified,"
 * never a rejection (§11).
 */
export const zVerification = z.object({
  by: z.string().min(1),
  at: z.string().min(1),
});
export type Verification = z.infer<typeof zVerification>;

/** Every note carries a one-line summary — the token-cheap retrieval index. */
const base = {
  summary: z.string().min(1, 'summary is mandatory — it is the retrieval index'),
  title: z.string().optional(),
  tags: z.array(z.string()).optional(),
  /** OKF trust family (§5.2): who confirmed this note is still true, and when. */
  verified: z.array(zVerification).optional(),
};

/**
 * Raw source material — transcripts, PDF articles, Slack threads, Confluence
 * pages. The body is never *edited* (by human or agent); it may be *updated*
 * wholesale when the upstream changes (re-sync), which resets `status` to `new`
 * so analyses know to re-run. Humans rarely read these; derived notes cite them.
 */
export const zSourceNote = z.object({
  type: z.literal('source'),
  ...base,
  status: z.enum(NOTE_STATUSES).default('new'),
  source: zSource.optional(),
  /** When the material was first captured. */
  captured: z.string().optional(),
  /** When the body was last re-synced from upstream. */
  updated: z.string().optional(),
  /**
   * Where the material came from when the PO wasn't in the room — e.g. the
   * colleague whose sales call this transcript records. External meetings are
   * sources, not meetings: the PO is a reader, not a participant.
   */
  origin: z.string().optional(),
  customer: zRef.optional(),
});

/**
 * Calendar providers whose events materialize as `meeting` notes. Same closed-
 * enum posture as TICKET_PROVIDERS: a new calendar source is one entry here
 * plus a connector.
 */
export const CALENDAR_PROVIDERS = ['google-calendar'] as const;
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number];

/** Upstream event lifecycle, verbatim from the provider's vocabulary. */
export const EVENT_STATUSES = ['confirmed', 'tentative', 'cancelled'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const zMeeting = z.object({
  type: z.literal('meeting'),
  ...base,
  status: z.enum(NOTE_STATUSES).optional(),
  date: z.string().optional(),
  /** Clock time the meeting started, "HH:MM" (24h) — pairs with `date`. */
  time: z.string().optional(),
  /** Meeting length in minutes. */
  duration_minutes: z.number().optional(),
  participants: z.array(z.string()).optional(),
  source: zSource.optional(),
  customer: zRef.optional(),
  /**
   * The immutable transcript, stored as a source note and linked — the meeting
   * page itself stays the human-scale anchor (prep, notes, processed summary).
   */
  transcript: zRef.optional(),
  /** Recurring-meeting series slug (e.g. "nordkap-checkin") — before-meeting prep reads the previous instance. */
  series: z.string().optional(),
  // Calendar-sync fields (docs/google-calendar-integration.md). All optional:
  // a hand-written meeting note is exactly as valid as a synced one. Ownership
  // splits BY FIELD, not by file — see MEETING_SYNC_FIELDS.
  provider: z.enum(CALENDAR_PROVIDERS).optional(),
  /** The provider's event id. */
  external_id: z.string().min(1).optional(),
  /** Calendar (container) the event lives on, e.g. "primary". */
  calendar: z.string().min(1).optional(),
  event_status: z.enum(EVENT_STATUSES).optional(),
  remote_updated: z.iso.datetime({ offset: true }).optional(),
  /** Open-in-Google-Calendar link. */
  url: z.string().url().optional(),
});

/**
 * The machine-owned meeting fields — the ONLY frontmatter keys the calendar
 * sync engine may update on an existing meeting note. `summary`/`title` are set
 * at creation and never touched again (the PM may sharpen them); the body
 * belongs to the PM from the first keystroke. The mirror patcher and its tests
 * share this list so the invariant stays checkable.
 */
export const MEETING_SYNC_FIELDS = [
  'date',
  'time',
  'duration_minutes',
  'participants',
  'series',
  'event_status',
  'external_id',
  'calendar',
  'remote_updated',
  'url',
] as const;
export type MeetingSyncField = (typeof MEETING_SYNC_FIELDS)[number];

export const zDecision = z.object({
  type: z.literal('decision'),
  ...base,
  status: z.enum(DECISION_STATUSES).default('active'),
  date: z.string().optional(),
  deciders: z.array(z.string()).optional(),
  sources: z.array(zRef).default([]),
  /** The decision this one replaces (back-pointer forms the supersedes-chain). */
  supersedes: zRef.optional(),
  /** Set when a newer decision replaces this one; body is never edited. */
  superseded_by: zRef.optional(),
  theme: zRef.optional(),
});

export const zInsight = z.object({
  type: z.literal('insight'),
  ...base,
  status: z.enum(NOTE_STATUSES).optional(),
  evidence: z.array(zRef).min(1, 'insights must cite evidence'),
  confidence: z.enum(CONFIDENCE_LEVELS).default('med'),
  customer: zRef.optional(),
  /** Optional roll-up. An insight is never required to belong to a theme — a
   *  claim can stand alone until synthesis finds it a pattern to join. */
  theme: zRef.optional(),
});

export const zCustomer = z.object({
  type: z.literal('customer'),
  ...base,
  status: z.enum(CUSTOMER_STATUSES).default('active'),
  segment: z.string().optional(),
});

/**
 * The durable thing worth solving — a problem, a pain, an opportunity, an idea.
 * The hub where insights accrete into a pattern and where a stance is taken.
 * Deliberately NOT a ticket: a ticket is an upstream mirror that cannot hold
 * evidence or a stance, and the watching/wont-do items never get one at all.
 */
export const zTheme = z.object({
  type: z.literal('theme'),
  ...base,
  stance: z.enum(THEME_STANCES).default('exploring'),
  evidence: z.array(zRef).default([]),
  customer: zRef.optional(),
});

export const zPerson = z.object({
  type: z.literal('person'),
  ...base,
  role: z.string().optional(),
  /** Work email — the join key that resolves calendar attendees to this note
   *  (docs/google-calendar-integration.md, job 4). Optional: unmatched attendees
   *  stay plain emails until someone makes a person note. */
  email: z.string().optional(),
  cares_about: z.array(z.string()).optional(),
  /** The what-they-were-told ledger clock: when this person was last updated. */
  last_told: z.string().optional(),
  customer: zRef.optional(),
});

/** Session transcript — the replayable audit trail, written by the harness. */
export const zSession = z.object({
  type: z.literal('session'),
  ...base,
  session_type: z.string(),
  /**
   * Every skill in force during the session, arrival order (Sessions v2): a
   * session is no longer one mode, so the single `session_type` above only names
   * what it opened with.
   */
  skills: z.array(z.string()).optional(),
  /** Full pi session id — resolves this receipt back to the stored chat. */
  session_id: z.string().optional(),
  started: z.string().optional(),
  ended: z.string().optional(),
  reads: z.array(zRef).default([]),
  writes: z.array(zRef).default([]),
  source_meeting: zRef.optional(),
});

/**
 * Skill file — a session type / voice guide / filing rule. The rich harness
 * config (checkpoints, tiers, guardrails) is parsed by @pm/sessions from the raw
 * file; the note schema only needs enough to list and route it.
 */
export const SKILL_KINDS = ['session', 'voice', 'filing', 'guide', 'reaction'] as const;
export type SkillKind = (typeof SKILL_KINDS)[number];

export const zSkill = z.object({
  type: z.literal('skill'),
  ...base,
  skill_kind: z.enum(SKILL_KINDS).default('session'),
});

/**
 * A tracked commitment — the PO's own ("email Åsa about rollout") or someone
 * else's ("Jonas: update the SSO docs"). `owner` absent means the PO owns it;
 * an `owner` ref/name marks an external commitment the PO is waiting on.
 * `sources` cite where the commitment was made (usually a meeting).
 */
export const zTodo = z.object({
  type: z.literal('todo'),
  ...base,
  status: z.enum(TODO_STATUSES).default('open'),
  /** Due date "YYYY-MM-DD" — optional; undated todos land in "Someday". */
  due: z.string().optional(),
  /** Who committed: omitted = the PO; else "[[people/…]]" ref or a plain name. */
  owner: zRef.optional(),
  sources: z.array(zRef).default([]),
  /** Stamped "YYYY-MM-DD" when status flips to done/dropped; cleared on reopen. */
  resolved: z.string().optional(),
  customer: zRef.optional(),
});

/** Generic authored note — the fallback so any markdown file still indexes. */
export const zNote = z.object({
  type: z.literal('note'),
  ...base,
  status: z.enum(NOTE_STATUSES).optional(),
  sources: z.array(zRef).default([]),
});

/**
 * External-mirror providers. Deliberately narrow today, deliberately a string
 * enum: a new provider (Linear, Notion, GitHub Issues) is one entry here plus a
 * connector — the domain vocabulary stays `ticket`/`wikipage` regardless.
 */
export const TICKET_PROVIDERS = ['jira'] as const;
export type TicketProvider = (typeof TICKET_PROVIDERS)[number];

export const WIKIPAGE_PROVIDERS = ['confluence'] as const;
export type WikipageProvider = (typeof WIKIPAGE_PROVIDERS)[number];

/**
 * Our normalized ticket-state vocabulary — the ONLY state field logic may branch
 * on. Each connector maps its provider's workflow labels onto this once; the raw
 * `state` string is display-only ("In Review", "Väntar på granskning", …).
 */
export const STATE_CATEGORIES = ['open', 'in_progress', 'blocked', 'done'] as const;
export type StateCategory = (typeof STATE_CATEGORIES)[number];

/**
 * Mirrored unit of tracked work (Jira issue, later Linear/GitHub issue) — a raw
 * source note, same immutability contract as `source`: never edited locally,
 * only ever updated wholesale by re-sync, which resets `status` to `new` so the
 * freshness spine marks dependents stale (the drift signal).
 */
export const zTicket = z.object({
  type: z.literal('ticket'),
  ...base,
  status: z.enum(NOTE_STATUSES).default('new'),
  provider: z.enum(TICKET_PROVIDERS),
  /** The provider's key for the item, e.g. "PAY-142". */
  external_id: z.string().min(1),
  /** Project / team / repo the item lives in, e.g. "PAY". */
  container: z.string().min(1),
  /** The provider's raw workflow label, shown verbatim. DISPLAY-ONLY — branch on state_category. */
  state: z.string().min(1),
  state_category: z.enum(STATE_CATEGORIES),
  assignee: z.string().optional(),
  /** Epic/parent key (e.g. "PAY-142") — written by sync, a `part-of` edge in the
   *  link index (docs/typed-links.md). Absent when the item has no parent. */
  parent: z.string().min(1).optional(),
  /** The provider's typed issue links, canonicalized to our link vocabulary.
   *  `reversed` = the semantic edge runs the other way ("is blocked by").
   *  Written by sync, origin `synced` in the index — never edited locally. */
  links: z
    .array(
      z.object({
        type: z.string().min(1),
        key: z.string().min(1),
        reversed: z.boolean().optional(),
      }),
    )
    .optional(),
  /** ISO datetime of the last upstream change (the provider's clock) — a bare
   *  date here would break drafted-against-stale comparisons, so it's rejected. */
  remote_updated: z.iso.datetime({ offset: true }),
  url: z.string().url(),
});

/**
 * Mirrored living document (Confluence page, later Notion) — raw layer, same
 * re-sync-only update contract as `ticket`.
 */
export const zWikipage = z.object({
  type: z.literal('wikipage'),
  ...base,
  status: z.enum(NOTE_STATUSES).default('new'),
  provider: z.enum(WIKIPAGE_PROVIDERS),
  external_id: z.string().min(1),
  /** Space / workspace the page lives in. */
  container: z.string().min(1),
  /** The provider's version counter — outbound edits assert against it. */
  version: z.number().int().nonnegative(),
  remote_updated: z.iso.datetime({ offset: true }),
  url: z.string().url(),
});

export const zFrontmatter = z.discriminatedUnion('type', [
  zSourceNote,
  zMeeting,
  zDecision,
  zInsight,
  zCustomer,
  zTheme,
  zPerson,
  zSession,
  zSkill,
  zTodo,
  zNote,
  zTicket,
  zWikipage,
]);

export type Frontmatter = z.infer<typeof zFrontmatter>;
export type SourceNoteFrontmatter = z.infer<typeof zSourceNote>;
export type MeetingFrontmatter = z.infer<typeof zMeeting>;
export type DecisionFrontmatter = z.infer<typeof zDecision>;
export type InsightFrontmatter = z.infer<typeof zInsight>;
export type CustomerFrontmatter = z.infer<typeof zCustomer>;
export type ThemeFrontmatter = z.infer<typeof zTheme>;
export type PersonFrontmatter = z.infer<typeof zPerson>;
export type SessionFrontmatter = z.infer<typeof zSession>;
export type SkillFrontmatter = z.infer<typeof zSkill>;
export type TodoFrontmatter = z.infer<typeof zTodo>;
export type NoteFrontmatter = z.infer<typeof zNote>;
export type TicketFrontmatter = z.infer<typeof zTicket>;
export type WikipageFrontmatter = z.infer<typeof zWikipage>;

/** Which on-disk folder + layer a note type lives in (PLAN-V2 §3.1). */
export const NOTE_TYPE_META: Record<NoteType, { dir: string; layer: NoteLayer }> = {
  source: { dir: 'sources', layer: 'raw' },
  meeting: { dir: 'meetings', layer: 'derived' },
  decision: { dir: 'decisions', layer: 'authored' },
  insight: { dir: 'insights', layer: 'derived' },
  customer: { dir: 'customers', layer: 'authored' },
  theme: { dir: 'themes', layer: 'authored' },
  person: { dir: 'people', layer: 'authored' },
  session: { dir: 'sessions', layer: 'derived' },
  skill: { dir: 'skills', layer: 'authored' },
  todo: { dir: 'todos', layer: 'authored' },
  note: { dir: 'notes', layer: 'authored' },
  ticket: { dir: 'tickets', layer: 'raw' },
  wikipage: { dir: 'wikipages', layer: 'raw' },
};

export function layerForType(type: NoteType): NoteLayer {
  return NOTE_TYPE_META[type].layer;
}

export function dirForType(type: NoteType): string {
  return NOTE_TYPE_META[type].dir;
}

/** Reverse lookup: which note type a top-level workspace folder maps to. */
export function typeForDir(dir: string): NoteType | null {
  const entry = (Object.keys(NOTE_TYPE_META) as NoteType[]).find(
    (t) => NOTE_TYPE_META[t].dir === dir,
  );
  return entry ?? null;
}

export interface ParseResult {
  ok: boolean;
  data?: Frontmatter;
  error?: string;
}

/**
 * Validate an unknown frontmatter object against the schema for its `type`.
 * Unknown keys are PRESERVED (merged back over the validated result) so the
 * workspace stays OKF-tolerant and round-trips fields we don't model yet.
 */
export function parseFrontmatter(input: unknown): ParseResult {
  const result = zFrontmatter.safeParse(input);
  if (result.success) {
    const merged =
      input && typeof input === 'object'
        ? { ...(input as Record<string, unknown>), ...result.data }
        : result.data;
    return { ok: true, data: merged as Frontmatter };
  }
  return {
    ok: false,
    error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
  };
}
