/**
 * Refresh the demo workspace — the successor to seed-demo.ts.
 *
 * `vault-dev/` is the *canonical* demo source: the Tavla scenario, frozen on a
 * fictional "today" of {@link ANCHOR} (2026-07-17). This script copies it to a
 * runtime target (default `.vault-dev`, gitignored) and slides every date
 * forward by (real today − ANCHOR) so the demo always reads as *now*: the
 * upcoming meeting stays in the near future, overdue todos stay overdue, the
 * stale insight stays proportionally stale, renewal dates stay months out.
 *
 * Because it always reads the pristine source, it is idempotent — run it as
 * often as you like; the canonical vault never drifts and never accumulates the
 * harness-written session receipts that pile up when you point the app straight
 * at `vault-dev/`. Point the app at the target (`.vault-dev`) instead.
 *
 *   pnpm tsx scripts/refresh-demo.ts                 # build .vault-dev, dated to today
 *   pnpm tsx scripts/refresh-demo.ts .vault-dev      # explicit target
 *   pnpm tsx scripts/refresh-demo.ts --today=2026-09-01   # pin "today" for testing
 *   pnpm tsx scripts/refresh-demo.ts --anchor=2026-07-17  # if you re-center the source timeline
 *   pnpm tsx scripts/refresh-demo.ts --dry           # print the plan, write nothing
 *   pnpm tsx scripts/refresh-demo.ts --keep-app-state    # rebuild the vault, leave the inbox alone
 *
 * It also resets the app-side state keyed to the runtime vault. The inbox cards
 * and proposals do NOT live in the vault — they sit in a per-vault SQLite
 * DB under Electron's userData dir (see apps/desktop/src/main/services/
 * vault-service.ts). A vault-only rebuild would therefore open behind a stale
 * inbox from the previous run, so by default we also clear that per-vault DB, the
 * shared search index (it reindexes on open), and the agent-run session receipts.
 * Pass --keep-app-state to skip that, or set QALE_USERDATA to point at a non-default
 * userData dir (the same override the app itself honours).
 *
 * What shifts: the date-valued frontmatter fields (date, due, captured, updated,
 * last_told, resolved, started, ended), the prose in summary/title, and bare
 * YYYY-MM-DD tokens in the body. What never shifts: dates that are part of a
 * wikilink slug (e.g. `[[meetings/2026-07-14-nordkap-checkin]]`) — filenames and
 * links are stable ids, so nothing to rewrite and no link can break. The app
 * derives every freshness/overdue/upcoming signal from frontmatter dates, not
 * filenames.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { homedir, platform } from 'node:os';
import { createHash } from 'node:crypto';

// The fictional "today" the canonical vault-dev/ scenario is written around.
// If you ever re-date the source to a different centre, update this (or pass
// --anchor) so the shift maths stay correct.
const ANCHOR = '2026-07-17';

// Frontmatter keys whose scalar value is a date we should slide. These never
// hold wikilinks, so shifting their date tokens can't corrupt a link.
// remote_updated (ticket/wikipage mirrors) is a full ISO timestamp; only its
// date part shifts, the time-of-day stays.
const DATE_KEYS = [
  'date',
  'due',
  'captured',
  'updated',
  'last_told',
  'resolved',
  'started',
  'ended',
  'remote_updated',
];

// Frontmatter string keys that hold human prose (never wikilinks): their date
// tokens shift too, so a summary like "SSO date 2026-07-28" stays consistent.
const PROSE_KEYS = ['summary', 'title'];

const DATE_RE = /\d{4}-\d{2}-\d{2}/g;

// A skill and an agent are folders: `skills/<name>/SKILL.md` is the runnable and
// its slug is the FOLDER, while anything else beside it is the skill's own
// material — never indexed, never a note, so it has no frontmatter to validate.
// Mirrors @qale/domain's slug.ts; this script stays dependency-free on purpose
// (it runs under bare `node`), so the rule is restated rather than imported.
const RUNNABLE_ENTRY_RE = /^(?:skills|agents)\/[^/]+\/(?:SKILL|AGENT)\.md$/i;
const RUNNABLE_FOLDER_RE = /^(?:skills|agents)\/[^/]+\/.+$/;

function isRunnableResource(rel: string): boolean {
  return RUNNABLE_FOLDER_RE.test(rel) && !RUNNABLE_ENTRY_RE.test(rel);
}

/** The slug a file is linkable by: a runnable's entry file answers to its folder. */
function slugOf(rel: string): string {
  const slug = rel.replace(/\.md$/, '');
  return RUNNABLE_ENTRY_RE.test(rel) ? slug.slice(0, slug.lastIndexOf('/')) : slug;
}
const FRONTMATTER_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

interface Args {
  target: string;
  anchor: string;
  today: string;
  dry: boolean;
  keepAppState: boolean;
}

function parseArgs(argv: string[]): Args {
  let target: string | null = null;
  let anchor = ANCHOR;
  let today = new Date().toISOString().slice(0, 10);
  let dry = false;
  let keepAppState = false;
  for (const a of argv) {
    if (a === '--dry' || a === '--dry-run') dry = true;
    else if (a === '--keep-app-state') keepAppState = true;
    else if (a.startsWith('--anchor=')) anchor = a.slice('--anchor='.length);
    else if (a.startsWith('--today=')) today = a.slice('--today='.length);
    else if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`);
    else target = a;
  }
  return { target: target ?? '.vault-dev', anchor, today, dry, keepAppState };
}

function assertISODate(label: string, s: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`${label} must be YYYY-MM-DD, got "${s}"`);
}

/** Whole-day difference a→b, computed in UTC so DST never skews it. */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Slide a single YYYY-MM-DD string by `offset` days. */
function shiftDate(iso: string, offset: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + offset);
  return dt.toISOString().slice(0, 10);
}

/**
 * Shift every YYYY-MM-DD in a run of prose, but hide wikilinks first so a slug's
 * date is never touched — files aren't renamed, so links must stay byte-exact.
 * The \x00 sentinel can't occur in markdown, so restoration is unambiguous.
 */
function shiftProse(text: string, offset: number): { out: string; count: number } {
  const links: string[] = [];
  const masked = text.replace(WIKILINK_RE, (m) => {
    links.push(m);
    return `\x00${links.length - 1}\x00`;
  });
  let count = 0;
  const out = masked
    .replace(DATE_RE, (tok) => {
      count++;
      return shiftDate(tok, offset);
    })
    .replace(/\x00(\d+)\x00/g, (_, i) => links[Number(i)]);
  return { out, count };
}

/** Shift the date-valued frontmatter fields and bare prose dates in one file. */
function shiftFile(raw: string, offset: number): { text: string; fm: number; body: number } {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    const { out, count } = shiftProse(raw, offset);
    return { text: out, fm: 0, body: count };
  }
  const fmBlock = match[1] ?? '';
  const rest = raw.slice(match[0].length);

  let fmCount = 0;
  const shiftedFm = fmBlock
    .split('\n')
    .map((line) => {
      const key = line.match(/^\s*([A-Za-z_]+):/)?.[1];
      if (!key) return line; // continuation / array-item line — leave alone
      if (DATE_KEYS.includes(key)) {
        return line.replace(DATE_RE, (tok) => {
          fmCount++;
          return shiftDate(tok, offset);
        });
      }
      if (PROSE_KEYS.includes(key)) {
        const { out, count } = shiftProse(line, offset);
        fmCount += count;
        return out;
      }
      return line; // ref/array keys (sources, evidence, customer, …) untouched
    })
    .join('\n');

  const { out: shiftedBody, count: bodyCount } = shiftProse(rest, offset);
  return { text: `---\n${shiftedFm}\n---\n${shiftedBody}`, fm: fmCount, body: bodyCount };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

/** Bare slug set for wikilink resolution: both `dir/name` and basename `name`. */
function buildSlugIndex(root: string, files: string[]): Set<string> {
  const slugs = new Set<string>();
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    const rel = slugOf(relative(root, f).replace(/\\/g, '/'));
    slugs.add(rel);
    slugs.add(rel.split('/').pop() ?? rel);
  }
  return slugs;
}

function extractLinks(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(WIKILINK_RE)) {
    // strip alias `|...`, anchor `#...`, and a `type::` prefix (typed links)
    // — resolution only cares about the bare target.
    let target = (m[1] ?? '').split('|')[0].split('#')[0].trim();
    const sep = target.indexOf('::');
    if (sep > 0 && target.slice(sep + 2).trim()) target = target.slice(sep + 2).trim();
    if (target) out.push(target);
  }
  return out;
}

/**
 * Electron's userData dir for the desktop app, resolved the same way the main
 * process does (apps/desktop/src/main/index.ts): honour QALE_USERDATA, else the OS
 * default under the app's name. Returns null only if the platform default can't
 * be determined. The app's per-vault DB, search index and session receipts all
 * live directly under here.
 */
function electronUserDataDir(): string | null {
  const override = process.env['QALE_USERDATA'];
  if (override) return resolve(override);
  let appName = 'Qale'; // app.getName() = productName ?? name
  try {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'apps', 'desktop', 'package.json'), 'utf8'),
    );
    appName = pkg.productName || pkg.name || appName;
  } catch {
    /* fall back to the known name */
  }
  // The demo vault is only ever opened by a dev run, and a dev run names itself
  // separately (`app.setName('Qale Dev')` in apps/desktop/src/main/index.ts) so
  // that it cannot share settings, receipts or keychain with the installed app.
  // Keep this in lockstep: pointed at the installed profile, the cleanup below
  // would delete the search index and session receipts of the app you actually
  // use, to refresh a demo it has never opened.
  appName = `${appName} Dev`;
  const appData =
    platform() === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : platform() === 'win32'
        ? (process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'))
        : (process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'));
  return join(appData, appName);
}

/**
 * Per-vault app DB filename, mirroring VaultService.appDbPathFor(): the first 12
 * hex chars of sha256(absolute vault root). Must stay in lockstep with that
 * method or we'd clear the wrong (or no) DB.
 */
function appDbBasename(vaultRoot: string): string {
  return `app-${createHash('sha256').update(vaultRoot).digest('hex').slice(0, 12)}.db`;
}

/**
 * Clear the app-side state a vault-only refresh can't reach: the target vault's
 * per-vault app DB (inbox cards / proposals, + its -shm/-wal sidecars),
 * the shared search index (harmless to drop — it reindexes on next open), and the
 * agent-run session receipts. Without this the freshly-dated vault opens behind a
 * stale inbox from the previous run. In dry mode it only reports what it'd remove.
 */
function clearAppState(target: string, dry: boolean): void {
  const dir = electronUserDataDir();
  if (!dir || !existsSync(dir)) {
    console.log('App state: userData dir not found — nothing to clear.');
    return;
  }
  const rm = (p: string): boolean => {
    if (!existsSync(p)) return false;
    if (!dry) rmSync(p, { force: true });
    return true;
  };
  const db = appDbBasename(target);
  let inbox = 0;
  let index = 0;
  let receipts = 0;
  for (const s of ['', '-shm', '-wal']) if (rm(join(dir, db + s))) inbox++;
  for (const s of ['', '-shm', '-wal']) if (rm(join(dir, 'index.db' + s))) index++;
  const sessionsDir = join(dir, 'sessions');
  if (existsSync(sessionsDir)) {
    for (const f of readdirSync(sessionsDir)) {
      if (f.endsWith('.jsonl') && rm(join(sessionsDir, f))) receipts++;
    }
  }
  if (inbox + index + receipts === 0) {
    console.log(`App state @ ${dir}: already clean.`);
    return;
  }
  const verb = dry ? 'would remove' : 'removed';
  console.log(
    `App state @ ${dir}: ${verb} ` +
      `${inbox ? `inbox DB ${db}` : 'no inbox DB'}, ` +
      `${index ? 'search index' : 'no index'}, ${receipts} session receipt(s).`,
  );
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  assertISODate('--anchor', args.anchor);
  assertISODate('--today', args.today);

  const source = resolve(join(import.meta.dirname, '..', 'vault-dev'));
  const target = resolve(args.target);
  if (target === source) {
    console.error(
      'Target is the canonical demo vault itself; pick another directory (default .vault-dev).',
    );
    process.exit(1);
  }

  const offset = daysBetween(args.anchor, args.today);
  console.log(
    `Anchor ${args.anchor} → today ${args.today}  (offset ${offset >= 0 ? '+' : ''}${offset} days)`,
  );
  if (args.dry) console.log('(dry run — no files written)\n');

  // 1. Rebuild the target from scratch so nothing stale survives — deleted-from-
  // -source notes, old test captures, harness session receipts. Guard against
  // clobbering an unrelated directory: a pre-existing target must look like a
  // vault (have a notes/ folder) before we remove it. app.db/index.db live in
  // userData, not here, so wiping the runtime vault loses no app state.
  if (!args.dry) {
    if (existsSync(target)) {
      if (!existsSync(join(target, 'notes'))) {
        console.error(
          `Refusing to overwrite ${target}: it exists but has no notes/ — not a demo vault.`,
        );
        process.exit(1);
      }
      rmSync(target, { recursive: true, force: true });
    }
    cpSync(source, target, {
      recursive: true,
      filter: (src) => !src.split(sep).includes('sessions') || src.endsWith(`${sep}sessions`),
    });
    mkdirSync(join(target, 'sessions'), { recursive: true });
  }

  // 1b. Reset the app-side state keyed to this runtime vault (inbox and proposals
  // live in a per-vault DB under userData, not in the vault) so the demo
  // opens with a clean inbox rather than last run's cards. --keep-app-state opts
  // out. Uses the resolved absolute `target` so the DB key matches the app's.
  if (!args.keepAppState) clearAppState(target, args.dry);

  // 2. Shift dates across the copy (or the source, read-only, in dry mode).
  const readRoot = args.dry ? source : target;
  const mdFiles = walk(readRoot).filter(
    (f) => f.endsWith('.md') && !f.split(sep).includes('sessions'),
  );
  let filesTouched = 0;
  let fmShifts = 0;
  let bodyShifts = 0;
  for (const f of mdFiles) {
    const raw = readFileSync(f, 'utf8');
    const { text, fm, body } = shiftFile(raw, offset);
    if (fm + body > 0) {
      filesTouched++;
      fmShifts += fm;
      bodyShifts += body;
      if (!args.dry) writeFileSync(f, text);
    }
  }
  console.log(
    `Shifted ${fmShifts} frontmatter date(s) + ${bodyShifts} prose date(s) across ${filesTouched} file(s).`,
  );

  // 3. Validate the result: frontmatter present + every wikilink resolves.
  const validateRoot = args.dry ? source : target;
  const allFiles = walk(validateRoot);
  const slugs = buildSlugIndex(validateRoot, allFiles);
  const unresolved: string[] = [];
  const untyped: string[] = [];
  for (const f of allFiles) {
    if (!f.endsWith('.md')) continue;
    const rel = relative(validateRoot, f).replace(/\\/g, '/');
    if (rel.startsWith('sessions/')) continue;
    const raw = readFileSync(f, 'utf8');
    const fmMatch = raw.match(FRONTMATTER_RE);
    // A skill's own material (anything beside its SKILL.md) is not a note: it is
    // never indexed and only ever read by the path its skill names, so it has no
    // frontmatter to check.
    if (!isRunnableResource(rel) && (!fmMatch || !/^\s*type:/m.test(fmMatch[1] ?? '')))
      untyped.push(rel);
    for (const link of extractLinks(raw)) {
      if (/^https?:\/\//.test(link)) continue;
      // A skill writes `[[people/…]]` to show the agent the shape of a link it
      // should emit. The ellipsis can never be part of a real slug, so it is a
      // placeholder in prose, not a broken reference.
      if (link.includes('…')) continue;
      if (!slugs.has(link)) unresolved.push(`${rel}  →  [[${link}]]`);
    }
  }

  // 4. Todo-lane sanity summary — a quick read on whether "today" lands well.
  // Dry mode reads the unshifted source, so compare its dues to the anchor; the
  // lane outcome is offset-invariant, so this matches the real build's result.
  const laneToday = args.dry ? args.anchor : args.today;
  const lanes: Record<string, number> = {
    overdue: 0,
    today: 0,
    upcoming: 0,
    someday: 0,
    waiting: 0,
    closed: 0,
  };
  try {
    for (const f of readdirSync(join(validateRoot, 'todos'))) {
      if (!f.endsWith('.md')) continue;
      const fm =
        readFileSync(join(validateRoot, 'todos', f), 'utf8').match(FRONTMATTER_RE)?.[1] ?? '';
      // Accept the legacy `status:` key too, exactly as the frontmatter parser does.
      const commitment = fm.match(/^\s*(?:commitment|status):\s*"?([\w-]+)"?/m)?.[1] ?? 'open';
      const due = fm.match(/^\s*due:\s*"?(\d{4}-\d{2}-\d{2})"?/m)?.[1] ?? null;
      const owner = /^\s*owner:\s*\S/m.test(fm);
      if (commitment !== 'open') lanes.closed++;
      else if (owner) lanes.waiting++;
      else if (!due) lanes.someday++;
      else if (due < laneToday) lanes.overdue++;
      else if (due === laneToday) lanes.today++;
      else lanes.upcoming++;
    }
    console.log(
      `Todo lanes @ today: ${Object.entries(lanes)
        .map(([k, v]) => `${v} ${k}`)
        .join(' · ')}`,
    );
  } catch {
    /* no todos dir — skip */
  }

  if (untyped.length) {
    console.warn(`\n⚠ ${untyped.length} file(s) missing a type: field:\n  ${untyped.join('\n  ')}`);
  }
  if (unresolved.length) {
    console.error(`\n✗ ${unresolved.length} unresolved wikilink(s):\n  ${unresolved.join('\n  ')}`);
    process.exit(1);
  }
  const noteCount = allFiles.filter((f) => f.endsWith('.md')).length;
  console.log(`\n✓ ${noteCount} notes validate; all wikilinks resolve.`);
  if (!args.dry) console.log(`✓ Demo workspace ready at ${target}`);
}

main();
