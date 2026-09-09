import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliedReceipt, appliedRowLine, readAppliedReceipt, type AppliedRow } from '@qale/domain';
import type { RevertResultDTO } from '@qale/ipc';
import {
  groupForRow,
  landedWrites,
  orderLanded,
  putRowBack,
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

/** A landed row, as short as the grouping needs it. */
const at = (path: string, title: string): AppliedRow => ({ verb: 'Changed', path, title });

test('the block orders a turn by sphere, in the sidebar order', () => {
  const rows = orderLanded([
    at('decisions/scim-q2.md', 'SCIM ships in Q2'),
    at('notes/rollout-runbook.md', 'Rollout runbook'),
    at('todos/send-the-dates.md', 'Send Nordkap the SSO dates'),
    at('meetings/2026-09-04-nordkap.md', 'Nordkap check-in'),
    at('people/asa-lind.md', 'Åsa Lind'),
  ]);
  // Anything outside the PM's three folders is Qale's own record, last, in the
  // order the writes landed.
  assert.deepEqual(
    rows.map((r) => r.title),
    [
      'Send Nordkap the SSO dates',
      'Nordkap check-in',
      'Rollout runbook',
      'SCIM ships in Q2',
      'Åsa Lind',
    ],
  );
});

test('a to-do keeps its group whichever way the write went', () => {
  const rows: AppliedRow[] = [
    { verb: 'New todo', path: 'todos/a.md', title: 'a' },
    { verb: 'Todo done', path: 'todos/b.md', title: 'b' },
    { verb: 'Removed', path: 'todos/c.md', title: 'c' },
  ];
  assert.deepEqual(new Set(rows.map(groupForRow)), new Set(['todos']));
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
  assert.equal(groupForRow({ verb: 'Sent', title: 'PAY-142' }), 'sent');
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
