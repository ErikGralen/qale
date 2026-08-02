import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEndQuietlyTool,
  ranSilent,
  readsAsNothingToReport,
  type RunOutcome,
} from '../src/quiet.js';

/**
 * A scheduled run that finds nothing should leave nothing (QM ticket 2). Three
 * things have to hold: the backstop reads only the LAST line, work the run
 * actually produced always outranks whatever the model said about it, and the
 * tool does nothing at all on a turn a person is waiting for.
 */

const run = (tool: { execute: unknown }) =>
  (tool.execute as (id: string, p: unknown) => Promise<{ content: { text: string }[] }>)(
    'call-1',
    {},
  );

const outcome = (over: Partial<RunOutcome> = {}): RunOutcome => ({
  scheduled: true,
  failed: false,
  produced: false,
  ended: false,
  blocked: false,
  finalText: '',
  ...over,
});

// --- the backstop --------------------------------------------------------

test('the backstop matches a closing line and ignores everything above it', () => {
  assert.equal(readsAsNothingToReport('Nothing to report.'), true);
  assert.equal(
    readsAsNothingToReport('I read the four interviews.\n\nNothing new since Monday.'),
    true,
  );
  // Decoration is formatting, not words.
  assert.equal(readsAsNothingToReport('**Nothing to report.**'), true);
  assert.equal(readsAsNothingToReport('- nothing changed\n\n   \n'), true);
});

test('the backstop reads only the last line, so a real report still gets delivered', () => {
  // The marker is in the reply, and the reply is a report. It must be delivered.
  const report =
    'Nothing to report on pricing.\n\nThree interviews landed since Monday and all three hit onboarding:\n' +
    '- Nordkap could not invite their own team\n- Kranelund gave up on step two\n- Bergman & Falk asked for SSO again';
  assert.equal(readsAsNothingToReport(report), false);
  // Same sentence, mid-reply rather than last.
  assert.equal(readsAsNothingToReport('Nothing changed upstream.\nPAY-142 moved to done.'), false);
});

test('a closing line long enough to carry a fact is a report, not a shrug', () => {
  assert.equal(
    readsAsNothingToReport(
      'Nothing new on pricing, but the Nordkap renewal moved to Q4 and Åsa wants a call about it.',
    ),
    false,
  );
});

test('the backstop stays out of runs it was not asked about', () => {
  assert.equal(readsAsNothingToReport(''), false);
  assert.equal(readsAsNothingToReport('   \n\n  '), false);
  assert.equal(readsAsNothingToReport('I found nothing worth reporting, so I stopped.'), false);
});

// --- what makes a run silent --------------------------------------------

test('a run that produced a card is never silent, however it signed off', () => {
  // Both doors closed by the same fact: the model called the tool, AND its last
  // line reads as a shrug. A card in the Inbox outranks both.
  assert.equal(ranSilent(outcome({ produced: true, ended: true })), false);
  assert.equal(ranSilent(outcome({ produced: true, finalText: 'Nothing to report.' })), false);
  assert.equal(
    ranSilent(outcome({ produced: true, ended: true, finalText: 'Nothing to report.' })),
    false,
  );
});

test('only a scheduled run can be silent, and only one that did not break', () => {
  assert.equal(ranSilent(outcome({ scheduled: false, ended: true })), false);
  assert.equal(ranSilent(outcome({ scheduled: false, finalText: 'Nothing to report.' })), false);
  // A scheduled run that broke stays visible: it is exactly the one to look at.
  assert.equal(ranSilent(outcome({ failed: true, ended: true })), false);
  assert.equal(ranSilent(outcome({ failed: true, finalText: 'Nothing changed.' })), false);
});

test('either the tool or the backstop is enough on a scheduled run', () => {
  assert.equal(ranSilent(outcome({ ended: true })), true);
  assert.equal(ranSilent(outcome({ finalText: 'Nothing to report.' })), true);
  // Neither: an ordinary answer keeps its receipt and its row.
  assert.equal(ranSilent(outcome({ finalText: 'Three interviews landed since Monday.' })), false);
});

test('a run stopped for want of a decision leaves nothing, whatever it said on the way out', () => {
  // It was told to stop and write nothing, so it never reaches the backstop's
  // vocabulary — waiting for it to would hand the PM a row for a run that
  // stopped (QM ticket 9). Its trace is the line on the agent's own page.
  assert.equal(ranSilent(outcome({ blocked: true })), true);
  assert.equal(
    ranSilent(outcome({ blocked: true, finalText: 'I need to know which reading to follow.' })),
    true,
  );
  // The floors still hold: a person's turn is never silent, a break is never
  // silent, and cards it managed to propose first are still cards.
  assert.equal(ranSilent(outcome({ blocked: true, scheduled: false })), false);
  assert.equal(ranSilent(outcome({ blocked: true, failed: true })), false);
  assert.equal(ranSilent(outcome({ blocked: true, produced: true })), false);
});

// --- the tool ------------------------------------------------------------

test('end_quietly is a no-op on a turn a person started', async () => {
  let ended = false;
  const tool = createEndQuietlyTool({ scheduled: () => false, endQuietly: () => (ended = true) });
  const said = (await run(tool)).content[0]!.text;
  assert.equal(ended, false, 'an interactive turn must not be marked silent');
  assert.match(said, /person started this session/);
  assert.match(said, /Answer them directly/);
});

test('end_quietly ends a scheduled turn', async () => {
  let ended = false;
  const tool = createEndQuietlyTool({ scheduled: () => true, endQuietly: () => (ended = true) });
  const said = (await run(tool)).content[0]!.text;
  assert.equal(ended, true);
  assert.match(said, /leave no receipt/);
});

test('the same tool is registered on both, and decides per turn', async () => {
  // The asymmetry lives in `scheduled()`, asked at call time, not in which
  // tools exist: the PM can write into a scheduled run and be answered.
  let scheduled = true;
  let ends = 0;
  const tool = createEndQuietlyTool({ scheduled: () => scheduled, endQuietly: () => void ends++ });
  await run(tool);
  scheduled = false;
  await run(tool);
  assert.equal(ends, 1);
});
