import { slugFromPath, titleForRef } from '@qale/domain';

const VAULT_FOLDERS = [
  'sources',
  'meetings',
  'decisions',
  'insights',
  'customers',
  'research',
  'about',
  'people',
  'sessions',
  'skills',
  'agents',
  'todos',
  'notes',
  'tickets',
  'wikipages',
] as const;

const BARE_PATH_RE = new RegExp(
  `(^|[\\s,;:])((?:${VAULT_FOLDERS.join('|')})/[\\w./-]+)\\b`,
  'gim',
);

/**
 * Wrap a bare vault-path citation (todos/henrik-review-swap-notifications,
 * decisions/adopt-workos.md) in a wikilink so it renders clickable. Skips
 * paths already inside wikilinks or markdown link parens (those are preceded
 * by `[` / `(`, which the prefix class excludes).
 */
export function linkifyNotePaths(text: string): string {
  return text.replace(BARE_PATH_RE, '$1[[$2]]');
}

/** Rewrite prose only — a fenced block is data (a proposal payload, a diff) and
 *  stays exactly as written, paths and all. */
export function outsideCode(text: string, rewrite: (chunk: string) => string): string {
  return text
    .split(/(```[\s\S]*?```)/)
    .map((chunk, i) => (i % 2 === 1 ? chunk : rewrite(chunk)))
    .join('');
}

/**
 * What a link with no alias prints: the note's own name, never its storage
 * path. The tree is asked first, so the chip says word for word what the
 * sidebar says.
 *
 * Two rows can't be used as a name, and both are real. A note the tree does
 * not hold yet is one (a page a session is still proposing). A row whose title
 * is blank or is the slug itself is the other: a calendar mirror has no
 * `title:` in its frontmatter, so its name is derived rather than read. Either
 * way the name comes off the slug, which is what the sidebar shows too.
 */
export function noteLinkTitle(target: string, titleBySlug: ReadonlyMap<string, string>): string {
  const slug = slugFromPath(target);
  const fromTree = titleBySlug.get(slug)?.trim();
  if (fromTree && fromTree !== slug && fromTree !== target) return fromTree;
  return titleForRef(target) || target;
}
