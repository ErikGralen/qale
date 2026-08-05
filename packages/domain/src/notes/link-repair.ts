import { asciiFold, basename, slugify } from './slug.js';

/**
 * Fuzzy name matching for a wikilink that resolves to nothing: which existing
 * notes look like the one the author meant, across renames, case and kebab
 * drift, date-prefixed files and typos. This is retrieval a text search cannot
 * do, and that is all it is. The librarian's worklist carries the top few as a
 * "similar existing pages" hint per broken link; the agent reads the notes and
 * decides. Nothing here ever picks a target.
 */

export interface LinkRepairCandidate {
  /** Vault-relative slug (path without .md). */
  slug: string;
  title: string;
}

/** Lowercase-kebab form used for all comparisons ("Tom Devlin" ≈ tom-devlin). */
function norm(text: string): string {
  return asciiFold(text.toLowerCase())
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9/-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const row = [i];
    for (let j = 1; j <= n; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[n]!;
}

/**
 * All hits from the strongest matching tier, ordered by edit distance to the
 * dangling target. Tiers, strongest first:
 *  1. normalized slug/basename/title equality (case, spaces, punctuation drift)
 *  2. equality after stripping a YYYY-MM-DD- file prefix
 *  3. small typos (levenshtein ≤ 1, or ≤ 2 on names ≥ 8 chars)
 *  4. containment (`tom` → `tom-devlin`), target ≥ 4 chars
 */
function tierHits(target: string, candidates: LinkRepairCandidate[]): LinkRepairCandidate[] {
  const t = norm(basename(target));
  const tFull = norm(target);
  if (t.length === 0) return [];

  const tiers: ((c: LinkRepairCandidate, name: string) => boolean)[] = [
    (c, name) => name === t || norm(c.slug) === tFull || norm(slugify(c.title)) === t,
    (_c, name) => name.replace(DATE_PREFIX, '') === t.replace(DATE_PREFIX, ''),
    (_c, name) => {
      const max = Math.min(name.length >= 8 ? 2 : 1, Math.floor(name.length / 4));
      return max > 0 && levenshtein(name, t) <= max;
    },
    (_c, name) => t.length >= 4 && (name.includes(t) || t.includes(name)),
  ];

  for (const matches of tiers) {
    const hits = candidates.filter((c) => matches(c, norm(basename(c.slug))));
    if (hits.length > 0) {
      return hits
        .slice()
        .sort((a, b) => levenshtein(norm(basename(a.slug)), t) - levenshtein(norm(basename(b.slug)), t));
    }
  }
  return [];
}

/**
 * Ranked plausible targets for a dangling link, strongest tier first. Empty
 * when nothing is plausible, which is honest: a target nothing resembles is a
 * page that was never written, and saying so beats offering a near miss.
 */
export function suggestLinkCandidates(
  target: string,
  candidates: LinkRepairCandidate[],
  max = 3,
): LinkRepairCandidate[] {
  return tierHits(target, candidates).slice(0, max);
}
