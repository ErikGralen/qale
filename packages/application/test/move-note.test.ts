import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeNote } from '@qale/domain';
import { moveNote } from '../src/index.js';
import type { UseCaseContext } from '../src/ports.js';

/**
 * `note:move` — moving a document between the PM's folders in Documents (E-14).
 * A folder is a persistent object (it exists when its index.md exists or a
 * document is in it, see document-folders.test.ts), but a move may still name a
 * folder nobody made first: the write creates the path.
 *
 * Three things must hold, and each has a test below: the file moves byte for
 * byte, the filename never changes (a wikilink resolves by unique basename, so
 * renaming on the way is what would break the backlinks), and nothing outside
 * `notes/` moves at all, because everywhere else the folder IS the note's type.
 */

const RAW =
  '---\ntype: note\ntitle: Q3 priorities\nsummary: Q3\nsources: []\nodd_field: kept\n---\n\nBody.\n';

function fakeContext(files: Record<string, string> = {}) {
  const store = new Map(Object.entries(files));
  const committed: string[] = [];
  const reindexed: string[] = [];
  const removed: string[] = [];
  const ctx = {
    vault: {
      root: () => '/fake',
      ensureScaffold: async () => {},
      readNote: async (p: string) => {
        const raw = store.get(p);
        if (raw === undefined) return null;
        return makeNote({
          path: p,
          frontmatter: { type: 'note', title: 'Q3 priorities', summary: 'Q3', sources: [] },
          body: 'Body.',
          mtime: 1,
        });
      },
      readRaw: async (p: string) => store.get(p) ?? null,
      writeNote: async () => {
        throw new Error('a move must not re-serialize the note');
      },
      writeBody: async () => {
        throw new Error('not used');
      },
      writeRaw: async (p: string, content: string) => void store.set(p, content),
      writeBinary: async () => {},
      remove: async (p: string) => void store.delete(p),
      exists: async (p: string) => store.has(p),
      list: async () => [],
      contain: () => null,
    },
    index: {
      reindex: (n: { path: string }) => void reindexed.push(n.path),
      removeByPath: (p: string) => void removed.push(p),
      get: () => null,
      all: () => [],
      listByType: () => [],
      search: () => [],
      backlinks: () => [],
      resolve: () => null,
      count: () => 0,
      clear: () => {},
    },
    git: {
      available: async () => false,
      isRepo: async () => false,
      init: async () => {},
      commitPaths: async (paths: string[]) => void committed.push(...paths),
      history: async () => [],
      fileAt: async () => null,
    },
    clock: { now: () => '2026-09-02T09:00:00.000Z' },
    proposals: {} as never,
  } as unknown as UseCaseContext;
  return { ctx, store, committed, reindexed, removed };
}

test('a document moves into a folder the PM named, and the folder is the path', async () => {
  const { ctx, store, committed, reindexed, removed } = fakeContext({
    'notes/q3-priorities.md': RAW,
  });
  const note = await moveNote(ctx, { path: 'notes/q3-priorities.md', folder: 'plans' });

  assert.equal(note.path, 'notes/plans/q3-priorities.md');
  assert.equal(store.has('notes/q3-priorities.md'), false);
  assert.deepEqual(committed, ['notes/q3-priorities.md', 'notes/plans/q3-priorities.md']);
  assert.deepEqual(removed, ['notes/q3-priorities.md']);
  assert.deepEqual(reindexed, ['notes/plans/q3-priorities.md']);
});

test('the file moves byte for byte, so a field the schema does not model survives', async () => {
  const { ctx, store } = fakeContext({ 'notes/q3-priorities.md': RAW });
  await moveNote(ctx, { path: 'notes/q3-priorities.md', folder: 'plans' });
  assert.equal(store.get('notes/plans/q3-priorities.md'), RAW);
});

test('the filename never changes, because a backlink resolves by it', async () => {
  const { ctx } = fakeContext({ 'notes/q3-priorities.md': RAW });
  const note = await moveNote(ctx, { path: 'notes/q3-priorities.md', folder: 'plans/2026' });
  assert.match(note.path, /\/q3-priorities\.md$/);
});

test('a folder name is cleaned up, and cannot climb out of Documents', async () => {
  const { ctx } = fakeContext({ 'notes/q3-priorities.md': RAW });
  const note = await moveNote(ctx, { path: 'notes/q3-priorities.md', folder: '  Q3 Plans / ' });
  assert.equal(note.path, 'notes/q3-plans/q3-priorities.md');

  const escape = fakeContext({ 'notes/a.md': RAW });
  const back = await moveNote(escape.ctx, { path: 'notes/a.md', folder: '../../etc' });
  assert.ok(back.path.startsWith('notes/'), `${back.path} left Documents`);
});

test('an empty folder puts the document back at the top of Documents', async () => {
  const { ctx } = fakeContext({ 'notes/plans/q3-priorities.md': RAW });
  const note = await moveNote(ctx, { path: 'notes/plans/q3-priorities.md', folder: '' });
  assert.equal(note.path, 'notes/q3-priorities.md');
});

test('a move that goes nowhere writes nothing', async () => {
  const { ctx, committed } = fakeContext({ 'notes/q3-priorities.md': RAW });
  const note = await moveNote(ctx, { path: 'notes/q3-priorities.md', folder: '' });
  assert.equal(note.path, 'notes/q3-priorities.md');
  assert.deepEqual(committed, []);
});

test('a name already taken in that folder refuses, rather than renaming the file', async () => {
  const { ctx, store } = fakeContext({
    'notes/q3-priorities.md': RAW,
    'notes/plans/q3-priorities.md': RAW,
  });
  await assert.rejects(
    () => moveNote(ctx, { path: 'notes/q3-priorities.md', folder: 'plans' }),
    /already a document called/,
  );
  assert.equal(store.has('notes/q3-priorities.md'), true);
});

test('nothing outside Documents moves, because there the folder is the type', async () => {
  const { ctx, store } = fakeContext({ 'insights/nordkap-needs-scim.md': RAW });
  await assert.rejects(
    () => moveNote(ctx, { path: 'insights/nordkap-needs-scim.md', folder: 'plans' }),
    /only your documents move between folders/,
  );
  assert.equal(store.has('insights/nordkap-needs-scim.md'), true);
});

test('a document that is not there says so', async () => {
  const { ctx } = fakeContext();
  await assert.rejects(
    () => moveNote(ctx, { path: 'notes/gone.md', folder: 'plans' }),
    /there is no note called/,
  );
});
