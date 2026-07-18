import type { NoteType } from '@pm/ipc';

/**
 * Frontmatter is never hand-written (PLAN-V2 §3.1): the properties panel renders
 * it as a form. These descriptors mirror the per-folder zod schema in @pm/domain
 * (the authority — writes are re-validated main-side via note:saveFrontmatter).
 * Ref arrays (evidence/sources/supersedes) are shown read-only; they are edited
 * through links and cards, not typed by hand.
 */
export type Widget = 'text' | 'textarea' | 'select' | 'tags' | 'date';

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
    { key: 'participants', label: 'Participants', widget: 'tags' },
    { key: 'series', label: 'Series', widget: 'text' },
    TAGS,
  ],
  decision: [
    SUMMARY,
    { key: 'status', label: 'Status', widget: 'select', options: ['active', 'superseded'] },
    { key: 'date', label: 'Date', widget: 'date' },
    { key: 'deciders', label: 'Deciders', widget: 'tags' },
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
  problem: [
    SUMMARY,
    { key: 'stance', label: 'Stance', widget: 'select', options: ['exploring', 'watching', 'committed', 'wont-do'] },
    TAGS,
  ],
  release: [
    SUMMARY,
    { key: 'status', label: 'Status', widget: 'select', options: ['planned', 'shipped'] },
    { key: 'date', label: 'Date', widget: 'date' },
    { key: 'audiences', label: 'Audiences', widget: 'tags' },
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
};

/** Ref-array frontmatter keys shown read-only as chips. */
export const REF_FIELDS = ['evidence', 'sources', 'supersedes', 'superseded_by', 'problem', 'customer', 'transcript'] as const;
