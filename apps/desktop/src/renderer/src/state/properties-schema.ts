import type { NoteType } from '@qale/ipc';

/**
 * Frontmatter is never hand-written (PLAN-V2 §3.1): the properties panel renders
 * it as a form. These descriptors mirror the per-folder zod schema in @qale/domain
 * (the authority — writes are re-validated main-side via note:saveFrontmatter).
 * Ref arrays (evidence/sources/supersedes) are shown read-only; they are edited
 * through links and cards, not typed by hand.
 */
/** `readonly` rows display a value the human never edits (sync-owned mirror
 *  facts) — offering a widget would only earn a main-side rejection. */
/** `people` rows hold person references (a `[[people/…]]` link, a name, or an
 *  invite address) and render as faces + names with a preview card — the raw
 *  form is never shown to the PO. */
export type Widget = 'text' | 'textarea' | 'select' | 'tags' | 'date' | 'readonly' | 'people';

export interface SelectOption {
  value: string;
  /** What the PO reads. Never the raw token. */
  label: string;
}

export interface FieldSpec {
  key: string;
  label: string;
  widget: Widget;
  options?: readonly SelectOption[];
  /**
   * The agent writes this, the reader only reads it. The row still shows the
   * value, it just offers no cursor. See {@link TAGS}.
   */
  agentOwned?: boolean;
}

const SUMMARY: FieldSpec = { key: 'summary', label: 'Summary', widget: 'textarea' };
/**
 * Tags file a note into a context, and the agent fills them on every note it
 * writes. Asking the PO to keep that vocabulary true is asking them to run a
 * filing system for a schema they never see, so the row reads and never edits:
 * chips you can click through to the context, and nothing to curate.
 */
const TAGS: FieldSpec = { key: 'tags', label: 'Tags', widget: 'tags', agentOwned: true };

/**
 * Lifecycle rows. Each type carries its OWN lifecycle under its own name, so no
 * two of them ever appear as "Status" (see NOTE_LIFECYCLES in @qale/domain, the
 * authority these mirror). Values are enums, never free text.
 *
 * Two of the three `processing` states are real: code writes `new` when
 * material lands and `processed` when a proposal citing it is approved, and the
 * attention lists read both. Nothing anywhere writes `stale`, so offering it
 * taught a word that only ever came back from the PO's own hand. The reads stay
 * (a vault file that carries it still counts as unread, and the fact strip still
 * flags it), and PropertyValue still shows a value the options no longer offer.
 */
const PROCESSING: FieldSpec = {
  key: 'processing',
  label: 'Gone through',
  widget: 'select',
  options: [
    { value: 'new', label: 'Not yet' },
    { value: 'processed', label: 'Gone through' },
  ],
};
const STANDING: FieldSpec = {
  key: 'standing',
  label: 'Standing',
  widget: 'select',
  options: [
    { value: 'active', label: 'Active' },
    { value: 'superseded', label: 'Superseded' },
  ],
};
const COMMITMENT: FieldSpec = {
  key: 'commitment',
  label: 'Commitment',
  widget: 'select',
  options: [
    { value: 'open', label: 'Open' },
    { value: 'done', label: 'Done' },
    { value: 'dropped', label: 'Dropped' },
  ],
};
/**
 * `processing` sits last everywhere it appears: it is Qale's own bookkeeping
 * (did the pipeline read this yet), not a fact about the thing the note
 * describes, and the one time it matters to a reader — stale — the fact strip
 * flags it above the fold.
 */
export const FIELDS: Partial<Record<NoteType, FieldSpec[]>> & { note: FieldSpec[] } = {
  source: [
    SUMMARY,
    { key: 'captured', label: 'Captured', widget: 'date' },
    { key: 'updated', label: 'Last synced', widget: 'date' },
    { key: 'origin', label: "Origin (who it's from)", widget: 'text' },
    TAGS,
    PROCESSING,
  ],
  meeting: [
    SUMMARY,
    { key: 'date', label: 'Date', widget: 'date' },
    { key: 'participants', label: 'Participants', widget: 'people' },
    { key: 'series', label: 'Series', widget: 'text' },
    TAGS,
    PROCESSING,
  ],
  decision: [
    SUMMARY,
    STANDING,
    { key: 'date', label: 'Date', widget: 'date' },
    { key: 'deciders', label: 'Deciders', widget: 'people' },
    TAGS,
  ],
  insight: [
    SUMMARY,
    {
      key: 'confidence',
      label: 'Confidence',
      widget: 'select',
      options: [
        { value: 'high', label: 'High' },
        { value: 'med', label: 'Medium' },
        { value: 'low', label: 'Low' },
      ],
    },
    TAGS,
    PROCESSING,
  ],
  // A customer's `relationship` and a theme's `stance` have no row: see
  // {@link HIDDEN_KEYS}.
  customer: [SUMMARY, { key: 'segment', label: 'Segment', widget: 'text' }, TAGS],
  theme: [SUMMARY, TAGS],
  person: [
    SUMMARY,
    { key: 'role', label: 'Role', widget: 'text' },
    { key: 'cares_about', label: 'Cares about', widget: 'tags' },
    { key: 'last_told', label: 'Last told', widget: 'date' },
    TAGS,
  ],
  session: [SUMMARY, { key: 'skill', label: 'Skill', widget: 'text' }],
  todo: [
    SUMMARY,
    COMMITMENT,
    { key: 'due', label: 'Due', widget: 'date' },
    { key: 'owner', label: 'Waiting on', widget: 'text' },
    { key: 'resolved', label: 'Resolved', widget: 'date' },
    TAGS,
  ],
  // `skill` and `agent` have no entries: they render as purpose-built pages
  // (SkillAgentPage), never through PropertiesBlock — the frontmatter is the
  // app's machinery there, not something a person edits row by row.
  note: [SUMMARY, TAGS, PROCESSING],
  // External mirrors: re-sync owns the delivery facts, so they display but
  // never edit (a hand-flipped state is exactly the drift the sync exists to
  // catch, and main rejects the write anyway). Only the PO's own
  // summary/processing/tags stay live.
  //
  // `state_category` has no row at all: it is how the app colours the state
  // chip, and the chip is already on screen (the fact strip). Two rows, one
  // saying "In review" and one saying "In progress", only ask the reader which
  // one the tracker meant. See {@link HIDDEN_KEYS}.
  ticket: [
    SUMMARY,
    { key: 'state', label: 'Tracker state', widget: 'readonly' },
    { key: 'assignee', label: 'Assignee', widget: 'readonly' },
    { key: 'remote_updated', label: 'Changed in the tracker', widget: 'readonly' },
    TAGS,
    PROCESSING,
  ],
  wikipage: [
    SUMMARY,
    { key: 'version', label: 'Version', widget: 'readonly' },
    { key: 'remote_updated', label: 'Changed in the wiki', widget: 'readonly' },
    TAGS,
    PROCESSING,
  ],
};

/**
 * The fact strip: the few facts a reader opens this type of note for, rendered
 * in one glanceable row under the title. Everything else, this included, lives
 * in the Details fold. A key with no value on the note is skipped, so the strip
 * only ever states what is true. Mirrors add their open-at-the-provider door;
 * `processing: stale` adds the amber flag on every type, listed here or not.
 */
export const FACTS: Partial<Record<NoteType, string[]>> = {
  ticket: ['state', 'assignee', 'remote_updated'],
  wikipage: ['remote_updated'],
  meeting: ['date', 'participants'],
  decision: ['date', 'deciders'],
  todo: ['due', 'owner'],
  customer: ['segment'],
  person: ['role'],
  insight: ['confidence'],
  source: ['origin', 'captured'],
};

/** Ref-array frontmatter keys shown read-only as chips. */
export const REF_FIELDS = [
  'evidence',
  'sources',
  'supersedes',
  'superseded_by',
  'theme',
  'customer',
  'transcript',
] as const;

/**
 * What a ref field is CALLED on screen, where the field name is not the word.
 * `evidence` and `sources` are two channels in the pipeline (one is
 * resolution-checked, the other self-heals) and one thing to a reader: where
 * this came from. They render under the same heading, and a note carrying both
 * gets one list. The keys on disk do not move.
 */
export const REF_LABELS: Record<string, string> = {
  evidence: 'Sources',
  sources: 'Sources',
};

/**
 * Frontmatter the panel never draws a row for. Each is machinery that already
 * says what it means somewhere the reader is looking anyway:
 *
 * - `state_category`: the colour of the ticket's state chip;
 * - `needs_summary`: a note to the next session. The summary above was lifted
 *   from the body and still owes the note a real one. "Needs summary: true" is
 *   the pass talking to itself, and it read as a demand on the PM;
 * - `broken_frontmatter`: one plain sentence replaces it (PropertiesBlock),
 *   because a wall of raw YAML in a value column explains nothing;
 * - `relationship` (a customer) and `stance` (a theme): two vocabularies with
 *   no code behind them. Every other lifecycle changes what the app does:
 *   `processing` picks what the attention lists ask about, `standing` strikes a
 *   superseded decision, `commitment` is the todo. Nothing branches on whether
 *   a customer is a prospect or a theme is being watched, so the two rows only
 *   asked the PO to keep a word true for us. The agent reads them and writes
 *   them; they are worth more in the file than on the screen.
 *
 * Hidden, not dropped: the keys stay in the file, and the agent still reads them.
 */
export const HIDDEN_KEYS = new Set<string>([
  'state_category',
  'needs_summary',
  'broken_frontmatter',
  'relationship',
  'stance',
]);

/**
 * Frontmatter the harness/domain writes, not the human: session receipt fields
 * (@qale/domain zSession), the decision spine back-pointers, sync provenance.
 * Shown like any other row but never one-click deletable — losing a receipt's
 * `reads`/`writes` or a spine pointer to a stray hover-X breaks the audit
 * trail. (The spine/transcript keys usually render as ref chips already; they
 * are listed here so they stay protected if they ever surface as custom rows.)
 */
export const SYSTEM_KEYS = new Set<string>([
  'session_id',
  'started',
  'ended',
  'reads',
  'writes',
  'source_meeting',
  'supersedes',
  'superseded_by',
  'transcript',
  'source',
]);
