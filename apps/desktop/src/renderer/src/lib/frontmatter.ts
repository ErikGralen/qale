/** Drop a leading YAML frontmatter block (optional BOM, CRLF tolerant) so a
 *  raw file renders as clean prose. */
export function stripFrontmatter(md: string): string {
  const m = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(md);
  return m ? md.slice(m[0].length).replace(/^\s+/, '') : md;
}

/**
 * The note a frontmatter ref points at: `"[[decisions/foo]]"` → `decisions/foo`.
 *
 * Null for anything that is not a wikilink, which is how an external ref (a
 * Jira key, a URL) says "there is no note behind me". Three screens read the
 * same refs (`supersedes`, `owner`, `sources`), so the parse is written once.
 */
export function refSlug(ref: string): string | null {
  const m = /^\[\[([^\]]+)\]\]$/.exec(ref.trim());
  return m?.[1] ?? null;
}
