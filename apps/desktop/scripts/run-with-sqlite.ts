/**
 * Run one of the demo scripts in a runtime that can open `better-sqlite3`.
 *
 * `better-sqlite3` is a native module, so it loads under exactly one ABI. A
 * fresh `pnpm install` fetches the build for plain node. The moment anyone
 * packages or runs the app, `@electron/rebuild` replaces it with Electron's,
 * and plain node cannot load it any more. Both states are normal on a working
 * machine, and neither is a mistake to correct.
 *
 * So the runtime is chosen rather than assumed. Plain node is asked first,
 * because it starts faster and needs nothing downloaded. If it cannot open the
 * module, the script runs under Electron's own node instead
 * (`ELECTRON_RUN_AS_NODE=1`), which is the same binary `pnpm desktop` uses.
 * Nothing is rebuilt either way, so `pnpm desktop` works before and after.
 *
 *   tsx scripts/run-with-sqlite.ts scripts/lint-scenarios.ts --scenario s1
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const requireHere = createRequire(import.meta.url);

/** Can this runtime load the native module and open a database? */
function canOpenSqlite(): boolean {
  try {
    const Database = requireHere('better-sqlite3') as new (path: string) => { close(): void };
    new Database(':memory:').close();
    return true;
  } catch {
    return false;
  }
}

/** The Electron binary this workspace installed. Null if it is not there. */
function electronBinary(): string | null {
  try {
    const path = requireHere('electron') as unknown;
    return typeof path === 'string' && path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

const [target, ...rest] = process.argv.slice(2);
if (!target) {
  console.error('usage: tsx scripts/run-with-sqlite.ts <script.ts> [args...]');
  process.exit(1);
}

const script = resolve(target);
const args = ['--import', 'tsx', script, ...rest];
let command = process.execPath;
let env = process.env;

if (!canOpenSqlite()) {
  const electron = electronBinary();
  if (!electron) {
    console.error(
      'better-sqlite3 here is not built for node, and Electron is not installed to run it ' +
        'instead. Run `pnpm install` in the repo root and try again.',
    );
    process.exit(1);
  }
  command = electron;
  env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
}

const run = spawnSync(command, args, { stdio: 'inherit', env });
if (run.error) {
  console.error(`could not start ${command}: ${run.error.message}`);
  process.exit(1);
}
process.exit(run.status ?? 1);
