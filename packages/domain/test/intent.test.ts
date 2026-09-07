import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cardDisposition,
  groupIntents,
  intentKey,
  intentSentence,
  type IntentCard,
} from '../src/index.js';

// One card per intent (docs/easier-tickets.md E-6). The rule the whole thing
// rests on: a group is what the PM would say out loud, so two cards group only
// when approving both is one act, and the sentence names it.

let n = 0;
const patch = (path: string, from = 'sources/2026-07-14-standup'): IntentCard => ({
  id: `p${++n}`,
  kind: 'update',
  targetPath: path,
  evidence: [`[[${from}]]`],
  payload: { path, patch: [{ search: 'a', replace: 'b' }] },
});

test('a patch over existing text is grouped; a send, a delete and a to-do are not', () => {
  assert.equal(cardDisposition(patch('insights/pricing.md')), 'grouped');
  assert.equal(cardDisposition({ id: 'x', kind: 'outbound' }), 'ask');
  assert.equal(cardDisposition({ id: 'x', kind: 'delete', targetPath: 'notes/old.md' }), 'ask');
  assert.equal(
    cardDisposition({ id: 'x', kind: 'update', targetPath: 'todos/ship-scim.md' }),
    'ask',
  );
  // A rule file does not group either. A rule the PM stated applied silently and
  // never became a card, so a rule file sitting in the queue is one the agent
  // wrote on its own, and that asks on its own row.
  assert.equal(
    cardDisposition({ id: 'x', kind: 'update', targetPath: 'skills/jira/SKILL.md' }),
    'ask',
  );
});

test('an append-only update lands silently, so it is not in the queue to group', () => {
  const card: IntentCard = {
    id: 'x',
    kind: 'update',
    targetPath: 'meetings/2026-07-14-standup.md',
    payload: { append: 'The team agreed to ship on Friday.' },
  };
  assert.equal(cardDisposition(card), 'silent');
  assert.equal(intentKey(card), null);
});

test('cards from one reading of one source are one intent', () => {
  const cards = [
    patch('insights/pricing.md'),
    patch('insights/onboarding.md'),
    patch('insights/support.md'),
  ];
  const groups = groupIntents(cards);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.cards.length, 3);
  assert.equal(groups[0]!.sentence, 'Edit 3 insights, from Standup');
});

test('the sentence names the folder only when they all share one', () => {
  const groups = groupIntents([patch('insights/pricing.md'), patch('research/pricing.md')]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.sentence, 'Edit 2 pages, from Standup');
});

test('two sources are two intents, because they are two sentences', () => {
  const groups = groupIntents([
    patch('insights/pricing.md', 'sources/2026-07-14-standup'),
    patch('insights/onboarding.md', 'meetings/2026-07-15-nordkap'),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((g) => g.cards.length),
    [1, 1],
  );
});

test('setting one field is its own intent, and the value is part of it', () => {
  const set = (path: string, status: string): IntentCard => ({
    id: `s${++n}`,
    kind: 'update',
    targetPath: path,
    evidence: ['[[meetings/2026-07-14-standup]]'],
    payload: { path, frontmatter: { status } },
  });
  const groups = groupIntents([
    set('tickets/jira/PAY-1.md', 'done'),
    set('tickets/jira/PAY-2.md', 'done'),
    set('tickets/jira/PAY-3.md', 'blocked'),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]!.sentence, 'Set status to done on 2 tickets, from Standup');
  assert.equal(groups[1]!.sentence, 'Set status to blocked on 1 ticket, from Standup');
});

test('a decision says so, and never joins the patches beside it', () => {
  const decision = (path: string): IntentCard => ({
    id: `d${++n}`,
    kind: 'decision',
    targetPath: path,
    evidence: ['[[meetings/2026-07-14-standup]]'],
    payload: { path },
  });
  const groups = groupIntents([
    decision('decisions/ship-friday.md'),
    decision('decisions/drop-sso.md'),
    patch('insights/pricing.md', 'meetings/2026-07-14-standup'),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]!.sentence, 'Record 2 decisions, from Standup');
});

test('what is left after a partial approval is still the same group', () => {
  const cards = [
    patch('insights/pricing.md'),
    patch('insights/onboarding.md'),
    patch('insights/support.md'),
    patch('insights/churn.md'),
  ];
  const before = groupIntents(cards)[0]!;
  // The PM approved two. The other two key the same way, so the row stays put
  // and only its count changes — they never read as orphans.
  const after = groupIntents(cards.slice(2))[0]!;
  assert.equal(before.key, after.key);
  assert.equal(after.sentence, 'Edit 2 insights, from Standup');
});

test('a card that groups with nobody comes back as itself, in its own place', () => {
  const alone = patch('insights/pricing.md', 'meetings/2026-07-15-nordkap');
  const pair = [patch('research/pricing.md'), patch('research/support.md')];
  const groups = groupIntents([alone, ...pair]);
  assert.deepEqual(
    groups.map((g) => g.cards.length),
    [1, 2],
  );
  assert.equal(groups[0]!.cards[0]!.id, alone.id);
});

test('with no source to name, the sentence stops rather than pads', () => {
  assert.equal(
    intentSentence([
      { id: 'a', kind: 'update', targetPath: 'notes/one.md', payload: { patch: [] } },
      { id: 'b', kind: 'update', targetPath: 'notes/two.md', payload: { patch: [] } },
    ]),
    'Edit 2 documents',
  );
});
