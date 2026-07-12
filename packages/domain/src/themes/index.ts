import type { ThemeStance } from '../notes/frontmatter.js';

/**
 * Theme "evidence heat" (PLAN §3, Phase 3): themes are ranked by how much
 * evidence they carry and how fresh it is — count + newest-signal date, not a
 * decayed score (decay is deferred, PLAN §7). Evidence accrues even on wont-do.
 */
export interface EvidenceHeat {
  count: number;
  newest: string | null;
}

export function computeHeat(evidenceCapturedDates: (string | null | undefined)[]): EvidenceHeat {
  const dates = evidenceCapturedDates.filter((d): d is string => typeof d === 'string' && d.length > 0);
  const newest = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
  return { count: evidenceCapturedDates.length, newest };
}

/** Sort comparator: hotter themes first (more evidence, then newer). */
export function byHeat(a: EvidenceHeat, b: EvidenceHeat): number {
  if (b.count !== a.count) return b.count - a.count;
  return (b.newest ?? '').localeCompare(a.newest ?? '');
}

export const STANCE_ORDER: ThemeStance[] = ['committed', 'watching', 'exploring', 'wont-do'];
