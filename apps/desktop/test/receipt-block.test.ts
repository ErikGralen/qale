import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliedReceipt, appliedRowLine, readAppliedReceipt, type AppliedRow } from '@qale/domain';
import type { RevertResultDTO } from '@qale/ipc';
import {
  chipForRow,
  foldsLanded,
  landedSummary,
  landedWrites,
  orderLanded,
  putRowBack,
  rowChange,
  tierForRow,
} from '../src/renderer/src/lib/receipt-block.js';

/**
 * The receipt block in the chat (docs/fewer-approvals.md FA-4). Most writes land
 * without a card, so the block is the only place the PM sees them: what landed,
 * where it went, and the way back on each row. These tests cover the reading and
 * the arithmetic; the drawing is in LandedRows.tsx.
 */

/** One landed tool result, prose and fields, as a tool writes it. */
function result(row: Parameters<typeof appliedRowLine>[0], subject = 'Nordkap check-in'): string {
  return (
    `${appliedReceipt('updated', subject)}.\n` +
    'It is in the workspace now and nothing is waiting on the PM.\n' +
    appliedRowLine(row)
  );
}

const part = (output: string) => ({ type: 'tool-propose_update', output });

test('the fields ride back through a tool result, whole', () => {
  const row = {
    verb: 'Changed' as const,
    activityId: 'a_1',
    proposalId: 'p_1',
    path: 'meetings/2026-09-04-nordkap-check-in.md',
    title: 'Nordkap check-in',
    change: 'Summary, 3 Next steps',
  };
  const receipt = readAppliedReceipt(result(row));
  assert.equal(receipt?.verb, 'Updated');
  assert.deepEqual(receipt?.row, row);
});

test('a result from before the block still draws a row, with no way back', () => {
  const old = `${appliedReceipt('created', 'Acme wants SCIM')}.\nIt is in the workspace now.`;
  assert.deepEqual(landedWrites([part(old)]), [{ verb: 'New', title: 'Acme wants SCIM' }]);
});

test('a write still waiting, and a step that failed, are not rows', () => {
  const waiting = 'Proposed new note (p_x): insights/foo.md. Awaiting review.';
  assert.deepEqual(landedWrites([part(waiting)]), []);
  assert.deepEqual(landedWrites([{ ...part(result({ verb: 'New' })), state: 'output-error' }]), []);
  assert.deepEqual(landedWrites([{ type: 'reasoning', output: result({ verb: 'New' }) }]), []);
});

test('a turn hands back its writes in the order it made them', () => {
  const rows = landedWrites([
    part(result({ verb: 'New', activityId: 'a_1', title: 'Send the dates' })),
    part(result({ verb: 'Changed', activityId: 'a_2', title: 'Rollout runbook' })),
  ]);
  assert.deepEqual(
    rows.map((r) => r.title),
    ['Send the dates', 'Rollout runbook'],
  );
  assert.deepEqual(
    rows.map((r) => r.activityId),
    ['a_1', 'a_2'],
  );
});

const restored = (method: 'patch' | 'snapshot' = 'patch'): RevertResultDTO => ({
  path: 'notes/rollout-runbook.md',
  outcome: 'restored',
  method,
});

test('put back asks for the undo by the row it came from', async () => {
  const asked: string[] = [];
  const result = await putRowBack('a_2', async (id) => {
    asked.push(id);
    return restored();
  });
  assert.deepEqual(asked, ['a_2']);
  assert.deepEqual(result, { ok: true, snapshot: false });
});

test('a row that went back as a whole page says so', async () => {
  assert.deepEqual(await putRowBack('a_2', async () => restored('snapshot')), {
    ok: true,
    snapshot: true,
  });
});

test('a put-back that fails comes back as a sentence, not a throw', async () => {
  const result = await putRowBack('a_2', () => {
    throw new Error('that one is already put back');
  });
  assert.deepEqual(result, {
    ok: false,
    snapshot: false,
    error: 'that one is already put back',
  });
});

/** A landed row, as short as the ordering needs it. */
const at = (path: string, title: string): AppliedRow => ({ verb: 'Changed', path, title });

test('the block orders a turn by tier, in one fixed order', () => {
  // What Qale promised in the PM's name first, then what moved, then their
  // documents, then Qale's own record, then anything that went.
  const rows = orderLanded([
    at('decisions/scim-q2.md', 'SCIM ships in Q2'),
    at('notes/rollout-runbook.md', 'Rollout runbook'),
    { verb: 'Removed', path: 'notes/old.md', title: 'Old pricing' },
    at('todos/confirm-the-date.md', 'Confirm the date'),
    at('meetings/2026-09-04-nordkap.md', 'Nordkap check-in'),
    { verb: 'New todo', path: 'todos/send-the-dates.md', title: 'Send Nordkap the SSO dates' },
    at('people/asa-lind.md', 'Åsa Lind'),
  ]);
  assert.deepEqual(
    rows.map((r) => r.title),
    [
      'Send Nordkap the SSO dates',
      'Confirm the date',
      'Nordkap check-in',
      'Rollout runbook',
      'SCIM ships in Q2',
      'Åsa Lind',
      'Old pricing',
    ],
  );
});

test('a to-do is placed by what happened to it, not by its folder', () => {
  assert.equal(tierForRow({ verb: 'New todo', path: 'todos/a.md', title: 'a' }), 'new-promise');
  assert.equal(tierForRow({ verb: 'Todo done', path: 'todos/b.md', title: 'b' }), 'promise-moved');
  assert.equal(tierForRow({ verb: 'Removed', path: 'todos/c.md', title: 'c' }), 'removed');
  // A meeting page is placed the same way: made, or moved.
  assert.equal(tierForRow({ verb: 'New', path: 'meetings/m.md', title: 'm' }), 'new-promise');
  assert.equal(tierForRow({ verb: 'Changed', path: 'meetings/m.md', title: 'm' }), 'promise-moved');
});

test('an approved send sits between the documents and the memory', () => {
  const rows = orderLanded([
    { verb: 'Sent', title: 'PAY-142', change: 'Commented on PAY-142' },
    at('decisions/scim-q2.md', 'SCIM ships in Q2'),
    at('notes/rollout-runbook.md', 'Rollout runbook'),
  ]);
  assert.deepEqual(
    rows.map((r) => r.title),
    ['Rollout runbook', 'PAY-142', 'SCIM ships in Q2'],
  );
  // A send writes no file, so it is placed by its verb and not by a path.
  assert.equal(tierForRow({ verb: 'Sent', title: 'PAY-142' }), 'sent');
});

test('a row from before the block draws last', () => {
  const old = `${appliedReceipt('created', 'Acme wants SCIM')}.\nIt is in the workspace now.`;
  const rows = orderLanded([
    ...landedWrites([part(old)]),
    at('todos/send-the-dates.md', 'Send the dates'),
  ]);
  // No path and no Activity row, so the line draws its name and stops: no way
  // to open it and no way back (docs/receipt-redesign.md RC-5).
  assert.deepEqual(rows, [
    { verb: 'Changed', path: 'todos/send-the-dates.md', title: 'Send the dates' },
    { verb: 'New', title: 'Acme wants SCIM' },
  ]);
});

/**
 * The fold (Erik, 2026-09-09, reworked twice by 2026-09-11). Seven rows in one
 * turn read as a wall, so from four the block draws one line and holds the rows
 * behind a chevron. The line is words only, in five fixed tiers: what Qale
 * promised in the PM's name, what moved, their documents, Qale's own record,
 * then anything that went. Only a page that went is named, because nothing else
 * on screen says it is gone.
 */

/** A landed row, by its path and title, with the verb the turn gave it. */
const wrote = (path: string, title: string, verb: AppliedRow['verb'] = 'Changed'): AppliedRow => ({
  verb,
  path,
  title,
});

test('three writes are a list, four are a line', () => {
  const rows = [
    wrote('todos/a.md', 'a', 'New todo'),
    wrote('todos/b.md', 'b', 'New todo'),
    wrote('notes/c.md', 'c'),
  ];
  assert.equal(foldsLanded(rows), false);
  assert.equal(foldsLanded([...rows, wrote('insights/d.md', 'd', 'New')]), true);
});

test('the line says the tiers in order, in a few words each', () => {
  // The turn Erik read: three new to-dos, the meeting page, an insight, the
  // customer and the person. Seven rows became six words.
  const summary = landedSummary([
    wrote('todos/a.md', 'Send Lena the October plan in writing', 'New todo'),
    wrote('todos/b.md', 'Send the renewal paperwork', 'New todo'),
    wrote('todos/c.md', 'Tell Lena the reminder fix went out', 'New todo'),
    wrote('meetings/2026-09-10-brasserie-lund.md', 'Brasserie Lund quarterly review'),
    wrote('insights/no-show-fees.md', 'No-show fees has a hard date', 'New'),
    wrote('customers/brasserie-lund.md', 'Brasserie Lund'),
    wrote('people/lena-strand.md', 'Lena Strand'),
  ]);
  assert.equal(summary.text, '3 new todos · meeting page updated · updated memory');
  // The turn made a promise, so the mark over the line is a plus.
  assert.equal(summary.mark, 'new');
});

test('the memory clause is two words, whatever it touched', () => {
  const one = landedSummary([
    wrote('todos/a.md', 'a', 'New todo'),
    wrote('todos/b.md', 'b', 'New todo'),
    wrote('todos/c.md', 'c', 'New todo'),
    wrote('people/lena-strand.md', 'Lena Strand'),
  ]);
  const many = landedSummary([
    wrote('todos/a.md', 'a', 'New todo'),
    wrote('todos/b.md', 'b', 'New todo'),
    wrote('todos/c.md', 'c', 'New todo'),
    wrote('people/lena-strand.md', 'Lena Strand'),
    wrote('customers/nordkap.md', 'Nordkap'),
    wrote('insights/i.md', 'i', 'New'),
    wrote('decisions/d.md', 'd', 'New'),
    wrote('research/r.md', 'r', 'New'),
  ]);
  // Erik's own example line.
  assert.equal(one.text, '3 new todos · updated memory');
  assert.equal(many.text, one.text);
});

test('a to-do that moved says how it moved, in the ledger words', () => {
  const summary = landedSummary([
    wrote('todos/a.md', 'a', 'New todo'),
    wrote('todos/b.md', 'b', 'Todo done'),
    wrote('todos/c.md', 'c', 'Todo done'),
    wrote('todos/d.md', 'd', 'Todo changed'),
  ]);
  assert.equal(summary.text, '1 new todo · 2 todos done · 1 todo changed');
});

test('a turn that only moved things wears a pencil', () => {
  const summary = landedSummary([
    wrote('todos/a.md', 'a', 'Todo done'),
    wrote('meetings/m.md', 'Nordkap check-in'),
    wrote('customers/nordkap.md', 'Nordkap'),
    wrote('insights/i.md', 'They want SCIM', 'New'),
  ]);
  assert.equal(summary.mark, 'changed');
  assert.equal(summary.text, '1 todo done · meeting page updated · updated memory');
});

test('one meeting page or document needs no number, two do', () => {
  const one = landedSummary([
    wrote('meetings/m.md', 'Brasserie Lund quarterly review', 'New'),
    wrote('notes/a.md', 'Rollout runbook', 'New'),
    wrote('notes/b.md', 'Pricing one-pager'),
    wrote('insights/i.md', 'i', 'New'),
  ]);
  assert.equal(one.text, 'New meeting page · new document · document updated · updated memory');
  const two = landedSummary([
    wrote('meetings/a.md', 'Brasserie Lund quarterly review', 'New'),
    wrote('meetings/b.md', 'Nordkap check-in'),
    wrote('notes/a.md', 'Rollout runbook'),
    wrote('notes/b.md', 'Pricing one-pager'),
  ]);
  assert.equal(two.text, 'New meeting page · meeting page updated · 2 documents updated');
});

test('two writes to one page are one page', () => {
  const summary = landedSummary([
    wrote('customers/nordkap.md', 'Nordkap'),
    wrote('customers/nordkap.md', 'Nordkap'),
    wrote('todos/a.md', 'a', 'New todo'),
    wrote('todos/b.md', 'b', 'New todo'),
  ]);
  assert.equal(summary.text, '2 new todos · updated memory');
});

test('a removal is named last, and never folded into a count', () => {
  const summary = landedSummary([
    wrote('todos/a.md', 'a', 'New todo'),
    wrote('todos/b.md', 'b', 'New todo'),
    wrote('insights/c.md', 'c', 'New'),
    wrote('notes/old-runbook.md', 'Old runbook', 'Removed'),
  ]);
  assert.equal(summary.text, '2 new todos · updated memory · removed Old runbook');
  // Its own clause, so the line can draw it in the destructive colour.
  assert.deepEqual(summary.clauses.at(-1), { tier: 'removed', text: 'removed Old runbook' });
});

test('a turn that only removed pages says so on its own', () => {
  const summary = landedSummary([
    wrote('notes/a.md', 'A', 'Removed'),
    wrote('notes/b.md', 'B', 'Removed'),
    wrote('notes/c.md', 'C', 'Removed'),
    wrote('notes/d.md', 'D', 'Removed'),
  ]);
  assert.equal(summary.text, 'Removed A, B, C and 1 more');
});

test('a row put back takes itself out of the line', () => {
  const rows = [
    wrote('todos/a.md', 'a', 'New todo'),
    wrote('todos/b.md', 'b', 'New todo'),
    wrote('customers/nordkap.md', 'Nordkap'),
  ];
  assert.equal(landedSummary(rows).text, '2 new todos · updated memory');
  assert.equal(landedSummary(rows.slice(0, 2)).text, '2 new todos');
  assert.equal(landedSummary([]).text, '');
});

test('only a page that changed says what moved', () => {
  const change = '2 lines added';
  assert.equal(rowChange({ verb: 'Changed', path: 'notes/a.md', title: 'A', change }), change);
  // The title is the whole change on all of these.
  for (const verb of ['New', 'New todo', 'Todo changed', 'Todo done', 'Done', 'Removed'] as const)
    assert.equal(rowChange({ verb, path: 'todos/a.md', title: 'a', change }), undefined);
});

test('an open row hands its chip the page, and a removed one nothing to open', () => {
  assert.deepEqual(chipForRow(wrote('people/lena-strand.md', 'Lena Strand')), {
    path: 'people/lena-strand.md',
    label: 'Lena Strand',
    type: 'person',
  });
  assert.deepEqual(chipForRow(wrote('notes/old.md', 'Old runbook', 'Removed')), {
    path: null,
    label: 'Old runbook',
    type: 'note',
  });
  // A row filed before the block existed carries a name and nothing else.
  assert.deepEqual(chipForRow({ verb: 'New', title: 'Acme wants SCIM' }), {
    path: null,
    label: 'Acme wants SCIM',
    type: null,
  });
});
