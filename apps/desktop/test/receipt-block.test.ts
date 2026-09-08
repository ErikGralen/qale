import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliedReceipt, appliedRowLine, readAppliedReceipt, type AppliedRow } from '@qale/domain';
import type { RevertResultDTO } from '@qale/ipc';
import {
  blockRows,
  GROUP_WORD,
  groupForRow,
  groupLanded,
  landedWrites,
  memoryFold,
  putRowBack,
  putTurnBack,
  revertableIds,
  turnBackMessage,
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
  // Nothing to put back and nothing to open: the row says what happened and stops.
  assert.deepEqual(revertableIds(landedWrites([part(old)])), []);
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
  assert.deepEqual(revertableIds(rows), ['a_1', 'a_2']);
});

test('the block reads question first, then what landed, then what waits', () => {
  const landed = [
    { verb: 'New' as const, title: 'Send the dates' },
    { verb: 'Changed' as const, title: 'Rollout runbook' },
  ];
  assert.deepEqual(
    blockRows({ question: true, landed, waiting: 1 }).map((r) => r.kind),
    ['question', 'landed', 'landed', 'waiting'],
  );
  // No question and nothing waiting: the landed rows are the whole block.
  assert.deepEqual(
    blockRows({ landed }).map((r) => r.kind),
    ['landed', 'landed'],
  );
  assert.deepEqual(blockRows({}), []);
  assert.equal(blockRows({ landed })[0]?.landed?.title, 'Send the dates');
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

test('putting a turn back works newest first', async () => {
  const asked: string[] = [];
  const result = await putTurnBack(['a_1', 'a_2', 'a_3'], async (id) => {
    asked.push(id);
    return restored();
  });
  assert.deepEqual(asked, ['a_3', 'a_2', 'a_1']);
  assert.deepEqual(result.done, ['a_3', 'a_2', 'a_1']);
  assert.equal(result.failed, undefined);
  assert.equal(turnBackMessage(result), null);
});

test('a turn stops at the first row that will not go back', async () => {
  const asked: string[] = [];
  const result = await putTurnBack(['a_1', 'a_2', 'a_3'], async (id) => {
    asked.push(id);
    if (id === 'a_2') throw new Error('the note it belongs to is gone');
    return restored();
  });
  // a_1 is never asked for: the run stops rather than leaving the PM to work
  // out which half of the turn is still there.
  assert.deepEqual(asked, ['a_3', 'a_2']);
  assert.deepEqual(result.done, ['a_3']);
  assert.deepEqual(result.failed, { id: 'a_2', error: 'the note it belongs to is gone' });
  assert.equal(
    turnBackMessage(result),
    '1 went back, then one would not: the note it belongs to is gone. The rest was left alone.',
  );
});

test('a turn where the first row fails says nothing went back', async () => {
  const result = await putTurnBack(['a_1'], () => {
    throw new Error('this workspace kept no history of that write');
  });
  assert.deepEqual(result.done, []);
  assert.equal(
    turnBackMessage(result),
    'Nothing went back, then one would not: this workspace kept no history of that write. ' +
      'The rest was left alone.',
  );
});

test('a turn that had to fall back to whole pages says so once', async () => {
  const result = await putTurnBack(['a_1', 'a_2'], async () => restored('snapshot'));
  assert.equal(
    turnBackMessage(result),
    'Put back as whole pages. Anything you wrote after those changes went with them.',
  );
});

/** A landed row, as short as the grouping needs it. */
const at = (path: string, title: string): AppliedRow => ({ verb: 'Changed', path, title });

test('the block groups a turn by sphere, in the sidebar order', () => {
  const groups = groupLanded([
    at('decisions/scim-q2.md', 'SCIM ships in Q2'),
    at('notes/rollout-runbook.md', 'Rollout runbook'),
    at('todos/send-the-dates.md', 'Send Nordkap the SSO dates'),
    at('meetings/2026-09-04-nordkap.md', 'Nordkap check-in'),
    at('people/asa-lind.md', 'Åsa Lind'),
  ]);
  assert.deepEqual(
    groups.map((g) => g.group),
    ['todos', 'meeting', 'documents', 'memory'],
  );
  // Anything outside the PM's three folders is Qale's own record, in the order
  // the writes landed.
  assert.deepEqual(
    groups.at(-1)?.rows.map((r) => r.title),
    ['SCIM ships in Q2', 'Åsa Lind'],
  );
  // The words are the sidebar's, and no group carries a count.
  assert.deepEqual(
    groups.map((g) => GROUP_WORD[g.group]),
    ['Todos', 'Meeting', 'Documents', 'Memory'],
  );
});

test('an empty group is not drawn, and a memory-only turn is the line alone', () => {
  const groups = groupLanded([at('decisions/scim-q2.md', 'SCIM ships in Q2')]);
  assert.deepEqual(
    groups.map((g) => g.group),
    ['memory'],
  );
  assert.equal(groups[0]?.rows.length, 1);
});

test('a to-do keeps its group whichever way the write went', () => {
  const rows: AppliedRow[] = [
    { verb: 'New todo', path: 'todos/a.md', title: 'a' },
    { verb: 'Todo done', path: 'todos/b.md', title: 'b' },
    { verb: 'Removed', path: 'todos/c.md', title: 'c' },
  ];
  assert.deepEqual(new Set(rows.map(groupForRow)), new Set(['todos']));
});

test('an approved send sits in its own group, between the documents and the memory', () => {
  const groups = groupLanded([
    { verb: 'Sent', title: 'PAY-142', change: 'Commented on PAY-142' },
    at('decisions/scim-q2.md', 'SCIM ships in Q2'),
    at('notes/rollout-runbook.md', 'Rollout runbook'),
  ]);
  assert.deepEqual(
    groups.map((g) => g.group),
    ['documents', 'sent', 'memory'],
  );
  // A send writes no file, so it is placed by its verb and not by a path.
  assert.equal(groupForRow({ verb: 'Sent', title: 'PAY-142' }), 'sent');
  assert.equal(GROUP_WORD.sent, 'Sent');
  // Nothing to put back: the send left the workspace (RC-3).
  assert.deepEqual(revertableIds(groups[1]?.rows ?? []), []);
});

test('the memory line names four titles, then counts the rest', () => {
  const rows = [1, 2, 3, 4, 5, 6].map((n) => at(`decisions/d-${n}.md`, `Decision ${n}`));
  const folded = memoryFold(rows);
  assert.deepEqual(
    folded.shown.map((r) => r.title),
    ['Decision 1', 'Decision 2', 'Decision 3', 'Decision 4'],
  );
  assert.equal(folded.more, 2);
  // Four or fewer: every title is named and there is nothing to count.
  assert.deepEqual(memoryFold(rows.slice(0, 4)), { shown: rows.slice(0, 4), more: 0 });
  assert.deepEqual(memoryFold([]), { shown: [], more: 0 });
});

test('a row from before the block draws last, in a group with no word', () => {
  const old = `${appliedReceipt('created', 'Acme wants SCIM')}.\nIt is in the workspace now.`;
  const rows = [...landedWrites([part(old)]), at('todos/send-the-dates.md', 'Send the dates')];
  const groups = groupLanded(rows);
  assert.deepEqual(
    groups.map((g) => g.group),
    ['todos', 'other'],
  );
  const last = groups.at(-1);
  // No word over it, and no path or Activity row, so the row draws its name and
  // stops: no way to open it and no way back (docs/receipt-redesign.md RC-5).
  assert.equal(GROUP_WORD[last?.group ?? 'other'], null);
  assert.deepEqual(last?.rows, [{ verb: 'New', title: 'Acme wants SCIM' }]);
  assert.deepEqual(revertableIds(rows), []);
});
