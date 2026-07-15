import type { NoteQueryDTO } from '@pm/ipc';

/**
 * Smart views (PLAN-V2 §3.3) — saved frontmatter queries pinned above the tree.
 * Views are how you navigate; the tree is how you orient. Structured filters
 * only, no user-facing query syntax (open decision §6). User-savable views land
 * later; these four built-ins ship now.
 */
export type SmartViewId = 'needs-review' | 'stale' | 'this-week' | 'decisions';

export interface SmartView {
  label: string;
  description: string;
  query: NoteQueryDTO;
}

export const SMART_VIEWS: Record<SmartViewId, SmartView> = {
  'needs-review': {
    label: 'Needs review',
    description: 'Tracked claims never verified — the memory has not been confirmed yet.',
    query: { unverified: true, limit: 200 },
  },
  stale: {
    label: 'Stale claims',
    description: 'Claims past their decay clock — the nightly sweep flags these for re-verification.',
    query: { stale: true, limit: 200 },
  },
  'this-week': {
    label: 'This week',
    description: 'Everything touched in the last 7 days.',
    query: { recentDays: 7, limit: 200 },
  },
  decisions: {
    label: 'Active decisions',
    description: 'The live decision spine (non-superseded).',
    query: { types: ['decision'], status: 'active', limit: 200 },
  },
};

export const SMART_VIEW_ORDER: SmartViewId[] = ['needs-review', 'stale', 'this-week', 'decisions'];
