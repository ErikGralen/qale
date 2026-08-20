/**
 * Decide whether a raw string is a web address the app should open in the
 * browser, and normalize it to an absolute URL. Accepts the shapes people
 * actually paste — `https://…`, a scheme-less `www.…`, or a bare `host.tld/…`
 * — and returns the canonical `https://…` form, or `null` when the string is
 * not a web link (a note path, a fragment, an empty value).
 *
 * Bare-domain detection is deliberately conservative so it never hijacks an
 * in-app note path: the host (everything before the first `/`) must itself
 * contain a dot and end in a letters-only TLD, which the folder segments of a
 * vault path (`decisions/x.md`, `spaces/PRODUCT/pages/1`) never do. Links that
 * point at a local `.md`/`.markdown` file stay note links even so.
 */
export function webUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;

  // Already carries a scheme: honor http(s), reject everything else (a note
  // path has no scheme; mailto/file/etc. are handled by their own surfaces).
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  if (scheme) return /^https?$/i.test(scheme[1] ?? '') ? s : null;

  if (s.startsWith('#')) return null;

  if (s.startsWith('www.')) return `https://${s}`;
  const host = s.split(/[/?#]/, 1)[0] ?? '';

  // Bare `host.tld[/path]` — require a dotted host with a real TLD, and don't
  // swallow a link to a local markdown file.
  if (
    /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) &&
    /\.[a-z]{2,24}$/i.test(host) &&
    !/\.(md|markdown)$/i.test(host)
  ) {
    return `https://${s}`;
  }
  return null;
}
