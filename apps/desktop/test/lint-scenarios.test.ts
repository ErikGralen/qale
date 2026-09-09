import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteIndex } from '@qale/vault';
import { lintScenarios, repoRootFrom, type Finding } from '../scripts/lint-scenarios.js';

/**
 * The demo lint (docs/plan-demo-replay.md, section 4.8).
 *
 * Two fixtures say what it is for. One is a script that works: a read of a page
 * the seed vault holds, a todo with an input its tool accepts, and a text turn
 * at the end. The other is a script that broke the way scripts break: a patch
 * whose anchor is not in the page any more, and a tool that no longer exists.
 * The test asserts the lint says which turn and which tool, because that is
 * what the author fixes from.
 */

// better-sqlite3 in this workspace is rebuilt for Electron's ABI; skip under a
// plain-node runner that cannot load it rather than failing the whole suite.
const skip = await (async () => {
  try {
    new SqliteIndex(join(mkdtempSync(join(tmpdir(), 'qale-lint-abi-')), 'index.db')).close();
    return false;
  } catch (err) {
    return (
      (err as NodeJS.ErrnoException).code === 'ERR_DLOPEN_FAILED' &&
      'better-sqlite3 built for a different ABI'
    );
  }
})();

const repoRoot = repoRootFrom(import.meta.dirname);
const FIXTURES = join('apps', 'desktop', 'test', 'fixtures');

/** The one finding whose address is `where`, or a readable failure. */
function at(findings: Finding[], where: string): Finding {
  const hit = findings.find((f) => f.where === where);
  assert.ok(hit, `no finding at "${where}", only: ${findings.map((f) => f.where).join(' | ')}`);
  return hit;
}

test(
  'a script that works comes back clean, on the anchor day and twelve days later',
  { skip },
  async () => {
    const report = await lintScenarios({
      repoRoot,
      dir: FIXTURES,
      scenario: 'lint-pass',
      offsets: [0, 12],
      engineCheck: false,
    });
    assert.deepEqual(report.errors, [], 'no errors');
    assert.deepEqual(report.warnings, [], 'no warnings');
    assert.equal(report.scenarios, 1);
  },
);

test(
  'a stale patch and a tool that is gone are both named, by turn and by tool',
  { skip },
  async () => {
    const report = await lintScenarios({
      repoRoot,
      dir: FIXTURES,
      scenario: 'lint-fail',
      offsets: [0],
      engineCheck: false,
    });

    assert.equal(
      report.errors.length,
      3,
      `three errors, got: ${report.errors.map((e) => e.where)}`,
    );

    // The patch: the tool's own refusal, carried through word for word.
    const patch = at(report.errors, 'stale-patch turn 0 propose_update');
    assert.equal(patch.scenario, 'lint-fail');
    assert.match(patch.message, /^Rejected:/);
    assert.match(patch.message, /search text is not in customers\/fjord-sports\.md/);

    // The tool: named before anything is run, because there is nothing to run.
    const gone = at(report.errors, 'stale-patch turn 1 propose_ticket_comment');
    assert.match(gone.message, /no tool called "propose_ticket_comment"/);

    // And the script ends on a tool call, which is one turn past the script.
    const ending = at(report.warnings, 'stale-patch');
    assert.match(ending.message, /does not end on a text-only turn/);

    // A watch under a plain typed session, with no use_skill before it: the
    // tool exists, but nothing in force grants `track-external`.
    const ungranted = at(report.errors, 'no-skill-in-force turn 0 track_external');
    assert.match(ungranted.message, /does not have "track_external"/);
    assert.match(ungranted.message, /no use_skill call before this turn/);
  },
);

test(
  'a use_skill call runs for real and turns on the tools that skill grants for the turns after it',
  { skip },
  async () => {
    const report = await lintScenarios({
      repoRoot,
      dir: FIXTURES,
      scenario: 'lint-use-skill',
      offsets: [0],
      engineCheck: false,
    });
    assert.deepEqual(report.errors, [], 'no errors');
    assert.deepEqual(report.warnings, [], 'no warnings');
    assert.equal(report.scenarios, 1);
  },
);
