import type { ProblemStance } from '../notes/frontmatter.js';

/**
 * Problem "evidence heat" (PLAN-V2 §3.1) — problems (the durable hubs that
 * absorbed themes) are ranked by how much evidence they carry and how fresh it
 * is: count + newest-evidence date, not a decayed score. Evidence accrues even on
 * a `wont-do` stance (we keep the why).
 */
export interface EvidenceHeat {
  count: number;
  newest: string | null;
}

export function computeHeat(evidenceDates: (string | null | undefined)[]): EvidenceHeat {
  const dates = evidenceDates.filter((d): d is string => typeof d === 'string' && d.length > 0);
  const newest = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
  return { count: evidenceDates.length, newest };
}

/** Sort comparator: hotter problems first (more evidence, then newer). */
export function byHeat(a: EvidenceHeat, b: EvidenceHeat): number {
  if (b.count !== a.count) return b.count - a.count;
  return (b.newest ?? '').localeCompare(a.newest ?? '');
}

export const STANCE_ORDER: ProblemStance[] = ['committed', 'watching', 'exploring', 'wont-do'];
