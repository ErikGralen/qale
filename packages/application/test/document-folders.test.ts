import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeNote } from '@qale/domain';
import {
  createDocumentFolder,
  deleteDocumentFolder,
  renameDocumentFolder,
  getVaultTree,
} from '../src/index.js';
import type { UseCaseContext } from '../src/ports.js';

/**
 * Folders in Documents (docs/documents-folders.md DF-1). A folder is a
 * persistent object: it exists when `notes/<folder>/index.md` exists or a
 * document is in it. Create writes the index stub, delete refuses while
 * anything else is under the folder, and rename moves every file byte for byte
 * with the basenames untouched, so wikilinks survive.
 */

const RAW =
  '---\ntype: note\ntitle: Q3 priorities\nsummary: Q3\nsources: []\nodd_field: kept\n---\n\nBody.\n';

function fakeContext(files: Record<string, string> = {}) {
  const store = new Map(Object.entries(files));
  const committed: string[] = [];
  const messages: string[] = [];
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
        throw new Error('folder work must not re-serialize a note');
      },
      writeBody: async () => {
        throw new Error('not used');
      },
      writeRaw: async (p: string, content: string) => void store.set(p, content),
      writeBinary: async () => {},
      remove: async (p: string) => void store.delete(p),
      exists: async (p: string) => store.has(p),
      list: async () => [...store.keys()].map((path) => ({ path, mtime: 1 })),
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
      commitPaths: async (paths: string[], message: string) => {
        committed.push(...paths);
        messages.push(message);
      },
      history: async () => [],
      fileAt: async () => null,
    },
    clock: { now: () => '2026-09-03T09:00:00.000Z' },
    proposals: {} as never,
  } as unknown as UseCaseContext;
  return { ctx, store, committed, messages, reindexed, removed };
}

// --- create ---------------------------------------------------------------

test('a new folder is its index.md, and the name is cleaned up on the way', async () => {
  const { ctx, store, committed } = fakeContext();
  const made = await createDocumentFolder(ctx, { folder: '  Q3 Plans / ' });

  assert.equal(made.folder, 'q3-plans');
  assert.equal(made.path, 'notes/q3-plans/index.md');
  const stub = store.get('notes/q3-plans/index.md')!;
  assert.match(stub, /^---\ndescription: /);
  assert.match(stub, /# Q3 Plans/);
  assert.deepEqual(committed, ['notes/q3-plans/index.md']);
});

test('a nested folder is fine, and only needs its own index file', async () => {
  const { ctx, store } = fakeContext({ 'notes/specs/index.md': 'stub' });
  const made = await createDocumentFolder(ctx, { folder: 'specs/2026' });
  assert.equal(made.folder, 'specs/2026');
  assert.ok(store.has('notes/specs/2026/index.md'));
});

test('a folder that already exists refuses, whichever way it exists', async () => {
  // By its index file.
  const byIndex = fakeContext({ 'notes/plans/index.md': 'stub' });
  await assert.rejects(
    () => createDocumentFolder(byIndex.ctx, { folder: 'plans' }),
    /already a folder called/,
  );

  // By a document sitting in it (a folder made by moving, before any index).
  const byDoc = fakeContext({ 'notes/plans/q3-priorities.md': RAW });
  await assert.rejects(
    () => createDocumentFolder(byDoc.ctx, { folder: 'plans' }),
    /already a folder called/,
  );
});

test('a folder with no name refuses', async () => {
  const { ctx, store } = fakeContext();
  await assert.rejects(() => createDocumentFolder(ctx, { folder: '  /  ' }), /needs a name/);
  assert.equal(store.size, 0);
});

// --- delete ---------------------------------------------------------------

test('an empty folder deletes: the index file goes, and the index drops it', async () => {
  const { ctx, store, committed, removed } = fakeContext({ 'notes/plans/index.md': 'stub' });
  const gone = await deleteDocumentFolder(ctx, { folder: 'plans' });

  assert.equal(gone.path, 'notes/plans/index.md');
  assert.equal(store.size, 0);
  assert.deepEqual(removed, ['notes/plans/index.md']);
  assert.deepEqual(committed, ['notes/plans/index.md']);
});

test('a folder that still holds anything refuses to delete', async () => {
  // A document at its level.
  const withDoc = fakeContext({
    'notes/plans/index.md': 'stub',
    'notes/plans/q3-priorities.md': RAW,
  });
  await assert.rejects(
    () => deleteDocumentFolder(withDoc.ctx, { folder: 'plans' }),
    /still has files in it/,
  );
  assert.ok(withDoc.store.has('notes/plans/index.md'));

  // A subfolder's index counts too: it is content this delete would orphan.
  const withSub = fakeContext({
    'notes/plans/index.md': 'stub',
    'notes/plans/2026/index.md': 'stub',
  });
  await assert.rejects(
    () => deleteDocumentFolder(withSub.ctx, { folder: 'plans' }),
    /still has files in it/,
  );
});

test('a folder that is not there says so on delete', async () => {
  const { ctx } = fakeContext();
  await assert.rejects(
    () => deleteDocumentFolder(ctx, { folder: 'plans' }),
    /there is no folder called/,
  );
});

// --- rename ---------------------------------------------------------------

test('a rename moves every file under the folder, basenames untouched', async () => {
  const { ctx, store, committed, reindexed, removed } = fakeContext({
    'notes/plans/index.md': 'stub',
    'notes/plans/q3-priorities.md': RAW,
    'notes/plans/2026/roadmap.md': RAW,
  });
  const renamed = await renameDocumentFolder(ctx, { folder: 'plans', name: 'Road Maps' });

  assert.equal(renamed.folder, 'road-maps');
  assert.deepEqual(
    [...store.keys()].sort(),
    ['notes/road-maps/2026/roadmap.md', 'notes/road-maps/index.md', 'notes/road-maps/q3-priorities.md'],
  );
  // Every old path left the index; the documents were reindexed at the new one.
  assert.ok(removed.includes('notes/plans/q3-priorities.md'));
  assert.ok(removed.includes('notes/plans/2026/roadmap.md'));
  assert.ok(reindexed.includes('notes/road-maps/q3-priorities.md'));
  // One commit carrying every old and new path.
  assert.equal(committed.length, 6);
});

test('a rename keeps every file byte for byte', async () => {
  const { ctx, store } = fakeContext({
    'notes/plans/index.md': 'stub bytes',
    'notes/plans/q3-priorities.md': RAW,
  });
  await renameDocumentFolder(ctx, { folder: 'plans', name: 'roadmaps' });
  assert.equal(store.get('notes/roadmaps/q3-priorities.md'), RAW);
  assert.equal(store.get('notes/roadmaps/index.md'), 'stub bytes');
});

test('a rename stays under the same parent', async () => {
  const { ctx, store } = fakeContext({ 'notes/specs/2026/index.md': 'stub' });
  const renamed = await renameDocumentFolder(ctx, { folder: 'specs/2026', name: 'archive' });
  assert.equal(renamed.folder, 'specs/archive');
  assert.ok(store.has('notes/specs/archive/index.md'));
});

test('a rename onto an existing folder refuses', async () => {
  const { ctx, store } = fakeContext({
    'notes/plans/index.md': 'stub',
    'notes/roadmaps/q3-priorities.md': RAW,
  });
  await assert.rejects(
    () => renameDocumentFolder(ctx, { folder: 'plans', name: 'roadmaps' }),
    /already a folder called/,
  );
  assert.ok(store.has('notes/plans/index.md'));
});

test('a rename that changes nothing refuses instead of committing noise', async () => {
  const { ctx, committed } = fakeContext({ 'notes/plans/index.md': 'stub' });
  await assert.rejects(
    () => renameDocumentFolder(ctx, { folder: 'plans', name: 'Plans' }),
    /already the folder/,
  );
  assert.deepEqual(committed, []);
});

test('a folder that is not there says so on rename', async () => {
  const { ctx } = fakeContext();
  await assert.rejects(
    () => renameDocumentFolder(ctx, { folder: 'plans', name: 'roadmaps' }),
    /there is no folder called/,
  );
});

// --- the tree -------------------------------------------------------------

test('an empty folder shows in the vault tree through its index file', async () => {
  const { ctx } = fakeContext({ 'notes/plans/index.md': 'stub', 'notes/index.md': 'root map' });
  const groups = await getVaultTree(ctx);
  const notes = groups.find((g) => g.type === 'note');
  assert.ok(notes, 'the note group exists for the folder alone');
  assert.deepEqual(
    notes!.notes.map((n) => n.path),
    ['notes/plans/index.md'],
  );
  assert.equal(notes!.notes[0]!.title, 'Plans');
});
