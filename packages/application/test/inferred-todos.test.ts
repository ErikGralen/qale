import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeNote, type Frontmatter, type Note } from '@qale/domain';
import type { CreateActivityInput, IndexedNote, UseCaseContext } from '../src/ports.js';
import { saveAuthoredNote, saveFrontmatter } from '../src/use-cases/notes.js';
import { setTodoDue, setTodoStatus } from '../src/use-cases/todos.js';

/**
 * The mark on a todo Qale heard rather than was told (docs/fewer-approvals.md
 * FA-7).
 *
 * Two rules are tested here, and the second is why the first matters. The mark
 * comes off the moment the PM does anything to the todo, whichever door they
 * used. And dropping one they never touched deletes the file: the ledger must
 * not remember a promise they say was never made.
 */

interface Stored {
  frontmatter: Frontmatter;
  body: string;
}

function fakeWorld(files: Record<string, Stored>) {
  const store = new Map(Object.entries(files));
  const commits: string[] = [];
  const rows: CreateActivityInput[] = [];
  let links: string[] = [];

  const note = (path: string, s: Stored): Note =>
    makeNote({ path, frontmatter: s.frontmatter, body: s.body, mtime: 1 });

  const ctx = {
    vault: {
      readNote: async (p: string) => {
        const s = store.get(p);
        return s ? note(p, s) : null;
      },
      writeNote: async (p: string, frontmatter: Frontmatter, body: string) => {
        store.set(p, { frontmatter, body });
        return note(p, { frontmatter, body });
      },
      writeBody: async (p: string, body: string) => {
        const s = store.get(p)!;
        store.set(p, { ...s, body });
        return note(p, { ...s, body });
      },
      remove: async (p: string) => void store.delete(p),
      exists: async (p: string) => store.has(p),
    },
    index: {
      reindex: () => {},
      removeByPath: () => {},
      // The one meeting the demo todo cites, so the removal row can name it.
      resolve: (target: string) =>
        target === 'meetings/2026-09-04-nordkap-check-in'
          ? 'meetings/2026-09-04-nordkap-check-in.md'
          : null,
      get: (p: string) =>
        p === 'meetings/2026-09-04-nordkap-check-in.md'
          ? ({ title: 'Nordkap check-in' } as IndexedNote)
          : null,
      backlinks: () => links.map((fromPath) => ({ fromPath })),
    },
    git: {
      commitPaths: async (_paths: string[], message: string) => void commits.push(message),
      history: async () => [{ hash: 'abc123', date: '2026-09-08', message: 'x', author: 'q' }],
    },
    clock: { now: () => '2026-09-08T09:00:00.000Z' },
    activity: {
      record: (input: CreateActivityInput) => {
        rows.push(input);
        return { ...input, id: 'a1', at: 1, reverted: null };
      },
    },
  } as unknown as UseCaseContext;

  return {
    ctx,
    store,
    commits,
    rows,
    fmOf: (p: string) => store.get(p)!.frontmatter as Record<string, unknown>,
    linkTo: (fromPath: string) => void (links = [...links, fromPath]),
  };
}

const PATH = 'todos/2026-09-04-send-nordkap-the-sso-dates.md';

/** A todo as it lands off a transcript: cited, open, undated, and marked. */
const heardTodo = (over: Record<string, unknown> = {}): Record<string, Stored> => ({
  [PATH]: {
    frontmatter: {
      type: 'todo',
      summary: 'Send Nordkap the SSO dates',
      title: 'Send Nordkap the SSO dates',
      commitment: 'open',
      sources: ['[[meetings/2026-09-04-nordkap-check-in]]'],
      inference: true,
      ...over,
    } as unknown as Frontmatter,
    body: "> I'll get those dates over this week.\n",
  },
});

/** The same commitment, but the PM's own word for it: no mark at all. */
const ownTodo = (): Record<string, Stored> => {
  const files = heardTodo();
  delete (files[PATH]!.frontmatter as Record<string, unknown>)['inference'];
  return files;
};

// --- the mark comes off when the PM touches the todo ---

test('dating it takes the mark off', async () => {
  const { ctx, fmOf } = fakeWorld(heardTodo());
  await setTodoDue(ctx, PATH, '2026-09-12');
  assert.equal(fmOf(PATH)['due'], '2026-09-12');
  assert.equal('inference' in fmOf(PATH), false);
});

test('checking it done takes the mark off', async () => {
  const { ctx, fmOf } = fakeWorld(heardTodo());
  await setTodoStatus(ctx, PATH, 'done');
  assert.equal(fmOf(PATH)['commitment'], 'done');
  assert.equal('inference' in fmOf(PATH), false);
});

test('handing it to somebody takes the mark off', async () => {
  const { ctx, fmOf } = fakeWorld(heardTodo());
  await saveFrontmatter(ctx, PATH, {
    ...(fmOf(PATH) as unknown as Frontmatter),
    owner: '[[people/asa-lindqvist]]',
  } as Frontmatter);
  assert.equal(fmOf(PATH)['owner'], '[[people/asa-lindqvist]]');
  assert.equal('inference' in fmOf(PATH), false);
});

test('writing in the body takes the mark off, and keeps every other field', async () => {
  const { ctx, store, fmOf } = fakeWorld(heardTodo({ due: '2026-09-12' }));
  await saveAuthoredNote(ctx, PATH, 'Åsa has the list already.');
  assert.equal(store.get(PATH)!.body, 'Åsa has the list already.');
  assert.equal('inference' in fmOf(PATH), false);
  assert.equal(fmOf(PATH)['due'], '2026-09-12');
  assert.equal(fmOf(PATH)['title'], 'Send Nordkap the SSO dates');
});

test('a body edit on a todo with no mark still writes the body alone', async () => {
  const { ctx, store } = fakeWorld(ownTodo());
  await saveAuthoredNote(ctx, PATH, 'Sent.');
  assert.equal(store.get(PATH)!.body, 'Sent.');
});

// --- dropping one Qale only heard removes it ---

test('dropping an untouched inferred todo deletes the file and leaves no closed row', async () => {
  const { ctx, store, commits } = fakeWorld(heardTodo());
  assert.equal(await setTodoStatus(ctx, PATH, 'dropped'), null);
  assert.equal(store.has(PATH), false);
  assert.ok(
    commits.some((m) => m.startsWith('delete:')),
    `the delete was committed: ${commits.join(' | ')}`,
  );
  assert.ok(
    !commits.some((m) => m.includes('dropped')),
    'no dropped row was written on the way out',
  );
});

test('the removal row says what went, where Qale heard it, and offers it back', async () => {
  const { ctx, rows } = fakeWorld(heardTodo());
  await setTodoStatus(ctx, PATH, 'dropped');
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.action, 'deleted');
  assert.equal(
    row.line,
    'Removed Send Nordkap the SSO dates. Qale had heard it in Nordkap check-in and you said it was not a commitment.',
  );
  assert.equal(row.path, PATH);
  // Put back = the file as the commit before the delete had it.
  assert.deepEqual(row.revert, { commit: 'abc123', undo: 'restore' });
});

test('a todo the PM made is dropped the old way: the record stays', async () => {
  const { ctx, fmOf, rows } = fakeWorld(ownTodo());
  const note = await setTodoStatus(ctx, PATH, 'dropped');
  assert.ok(note, 'the file is still there');
  assert.equal(fmOf(PATH)['commitment'], 'dropped');
  assert.equal(fmOf(PATH)['resolved'], '2026-09-08');
  assert.equal(rows.length, 0);
});

test('a todo something links to is closed, not deleted: the link must not break', async () => {
  const { ctx, fmOf, linkTo, rows } = fakeWorld(heardTodo());
  linkTo('meetings/2026-09-04-nordkap-check-in.md');
  const note = await setTodoStatus(ctx, PATH, 'dropped');
  assert.ok(note, 'the file is still there');
  assert.equal(fmOf(PATH)['commitment'], 'dropped');
  assert.equal('inference' in fmOf(PATH), false, 'and the drop still answered the mark');
  assert.equal(rows.length, 0);
});

test('a todo that cites nothing still gets a row, in one sentence less', async () => {
  const { ctx, rows } = fakeWorld(heardTodo({ sources: [] }));
  await setTodoStatus(ctx, PATH, 'dropped');
  assert.equal(
    rows[0]!.line,
    'Removed Send Nordkap the SSO dates. Qale had heard it and you said it was not a commitment.',
  );
});
