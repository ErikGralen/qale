import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeNote, type Frontmatter, type Note, type NoteType } from '@qale/domain';
import { deleteNote, renameNote } from '../src/use-cases/notes.js';
import { VaultBoundaryError } from '../src/ports.js';
import type { IndexedNote, UseCaseContext } from '../src/ports.js';

/**
 * OW8 — a write the containment guard refuses must reach the person who asked
 * for it. These are the use-cases the renderer calls straight through IPC, so
 * "loud" means the promise rejects: `ipcMain.handle` carries a rejection to the
 * renderer, which is what draws the toast.
 *
 * The second half of each test is the half that matters. A refused delete used
 * to return as though it had happened, and every caller here follows one with
 * `index.removeByPath` — so the note vanished from the app while the file sat on
 * disk, and the next reconcile brought it back with no explanation.
 */

function fakeWorld(refuse: (path: string) => boolean) {
  const files = new Map<string, Note>();
  const indexed = new Map<string, IndexedNote>();

  const ctx = {
    vault: {
      root: () => '/fake',
      readNote: async (p: string) => files.get(p) ?? null,
      readRaw: async (p: string) => (files.has(p) ? files.get(p)!.body : null),
      writeNote: async (p: string, frontmatter: Frontmatter, body: string) => {
        if (refuse(p)) throw new VaultBoundaryError(p);
        const note = makeNote({ path: p, frontmatter, body, mtime: 1 });
        files.set(p, note);
        return note;
      },
      writeRaw: async (p: string) => {
        if (refuse(p)) throw new VaultBoundaryError(p);
      },
      writeBinary: async (p: string) => {
        if (refuse(p)) throw new VaultBoundaryError(p);
      },
      remove: async (p: string) => {
        if (refuse(p)) throw new VaultBoundaryError(p);
        files.delete(p);
      },
      exists: async (p: string) => files.has(p),
      list: async () => [],
      contain: (p: string) => (refuse(p) ? null : p),
    },
    index: {
      reindex: (note: Note) => {
        indexed.set(note.path, {
          path: note.path,
          slug: note.slug,
          type: note.type as NoteType,
          layer: note.layer,
          title: note.slug,
          summary: '',
          lifecycle: null,
          hasBody: !!note.body.trim(),
          mtime: 1,
          frontmatter: note.frontmatter as Record<string, unknown>,
          links: [],
        });
      },
      removeByPath: (p: string) => void indexed.delete(p),
      get: (p: string) => indexed.get(p) ?? null,
      all: () => [...indexed.values()],
      backlinks: () => [],
      resolve: () => null,
    },
    git: { commitPaths: async () => {} },
    clock: { now: () => '2026-08-07T09:00:00.000Z' },
  } as unknown as UseCaseContext;

  const seed = (path: string, frontmatter: Frontmatter, body = 'Body.'): void => {
    const note = makeNote({ path, frontmatter, body, mtime: 1 });
    files.set(path, note);
    ctx.index.reindex(note);
  };

  return { ctx, files, indexed, seed };
}

const noteFm = (summary: string): Frontmatter =>
  ({ type: 'note', summary, sources: [] }) as unknown as Frontmatter;

test('deleting a note the guard refuses fails instead of dropping it from the app', async () => {
  const { ctx, files, indexed, seed } = fakeWorld((p) => p.includes('..'));
  seed('notes/../../escape.md', noteFm('a path that should never have been built'));

  await assert.rejects(() => deleteNote(ctx, 'notes/../../escape.md'), VaultBoundaryError);
  assert.ok(files.has('notes/../../escape.md'), 'the file is still there');
  assert.ok(indexed.has('notes/../../escape.md'), 'so the app must not have forgotten it');
});

test('a rename whose old file cannot be removed fails rather than leaving two notes', async () => {
  // The file-moving branch: nothing links here, so `renameNote` writes the new
  // path and deletes the old. If the delete is refused, the caller hears about
  // it — the alternative is one note answering to two addresses forever.
  const { ctx, indexed, seed } = fakeWorld((p) => p === 'notes/old.md');
  seed('notes/old.md', noteFm('Old'));

  await assert.rejects(
    () => renameNote(ctx, { path: 'notes/old.md', title: 'New' }),
    VaultBoundaryError,
  );
  assert.ok(indexed.has('notes/old.md'), 'the old row stands until the move really happened');
});
