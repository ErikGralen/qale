import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProposalDTO } from '@qale/ipc';
import { waitingElsewhere, type AttentionItem } from '../src/renderer/src/lib/attention.js';
import {
  receiptEntry,
  receiptOf,
  receiptSummary,
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
// The session review: the tally
// ---------------------------------------------------------------------------

test('the tally names only what happened', () => {
  assert.equal(receiptSummary({ accepted: 2, rejected: 1 }), 'Approved 2, discarded 1');
  assert.equal(receiptSummary({ accepted: 2, rejected: 0 }), 'Approved 2');
  assert.equal(receiptSummary({ accepted: 0, rejected: 2 }), 'Discarded 2');
});

// ---------------------------------------------------------------------------
// Chat: the resolved-cards receipt
// ---------------------------------------------------------------------------

test('every kind of card has its own past tense', () => {
  assert.deepEqual(receiptEntry(card('a', { kind: 'note', targetPath: 'insights/pricing.md' })), {
    id: 'a',
    verb: 'Created',
    note: { title: 'Pricing', path: 'insights/pricing.md' },
  });
  assert.deepEqual(receiptEntry(card('b', { kind: 'update', targetPath: 'themes/pricing.md' })), {
    id: 'b',
    verb: 'Updated',
    note: { title: 'Pricing', path: 'themes/pricing.md' },
  });
  assert.deepEqual(
    receiptEntry(card('c', { kind: 'decision', targetPath: 'decisions/2026-07-28-scim.md' })),
    { id: 'c', verb: 'Decided', note: { title: 'SCIM', path: 'decisions/2026-07-28-scim.md' } },
  );
  // An outbound card touched no note, so it carries the sentence instead.
  assert.deepEqual(
    receiptEntry(
      card('d', {
        kind: 'outbound',
        payload: {
          action: 'comment_ticket',
          targetId: 'PAY-142',
        } as unknown as ProposalDTO['payload'],
      }),
    ),
    { id: 'd', verb: 'Sent', sent: 'Commented on PAY-142' },
  );
});

test('a create card with no target path still names what it wrote', () => {
  const entry = receiptEntry(
    card('a', {
      kind: 'note',
      payload: { path: 'insights/scim.md' } as unknown as ProposalDTO['payload'],
    }),
  );
  assert.deepEqual(entry.note, { title: 'SCIM', path: 'insights/scim.md' });
});

test('the receipt counts both answers and reports consequences for one', () => {
  const receipt = receiptOf([
    card('c', { status: 'rejected', created: NOW + 2 }),
    card('a', {
      status: 'accepted',
      created: NOW,
      targetPath: 'themes/pricing.md',
      kind: 'update',
    }),
    card('b', { status: 'accepted', created: NOW + 1, targetPath: 'insights/scim.md' }),
    // Neither of these was a decision of the PO's, so neither is in the tally.
    card('d', { status: 'pending' }),
    card('e', { status: 'withdrawn' as ProposalDTO['status'] }),
  ]);
  assert.equal(receipt.accepted, 2);
  assert.equal(receipt.rejected, 1);
  assert.deepEqual(
    receipt.entries.map((e) => `${e.verb} ${e.note?.title}`),
    ['Updated Pricing', 'Created SCIM'],
  );
});

test('a session that proposed nothing gets no receipt', () => {
  assert.deepEqual(receiptOf([]), { accepted: 0, rejected: 0, entries: [] });
});

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

function item(id: string, extra: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id,
    kind: 'card',
    label: id,
    meta: 'to approve',
    tone: 'brand',
    target: { open: 'session', sessionId: 'session-1', title: 'Session' },
    ...extra,
  };
}

test('the door counts what waits elsewhere, never this session’s own cards', () => {
  const items = [
    item('card:p1'),
    item('card:p2'),
    item('card:p3'),
    item('question:s2', { kind: 'question' }),
    // The librarian's own question can always wait, so no door counts it.
    item('question:s3', { kind: 'question', quiet: true }),
    // The clock's items are attention, but no session is waiting on them.
    item('todo:todos/a.md', { kind: 'todo' }),
  ];
  assert.equal(waitingElsewhere(items, ['p1', 'p2']), 2);
  assert.equal(waitingElsewhere(items, []), 4);
  assert.equal(waitingElsewhere([], ['p1']), 0);
});
