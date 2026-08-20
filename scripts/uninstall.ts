/**
 * Remove every trace of Qale from this machine, so the next run is a first run.
 *
 * The app scatters state in five places, and deleting /Applications/Qale.app
 * leaves four of them behind — which is why a reinstall keeps remembering your
 * API key, your workspace, and that you already finished onboarding:
 *
 *   1. the packaged app                /Applications/Qale.app
 *   2. the installed profile           ~/Library/Application Support/Qale
 *   3. the dev profile                 ~/Library/Application Support/Qale Dev
 *      (a dev run renames itself — see app.setName('Qale Dev') in
 *      apps/desktop/src/main/index.ts — so it never shares state with 2)
 *   4. window/prefs + crash logs       ~/Library/Preferences/ai.qale.app.plist, ...
 *   5. the safeStorage keychain keys   "Qale Safe Storage", "Qale Dev Safe Storage"
 *      — without these the encrypted secrets in settings.json are unreadable, so
 *      a profile deleted without its key leaves a key that unlocks nothing.
 *
 *   pnpm uninstall-app              # print the plan, remove nothing
 *   pnpm uninstall-app --yes        # actually remove it
 *   pnpm uninstall-app --dev        # only the dev profile (keep the installed app)
 *   pnpm uninstall-app --installed  # only the installed app and its profile
 *   pnpm uninstall-app --vault --yes  # ALSO delete the workspace folders
 *
 * Your notes are NOT touched unless you pass --vault. The workspace is a plain
 * folder you chose, it can hold years of writing, and nothing else in here can
 * recreate it — so it is opt-in, printed by path, and never a default.
 *
 * Named `uninstall-app` rather than `uninstall` because `pnpm uninstall` is
 * pnpm's own alias for `pnpm remove`, and would rip packages out of the
 * workspace instead of running this.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const GO = argv.includes('--yes');
const WITH_VAULT = argv.includes('--vault');
const ONLY_DEV = argv.includes('--dev');
const ONLY_INSTALLED = argv.includes('--installed');
// Neither flag means both profiles, which is what "set up from fresh" wants.
const wantInstalled = !ONLY_DEV || ONLY_INSTALLED;
const wantDev = !ONLY_INSTALLED || ONLY_DEV;

const APP_ID = 'ai.qale.app';
const HOME = homedir();
const MAC = platform() === 'darwin';

/** Electron's userData dir, resolved the way the main process does. */
function userDataDir(appName: string): string {
  const appData = MAC
    ? join(HOME, 'Library', 'Application Support')
    : platform() === 'win32'
      ? (process.env['APPDATA'] ?? join(HOME, 'AppData', 'Roaming'))
      : (process.env['XDG_CONFIG_HOME'] ?? join(HOME, '.config'));
  return join(appData, appName);
}

/** `~/Library/…` beats a 60-character absolute path in a confirmation prompt. */
function short(p: string): string {
  return p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p;
}

function sizeOf(p: string): string {
  try {
    const out = execFileSync('du', ['-sh', p], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().split(/\s+/)[0] ?? '';
  } catch {
    return '';
  }
}

/** The workspace each profile last had open. Read before anything is deleted —
 *  once settings.json is gone the path is gone with it. */
function vaultOf(profile: string): string | null {
  try {
    const settings = JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8'));
    const path = settings.vaultPath;
    return typeof path === 'string' && path ? resolve(path) : null;
  } catch {
    return null;
  }
}

function keychainHas(service: string): boolean {
  if (!MAC) return false;
  try {
    execFileSync('security', ['find-generic-password', '-s', service], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Processes still holding the files we are about to delete. Deleting a running
 *  app's profile means the live process rewrites some of it on quit, so the
 *  uninstall silently half-survives. Dev runs are `pnpm kill-dev`'s job. */
function running(): string[] {
  if (!MAC) return [];
  try {
    return execFileSync('ps', ['-axww', '-o', 'command='], { encoding: 'utf8' })
      .split('\n')
      .filter((line) => line.includes('/Applications/Qale.app/Contents/MacOS/'));
  } catch {
    return [];
  }
}

type Item = { group: string; label: string; remove: () => void };

const items: Item[] = [];
const skipped: string[] = [];
const vaults: string[] = [];

function addPath(group: string, path: string): void {
  if (!existsSync(path)) return;
  const size = sizeOf(path);
  items.push({
    group,
    label: size ? `${short(path)}  (${size})` : short(path),
    remove: () => rmSync(path, { recursive: true, force: true }),
  });
}

function addKeychain(service: string): void {
  if (!keychainHas(service)) return;
  items.push({
    group: 'Keychain',
    label: `${service}  (may ask for your login password)`,
    remove: () => {
      // -s alone deletes the first match; the loop clears duplicates, which
      // accumulate when the app is reinstalled without being uninstalled.
      for (;;) {
        try {
          execFileSync('security', ['delete-generic-password', '-s', service], { stdio: 'ignore' });
        } catch {
          return;
        }
      }
    },
  });
}

const installedProfile = userDataDir('Qale');
const devProfile = userDataDir('Qale Dev');

if (wantInstalled) {
  const vault = vaultOf(installedProfile);
  if (vault) vaults.push(vault);
  if (MAC) addPath('App', '/Applications/Qale.app');
  addPath('App state', installedProfile);
}
if (wantDev) {
  const vault = vaultOf(devProfile);
  if (vault) vaults.push(vault);
  addPath('App state', devProfile);
}

if (MAC && wantInstalled) {
  addPath('System leftovers', join(HOME, 'Library', 'Preferences', `${APP_ID}.plist`));
  addPath(
    'System leftovers',
    join(HOME, 'Library', 'Saved Application State', `${APP_ID}.savedState`),
  );
  addPath('System leftovers', join(HOME, 'Library', 'Caches', APP_ID));
  const crashes = join(HOME, 'Library', 'Application Support', 'CrashReporter');
  try {
    for (const f of execFileSync('ls', [crashes], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\n')) {
      if (/^Qale[_.]/.test(f)) addPath('System leftovers', join(crashes, f));
    }
  } catch {
    /* no crash logs, nothing to clean */
  }
}

if (wantInstalled) addKeychain('Qale Safe Storage');
if (wantDev) addKeychain('Qale Dev Safe Storage');
// "Electron Safe Storage" is deliberately left alone: it is the unbranded key
// every unsigned Electron app shares, so deleting it would wipe the saved
// secrets of unrelated apps on this machine.

if (WITH_VAULT) {
  for (const v of new Set(vaults)) {
    if (existsSync(v)) addPath('Workspace', v);
    else skipped.push(`${short(v)} (already gone)`);
  }
}

const live = running();
if (live.length > 0) {
  console.log('Qale is still running. Quit it first (⌘Q), then run this again.');
  if (GO) process.exit(1);
}

if (items.length === 0) {
  console.log('Nothing to remove — Qale is not installed on this machine.');
  process.exit(0);
}

console.log(GO ? '\nRemoving:\n' : '\nWould remove (nothing has been touched yet):\n');
let group = '';
for (const item of items) {
  if (item.group !== group) {
    group = item.group;
    console.log(`  ${group}`);
  }
  console.log(`    ${item.label}`);
}

if (!WITH_VAULT && vaults.length > 0) {
  console.log('\n  Workspace (kept — pass --vault to delete your notes too)');
  for (const v of new Set(vaults))
    console.log(`    ${short(v)}${existsSync(v) ? '' : '  (already gone)'}`);
}
for (const s of skipped) console.log(`\n  Skipped: ${s}`);

if (!GO) {
  console.log('\nRun `pnpm uninstall-app --yes` to go ahead.\n');
  process.exit(0);
}

for (const item of items) {
  try {
    item.remove();
  } catch (err) {
    console.log(`    failed: ${item.label} (${err instanceof Error ? err.message : String(err)})`);
  }
}

if (MAC && wantInstalled) {
  // cfprefsd caches preferences in memory and writes the plist back out on its
  // own schedule, so deleting the file alone can be undone minutes later.
  try {
    execFileSync('defaults', ['delete', APP_ID], { stdio: 'ignore' });
  } catch {
    /* nothing registered under the domain */
  }
}

console.log('\nDone. Qale is gone from this machine.');
console.log('For a fresh dev run: `pnpm refresh-demo` rebuilds .vault-dev, then `pnpm desktop`.\n');
