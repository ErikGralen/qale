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
 * The credentials this install actually holds, longest first so a token that
 * contains a shorter one is still blanked whole. Nothing is ever removed: a
 * rotated token has to keep redacting, because a line written before the
 * rotation is still sitting in the buffer.
 */
const secrets: string[] = [];
/** Under this a "secret" is more likely a word, and blanking every occurrence
 *  of it would mangle ordinary lines. */
const MIN_SECRET = 6;

/**
 * Tell the scrubber about a credential the moment we hold it. The shape rules
 * below only catch formats we anticipated; this catches a credential in any
 * shape, including the next connector's.
 */
export function registerSecretValue(value: string | null | undefined): void {
  if (typeof value !== 'string') return;
  const secret = value.trim();
  if (secret.length < MIN_SECRET || secrets.includes(secret)) return;
  secrets.push(secret);
  secrets.sort((a, b) => b.length - a.length);
}

/**
 * Scrub a line on the way IN, not on the way out, so that whatever sits in the
 * buffer is already safe to hand over. Log lines carry the PM's own material
 * today: git names the note file it failed on, the sync engine names a calendar
 * id (which is an email address), a dev flag prints the MCP bearer token, and
 * any absolute path spells out their name and their folders.
 */
export function redactLogLine(text: string): string {
  // The value pass runs first, on the whole line: a credential we hold goes
  // whatever it is wrapped in (a URL, a JSON body, a header dump). Plain
  // split/join rather than a regex — the value is a secret, not a pattern, and
  // its own characters must not be read as one.
  let scrubbed = text;
  for (const secret of secrets) scrubbed = scrubbed.split(secret).join('<redacted>');
  return (
    scrubbed
      // Before the bare-path rule gets at their slashes.
      .replace(/\bfile:\/\/\S+/gi, '<path>')
      // A hostname identifies the customer (their Jira site, their company
      // domain), and so does everything after it: a Confluence URL spells out
      // the page title. Keep only that a request went somewhere.
      .replace(
        /\b(https?:\/\/)([^\s/:]+)(:\d+)?/gi,
        (whole, scheme: string, host: string, port?: string) =>
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

/** One thing a background pass tried and could not do. */
export interface PassFailure {
  /** What was being worked, in the fewest words that identify it. */
  item: string;
  /** Whatever came back — an Error, a string, anything a catch caught. */
  reason: unknown;
}

/**
 * Every failure a background pass hit, as ONE already-scrubbed line naming each
 * item and its reason (OW3). A pass that logs a row per failure turns one bad
 * network minute into a wall of red, and a pass that swallows them leaves a
 * workspace that quietly stopped being tidied with nothing to explain it.
 *
 * Scrubbed here rather than left to the capture hook, because console still
 * prints straight to stderr and the items are the PM's own note paths.
 * Returns null when nothing failed: there is no line to write then.
 */
export function failureReport(pass: string, failures: PassFailure[]): string | null {
  if (failures.length === 0) return null;
  const items = failures
    .map((f) => `${f.item} (${f.reason instanceof Error ? f.reason.message : String(f.reason)})`)
    .join('; ');
  const count = failures.length === 1 ? '1 item' : `${failures.length} items`;
  return redactLogLine(`[qale] ${pass}: ${count} failed this pass — ${items}`);
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

/** Tests only, and for the same reason: registered values never expire in life. */
export function resetSecretsForTest(): void {
  secrets.length = 0;
}
