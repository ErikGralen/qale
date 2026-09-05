import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProposalDTO } from '@qale/ipc';
import { cardIntents } from '../src/renderer/src/components/inbox/cardMeta.js';

/**
 * One card per intent, as the Inbox reads it (docs/easier-tickets.md E-6).
 *
 * The grouping itself is argued in the domain (packages/domain/test/intent.test.ts).
 * What is tested here is the seam: a stored card carries its evidence as rows,
 * not as strings, and the rows the queue draws have to come back as the very
 * same DTOs — a group that hands back a copy would approve a card the PO never
 * saw.
 */

let n = 0;
function card(partial: Partial<ProposalDTO> & Pick<ProposalDTO, 'kind'>): ProposalDTO {
  return {
    id: `p_${++n}`,
    sessionId: 's1',
    skill: null,
    targetPath: null,
    payload: { path: '', rationale: 'because' } as ProposalDTO['payload'],
    rationale: 'because',
    evidence: [],
    inference: false,
    asked: false,
    status: 'pending',
    created: n,
    resolved: null,
    ...partial,
  };
}

function patch(path: string): ProposalDTO {
  return card({
    kind: 'update',
    targetPath: path,
    evidence: [{ ref: '[[meetings/2026-07-14-standup]]', resolved: true }],
    payload: { path, patch: [{ search: 'old', replace: 'new' }], rationale: 'because' },
  });
}

test('a transcript that produced six patches draws one row, not six cards', () => {
  const cards = [
    patch('insights/pricing.md'),
    patch('insights/onboarding.md'),
    patch('insights/support.md'),
  ];
  const groups = cardIntents(cards);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.sentence, 'Edit 3 insights, from Standup');
  // The very cards that went in, not copies of them.
  assert.deepEqual(groups[0]!.cards, cards);
});

test('a send never joins a group, whatever it arrived beside', () => {
  const send = card({
    kind: 'outbound',
    payload: {
      provider: 'jira',
      system: 'jira',
      action: 'comment_ticket',
      targetId: 'PAY-142',
      body: 'Shipping Friday.',
      rationale: 'because',
    } as ProposalDTO['payload'],
  });
  const groups = cardIntents([patch('insights/pricing.md'), patch('themes/pricing.md'), send]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]!.cards.length, 2);
  assert.deepEqual(groups[1]!.cards, [send]);
});

test('a to-do keeps its own card, because a promise is the PO to decide', () => {
  const todo = card({
    kind: 'update',
    targetPath: 'todos/send-scim-quote.md',
    evidence: [{ ref: '[[meetings/2026-07-14-standup]]', resolved: true }],
    payload: {
      path: 'todos/send-scim-quote.md',
      frontmatter: { status: 'done' },
      rationale: 'because',
    },
  });
  const groups = cardIntents([todo, patch('insights/pricing.md')]);
  assert.deepEqual(
    groups.map((g) => g.cards.length),
    [1, 1],
  );
});

test('the row keeps its key while its members are approved away', () => {
  const cards = [
    patch('insights/pricing.md'),
    patch('insights/onboarding.md'),
    patch('insights/support.md'),
  ];
  const before = cardIntents(cards)[0]!;
  const after = cardIntents(cards.slice(1))[0]!;
  assert.equal(before.key, after.key);
  assert.equal(after.sentence, 'Edit 2 insights, from Standup');
});
