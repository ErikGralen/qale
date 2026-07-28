import type { NoteType } from '@pm/ipc';

/**
 * Frontmatter is never hand-written (PLAN-V2 §3.1): the properties panel renders
 * it as a form. These descriptors mirror the per-folder zod schema in @pm/domain
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

export interface FieldSpec {
  key: string;
  label: string;
  widget: Widget;
  options?: readonly string[];
}

const SUMMARY: FieldSpec = { key: 'summary', label: 'Summary', widget: 'textarea' };
const TAGS: FieldSpec = { key: 'tags', label: 'Tags', widget: 'tags' };
/** Generic lifecycle status — mirrors NOTE_STATUSES in @pm/domain (enum, never free text). */
const STATUS: FieldSpec = {
  key: 'status',
  label: 'Status',
  widget: 'select',
  options: ['new', 'processed', 'active', 'stale'],
};

export const FIELDS: Record<NoteType, FieldSpec[]> = {
  source: [
    SUMMARY,
    STATUS,
    { key: 'captured', label: 'Captured', widget: 'date' },
    { key: 'updated', label: 'Last synced', widget: 'date' },
    { key: 'origin', label: 'Origin (whose material)', widget: 'text' },
    TAGS,
  ],
  meeting: [
    SUMMARY,
    STATUS,
    { key: 'date', label: 'Date', widget: 'date' },
    { key: 'participants', label: 'Participants', widget: 'people' },
    { key: 'series', label: 'Series', widget: 'text' },
    TAGS,
  ],
  decision: [
    SUMMARY,
    { key: 'status', label: 'Status', widget: 'select', options: ['active', 'superseded'] },
    { key: 'date', label: 'Date', widget: 'date' },
    { key: 'deciders', label: 'Deciders', widget: 'people' },
    TAGS,
  ],
  insight: [
    SUMMARY,
    STATUS,
    { key: 'confidence', label: 'Confidence', widget: 'select', options: ['high', 'med', 'low'] },
    TAGS,
  ],
  customer: [
    SUMMARY,
    { key: 'status', label: 'Status', widget: 'select', options: ['prospect', 'active', 'churned'] },
    { key: 'segment', label: 'Segment', widget: 'text' },
    TAGS,
  ],
  theme: [
    SUMMARY,
    { key: 'stance', label: 'Stance', widget: 'select', options: ['exploring', 'watching', 'committed', 'wont-do'] },
    TAGS,
  ],
  person: [
    SUMMARY,
    { key: 'role', label: 'Role', widget: 'text' },
    { key: 'cares_about', label: 'Cares about', widget: 'tags' },
    { key: 'last_told', label: 'Last told', widget: 'date' },
    TAGS,
  ],
  session: [SUMMARY, { key: 'session_type', label: 'Session type', widget: 'text' }],
  todo: [
    SUMMARY,
    { key: 'status', label: 'Status', widget: 'select', options: ['open', 'done', 'dropped'] },
    { key: 'due', label: 'Due', widget: 'date' },
    { key: 'owner', label: 'Waiting on', widget: 'text' },
    { key: 'resolved', label: 'Resolved', widget: 'date' },
    TAGS,
  ],
  skill: [
    SUMMARY,
    { key: 'skill_kind', label: 'Kind', widget: 'select', options: ['session', 'voice', 'filing', 'guide', 'reaction'] },
    TAGS,
  ],
  note: [SUMMARY, STATUS, TAGS],
  // External mirrors: re-sync owns the delivery facts, so they display but
  // never edit (a hand-flipped state_category is exactly the drift the sync
  // exists to catch, and main rejects the write anyway). Only the PO's own
  // summary/status/tags stay live.
  ticket: [
    SUMMARY,
    STATUS,
    { key: 'state', label: 'State (as in tracker)', widget: 'readonly' },
    { key: 'state_category', label: 'State category', widget: 'readonly' },
    { key: 'assignee', label: 'Assignee', widget: 'readonly' },
    { key: 'remote_updated', label: 'Changed upstream', widget: 'readonly' },
    TAGS,
  ],
  wikipage: [
    SUMMARY,
    STATUS,
    { key: 'version', label: 'Version', widget: 'readonly' },
    { key: 'remote_updated', label: 'Changed upstream', widget: 'readonly' },
    TAGS,
  ],
};

/** Ref-array frontmatter keys shown read-only as chips. */
export const REF_FIELDS = ['evidence', 'sources', 'supersedes', 'superseded_by', 'theme', 'customer', 'transcript'] as const;

/**
 * Frontmatter the harness/domain writes, not the human: session receipt fields
 * (@pm/domain zSession), the decision spine back-pointers, sync provenance.
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
