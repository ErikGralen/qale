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
}

const SUMMARY: FieldSpec = { key: 'summary', label: 'Summary', widget: 'textarea' };
const TAGS: FieldSpec = { key: 'tags', label: 'Tags', widget: 'tags' };

/**
 * Lifecycle rows. Each type carries its OWN lifecycle under its own name, so no
 * two of them ever appear as "Status" (see NOTE_LIFECYCLES in @qale/domain, the
 * authority these mirror). Values are enums, never free text.
 */
const PROCESSING: FieldSpec = {
  key: 'processing',
  label: 'Processing',
  widget: 'select',
  options: [
    { value: 'new', label: 'New' },
    { value: 'processed', label: 'Processed' },
    { value: 'stale', label: 'Stale' },
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
const RELATIONSHIP: FieldSpec = {
  key: 'relationship',
  label: 'Relationship',
  widget: 'select',
  options: [
    { value: 'prospect', label: 'Prospect' },
    { value: 'active', label: 'Active' },
    { value: 'churned', label: 'Churned' },
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
const STANCE: FieldSpec = {
  key: 'stance',
  label: 'Stance',
  widget: 'select',
  options: [
    { value: 'exploring', label: 'Exploring' },
    { value: 'watching', label: 'Watching' },
    { value: 'committed', label: 'Committed' },
    { value: 'wont-do', label: "Won't do" },
  ],
};

export const FIELDS: Partial<Record<NoteType, FieldSpec[]>> & { note: FieldSpec[] } = {
  source: [
    SUMMARY,
    PROCESSING,
    { key: 'captured', label: 'Captured', widget: 'date' },
    { key: 'updated', label: 'Last synced', widget: 'date' },
    { key: 'origin', label: 'Origin (whose material)', widget: 'text' },
    TAGS,
  ],
  meeting: [
    SUMMARY,
    PROCESSING,
    { key: 'date', label: 'Date', widget: 'date' },
    { key: 'participants', label: 'Participants', widget: 'people' },
    { key: 'series', label: 'Series', widget: 'text' },
    TAGS,
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
    PROCESSING,
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
  ],
  customer: [
    SUMMARY,
    RELATIONSHIP,
    { key: 'segment', label: 'Segment', widget: 'text' },
    TAGS,
  ],
  theme: [
    SUMMARY,
    STANCE,
    TAGS,
  ],
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
  note: [SUMMARY, PROCESSING, TAGS],
  // External mirrors: re-sync owns the delivery facts, so they display but
  // never edit (a hand-flipped state_category is exactly the drift the sync
  // exists to catch, and main rejects the write anyway). Only the PO's own
  // summary/processing/tags stay live.
  ticket: [
    SUMMARY,
    PROCESSING,
    { key: 'state', label: 'State (as in tracker)', widget: 'readonly' },
    {
      key: 'state_category',
      label: 'State category',
      widget: 'readonly',
      options: [
        { value: 'open', label: 'Open' },
        { value: 'in_progress', label: 'In progress' },
        { value: 'blocked', label: 'Blocked' },
        { value: 'done', label: 'Done' },
      ],
    },
    { key: 'assignee', label: 'Assignee', widget: 'readonly' },
    { key: 'remote_updated', label: 'Changed upstream', widget: 'readonly' },
    TAGS,
  ],
  wikipage: [
    SUMMARY,
    PROCESSING,
    { key: 'version', label: 'Version', widget: 'readonly' },
    { key: 'remote_updated', label: 'Changed upstream', widget: 'readonly' },
    TAGS,
  ],
};

/** Ref-array frontmatter keys shown read-only as chips. */
export const REF_FIELDS = ['evidence', 'sources', 'supersedes', 'superseded_by', 'theme', 'customer', 'transcript'] as const;

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
