/** Drop a leading YAML frontmatter block (optional BOM, CRLF tolerant) so a
 *  raw file renders as clean prose. */
export function stripFrontmatter(md: string): string {
  const m = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(md);
  return m ? md.slice(m[0].length).replace(/^\s+/, '') : md;
}
