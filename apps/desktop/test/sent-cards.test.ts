import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OutboundPayloadDTO, ProposalDTO } from '@qale/ipc';
import { mergeReviewCards, sentCards } from '../src/renderer/src/lib/sent-cards.js';

const T0 = new Date(2026, 8, 11, 12).getTime();

function outbound(over: Partial<OutboundPayloadDTO> = {}): OutboundPayloadDTO {
  return {
    provider: 'jira',
    system: 'jira',
    action: 'create_ticket',
    container: 'Nordkap',
    body: 'A ticket body.',
    rationale: 'Because.',
    ...over,
  };
}

function card(over: Partial<ProposalDTO> = {}): ProposalDTO {
  return {
    id: 'c1',
    kind: 'outbound',
    sessionId: 's1',
    skill: null,
    targetPath: null,
    payload: outbound(),
    rationale: 'Because.',
    evidence: [],
    inference: false,
    asked: false,
    status: 'accepted',
    created: T0,
    resolved: T0 + 1000,
    ...over,
  };
}

test('stored cards that are not accepted sends are dropped', () => {
  const stored = [
    card({ id: 'note', kind: 'note', payload: { title: 'A note', body: '', rationale: '' } as never }),
    card({ id: 'rejected', status: 'rejected' }),
    card({ id: 'pending', status: 'pending', resolved: null }),
    card({ id: 'sent' }),
  ];
  assert.deepEqual(
    sentCards([], stored).map((s) => s.card.id),
    ['sent'],
  );
});

test('a sitting send wins over the stored copy of the same id', () => {
  const stored = card({ id: 'same', payload: outbound({ targetId: undefined }) });
  const landed = card({
    id: 'same',
    payload: outbound({ targetId: 'PAY-171', url: 'https://x.atlassian.net/browse/PAY-171' }),
  });
  const line = { act: 'Created', item: 'PAY-171', url: 'https://x.atlassian.net/browse/PAY-171' };
  const other = card({ id: 'other', created: T0 - 1, resolved: T0 + 5 });

  const out = sentCards([{ card: landed, line, at: T0 + 2000 }], [stored, other]);

  assert.deepEqual(out.map((s) => s.card.id), ['other', 'same']);
  const [old, fresh] = out;
  assert.equal(fresh.fresh, true);
  assert.equal(fresh.at, T0 + 2000);
  assert.equal(fresh.line.url, line.url);
  assert.equal(fresh.line.item, 'PAY-171');
  assert.equal(fresh.card, landed);
  assert.equal(old.fresh, false);
  assert.equal(old.at, T0 + 5);
  assert.equal(old.line.act, 'Created a ticket in Nordkap');
});

test('a stored send takes its line from its payload', () => {
  const stored = card({
    payload: outbound({ action: 'comment_ticket', targetId: 'PAY-142', url: 'https://x/PAY-142' }),
  });
  const [only] = sentCards([], [stored]);
  assert.deepEqual(only.line, { act: 'Commented on', item: 'PAY-142', url: 'https://x/PAY-142' });
});

test('output is sorted by created, oldest first', () => {
  const late = card({ id: 'late', created: T0 + 3 });
  const early = card({ id: 'early', created: T0 + 1 });
  const middle = card({ id: 'middle', created: T0 + 2 });
  const out = sentCards([{ card: middle, line: { act: 'Created' }, at: T0 + 9 }], [late, early]);
  assert.deepEqual(out.map((s) => s.card.id), ['early', 'middle', 'late']);
});

test('mergeReviewCards keeps pending first, then held, then sent, one card per id', () => {
  const pendingA = card({ id: 'a', status: 'pending', resolved: null });
  const pendingB = card({ id: 'b', status: 'pending', resolved: null });
  const heldB = card({ id: 'b' });
  const heldC = card({ id: 'c' });
  const sentA = { card: card({ id: 'a' }), line: { act: 'Created' }, fresh: true, at: T0 };
  const sentC = { card: card({ id: 'c' }), line: { act: 'Created' }, fresh: false, at: T0 };
  const sentD = { card: card({ id: 'd' }), line: { act: 'Created' }, fresh: false, at: T0 };

  const out = mergeReviewCards([pendingA, pendingB], [heldB, heldC], [sentA, sentC, sentD]);

  assert.deepEqual(out.map((c) => c.id), ['a', 'b', 'c', 'd']);
  assert.equal(out[0], pendingA);
  assert.equal(out[0].status, 'pending');
  assert.equal(out[1], pendingB);
  assert.equal(out[2], heldC);
  assert.equal(out[3], sentD.card);
});
