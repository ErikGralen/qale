import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProposalDTO } from '@qale/ipc';
import {
  batchCount,
  batchSource,
  cardFacts,
  cardGroups,
  cardTitle,
  causeSentence,
  groupCause,
  orderCards,
  sourceRefOf,
} from '../src/renderer/src/components/review/cardMeta.js';

/**
 * The review surface, as it reads a batch of cards (docs/review-rework.md RR-3).
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

const MEETING = '[[meetings/2026-09-07-steering-h2-priorities]]';

function patch(path: string, from = MEETING): ProposalDTO {
  return card({
    kind: 'update',
    targetPath: path,
    evidence: [{ ref: from, resolved: true }],
    payload: { path, patch: [{ search: 'old', replace: 'new' }], rationale: 'because' },
  });
}

function send(targetId?: string): ProposalDTO {
  return card({
    kind: 'outbound',
    evidence: [{ ref: MEETING, resolved: true }],
    payload: {
      provider: 'jira',
      system: 'jira',
      action: 'comment_ticket',
      targetId,
      body: 'Payroll export is moving to Q1.',
      rationale: 'because',
    } as ProposalDTO['payload'],
  });
}

test('two changes to one to-do draw as one group, in the order they came', () => {
  const due = card({
    kind: 'update',
    targetPath: 'todos/reply-marcus-swap-eta.md',
    evidence: [{ ref: MEETING, resolved: true }],
    payload: {
      path: 'todos/reply-marcus-swap-eta.md',
      frontmatter: { due: '2026-09-11' },
      rationale: 'because',
    },
  });
  const text = patch('todos/reply-marcus-swap-eta.md');
  const groups = cardGroups([due, text, patch('customers/cafe-nord.md')]);
  assert.equal(groups.length, 2);
  // The very cards that went in, not copies of them.
  assert.deepEqual(groups[0]!.cards, [due, text]);
  assert.equal(groups[1]!.cards.length, 1);
});

test('cards about different pages never group, however alike they are', () => {
  const groups = cardGroups([patch('customers/fjord-sports.md'), patch('customers/cafe-nord.md')]);
  assert.deepEqual(
    groups.map((g) => g.cards.length),
    [1, 1],
  );
});

test('a send groups with the page edit about the same item, never with anything else', () => {
  const groups = cardGroups([patch('customers/cafe-nord.md'), send('SCH-118'), send()]);
  assert.deepEqual(
    groups.map((g) => g.cards.length),
    [1, 1, 1],
  );
});

test('the batch reads in one order: the meeting, the promises, the documents, then the sends', () => {
  const meeting = patch('meetings/2026-09-07-steering-h2-priorities.md');
  const todo = patch('todos/reply-marcus-swap-eta.md');
  const doc = patch('notes/h2-capacity.md');
  const hub = patch('customers/cafe-nord.md');
  const gone = card({ kind: 'delete', targetPath: 'notes/old.md' });
  const posted = send('SCH-118');
  const order = orderCards([posted, gone, hub, doc, todo, meeting]);
  assert.deepEqual(
    order.map((p) => p.targetPath),
    [
      'meetings/2026-09-07-steering-h2-priorities.md',
      'todos/reply-marcus-swap-eta.md',
      'notes/h2-capacity.md',
      'customers/cafe-nord.md',
      'notes/old.md',
      null,
    ],
  );
});

test('the heading counts the changes and the sends apart', () => {
  assert.equal(batchCount(6, 0), '6 changes');
  assert.equal(batchCount(1, 0), '1 change');
  assert.equal(batchCount(4, 2), '4 changes and 2 sends');
  assert.equal(batchCount(0, 1), '1 send');
});

test('one source for the whole batch is named once; two are named by nobody', () => {
  const one = [patch('customers/cafe-nord.md'), send('SCH-118')];
  assert.equal(batchSource(one), 'meetings/2026-09-07-steering-h2-priorities');
  const two = [patch('customers/cafe-nord.md'), patch('notes/h2.md', '[[sources/2026-08-01-call]]')];
  assert.equal(batchSource(two), null);
  // One card read out of nothing: the heading would be claiming a source that
  // card does not have.
  assert.equal(batchSource([...one, card({ kind: 'decision' })]), null);
  assert.equal(batchSource([]), null);
});

test('the source is the material, never the page being written', () => {
  assert.equal(sourceRefOf(patch('customers/cafe-nord.md')), 'meetings/2026-09-07-steering-h2-priorities');
  assert.equal(sourceRefOf(card({ kind: 'decision', targetPath: 'decisions/x.md' })), '');
});

test('a row leads with the real title, and falls back to the filename', () => {
  const todo = patch('todos/tell-fjord-sports-payroll-timeline.md');
  assert.equal(cardTitle(todo, 'Tell Fjord Sports the payroll timeline'), 'Tell Fjord Sports the payroll timeline');
  assert.equal(cardTitle(todo), 'Tell Fjord Sports Payroll Timeline');
});

test('a new to-do says who owes it and when, before it says anything else', () => {
  const todo = card({
    kind: 'note',
    targetPath: 'todos/2026-09-07-re-scope-sch-240.md',
    payload: {
      path: 'todos/2026-09-07-re-scope-sch-240.md',
      frontmatter: {
        type: 'todo',
        title: 'Re-scope SCH-240 and give a real estimate',
        due: '2026-09-24',
        owner: '[[people/rebecca-holm]]',
      },
      body: "> I'll have a real estimate by next Friday.\n",
      rationale: 'because',
    } as ProposalDTO['payload'],
  });
  assert.equal(cardTitle(todo), 'Re-scope SCH-240 and give a real estimate');
  assert.deepEqual(cardFacts(todo), {
    facts: ['Waiting on [[people/rebecca-holm]]', 'Due 24 Sep'],
    line: "I'll have a real estimate by next Friday.",
    quoted: true,
  });
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
      { ref: MEETING, resolved: true },
    ],
    payload: { path, patch: [{ search: 'old', replace: 'new' }], rationale: 'because' },
  });
}

test('cards that all cite the same decision name it as their cause', () => {
  const cause = 'decisions/2026-07-01-ship-in-august';
  const cards = [repointed('notes/pricing.md', cause), repointed('todos/tell-oskar.md', cause)];
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
      repointed('notes/pricing.md', cause),
      repointed('todos/tell-oskar.md', 'decisions/2026-06-02-hold-the-price'),
    ]),
    null,
  );
  // A card that creates rather than updates.
  assert.equal(
    groupCause([
      repointed('notes/pricing.md', cause),
      card({ kind: 'decision', targetPath: 'decisions/2026-07-20-new.md' }),
    ]),
    null,
  );
  // Updates with no decision behind them at all.
  assert.equal(groupCause([patch('notes/pricing.md'), patch('todos/tell-oskar.md')]), null);
  assert.equal(groupCause([]), null);
});
