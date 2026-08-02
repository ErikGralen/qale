import type { NoteType } from './frontmatter.js';

/**
 * What each note type IS, over time. {@link ./edit-layer.ts} answers who owns the
 * text; this answers where the note stands.
 *
 * Every type used to carry one polymorphic `status` key, so `active` meant three
 * unrelated things at once (a source that is current, a decision that still
 * stands, a customer who is paying) and every surface labelled all three
 * "Status". Themes already had it right with `stance`, so the fix is that shape
 * everywhere: one field name per lifecycle, one hard-coded enum per field, one
 * human label per value. Nothing here is configurable and nothing is generic;
 * adding a lifecycle is an entry in this file and a key on the type's schema.
 *
 * Types with no lifecycle (person, session, skill) simply have none. A note that
 * never moves through states should not be made to look like it does.
 */

/**
 * How far a piece of material has got through the workspace. Shared, on purpose,
 * by every type whose lifecycle really is this one question: sources, meetings,
 * insights, plain notes, and the two external mirrors.
 * - `new`, arrived (captured, synced, re-synced) and not yet worked;
 * - `processed`, the analyses ran and their truth delta landed;
 * - `stale`, needs another pass because something it cites moved upstream.
 * A re-sync or a fresh transcript resets it to `new`, which is what makes
 * "needs review" answerable without a second bookkeeping field.
 */
export const PROCESSING_STATES = ['new', 'processed', 'stale'] as const;
export type ProcessingState = (typeof PROCESSING_STATES)[number];

/** Whether a decision still stands. It is superseded, never edited. */
export const DECISION_STANDINGS = ['active', 'superseded'] as const;
export type DecisionStanding = (typeof DECISION_STANDINGS)[number];

/** Where a customer stands with us. */
export const CUSTOMER_RELATIONSHIPS = ['prospect', 'active', 'churned'] as const;
export type CustomerRelationship = (typeof CUSTOMER_RELATIONSHIPS)[number];

/**
 * Whether a commitment is still outstanding. `done` and `dropped` both close it
 * but stay in the workspace: the ledger accretes, it never deletes.
 */
export const TODO_COMMITMENTS = ['open', 'done', 'dropped'] as const;
export type TodoCommitment = (typeof TODO_COMMITMENTS)[number];

/**
 * What we currently believe about a theme. `watching` is the someday shelf and
 * `wont-do` is a deliberate decline that KEEPS accreting evidence. Neither has a
 * ticket, which is precisely why they need a home the workspace owns.
 */
export const THEME_STANCES = ['exploring', 'watching', 'committed', 'wont-do'] as const;
export type ThemeStance = (typeof THEME_STANCES)[number];

export interface Lifecycle {
  /** The frontmatter key, e.g. "standing". Never "status". */
  field: string;
  /** The row label a surface prints, sentence case. */
  label: string;
  values: readonly string[];
  /** Human label per value, so no surface ever prints a raw token. */
  valueLabels: Readonly<Record<string, string>>;
  /**
   * Values an older vault wrote under `status:` that fold onto a current one.
   * Read-side only, see {@link normalizeLifecycleKeys}.
   */
  aliases?: Readonly<Record<string, string>>;
}

const PROCESSING: Lifecycle = {
  field: 'processing',
  label: 'Processing',
  values: PROCESSING_STATES,
  valueLabels: { new: 'New', processed: 'Processed', stale: 'Stale' },
  // The old generic enum also had `active`, which only ever meant "we are done
  // with it and rely on it" — that is `processed` under a name borrowed from two
  // other lifecycles, which is the confusion this whole file exists to end.
  aliases: { active: 'processed' },
};

const STANDING: Lifecycle = {
  field: 'standing',
  label: 'Standing',
  values: DECISION_STANDINGS,
  valueLabels: { active: 'Active', superseded: 'Superseded' },
};

const RELATIONSHIP: Lifecycle = {
  field: 'relationship',
  label: 'Relationship',
  values: CUSTOMER_RELATIONSHIPS,
  valueLabels: { prospect: 'Prospect', active: 'Active', churned: 'Churned' },
};

const COMMITMENT: Lifecycle = {
  field: 'commitment',
  label: 'Commitment',
  values: TODO_COMMITMENTS,
  valueLabels: { open: 'Open', done: 'Done', dropped: 'Dropped' },
};

const STANCE: Lifecycle = {
  field: 'stance',
  label: 'Stance',
  values: THEME_STANCES,
  valueLabels: {
    exploring: 'Exploring',
    watching: 'Watching',
    committed: 'Committed',
    'wont-do': "Won't do",
  },
};

/**
 * THE table: which lifecycle each note type carries, or `null` for none.
 *
 * Machine-owned state fields are deliberately absent, because they are not
 * lifecycles the PM moves a note through: a meeting's `event_status` is Google's
 * word for its own event (including `cancelled`), a ticket's `state` /
 * `state_category` is the tracker's workflow, and a wikipage's `version` is
 * Confluence's counter. Those stay read-only sync facts under their own labels.
 */
export const NOTE_LIFECYCLES: Record<NoteType, Lifecycle | null> = {
  source: PROCESSING,
  meeting: PROCESSING,
  decision: STANDING,
  insight: PROCESSING,
  customer: RELATIONSHIP,
  theme: STANCE,
  person: null,
  session: null,
  skill: null,
  agent: null,
  todo: COMMITMENT,
  note: PROCESSING,
  ticket: PROCESSING,
  wikipage: PROCESSING,
};

/** The lifecycle a type carries, or null when it carries none. */
export function lifecycleFor(type: NoteType): Lifecycle | null {
  return NOTE_LIFECYCLES[type] ?? null;
}

/** The frontmatter key holding this type's lifecycle, e.g. `"relationship"`. */
export function lifecycleField(type: NoteType): string | null {
  return lifecycleFor(type)?.field ?? null;
}

/** This note's lifecycle value, whatever its lifecycle happens to be called. */
export function lifecycleValue(
  type: NoteType,
  frontmatter: Readonly<Record<string, unknown>> | null | undefined,
): string | null {
  const field = lifecycleField(type);
  if (!field || !frontmatter) return null;
  const v = frontmatter[field];
  return typeof v === 'string' && v !== '' ? v : null;
}

/** Title-case a token the table doesn't know ("in_progress" → "In progress"). */
function fallbackLabel(value: string): string {
  const words = value.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The human label for a lifecycle value: `"wont-do"` → `"Won't do"`. */
export function lifecycleValueLabel(type: NoteType | null, value: string): string {
  const lc = type ? lifecycleFor(type) : null;
  return lc?.valueLabels[value] ?? fallbackLabel(value);
}

/**
 * Compat read for vaults written before lifecycles had their own names. A note
 * on disk still says `status: processed`; this moves that value onto the type's
 * own key (and folds a retired value onto its replacement) so existing vaults
 * keep working with no migration script and nothing destroyed.
 *
 * Deliberately conservative. The rename only happens when the value is one this
 * type's lifecycle actually recognises, so somebody else's `status: draft` on a
 * plain note survives untouched as the unknown key it always was. When both keys
 * are present the new one wins, since it is the one every writer sets now.
 *
 * Applied on every read ({@link ./frontmatter.ts} parseFrontmatter) and on every
 * write (the vault's writeNote), so `status:` fades out as notes are saved.
 */
export function normalizeLifecycleKeys(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const rec = input as Record<string, unknown>;
  const type = rec['type'];
  if (typeof type !== 'string' || !(type in NOTE_LIFECYCLES)) return input;
  const lc = lifecycleFor(type as NoteType);
  if (!lc || lc.field === 'status') return input;

  const legacy = rec['status'];
  if (typeof legacy !== 'string') return input;
  const mapped = lc.aliases?.[legacy] ?? (lc.values.includes(legacy) ? legacy : null);
  if (mapped === null) return input;

  const out = { ...rec };
  delete out['status'];
  if (typeof out[lc.field] !== 'string') out[lc.field] = mapped;
  return out;
}
