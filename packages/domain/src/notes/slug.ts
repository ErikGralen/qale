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

/** The final path segment (basename without extension). */
export function basename(slug: string): string {
  const s = slugFromPath(slug);
  const idx = s.lastIndexOf('/');
  return idx === -1 ? s : s.slice(idx + 1);
}

/** Strip an alias (`target|alias`) and heading anchor (`target#heading`). */
export function normalizeLinkTarget(raw: string): { target: string; anchor?: string; alias?: string } {
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
  return { target: slugFromPath(rest), anchor, alias };
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

/** Lowercase-kebab, filename-safe slug of a title/summary line. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
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
