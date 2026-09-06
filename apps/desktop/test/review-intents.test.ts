import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProposalDTO } from '@qale/ipc';
import {
  cardIntents,
  causeSentence,
  groupCause,
} from '../src/renderer/src/components/review/cardMeta.js';

/**
 * One card per intent, as the session review reads it (docs/easier-tickets.md E-6).
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
  const groups = cardIntents([patch('insights/pricing.md'), patch('research/pricing.md'), send]);
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

/**
 * The cause line the session review heads a librarian sweep with (RI-3). It has
 * to be true only for a sweep: every card an update, all citing the one
 * decision. An ordinary pile of cards must never wear it, or the review claims
 * a cause that is not there.
 */
function repointed(path: string, cause: string): ProposalDTO {
  return card({
    kind: 'update',
    targetPath: path,
    evidence: [
      { ref: `[[${cause}]]`, resolved: true },
      { ref: '[[meetings/2026-07-14-standup]]', resolved: true },
    ],
    payload: { path, patch: [{ search: 'old', replace: 'new' }], rationale: 'because' },
  });
}

test('cards that all cite the same decision name it as their cause', () => {
  const cause = 'decisions/2026-07-01-ship-in-august';
  const cards = [repointed('insights/pricing.md', cause), repointed('research/pricing.md', cause)];
  assert.equal(groupCause(cards), cause);
  assert.equal(
    causeSentence(cause, cards.length),
    'Because you decided “Ship in August”, 2 notes still point at the old plan',
  );
});

test('one note reads as one note', () => {
  const cause = 'decisions/2026-07-01-ship-in-august';
  assert.equal(
    causeSentence(cause, 1),
    'Because you decided “Ship in August”, 1 note still points at the old plan',
  );
});

test('an ordinary pile has no cause', () => {
  const cause = 'decisions/2026-07-01-ship-in-august';
  // A second decision behind one of the cards: the group is not one sweep.
  assert.equal(
    groupCause([
      repointed('insights/pricing.md', cause),
      repointed('research/pricing.md', 'decisions/2026-06-02-hold-the-price'),
    ]),
    null,
  );
  // A card that creates rather than updates.
  assert.equal(
    groupCause([
      repointed('insights/pricing.md', cause),
      card({ kind: 'decision', targetPath: 'decisions/2026-07-20-new.md' }),
    ]),
    null,
  );
  // Updates with no decision behind them at all.
  assert.equal(groupCause([patch('insights/pricing.md'), patch('research/pricing.md')]), null);
  assert.equal(groupCause([]), null);
});
