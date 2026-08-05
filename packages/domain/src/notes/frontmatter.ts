import { z } from 'zod';
import {
  CUSTOMER_RELATIONSHIPS,
  DECISION_STANDINGS,
  normalizeLifecycleKeys,
  PROCESSING_STATES,
  THEME_STANCES,
  TODO_COMMITMENTS,
} from './lifecycle.js';

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
  'agent',
  'todo',
  'note',
  'ticket',
  'wikipage',
] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

/**
 * Every lifecycle a note type can carry lives in {@link ./lifecycle.ts}: one
 * field name and one hard-coded enum per lifecycle, so `active` on a decision
 * and `active` on a customer are never the same key. The schemas below just
 * declare that key. Values are enums, never free text.
 */

/**
 * Layer governs edit permissions (see invariant.ts):
 * - `raw` — provenance is immutable (meeting transcripts, session receipts);
 * - `derived` — written/refreshed by the agent-harness, human-editable;
 * - `authored` — hub/spine pages the human owns.
 */
export const NOTE_LAYERS = ['raw', 'derived', 'authored'] as const;
export type NoteLayer = (typeof NOTE_LAYERS)[number];

export const CONFIDENCE_LEVELS = ['high', 'med', 'low'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

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
 * wholesale when the upstream changes (re-sync), which resets `processing` to
 * `new` so analyses know to re-run. Humans rarely read these; derived notes cite them.
 */
export const zSourceNote = z.object({
  type: z.literal('source'),
  ...base,
  processing: z.enum(PROCESSING_STATES).default('new'),
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
  processing: z.enum(PROCESSING_STATES).optional(),
  date: z.string().optional(),
  /** Clock time the meeting started, "HH:MM" (24h) — pairs with `date`. */
  time: z.string().optional(),
  /** Meeting length in minutes. */
  duration_minutes: z.number().optional(),
  participants: z.array(z.string()).optional(),
  source: zSource.optional(),
  customer: zRef.optional(),
  /**
   * The immutable transcripts, stored as source notes and linked — the meeting
   * page itself stays the human-scale anchor (prep, notes, processed summary).
   *
   * One recording is routinely delivered as several files: a call that dropped
   * and resumed, a notetaker that splits on the hour, a part 1 and part 2. Those
   * are one meeting, so the meeting holds a LIST. Read it through
   * {@link transcriptRefs}, which takes either shape; a meeting with a single
   * transcript keeps writing the bare string, so no existing note is rewritten
   * to gain a feature it does not use.
   */
  transcript: z.union([zRef, z.array(zRef)]).optional(),
  /** Recurring-meeting series slug (e.g. "nordkap-checkin") — before-meeting prep reads the previous instance. */
  series: z.string().optional(),
  // Calendar-sync fields. All optional:
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

/**
 * Every transcript a meeting holds, in the order they were linked.
 *
 * The one way to read the field. It carries a bare string on the meetings that
 * have a single recording (which is most of them, and which is how they were
 * written before a meeting could hold several), and a list on the ones split
 * across files. A reader that checks `typeof === 'string'` silently reports
 * "no transcript" for a two-part meeting, so nothing checks the shape by hand.
 */
export function transcriptRefs(frontmatter: Record<string, unknown>): string[] {
  const value = frontmatter['transcript'];
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && !!v.trim());
  return [];
}

/**
 * The value to write after linking one more transcript onto a meeting.
 *
 * Append, never replace: attaching part 2 to a meeting that already holds part 1
 * must not orphan part 1, and a transcript that is already linked must not
 * double up when the same file is dropped twice. Stays a bare string while there
 * is only one, so a meeting that never splits keeps the frontmatter it has had
 * all along.
 */
export function addTranscriptRef(
  frontmatter: Record<string, unknown>,
  ref: string,
): string | string[] {
  const refs = transcriptRefs(frontmatter);
  if (refs.includes(ref)) return refs.length === 1 ? refs[0]! : refs;
  const next = [...refs, ref];
  return next.length === 1 ? next[0]! : next;
}

export const zDecision = z.object({
  type: z.literal('decision'),
  ...base,
  standing: z.enum(DECISION_STANDINGS).default('active'),
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
  processing: z.enum(PROCESSING_STATES).optional(),
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
  relationship: z.enum(CUSTOMER_RELATIONSHIPS).default('active'),
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
   *. Optional: unmatched attendees
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
  /** The skill this session was ABOUT — the first that arrived, else `chat`. */
  skill: z.string(),
  /**
   * Every skill in force during the session, arrival order (Sessions v2): a
   * session is not one mode, so the single `skill` above only names the one it
   * turned out to be about.
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
 * Skill and agent files — the same kind of thing filed in two folders: free-text
 * instructions plus `starts` (what puts it in force) and `can` (what it may
 * do), both parsed by @qale/sessions from the raw file. The note schema only
 * needs enough to list and route it, so it carries neither: an unknown value in
 * either list is a validation error the file's own page pins, and a schema that
 * rejected it here would drop the file out of its type and hide the error.
 */
export const zSkill = z.object({
  type: z.literal('skill'),
  ...base,
  // `.catch(true)`: a junk value must surface on the Skills view, not silently
  // drop the file from the skill type.
  enabled: z.boolean().default(true).catch(true),
});

export const zAgentNote = z.object({
  type: z.literal('agent'),
  ...base,
  enabled: z.boolean().default(true).catch(true),
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
  commitment: z.enum(TODO_COMMITMENTS).default('open'),
  /** Due date "YYYY-MM-DD" — optional; undated todos land in "Someday". */
  due: z.string().optional(),
  /** Who committed: omitted = the PO; else "[[people/…]]" ref or a plain name. */
  owner: zRef.optional(),
  sources: z.array(zRef).default([]),
  /** Stamped "YYYY-MM-DD" when `commitment` flips to done/dropped; cleared on reopen. */
  resolved: z.string().optional(),
  customer: zRef.optional(),
});

/** Generic authored note — the fallback so any markdown file still indexes. */
export const zNote = z.object({
  type: z.literal('note'),
  ...base,
  processing: z.enum(PROCESSING_STATES).optional(),
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
 * only ever updated wholesale by re-sync, which resets `processing` to `new` so
 * the freshness spine marks dependents stale (the drift signal).
 */
export const zTicket = z.object({
  type: z.literal('ticket'),
  ...base,
  processing: z.enum(PROCESSING_STATES).default('new'),
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
   *  link index. Absent when the item has no parent. */
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
  processing: z.enum(PROCESSING_STATES).default('new'),
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
  zAgentNote,
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
export type AgentNoteFrontmatter = z.infer<typeof zAgentNote>;
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
  agent: { dir: 'agents', layer: 'authored' },
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
 *
 * A legacy `status:` is folded onto the type's own lifecycle key first (see
 * {@link normalizeLifecycleKeys}), and the merge below runs over the normalized
 * object, so an old vault reads clean instead of carrying both keys forward.
 */
export function parseFrontmatter(input: unknown): ParseResult {
  const normalized = normalizeLifecycleKeys(input);
  const result = zFrontmatter.safeParse(normalized);
  if (result.success) {
    const merged =
      normalized && typeof normalized === 'object'
        ? { ...(normalized as Record<string, unknown>), ...result.data }
        : result.data;
    return { ok: true, data: merged as Frontmatter };
  }
  return {
    ok: false,
    error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
  };
}
