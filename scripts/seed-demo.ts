/**
 * Seed the demo workspace (PLAN-V2 Phase 1.5) by copying the checked-in demo
 * vault at vault-dev/ — the Tavla scenario: 5 customers, 10 decisions with a
 * supersedes-chain, 9 meetings with transcripts, and cited insights.
 * Deterministic — run with:
 *   npx tsx scripts/seed-demo.ts [targetDir=.vault-dev]
 *
 * vault-dev/ is the source of truth for the demo content; edit the markdown
 * there, not this script. sessions/ contents are skipped (harness-written).
 */
import { cpSync, mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const source = resolve(join(import.meta.dirname, '..', 'vault-dev'));
const root = resolve(process.argv[2] ?? '.vault-dev');

if (root === source) {
  console.error('Target is the demo vault itself; pick another directory.');
  process.exit(1);
}

cpSync(source, root, {
  recursive: true,
  filter: (src) => !src.split(sep).includes('sessions') || src.endsWith(`${sep}sessions`),
});
mkdirSync(join(root, 'sessions'), { recursive: true });

console.log(`Seeded demo workspace at ${root}`);
