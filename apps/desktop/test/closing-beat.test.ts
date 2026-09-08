import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProposalDTO } from '@qale/ipc';
import {
  appliedRowForCard,
  receiptOf,
  receiptPaths,
} from '../src/renderer/src/components/review/cardMeta.js';

/**
 * The closing beat (docs/closing-beat.md): what a session says when the work is
 * done. Every line it prints is a fact the workspace already holds, so these
 * tests are about where each fact comes from and when it stays off the page. A
 * zero that greets a first-time PO with a tally is the failure this replaced.
 */

/** Local-clock instants, like the attention tests: the day is the PO's. */
const at = (day: number, hour: number, minute = 0): number =>
  new Date(2026, 6, day, hour, minute).getTime();

/** Tuesday 28 July 2026, 09:00. */
const NOW = at(28, 9);

function card(id: string, extra: Partial<ProposalDTO> = {}): ProposalDTO {
  return {
    id,
    kind: 'note',
    sessionId: 'session-1',
    skill: null,
    targetPath: null,
    payload: {} as ProposalDTO['payload'],
    rationale: id,
    evidence: [],
    inference: false,
    asked: false,
    status: 'accepted',
    created: NOW,
    resolved: NOW,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Chat: the resolved-cards receipt
// ---------------------------------------------------------------------------

test('every kind of card lands as the row a silent write would have left', () => {
  // A new page: the verb the landed rows use, the page's own title, and the
  // sections it filled.
  assert.deepEqual(
    appliedRowForCard(
      card('a', {
        kind: 'note',
        payload: {
          path: 'research/pricing.md',
          frontmatter: { title: 'Pricing tiers' },
          body: '## Summary\nThey pay per seat.',
        } as unknown as ProposalDTO['payload'],
      }),
    ),
    {
      verb: 'New',
      proposalId: 'a',
      path: 'research/pricing.md',
      title: 'Pricing tiers',
      change: 'Summary',
    },
  );
  // An edit says what moved, and takes the page's real name from the workspace
  // rather than from its filename.
  assert.deepEqual(
    appliedRowForCard(
      card('b', {
        kind: 'update',
        targetPath: 'notes/rollout-runbook.md',
        payload: {
          patch: [
            {
              search: '## Entra\nWe map groups.',
              replace: '## Entra\nWe map groups.\nSCIM ships in Q2.',
            },
          ],
        } as unknown as ProposalDTO['payload'],
      }),
      'The rollout runbook',
    ),
    {
      verb: 'Changed',
      proposalId: 'b',
      path: 'notes/rollout-runbook.md',
      title: 'The rollout runbook',
      change: 'one line under Entra',
    },
  );
  // A decision is a page that was not there, so it reads as one.
  const decision = appliedRowForCard(
    card('c', {
      kind: 'decision',
      targetPath: 'decisions/2026-07-28-scim.md',
      payload: { body: 'We ship SCIM in Q2.' } as unknown as ProposalDTO['payload'],
    }),
  );
  assert.equal(decision.verb, 'New');
  assert.equal(decision.change, 'We ship SCIM in Q2.');
  // A page that went has no change line: the row's own words are the whole
  // story, and there is nothing left to open.
  const removed = appliedRowForCard(
    card('d', { kind: 'delete', targetPath: 'research/old-pricing.md' }),
  );
  assert.equal(removed.verb, 'Removed');
  assert.equal(removed.change, undefined);
  // A send writes no file, so it carries the thing it touched and the sentence
  // for what happened to it, and no path and no way back.
  assert.deepEqual(
    appliedRowForCard(
      card('e', {
        kind: 'outbound',
        payload: {
          action: 'comment_ticket',
          targetId: 'PAY-142',
        } as unknown as ProposalDTO['payload'],
      }),
    ),
    { verb: 'Sent', proposalId: 'e', title: 'PAY-142', change: 'Commented on PAY-142' },
  );
});

test('an approved to-do says who and when, and skips the mark', () => {
  const row = appliedRowForCard(
    card('a', {
      kind: 'note',
      inference: true,
      payload: {
        path: 'todos/send-nordkap-the-sso-dates.md',
        frontmatter: { title: 'Send Nordkap the SSO dates', type: 'todo', due: '2026-09-11' },
      } as unknown as ProposalDTO['payload'],
    }),
  );
  assert.equal(row.verb, 'New todo');
  assert.equal(row.change, 'you · due 11 Sep');
});

test('the Activity row an approval left is the row’s way back', () => {
  const row = appliedRowForCard(
    card('a', { kind: 'update', targetPath: 'notes/runbook.md', activityId: 'a_7' }),
  );
  assert.equal(row.activityId, 'a_7');
  // A send leaves no Activity row, so the receipt offers nothing to press.
  const sent = appliedRowForCard(
    card('b', {
      kind: 'outbound',
      payload: {
        action: 'update_page',
        title: 'Rollout plan',
      } as unknown as ProposalDTO['payload'],
    }),
  );
  assert.equal(sent.activityId, undefined);
  assert.equal(sent.path, undefined);
});

test('the receipt counts both answers and draws a row for one', () => {
  const receipt = receiptOf([
    card('c', { status: 'rejected', created: NOW + 2, targetPath: 'research/dropped.md' }),
    card('a', {
      status: 'accepted',
      created: NOW,
      targetPath: 'research/pricing.md',
      kind: 'update',
    }),
    card('b', {
      status: 'accepted',
      created: NOW + 1,
      payload: { path: 'research/scim.md' } as unknown as ProposalDTO['payload'],
    }),
    // Neither of these was a decision of the PM's, so neither is in the tally.
    card('d', { status: 'pending' }),
    card('e', { status: 'withdrawn' as ProposalDTO['status'] }),
  ]);
  assert.equal(receipt.accepted, 2);
  assert.equal(receipt.rejected, 1);
  // A discarded card draws nothing: it changed nothing, and the tally has it.
  assert.deepEqual(
    receipt.rows.map((r) => `${r.verb} ${r.title}`),
    ['Changed Pricing', 'New SCIM'],
  );
});

test('the receipt names only the files it has to look up', () => {
  assert.deepEqual(
    receiptPaths([
      card('a', { status: 'accepted', targetPath: 'research/pricing.md' }),
      card('b', { status: 'accepted', targetPath: 'research/pricing.md' }),
      card('c', { status: 'rejected', targetPath: 'research/dropped.md' }),
      card('d', {
        status: 'accepted',
        kind: 'outbound',
        payload: {
          action: 'comment_ticket',
          targetId: 'PAY-1',
        } as unknown as ProposalDTO['payload'],
      }),
    ]),
    ['research/pricing.md'],
  );
});

test('a session that proposed nothing gets no receipt', () => {
  assert.deepEqual(receiptOf([]), { accepted: 0, rejected: 0, rows: [] });
});

test('a write that landed on its own is not something the PM approved', () => {
  // A silent write is an accepted card in the store, but the PM never saw it as
  // one, and the turn that landed it already draws it. Counting it here drew
  // the same to-do twice, under "Approved 2".
  const resolved = [
    card('a', { status: 'accepted', targetPath: 'todos/tell-petra.md', silent: true }),
    card('b', { status: 'accepted', targetPath: 'customers/brunos.md', silent: true }),
    card('c', { status: 'accepted', targetPath: 'notes/runbook.md', created: NOW + 1 }),
  ];
  const receipt = receiptOf(resolved);
  assert.equal(receipt.accepted, 1);
  assert.deepEqual(
    receipt.rows.map((r) => r.path),
    ['notes/runbook.md'],
  );
  assert.deepEqual(receiptPaths(resolved), ['notes/runbook.md']);
});
