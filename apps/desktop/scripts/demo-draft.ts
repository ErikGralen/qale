/**
 * `pnpm demo:draft`: a recording becomes a scenario script
 * (docs/plan-demo-replay.md, section 4.7, step 2).
 *
 * Reads one or more recordings from the same scenario, runs them through
 * `draftScenario`, validates the result the way the loader does, and writes
 * it out. The file it writes has `draft: true` and is not the finished
 * script: the flags this prints name what the author still has to look at.
 *
 * Never overwrites a file that fails `validateScenario`. A bad shape stays
 * on the console, not on disk.
 *
 *   pnpm demo:draft --scenario s1 --from demo/recordings/run-the-arrival-skill-....json
 *   pnpm demo:draft --scenario s1 --from a.json --from b.json --title "H2 priorities" --keep-reads
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ANCHOR } from '@qale/domain/demo';
import { draftScenario } from '../src/main/demo/script-from-recording.js';
import { validateScenario } from '../src/main/demo/scenario.js';
import type { Recording } from '../src/main/demo/replay-recordings.js';

/** The nearest folder at or above `start` that holds `vault-dev/`. Same rule `demo:lint` uses. */
export function repoRootFrom(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'vault-dev'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no vault-dev/ above ${start}`);
    dir = parent;
  }
}

function readRecording(file: string): Recording {
  const recording = JSON.parse(readFileSync(file, 'utf8')) as Recording;
  if (!Array.isArray(recording.turns)) throw new Error(`${file}: no turns`);
  return recording;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      scenario: { type: 'string' },
      from: { type: 'string', multiple: true },
      title: { type: 'string' },
      out: { type: 'string' },
      'keep-reads': { type: 'boolean' },
      'keep-claims': { type: 'boolean' },
    },
  });
  const scenarioId = values.scenario;
  const from = values.from ?? [];
  if (!scenarioId) throw new Error('--scenario is required (the id the file is named after, e.g. s1)');
  if (from.length === 0) throw new Error('--from is required at least once: a recording file to draft from');

  const repoRoot = repoRootFrom(import.meta.dirname);
  const recordings = from.map((f) => readRecording(resolve(repoRoot, f)));

  const { scenario, flags } = draftScenario({
    recordings,
    scenarioId,
    ...(values.title ? { title: values.title } : {}),
    keepReads: !!values['keep-reads'],
    keepClaims: !!values['keep-claims'],
    anchor: ANCHOR,
  });

  const { errors } = validateScenario(scenario);
  if (errors.length > 0) {
    console.error(`[qale] demo:draft refused to write a bad shape:\n  ${errors.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }

  const outFile = resolve(repoRoot, values.out ?? join('demo', 'scenarios', `${scenarioId}.json`));
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(scenario, null, 2)}\n`, 'utf8');
  console.log(`[qale] wrote ${outFile}`);

  if (flags.length > 0) {
    console.log(`[qale] ${flags.length} thing(s) to look at before this is a real script:`);
    for (const flag of flags) console.log(`  - ${flag}`);
  }
}

// Run only as a command; a test imports `draftScenario` directly.
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  await main();
}
