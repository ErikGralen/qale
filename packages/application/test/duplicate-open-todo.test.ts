import test from 'node:test';
import assert from 'node:assert/strict';
import {
  duplicateOpenTodo,
  matchOpenTodo,
  todoTitleSimilarity,
  todoTitleTokens,
  type OpenTodo,
} from '../src/use-cases/proposals.js';
import type { IndexedNote, UseCaseContext } from '../src/ports.js';

/**
 * The duplicate check against the ledger (docs/fewer-approvals.md FA-8).
 *
 * A todo lands without a card now, so by the time the second spawn lane looks,
 * the queue `duplicatePending` reads is empty and the commitment is a file. The
 * two things that can break: the scoring, and reading the ledger.
 */

const todo = (path: string, title: string, extra: Partial<OpenTodo> = {}): OpenTodo => ({
  path,
  title,
  ...extra,
});

test('one commitment written two ways scores as the same commitment', () => {
  // The pair the ticket names: two lanes over two transcripts of one meeting.
  assert.equal(todoTitleSimilarity('Send Nordkap the pricing', 'Pricing to Nordkap'), 0.8);
  const hit = matchOpenTodo(
    [todo('todos/2026-09-01-send-nordkap-the-pricing.md', 'Send Nordkap the pricing')],
    { title: 'Pricing to Nordkap' },
  );
  assert.equal(hit?.band, 'same');
  assert.equal(hit?.path, 'todos/2026-09-01-send-nordkap-the-pricing.md');
  assert.equal(hit?.title, 'Send Nordkap the pricing');
});

test('two commitments that share most of their words are near, not the same', () => {
  const hit = matchOpenTodo(
    [todo('todos/2026-09-01-q3-roadmap.md', 'Send Nordkap the Q3 roadmap')],
    { title: 'Send Nordkap the Q4 roadmap' },
  );
  assert.equal(hit?.band, 'near');
});

test('two different commitments match nothing', () => {
  assert.equal(
    matchOpenTodo([todo('todos/2026-09-01-pricing.md', 'Send Nordkap the pricing')], {
      title: 'Book a workshop with Åsa',
    }),
    null,
  );
});

test('one shared word is not a match, however short the titles are', () => {
  // "Call Åsa" against "Call Jonas" is 0.5 on the numbers and two calls in life.
  assert.equal(
    matchOpenTodo([todo('todos/2026-09-01-call-asa.md', 'Call Åsa')], { title: 'Call Jonas' }),
    null,
  );
});

test('titles that normalise to the same words are the same, however short', () => {
  const hit = matchOpenTodo([todo('todos/2026-09-01-ring-asa.md', 'Ring Åsa')], {
    title: 'ring asa',
  });
  assert.equal(hit?.band, 'same');
});

test('stop words carry no weight either side', () => {
  assert.deepEqual(
    [...todoTitleTokens('Send the pricing to Nordkap')].sort(),
    [...todoTitleTokens('Send pricing Nordkap')].sort(),
  );
  assert.equal(todoTitleSimilarity('Send the pricing to Nordkap', 'Send pricing Nordkap'), 1);
});

test('a Swedish todo written twice matches through its endings', () => {
  // "prislistan"/"prislista" and "skicka"/"skickar" are one word each.
  const hit = matchOpenTodo(
    [todo('todos/2026-09-01-prislista.md', 'Skicka prislistan till Nordkap')],
    { title: 'Skickar prislista till Nordkap' },
  );
  assert.equal(hit?.band, 'same');
});

test('English endings fold too, so plural and gerund read as one word', () => {
  assert.equal(todoTitleSimilarity('Confirm the SSO dates', 'Confirmed the SSO date'), 1);
  assert.equal(todoTitleSimilarity('Book the pricing meetings', 'Book the pricing meeting'), 1);
});

test('a shared source and the same owner lower the bar to a question, never past it', () => {
  const ledger = [
    todo(
      'todos/2026-09-01-pricing-sheet.md',
      'Put together the pricing sheet for Nordkap before Friday',
      {
        owner: '[[people/asa-lindqvist]]',
        sources: ['[[meetings/2026-09-01-nordkap-qbr]]'],
      },
    ),
  ];
  const candidate = { title: 'Send Nordkap the pricing' };
  assert.equal(todoTitleSimilarity(ledger[0]!.title, candidate.title), 0.4);

  // On the words alone it is under the near line, so nothing is said.
  assert.equal(matchOpenTodo(ledger, candidate), null);

  // Same meeting, same person: it is worth a question.
  const hit = matchOpenTodo(ledger, {
    ...candidate,
    owner: 'Åsa Lindqvist',
    sources: ['[[meetings/2026-09-01-nordkap-qbr]]'],
  });
  assert.equal(hit?.band, 'near');
});

test('a path the PM cleared stops being a near match, but a same match stands', () => {
  const near = [todo('todos/2026-09-01-q3-roadmap.md', 'Send Nordkap the Q3 roadmap')];
  assert.equal(
    matchOpenTodo(
      near,
      { title: 'Send Nordkap the Q4 roadmap' },
      {
        notTheSameAs: ['todos/2026-09-01-q3-roadmap.md'],
      },
    ),
    null,
  );

  const same = [todo('todos/2026-09-01-pricing.md', 'Send Nordkap the pricing')];
  assert.equal(
    matchOpenTodo(
      same,
      { title: 'Pricing to Nordkap' },
      {
        notTheSameAs: ['todos/2026-09-01-pricing.md'],
      },
    )?.band,
    'same',
  );
});

test('the strongest match wins: same ahead of near', () => {
  const hit = matchOpenTodo(
    [
      todo('todos/a.md', 'Send Nordkap the Q3 roadmap'),
      todo('todos/b.md', 'Send Nordkap the roadmap'),
    ],
    { title: 'Send Nordkap the roadmap' },
  );
  assert.equal(hit?.path, 'todos/b.md');
  assert.equal(hit?.band, 'same');
});

/** An indexed todo, exactly as the index hands one over. */
function indexedTodo(path: string, title: string, lifecycle: string): IndexedNote {
  return {
    path,
    slug: path.replace(/\.md$/, ''),
    type: 'todo',
    layer: 'authored',
    title,
    summary: title,
    lifecycle,
    hasBody: false,
    mtime: 0,
    frontmatter: { type: 'todo', title, commitment: lifecycle, sources: [] },
    links: [],
  } as unknown as IndexedNote;
}

function ledgerWith(todos: IndexedNote[]): UseCaseContext {
  return {
    index: { listByType: (type: string) => (type === 'todo' ? todos : []) },
  } as unknown as UseCaseContext;
}

test('the ledger check reads open todos only', () => {
  const title = 'Send Nordkap the pricing';
  const candidate = { title: 'Pricing to Nordkap' };

  assert.equal(
    duplicateOpenTodo(ledgerWith([indexedTodo('todos/a.md', title, 'open')]), candidate)?.band,
    'same',
  );
  // Closing a promise is not a standing instruction never to make it again.
  assert.equal(
    duplicateOpenTodo(ledgerWith([indexedTodo('todos/a.md', title, 'done')]), candidate),
    null,
  );
  assert.equal(
    duplicateOpenTodo(ledgerWith([indexedTodo('todos/a.md', title, 'dropped')]), candidate),
    null,
  );
});

test('a todo with no commitment field counts as open', () => {
  const note = indexedTodo('todos/a.md', 'Send Nordkap the pricing', 'open');
  const hit = duplicateOpenTodo(ledgerWith([{ ...note, lifecycle: null }]), {
    title: 'Pricing to Nordkap',
  });
  assert.equal(hit?.band, 'same');
});

test('todos nobody has indexed yet are compared alongside the ledger', () => {
  // The in-process guard hands its list over this way: the write of the first
  // lane has not landed, so the index cannot know about it.
  const hit = duplicateOpenTodo(
    ledgerWith([]),
    { title: 'Pricing to Nordkap' },
    { also: [todo('todos/2026-09-08-send-nordkap-the-pricing.md', 'Send Nordkap the pricing')] },
  );
  assert.equal(hit?.band, 'same');
});
