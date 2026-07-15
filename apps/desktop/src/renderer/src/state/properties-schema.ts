import type { NoteType } from '@pm/ipc';

/**
 * Frontmatter is never hand-written (PLAN-V2 §3.1): the properties panel renders
 * it as a form. These descriptors mirror the per-folder zod schema in @pm/domain
 * (the authority — writes are re-validated main-side via note:saveFrontmatter).
 * Ref arrays (evidence/sources/supersedes) are shown read-only; they are edited
 * through links and cards, not typed by hand.
 */
export type Widget = 'text' | 'textarea' | 'select' | 'tags' | 'date' | 'bool';

export interface FieldSpec {
  key: string;
  label: string;
  widget: Widget;
  options?: readonly string[];
}

const SUMMARY: FieldSpec = { key: 'summary', label: 'Summary', widget: 'textarea' };
const TAGS: FieldSpec = { key: 'tags', label: 'Tags', widget: 'tags' };
const LAST_VERIFIED: FieldSpec = { key: 'last_verified', label: 'Last verified', widget: 'date' };
const FRESH_FOR: FieldSpec = { key: 'fresh_for', label: 'Fresh for (e.g. 90d)', widget: 'text' };

export const FIELDS: Record<NoteType, FieldSpec[]> = {
  meeting: [
    SUMMARY,
    { key: 'date', label: 'Date', widget: 'date' },
    { key: 'participants', label: 'Participants', widget: 'tags' },
    { key: 'safe_space', label: 'Safe space (private)', widget: 'bool' },
    TAGS,
  ],
  decision: [
    SUMMARY,
    { key: 'status', label: 'Status', widget: 'select', options: ['active', 'superseded'] },
    { key: 'date', label: 'Date', widget: 'date' },
    { key: 'deciders', label: 'Deciders', widget: 'tags' },
    LAST_VERIFIED,
    FRESH_FOR,
    TAGS,
  ],
  insight: [
    SUMMARY,
    { key: 'confidence', label: 'Confidence', widget: 'select', options: ['high', 'med', 'low'] },
    LAST_VERIFIED,
    FRESH_FOR,
    TAGS,
  ],
  customer: [
    SUMMARY,
    { key: 'status', label: 'Status', widget: 'select', options: ['prospect', 'active', 'churned'] },
    { key: 'segment', label: 'Segment', widget: 'text' },
    LAST_VERIFIED,
    FRESH_FOR,
    TAGS,
  ],
  problem: [
    SUMMARY,
    { key: 'stance', label: 'Stance', widget: 'select', options: ['exploring', 'watching', 'committed', 'wont-do'] },
    LAST_VERIFIED,
    FRESH_FOR,
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
    LAST_VERIFIED,
    TAGS,
  ],
  session: [SUMMARY, { key: 'session_type', label: 'Session type', widget: 'text' }],
  skill: [
    SUMMARY,
    { key: 'skill_kind', label: 'Kind', widget: 'select', options: ['session', 'voice', 'filing'] },
    TAGS,
  ],
  note: [SUMMARY, LAST_VERIFIED, FRESH_FOR, TAGS],
};

/** Ref-array frontmatter keys shown read-only as chips. */
export const REF_FIELDS = ['evidence', 'sources', 'supersedes', 'superseded_by', 'problem', 'customer'] as const;
