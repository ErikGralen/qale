import { NOTE_TYPE_META, type Frontmatter, type NoteType } from './frontmatter.js';

/**
 * Freshness is first-class (PLAN-V2 §3.1). Every claim-like note decays on a
 * type-appropriate clock; a `fresh_for` frontmatter field overrides the per-type
 * default; `last_verified` is stamped when a human approves or re-verifies it.
 * A document's health = the share of its live claims that are still fresh — the
 * closest thing product work has to a failing test. Domain stays pure: callers
 * inject `now` (an ISO datetime); there is no ambient clock here.
 */

/** Default decay clock in days per type; null = does not decay (events, files). */
export const FRESHNESS_DEFAULTS: Record<NoteType, number | null> = {
  meeting: null,
  decision: 180,
  insight: 90,
  customer: 60,
  problem: 120,
  release: null,
  person: 90,
  session: null,
  skill: null,
  note: 120,
};

/** Whether a note type carries a freshness clock at all. */
export function hasFreshness(type: NoteType): boolean {
  return FRESHNESS_DEFAULTS[type] !== null;
}

/** Parse a duration like "90d", "12w", "6m", "1y" into days. */
export function parseDuration(spec: string | null | undefined): number | null {
  if (!spec) return null;
  const m = /^\s*(\d+)\s*([dwmy])\s*$/i.exec(spec);
  if (!m) return null;
  const n = Number(m[1]);
  switch (m[2]!.toLowerCase()) {
    case 'd':
      return n;
    case 'w':
      return n * 7;
    case 'm':
      return n * 30;
    case 'y':
      return n * 365;
    default:
      return null;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(fromISO);
  const b = Date.parse(toISO);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / DAY_MS);
}

export interface FreshnessState {
  /** Whether this type/note is subject to a decay clock. */
  tracked: boolean;
  /** Effective decay window in days (override or type default), null if untracked. */
  freshForDays: number | null;
  /** The reference date we measured from (last_verified, else null). */
  lastVerified: string | null;
  /** Age in days since last_verified, null if never verified. */
  ageDays: number | null;
  /** True when the claim is tracked, verified, and past its decay window. */
  stale: boolean;
  /** True when the claim is tracked but was never verified (no last_verified). */
  unverified: boolean;
}

/** Compute a note's freshness state relative to `now` (ISO datetime). */
export function computeFreshness(fm: Frontmatter, now: string): FreshnessState {
  const type = fm.type;
  const record = fm as Record<string, unknown>;
  const defaultDays = FRESHNESS_DEFAULTS[type];
  if (defaultDays === null) {
    return {
      tracked: false,
      freshForDays: null,
      lastVerified: null,
      ageDays: null,
      stale: false,
      unverified: false,
    };
  }
  const override = parseDuration(record['fresh_for'] as string | undefined);
  const freshForDays = override ?? defaultDays;
  const lastVerified =
    typeof record['last_verified'] === 'string' ? (record['last_verified'] as string) : null;

  // Superseded/archived claims are not "live" — never flag them stale.
  const dead = record['status'] === 'superseded' || record['status'] === 'archived';

  if (!lastVerified) {
    return {
      tracked: true,
      freshForDays,
      lastVerified: null,
      ageDays: null,
      stale: false,
      unverified: !dead,
    };
  }
  const ageDays = daysBetween(lastVerified, now);
  return {
    tracked: true,
    freshForDays,
    lastVerified,
    ageDays,
    stale: !dead && ageDays > freshForDays,
    unverified: false,
  };
}

export interface HealthScore {
  /** Live, freshness-tracked claims considered. */
  total: number;
  fresh: number;
  stale: number;
  unverified: number;
  /** fresh / total in [0,1]; 1 when there are no tracked claims. */
  score: number;
}

/**
 * Document/folder health: the share of live, tracked claims still fresh. An
 * unverified claim counts against health (it is not demonstrably true).
 */
export function computeHealth(notes: Frontmatter[], now: string): HealthScore {
  let total = 0;
  let fresh = 0;
  let stale = 0;
  let unverified = 0;
  for (const fm of notes) {
    const f = computeFreshness(fm, now);
    if (!f.tracked) continue;
    const record = fm as Record<string, unknown>;
    if (record['status'] === 'superseded' || record['status'] === 'archived') continue;
    total++;
    if (f.stale) stale++;
    else if (f.unverified) unverified++;
    else fresh++;
  }
  return { total, fresh, stale, unverified, score: total === 0 ? 1 : fresh / total };
}

/** Convenience: which type folders carry freshness, for sweep scoping. */
export const FRESHNESS_TRACKED_TYPES: NoteType[] = (
  Object.keys(NOTE_TYPE_META) as NoteType[]
).filter(hasFreshness);
