import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cardTargetTitle,
  groupByTarget,
  newPageFacts,
  targetKey,
  type TargetCard,
} from '../src/index.js';

// One row per thing that changes (docs/review-rework.md RR-3). The rule the
// whole thing rests on: two cards sit together only when they change the same
// thing, so a person reads the review by asking "what happens to this?".

let n = 0;
const patch = (path: string): TargetCard => ({
  id: `p${++n}`,
  kind: 'update',
  targetPath: path,
  payload: { path },
});

test('the key is the file, whatever the card does to it', () => {
  assert.equal(targetKey(patch('todos/reply-marcus.md')), 'path:todos/reply-marcus.md');
  // A new page carries its path in the payload only.
  assert.equal(
    targetKey({ id: 'x', kind: 'note', payload: { path: 'todos/re-scope.md' } }),
    'path:todos/re-scope.md',
  );
});

test('a send keys on the item it touches, so it never joins a page edit', () => {
  const comment: TargetCard = {
    id: 'x',
    kind: 'outbound',
    payload: { targetId: 'SCH-118' },
  };
  assert.equal(targetKey(comment), 'ref:SCH-118');
  // A new ticket and a calendar event name nothing that exists yet.
  assert.equal(targetKey({ id: 'y', kind: 'outbound', payload: {} }), null);
});

test('two changes to one to-do are one group', () => {
  const due: TargetCard = {
    id: 'a',
    kind: 'update',
    targetPath: 'todos/reply-marcus.md',
    payload: { path: 'todos/reply-marcus.md' },
  };
  const text = patch('todos/reply-marcus.md');
  const groups = groupByTarget([due, text, patch('customers/cafe-nord.md')]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0]!.cards, [due, text]);
  assert.equal(groups[0]!.key, 'path:todos/reply-marcus.md');
  assert.equal(groups[1]!.cards.length, 1);
});

test('cards from one meeting that touch different pages stay apart', () => {
  const groups = groupByTarget([
    patch('customers/fjord-sports.md'),
    patch('customers/cafe-nord.md'),
    patch('todos/reply-marcus.md'),
  ]);
  assert.deepEqual(
    groups.map((g) => g.cards.length),
    [1, 1, 1],
  );
});

test('a card that names no target keeps a row of its own', () => {
  const alone = (id: string): TargetCard => ({ id, kind: 'outbound', payload: {} });
  const groups = groupByTarget([alone('a'), alone('b')]);
  assert.equal(groups.length, 2);
});

test('what is left after a partial approval is still the same group', () => {
  const cards = [
    patch('todos/reply-marcus.md'),
    patch('todos/reply-marcus.md'),
    patch('todos/reply-marcus.md'),
  ];
  const before = groupByTarget(cards)[0]!;
  const after = groupByTarget(cards.slice(1))[0]!;
  assert.equal(before.key, after.key);
  assert.equal(after.cards.length, 2);
});

test('the cards come back as the very ones that went in', () => {
  const cards = [patch('notes/h2-capacity.md'), patch('notes/h2-capacity.md')];
  assert.equal(groupByTarget(cards)[0]!.cards[0], cards[0]);
});

// The row leads with the page's real name (docs/review-rework.md). A prettified
// filename is the last resort, never the first answer.

test('an existing page is named by the workspace, not by its filename', () => {
  assert.equal(
    cardTargetTitle({
      kind: 'update',
      targetPath: 'todos/tell-fjord-sports-payroll-timeline.md',
      knownTitle: 'Tell Fjord Sports the payroll timeline',
    }),
    'Tell Fjord Sports the payroll timeline',
  );
  // Nothing knows it yet: the filename, de-slugged, is all there is.
  assert.equal(
    cardTargetTitle({ kind: 'update', targetPath: 'todos/reply-marcus-swap-eta.md' }),
    'Reply Marcus Swap Eta',
  );
});

test('a new page names itself, because nothing else knows it', () => {
  assert.equal(
    cardTargetTitle({
      kind: 'note',
      targetPath: 'todos/2026-09-07-re-scope-sch-240.md',
      frontmatter: { type: 'todo', title: 'Re-scope SCH-240 and give a real estimate' },
    }),
    'Re-scope SCH-240 and give a real estimate',
  );
});

test('a card with nothing to name says what kind of page it is', () => {
  assert.equal(cardTargetTitle({ kind: 'update', targetPath: '' }), 'a page');
});

// Line two of a row that creates a page: the facts a person checks, then what
// the page says.

test('a new to-do says who owes it, when it is due, and what it is', () => {
  assert.deepEqual(
    newPageFacts({
      kind: 'note',
      frontmatter: {
        type: 'todo',
        title: 'Re-scope SCH-240',
        due: '2026-09-24',
        owner: '[[people/rebecca-holm]]',
      },
      body: "> I'll re-scope SCH-240 properly.\n> — [[meetings/2026-09-07-steering]]\n",
    }),
    {
      facts: ['Waiting on [[people/rebecca-holm]]', 'Due 24 Sep'],
      line: "I'll re-scope SCH-240 properly.",
      quoted: true,
    },
  );
});

test('a bare-name owner stays a name, and a plain to-do body is not a quote', () => {
  assert.deepEqual(
    newPageFacts({
      kind: 'note',
      frontmatter: { type: 'todo', title: 'Confirm the date', owner: 'Tom Devlin' },
      body: 'Tom confirms the SCIM date.',
    }),
    { facts: ['Waiting on Tom Devlin'], line: 'Tom confirms the SCIM date.', quoted: false },
  );
});

test('the PM’s own to-do names no owner, and a missing date drops a part', () => {
  assert.deepEqual(
    newPageFacts({
      kind: 'note',
      frontmatter: { type: 'todo', title: 'Answer Marcus' },
      body: 'Say "before September" and nothing tighter.',
    }),
    { facts: [], line: 'Say "before September" and nothing tighter.', quoted: false },
  );
});

test('a new meeting page says only the day, nothing about who sat in it or what it says', () => {
  assert.deepEqual(
    newPageFacts({
      kind: 'note',
      frontmatter: {
        type: 'meeting',
        title: 'Steering: H2 priorities',
        date: '2026-09-07',
        participants: ['Åsa Lindgren', 'Rebecca Holm', 'Erik'],
      },
      body: '## Summary\n\nThe H2 order flipped.',
    }),
    { facts: ['7 Sep'], line: '', quoted: false },
  );
});

test('a page with nothing but prose says its first line, never as a quote', () => {
  assert.deepEqual(
    newPageFacts({ kind: 'decision', frontmatter: { type: 'decision' }, body: 'Swaps ship first.' }),
    { facts: [], line: 'Swaps ship first.', quoted: false },
  );
  assert.deepEqual(
    newPageFacts({ kind: 'decision', frontmatter: { type: 'decision' }, body: '> Swaps first.' }),
    { facts: [], line: 'Swaps first.', quoted: false },
  );
  assert.deepEqual(newPageFacts({ kind: 'note', frontmatter: {}, body: '' }), {
    facts: [],
    line: '',
    quoted: false,
  });
});
