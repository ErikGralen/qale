/**
 * Refresh the demo workspace — the successor to seed-demo.ts.
 *
 * `vault-dev/` is the *canonical* demo source: the Rota scenario, frozen on a
 * fictional "today" of ANCHOR (2026-07-17). This script copies it to a runtime
 * target (default `.vault-dev`, gitignored) and slides every date forward by
 * (real today − ANCHOR) so the demo always reads as *now*: the upcoming meeting
 * stays in the near future, overdue todos stay overdue, the stale insight stays
 * proportionally stale, renewal dates stay months out.
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
 *   pnpm tsx scripts/refresh-demo.ts --done          # the Flow 4 snapshot (see below)
 *
 * --done lays scripts/demo-overlays/done/ over the fresh copy before the dates
 * slide: the same vault, except the shift-swaps epic and its last story read
 * Done. Flow 4 needs that state and nothing else does, so it is two overlay
 * files rather than a second vault. `pnpm reset-atlassian --done` is its live
 * counterpart, and reads the same list of keys from scripts/lib/atlassian-cast.ts.
 * The demo build needs none of this: Settings → Demo applies the
 * `sch-231-done` fixture step and the sync tick after it writes the mirrors.
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
 * wikilink slug (e.g. `[[meetings/2026-07-09-steering]]`) — filenames and
 * links are stable ids, so nothing to rewrite and no link can break. The app
 * derives every freshness/overdue/upcoming signal from frontmatter dates, not
 * filenames.
 *
 * The shift, the validation and the DB-name rule are NOT written here: they are
 * shared with the demo build's Reset (docs/demo-mode.md DM-9) and live in
 * packages/domain/src/demo/shift.ts. The import is a relative path with an
 * explicit `.ts` extension because this script runs under bare `node` with type
 * stripping and no bundler, which is also why that module may only import node
 * builtins. Keep it that way and this script keeps working.
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import {
  ANCHOR,
  appDbBasename,
  assertISODate,
  copyVault,
  daysBetween,
  shiftVaultDates,
  todoLanes,
  validateVault,
} from '../packages/domain/src/demo/shift.ts';

interface Args {
  target: string;
  anchor: string;
  today: string;
  dry: boolean;
  keepAppState: boolean;
  done: boolean;
}

function parseArgs(argv: string[]): Args {
  let target: string | null = null;
  let anchor = ANCHOR;
  let today = new Date().toISOString().slice(0, 10);
  let dry = false;
  let keepAppState = false;
  let done = false;
  for (const a of argv) {
    if (a === '--dry' || a === '--dry-run') dry = true;
    else if (a === '--keep-app-state') keepAppState = true;
    else if (a === '--done') done = true;
    else if (a.startsWith('--anchor=')) anchor = a.slice('--anchor='.length);
    else if (a.startsWith('--today=')) today = a.slice('--today='.length);
    else if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`);
    else target = a;
  }
  return { target: target ?? '.vault-dev', anchor, today, dry, keepAppState, done };
}

/**
 * Lay one overlay directory over the fresh copy: every file under
 * scripts/demo-overlays/<name>/ replaces the note at the same relative path.
 * It runs before the date shift, so overlay dates slide with everything else.
 * The overlay only ever REPLACES a note the canonical vault already has; a
 * stray path is a typo, and a typo that silently adds an orphan note to the
 * demo is worse than a stop.
 */
function applyOverlay(name: string, target: string, dry: boolean): void {
  const root = join(import.meta.dirname, 'demo-overlays', name);
  if (!existsSync(root)) throw new Error(`No demo overlay at ${root}`);
  const files: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), next);
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(next);
    }
  };
  walk(root, '');
  for (const rel of files) {
    const to = join(target, ...rel.split('/'));
    if (!dry && !existsSync(to)) {
      throw new Error(`Overlay "${name}" names ${rel}, which the canonical vault does not have.`);
    }
    if (!dry) copyFileSync(join(root, ...rel.split('/')), to);
  }
  console.log(
    `Overlay "${name}": ${dry ? 'would replace' : 'replaced'} ${files.length} note(s) — ${files.join(', ')}.`,
  );
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
    copyVault(source, target);
  }

  // 1a. The Flow 4 snapshot, laid over the fresh copy before the dates slide.
  // This is the live-site path only; the demo build gets there from Settings →
  // Demo with the `sch-231-done` fixture step.
  if (args.done) applyOverlay('done', target, args.dry);

  // 1b. Reset the app-side state keyed to this runtime vault (inbox and proposals
  // live in a per-vault DB under userData, not in the vault) so the demo
  // opens with a clean inbox rather than last run's cards. --keep-app-state opts
  // out. Uses the resolved absolute `target` so the DB key matches the app's.
  if (!args.keepAppState) clearAppState(target, args.dry);

  // 2. Shift dates across the copy (or the source, read-only, in dry mode).
  const readRoot = args.dry ? source : target;
  const shifted = shiftVaultDates(readRoot, offset, !args.dry);
  console.log(
    `Shifted ${shifted.fm} frontmatter date(s) + ${shifted.body} prose date(s) across ${shifted.filesTouched} file(s).`,
  );

  // 3. Validate the result: frontmatter present + every wikilink resolves.
  const validateRoot = args.dry ? source : target;
  const { unresolved, untyped, noteCount } = validateVault(validateRoot);

  // 4. Todo-lane sanity summary — a quick read on whether "today" lands well.
  // Dry mode reads the unshifted source, so compare its dues to the anchor; the
  // lane outcome is offset-invariant, so this matches the real build's result.
  const laneToday = args.dry ? args.anchor : args.today;
  try {
    const lanes = todoLanes(validateRoot, laneToday);
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
  console.log(`\n✓ ${noteCount} notes validate; all wikilinks resolve.`);
  if (!args.dry) console.log(`✓ Demo workspace ready at ${target}`);
}

main();
