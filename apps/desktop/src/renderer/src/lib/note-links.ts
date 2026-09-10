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
