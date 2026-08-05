/**
 * The app's own log, kept in memory so a bug report can carry it.
 *
 * There is no log file and no logging library: main and the packages it bundles
 * write to `console`, which in a packaged build goes to a stderr nobody ever
 * sees. So we tee console into a small ring buffer and hand the tail to
 * diagnostics. Console still prints as before, so the dev workflow is unchanged.
 */

/** How many lines we keep. Enough to cover a session, small enough to ignore. */
const CAPACITY = 400;
/** One runaway line (a stringified object, a stack) must not crowd out the rest. */
const MAX_LINE = 300;

const lines: string[] = [];
let total = 0;
let installed = false;

/** The local MCP server is the only host worth keeping: it is ours, not theirs. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']);

/**
 * Scrub a line on the way IN, not on the way out, so that whatever sits in the
 * buffer is already safe to hand over. Log lines carry the PM's own material
 * today: git names the note file it failed on, the sync engine names a calendar
 * id (which is an email address), a dev flag prints the MCP bearer token, and
 * any absolute path spells out their name and their folders.
 */
export function redactLogLine(text: string): string {
  return (
    text
      // Before the bare-path rule gets at their slashes.
      .replace(/\bfile:\/\/\S+/gi, '<path>')
      // A hostname identifies the customer (their Jira site, their company
      // domain), and so does everything after it: a Confluence URL spells out
      // the page title. Keep only that a request went somewhere.
      .replace(/\b(https?:\/\/)([^\s/:]+)(:\d+)?/gi, (whole, scheme: string, host: string, port?: string) =>
        LOOPBACK.has(host) ? whole : `${scheme}<host>${port ?? ''}`,
      )
      .replace(/[A-Za-z]:\\[^\s'"]+/g, '<path>')
      // An absolute path, but not the tail of a URL we just kept (loopback).
      .replace(/(?<![\w:/])\/[\w.-]+(?:\/[^\s'"`,;:)\]]+)+/g, '<path>')
      // A note reference relative to the workspace ("decisions/adopt-workos",
      // "skills/weekly-update/SKILL.md"): a slug is the title with hyphens in
      // it. The leading guard and the digits-first guard between them spare the
      // loopback URL's "…:7717/mcp", which is the one slash worth keeping.
      .replace(/(?<![\w/.-])(?!\d+\/)[\w][\w.-]*(?:\/[\w.-]+)+/g, '<note>')
      // And a bare note filename, which has no folder in front of it.
      .replace(/[^\s'"`,;:)\]]*\.md\b/gi, '<note>')
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
      // Anything key-shaped: the MCP token, an API key that reached a log line.
      .replace(/\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{24,}\b/g, '<redacted>')
  );
}

/** Errors go in as name + message: a stack is long, and it is all paths. */
function format(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (arg === null || arg === undefined || typeof arg !== 'object') return String(arg);
  try {
    return JSON.stringify(arg);
  } catch {
    return '[unserialisable]';
  }
}

function record(level: string, args: unknown[]): void {
  const text = args.map(format).join(' ');
  const stamp = new Date().toISOString().slice(11, 23);
  const line = `${stamp} ${level} ${redactLogLine(text)}`;
  lines.push(line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}…` : line);
  total++;
  if (lines.length > CAPACITY) lines.splice(0, lines.length - CAPACITY);
}

const LEVELS = { log: 'INFO', info: 'INFO', warn: 'WARN', error: 'ERROR' } as const;

/** Call once, as early in main as possible: lines written before this are lost. */
export function installLogCapture(): void {
  if (installed) return;
  installed = true;
  for (const [method, label] of Object.entries(LEVELS) as [keyof typeof LEVELS, string][]) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      record(label, args);
      original(...args);
    };
  }
}

/** The tail, oldest first, plus how many lines there have ever been. */
export function recentLog(limit: number): { lines: string[]; total: number } {
  return { lines: lines.slice(-limit), total };
}

/** Tests only: the buffer is process-wide and would otherwise leak between them. */
export function resetLogForTest(): void {
  lines.length = 0;
  total = 0;
}
