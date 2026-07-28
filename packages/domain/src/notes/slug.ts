import { normalizeLinkType } from './link-types.js';

/**
 * Slug / path / wikilink helpers. A slug is the vault-relative path without the
 * `.md` extension (e.g. `signals/2026-07-12-gong-sso`). Wikilinks target slugs,
 * possibly by their shortest unique tail (Obsidian shortest-path).
 */

export function slugFromPath(path: string): string {
  return path.replace(/\.md$/i, '');
}

/**
 * Folder hub pages (`<dir>/index.md`) are navigation, not content — every
 * content listing (views, sweeps, agent listings) excludes them via this ONE
 * predicate.
 */
export function isFolderIndex(path: string): boolean {
  return path.endsWith('/index.md');
}

/**
 * Reserved filenames the OKF spec (§3.1) sets aside for orientation, not
 * content: `index.md` (directory map, §8) and `log.md` (update history, §9).
 * They may appear at the vault root (bare `index.md`) or inside any folder, so
 * this matches on the basename — unlike {@link isFolderIndex}, which only knows
 * folder hubs. Reserved files are exempt from the `type`-required rule and never
 * indexed as concept notes: they are read by path, not searched or listed.
 */
export const RESERVED_BASENAMES = ['index.md', 'log.md'] as const;

export function isReservedFile(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  return (RESERVED_BASENAMES as readonly string[]).includes(base);
}

/** The OKF spec version this workspace conforms to — stamped in the root index.md (§12). */
export const OKF_VERSION = '0.2';

/**
 * Where a session's own working files live (Sessions v2 Part 1).
 * `sessions/2026-07-28-synthesis-a1b2c3.md` is the session's git-tracked, indexed
 * *face*; `sessions/.files/a1b2c3/` is its untracked *body* — the relationship is
 * legible from the filesystem alone.
 *
 * The leading dot is what keeps it out of the memory for free: `FsVault.walk`
 * skips any entry whose name starts with `.` at every level, so nothing under
 * here is indexed, searched, retrieved, linkable or counted in freshness
 * (invariant 1). It is also seeded into the vault's `.gitignore`.
 */
export const SESSION_FILES_DIR = 'sessions/.files';

/** Is this vault-relative path inside some session's working files? */
export function isSessionFile(path: string): boolean {
  const p = path.replace(/^\.?\//, '');
  return p === SESSION_FILES_DIR || p.startsWith(`${SESSION_FILES_DIR}/`);
}

/** The final path segment (basename without extension). */
export function basename(slug: string): string {
  const s = slugFromPath(slug);
  const idx = s.lastIndexOf('/');
  return idx === -1 ? s : s.slice(idx + 1);
}

/**
 * Split a `type::target#heading|alias` wikilink inner text (docs/typed-links.md).
 * The type is optional; a malformed type prefix (empty side, unusable token)
 * degrades to an untyped link on the full text — a type never fails a parse.
 * Known inverse spellings canonicalize (`blocked-by::X` → type `blocks`,
 * `reversed`: the semantic edge runs target → source).
 */
export function normalizeLinkTarget(raw: string): {
  target: string;
  anchor?: string;
  alias?: string;
  linkType?: string;
  reversed?: boolean;
} {
  let rest = raw.trim();
  let alias: string | undefined;
  const pipe = rest.indexOf('|');
  if (pipe !== -1) {
    alias = rest.slice(pipe + 1).trim();
    rest = rest.slice(0, pipe).trim();
  }
  let anchor: string | undefined;
  const hash = rest.indexOf('#');
  if (hash !== -1) {
    anchor = rest.slice(hash + 1).trim();
    rest = rest.slice(0, hash).trim();
  }
  let linkType: string | undefined;
  let reversed: boolean | undefined;
  const sep = rest.indexOf('::');
  if (sep !== -1) {
    const typed = normalizeLinkType(rest.slice(0, sep));
    const after = rest.slice(sep + 2).trim();
    if (typed && after) {
      linkType = typed.type;
      if (typed.reversed) reversed = true;
      rest = after;
    }
  }
  return { target: slugFromPath(rest), anchor, alias, linkType, reversed };
}

const TITLE_CASE = /[-_]+/g;

/** Derive a human title from a slug's basename when no explicit title exists. */
export function titleFromSlug(slug: string): string {
  const name = basename(slug).replace(/^\d{4}-\d{2}-\d{2}-/, '');
  return name
    .replace(TITLE_CASE, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

const ASCII_FOLD: Record<string, string> = {
  ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ð: 'd', þ: 'th', đ: 'd', ł: 'l',
};

/** Transliterate diacritics to plain ASCII ('möte med åsa' → 'mote med asa'). */
export function asciiFold(text: string): string {
  return text.replace(/[^\x00-\x7f]/g, (ch) => {
    const mapped = ASCII_FOLD[ch] ?? ASCII_FOLD[ch.toLowerCase()];
    if (mapped !== undefined) return mapped;
    const stripped = ch.normalize('NFD').replace(/\p{M}+/gu, '');
    return stripped === ch ? ch : stripped;
  });
}

/** Lowercase-kebab, filename-safe slug of a title/summary line. */
export function slugify(text: string): string {
  return asciiFold(text.toLowerCase())
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 48)
    .replace(/-+$/, '');
}

/** A YYYY-MM-DD-slugified filename from a summary line, for capture. */
export function fileSlug(text: string, date: string): string {
  return `${date}-${slugify(text) || 'note'}`;
}
