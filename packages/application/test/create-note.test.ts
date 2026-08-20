import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeNote, type Frontmatter } from '@qale/domain';
import { createNote } from '../src/index.js';
import type { UseCaseContext } from '../src/ports.js';

// The "+" on a Memory shelf: a blank page of a chosen type. What matters here is
// where the file lands (hubs are named after the thing, notes keep the date),
// that it starts on a lifecycle value, and that the types nobody authors are
// refused even though the renderer never offers them.

interface Stored {
  frontmatter: Frontmatter;
  body: string;
}

function fakeContext(files: Record<string, Stored> = {}) {
  const store = new Map(Object.entries(files));
  const committed: string[] = [];
  const note = (path: string, s: Stored) =>
    makeNote({ path, frontmatter: s.frontmatter, body: s.body, mtime: 1 });
  const ctx = {
    vault: {
      root: () => '/fake',
      ensureScaffold: async () => {},
      readNote: async (p: string) => {
        const s = store.get(p);
        return s ? note(p, s) : null;
      },
      readRaw: async () => null,
      writeNote: async (p: string, frontmatter: Frontmatter, body: string) => {
        store.set(p, { frontmatter, body });
        return note(p, { frontmatter, body });
      },
      writeBody: async () => {
        throw new Error('not used');
      },
      writeRaw: async () => {},
      writeBinary: async () => {},
      remove: async (p: string) => void store.delete(p),
      exists: async (p: string) => store.has(p),
      list: async () => [],
      contain: () => null,
    },
    index: {
      reindex: () => {},
      removeByPath: () => {},
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
    clock: { now: () => '2026-08-14T09:00:00.000Z' },
    proposals: {} as never,
  } as unknown as UseCaseContext;
  return { ctx, store, committed };
}

test('a hub page is named after the thing, with no date in the path', async () => {
  const { ctx, store, committed } = fakeContext();
  const note = await createNote(ctx, { type: 'customer', title: 'Nordkap Payments' });

  assert.equal(note.path, 'customers/nordkap-payments.md');
  const fm = store.get(note.path)!.frontmatter as Record<string, unknown>;
  assert.equal(fm['type'], 'customer');
  assert.equal(fm['title'], 'Nordkap Payments');
  assert.equal(fm['summary'], 'Nordkap Payments');
  assert.equal(fm['relationship'], 'active');
  assert.equal(store.get(note.path)!.body, '');
  assert.deepEqual(committed, ['customers/nordkap-payments.md']);
});

test('a theme starts on a stance, a note keeps its date prefix', async () => {
  const { ctx, store } = fakeContext();
  const theme = await createNote(ctx, { type: 'theme', title: 'On-prem deployment' });
  assert.equal(theme.path, 'themes/on-prem-deployment.md');
  assert.equal((store.get(theme.path)!.frontmatter as Record<string, unknown>)['stance'], 'exploring');

  const note = await createNote(ctx, { type: 'note' });
  assert.equal(note.path, 'notes/2026-08-14-untitled.md');
  assert.equal((store.get(note.path)!.frontmatter as Record<string, unknown>)['title'], 'Untitled');
});

test('a second page of the same name does not clobber the first', async () => {
  const { ctx } = fakeContext();
  const first = await createNote(ctx, { type: 'person', title: 'Sara Lindqvist' });
  const second = await createNote(ctx, { type: 'person', title: 'Sara Lindqvist' });
  assert.equal(first.path, 'people/sara-lindqvist.md');
  assert.equal(second.path, 'people/sara-lindqvist-2.md');
});

test('the types nobody writes from scratch are refused', async () => {
  const { ctx, store } = fakeContext();
  for (const type of ['decision', 'insight', 'meeting', 'ticket'] as const) {
    await assert.rejects(
      () => createNote(ctx, { type: type as never }),
      /not something you write from a blank page/,
    );
  }
  assert.equal(store.size, 0);
});
