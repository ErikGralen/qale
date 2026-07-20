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
 *
 * What shifts: the date-valued frontmatter fields (date, due, captured, updated,
 * last_told, resolved, started, ended), the prose in summary/title, and bare
 * YYYY-MM-DD tokens in the body. What never shifts: dates that are part of a
 * wikilink slug (e.g. `[[meetings/2026-07-14-nordkap-checkin]]`) — filenames and
 * links are stable ids, so nothing to rewrite and no link can break. The app
 * derives every freshness/overdue/upcoming signal from frontmatter dates, not
 * filenames.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

// The fictional "today" the canonical vault-dev/ scenario is written around.
// If you ever re-date the source to a different centre, update this (or pass
// --anchor) so the shift maths stay correct.
const ANCHOR = '2026-07-17';

// Frontmatter keys whose scalar value is a date we should slide. These never
// hold wikilinks, so shifting their date tokens can't corrupt a link.
const DATE_KEYS = ['date', 'due', 'captured', 'updated', 'last_told', 'resolved', 'started', 'ended'];

// Frontmatter string keys that hold human prose (never wikilinks): their date
// tokens shift too, so a summary like "SSO date 2026-07-28" stays consistent.
const PROSE_KEYS = ['summary', 'title'];

const DATE_RE = /\d{4}-\d{2}-\d{2}/g;
const FRONTMATTER_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

interface Args {
  target: string;
  anchor: string;
  today: string;
  dry: boolean;
}

function parseArgs(argv: string[]): Args {
  let target: string | null = null;
  let anchor = ANCHOR;
  let today = new Date().toISOString().slice(0, 10);
  let dry = false;
  for (const a of argv) {
    if (a === '--dry' || a === '--dry-run') dry = true;
    else if (a.startsWith('--anchor=')) anchor = a.slice('--anchor='.length);
    else if (a.startsWith('--today=')) today = a.slice('--today='.length);
    else if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`);
    else target = a;
  }
  return { target: target ?? '.vault-dev', anchor, today, dry };
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
    const rel = relative(root, f).replace(/\\/g, '/').replace(/\.md$/, '');
    slugs.add(rel);
    slugs.add(rel.split('/').pop() ?? rel);
  }
  return slugs;
}

function extractLinks(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(WIKILINK_RE)) {
    // strip alias `|...` and anchor `#...`
    const target = (m[1] ?? '').split('|')[0].split('#')[0].trim();
    if (target) out.push(target);
  }
  return out;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  assertISODate('--anchor', args.anchor);
  assertISODate('--today', args.today);

  const source = resolve(join(import.meta.dirname, '..', 'vault-dev'));
  const target = resolve(args.target);
  if (target === source) {
    console.error('Target is the canonical demo vault itself; pick another directory (default .vault-dev).');
    process.exit(1);
  }

  const offset = daysBetween(args.anchor, args.today);
  console.log(`Anchor ${args.anchor} → today ${args.today}  (offset ${offset >= 0 ? '+' : ''}${offset} days)`);
  if (args.dry) console.log('(dry run — no files written)\n');

  // 1. Rebuild the target from scratch so nothing stale survives — deleted-from-
  // -source notes, old test captures, harness session receipts. Guard against
  // clobbering an unrelated directory: a pre-existing target must look like a
  // vault (have a notes/ folder) before we remove it. app.db/index.db live in
  // userData, not here, so wiping the runtime vault loses no app state.
  if (!args.dry) {
    if (existsSync(target)) {
      if (!existsSync(join(target, 'notes'))) {
        console.error(`Refusing to overwrite ${target}: it exists but has no notes/ — not a demo vault.`);
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

  // 2. Shift dates across the copy (or the source, read-only, in dry mode).
  const readRoot = args.dry ? source : target;
  const mdFiles = walk(readRoot).filter((f) => f.endsWith('.md') && !f.split(sep).includes('sessions'));
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
    if (!fmMatch || !/^\s*type:/m.test(fmMatch[1] ?? '')) untyped.push(rel);
    for (const link of extractLinks(raw)) {
      if (/^https?:\/\//.test(link)) continue;
      if (!slugs.has(link)) unresolved.push(`${rel}  →  [[${link}]]`);
    }
  }

  // 4. Todo-lane sanity summary — a quick read on whether "today" lands well.
  // Dry mode reads the unshifted source, so compare its dues to the anchor; the
  // lane outcome is offset-invariant, so this matches the real build's result.
  const laneToday = args.dry ? args.anchor : args.today;
  const lanes: Record<string, number> = { overdue: 0, today: 0, upcoming: 0, someday: 0, waiting: 0, closed: 0 };
  try {
    for (const f of readdirSync(join(validateRoot, 'todos'))) {
      if (!f.endsWith('.md')) continue;
      const fm = readFileSync(join(validateRoot, 'todos', f), 'utf8').match(FRONTMATTER_RE)?.[1] ?? '';
      const status = fm.match(/^\s*status:\s*"?(\w+)"?/m)?.[1] ?? 'open';
      const due = fm.match(/^\s*due:\s*"?(\d{4}-\d{2}-\d{2})"?/m)?.[1] ?? null;
      const owner = /^\s*owner:\s*\S/m.test(fm);
      if (status !== 'open') lanes.closed++;
      else if (owner) lanes.waiting++;
      else if (!due) lanes.someday++;
      else if (due < laneToday) lanes.overdue++;
      else if (due === laneToday) lanes.today++;
      else lanes.upcoming++;
    }
    console.log(`Todo lanes @ today: ${Object.entries(lanes).map(([k, v]) => `${v} ${k}`).join(' · ')}`);
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
