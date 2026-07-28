import { linkTypeToken } from './link-types.js';
import { asciiFold, basename, normalizeLinkTarget, slugify } from './slug.js';

/**
 * Deterministic link repair (the librarian's work-ahead pass): given a wikilink
 * target that resolves to nothing, find the note it almost certainly meant —
 * renames, case/kebab drift, date-prefixed files, typos — and build the
 * search/replace patch that repoints every body occurrence. Pure functions; the
 * sweep turns the result into an approval card, so a wrong guess costs one
 * Discard click, never a silent write. Ambiguity returns null: two plausible
 * targets is a conversation, not a suggestion.
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
 * The likely intended slug for a dangling target, or null when no candidate is
 * confident AND unique: the strongest tier must have exactly one hit, otherwise
 * the finding needs the PO's judgment.
 */
export function suggestLinkTarget(target: string, candidates: LinkRepairCandidate[]): string | null {
  const hits = tierHits(target, candidates);
  return hits.length === 1 ? hits[0]!.slug : null;
}

/**
 * Ranked plausible targets for a dangling link when no single candidate is
 * confident — the librarian's "did you mean…?" options. Empty when nothing is
 * plausible: that finding really is a conversation.
 */
export function suggestLinkCandidates(
  target: string,
  candidates: LinkRepairCandidate[],
  max = 3,
): LinkRepairCandidate[] {
  return tierHits(target, candidates).slice(0, max);
}

/** Regex-escape a literal string. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A title mentioned as plain text, not letter/digit-embedded and not on a line
 * that already carries a wikilink (conservative: never patch near existing
 * links). Titles under 4 chars are too ambiguous to count as mentions.
 */
function mentionRe(title: string): RegExp | null {
  const clean = title.trim();
  if (clean.length < 4) return null;
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRe(clean)})(?![\\p{L}\\p{N}])`, 'iu');
}

/**
 * Body lines where `title` appears as an unlinked plain-text mention — the
 * evidence that an orphan note is already part of the story, just not wired in.
 */
export function findUnlinkedMentions(body: string, title: string): string[] {
  const re = mentionRe(title);
  if (!re) return [];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const line of body.split('\n')) {
    if (line.includes('[[') || line.startsWith('---')) continue;
    if (!re.test(line)) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines;
}

/**
 * Search/replace blocks wrapping the first plain-text mention of `title` per
 * line in a wikilink to `slug`, original casing preserved via alias. Empty when
 * nothing qualifies — the caller falls back to a conversation.
 */
export function buildMentionLinkPatch(
  body: string,
  title: string,
  slug: string,
): { search: string; replace: string }[] {
  const re = mentionRe(title);
  if (!re) return [];
  return findUnlinkedMentions(body, title).map((line) => {
    const replace = line.replace(re, (_m, pre: string, text: string) =>
      `${pre}[[${slug}${text === basename(slug) ? '' : `|${text}`}]]`,
    );
    return { search: line, replace };
  });
}

const WIKILINK = /\[\[([^\]]+)\]\]/g;

/**
 * Search/replace blocks repointing every body occurrence of `oldTarget` at
 * `newSlug`, aliases and anchors preserved. Empty when the link only lives in
 * frontmatter (a body patch can't reach it — leave that to a session).
 * Duplicate occurrences are safe with sequential indexOf application: each
 * block's replacement differs from its search, so the cursor advances.
 */
export function buildLinkRepairPatch(
  body: string,
  oldTarget: string,
  newSlug: string,
): { search: string; replace: string }[] {
  const blocks: { search: string; replace: string }[] = [];
  WIKILINK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKILINK.exec(body)) !== null) {
    const { target, anchor, alias, linkType, reversed } = normalizeLinkTarget(match[1] ?? '');
    if (target !== oldTarget) continue;
    // Re-emit the type in the author's direction — a repair must repoint the
    // link, never silently strip its relationship.
    const type = linkType ? `${linkTypeToken(linkType, reversed)}::` : '';
    const replace = `[[${type}${newSlug}${anchor ? `#${anchor}` : ''}${alias ? `|${alias}` : ''}]]`;
    if (match[0] === replace) continue;
    blocks.push({ search: match[0], replace });
  }
  return blocks;
}
