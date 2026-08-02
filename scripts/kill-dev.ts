/**
 * Kill every dev/verification process this checkout has spawned.
 *
 * Dev servers (`pnpm desktop`) and one-shot screenshot runs are cheap to start
 * and easy to forget, and on macOS an Electron app outlives its window — so
 * forgotten launches pile up in the dock until you hunt them down by hand.
 *
 * Matching is scoped to THIS repo path, so a second clone, a packaged build, or
 * anyone else's Electron is left running.
 *
 *   pnpm kill-dev              # terminate them
 *   pnpm kill-dev --dry        # just list what would be killed
 *   pnpm kill-dev --sandboxed  # only PM_USERDATA runs — never a human's dev server
 *
 * Prefer --sandboxed when something automated is doing the cleaning: a plain
 * `pnpm desktop` looks identical whoever started it, but a PM_USERDATA launch is
 * always a throwaway verification run.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const SANDBOXED_ONLY = process.argv.includes('--sandboxed');

/** The vendored Electron binary — the only thing that actually shows in the dock. */
const ELECTRON = 'node_modules/.pnpm/electron@';

type Proc = { pid: number; command: string };

function list(args: string[]): Proc[] {
  return execFileSync('ps', args, { encoding: 'utf8' })
    .split('\n')
    .map((line) => {
      const m = /^\s*(\d+)\s+(.*)$/.exec(line);
      return m ? { pid: Number(m[1]), command: m[2] } : null;
    })
    .filter((p): p is Proc => p !== null);
}

/** PIDs of sandboxed verification launches. The marker is the PM_USERDATA env
 *  var — never an argv flag — so this needs `-E`, which appends the environment
 *  to each line.
 *
 *  Two traps in that listing, both hit in practice: it also splices in every
 *  process's PWD (so path-matching against it sweeps up any shell sitting in the
 *  repo), and a shell whose *command text* merely mentions PM_USERDATA matches
 *  as readily as a process that actually has it set. Hence: require an expanded
 *  absolute path after the `=`, and require the process to be Electron itself —
 *  which is all we ever wanted to kill, since it is what holds the dock icon. */
function sandboxed(): Set<number> {
  return new Set(
    list(['-Eaxww', '-o', 'pid=,command='])
      .filter((p) => p.command.includes(ELECTRON) && /PM_USERDATA=\//.test(p.command))
      .map((p) => p.pid),
  );
}

/** Every live process whose *argv* points into this checkout — minus the
 *  toolchain running this script (and its shell), which would be suicide. */
function targets(): Proc[] {
  const self = new Set([process.pid, process.ppid]);
  const sandbox = SANDBOXED_ONLY ? sandboxed() : null;
  return list(['-axww', '-o', 'pid=,command='])
    .filter((p) => p.command.includes(ROOT) && !p.command.includes('kill-dev') && !self.has(p.pid))
    .filter((p) => sandbox === null || sandbox.has(p.pid));
}

function signal(pids: number[], sig: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, sig);
    } catch {
      // Already gone — killing a parent often takes its children with it.
    }
  }
}

const found = targets();
if (found.length === 0) {
  console.log('[kill-dev] nothing running from this checkout');
  process.exit(0);
}

for (const p of found) console.log(`  ${p.pid}  ${p.command.slice(0, 110)}`);
if (DRY) {
  console.log(`[kill-dev] --dry: would kill ${found.length} process(es)`);
  process.exit(0);
}

signal(
  found.map((p) => p.pid),
  'SIGTERM',
);
// Give teardown (DB close, watcher close) a moment before escalating.
await new Promise((r) => setTimeout(r, 2000));
const stubborn = targets();
if (stubborn.length > 0) {
  signal(
    stubborn.map((p) => p.pid),
    'SIGKILL',
  );
}
console.log(`[kill-dev] killed ${found.length} process(es)`);
