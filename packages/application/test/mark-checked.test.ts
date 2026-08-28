import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeNote, trustTier, type Frontmatter, type Note } from '@qale/domain';
import { markNoteChecked, saveFrontmatter } from '../src/use-cases/notes.js';
import type { UseCaseContext } from '../src/ports.js';

/**
 * "Mark as checked" (complexity review, finding 11). The tier a note shows is
 * derived from `verified`, and until this use-case existed nothing a person did
 * could write it: the mutability invariant freezes that field on a meeting and
 * on a session receipt, which are the notes most worth vouching for.
 */

function fakeWorld(today = '2026-08-24') {
  const files = new Map<string, Note>();
  const commits: string[] = [];
  let day = today;

  const ctx = {
    vault: {
      readNote: async (p: string) => files.get(p) ?? null,
      writeNote: async (p: string, frontmatter: Frontmatter, body: string) => {
        const note = makeNote({ path: p, frontmatter, body, mtime: 1 });
        files.set(p, note);
        return note;
      },
    },
    index: { reindex: () => {} },
    git: { commitPaths: async (_paths: string[], message: string) => void commits.push(message) },
    clock: { now: () => `${day}T09:00:00.000Z` },
  } as unknown as UseCaseContext;

  const seed = (path: string, frontmatter: Frontmatter): void => {
    files.set(path, makeNote({ path, frontmatter, body: 'Body.', mtime: 1 }));
  };
  const fmOf = (path: string): Record<string, unknown> =>
    files.get(path)!.frontmatter as Record<string, unknown>;
  const verified = (path: string): { by: string; at: string }[] =>
    (fmOf(path)['verified'] ?? []) as { by: string; at: string }[];

  return { ctx, seed, fmOf, verified, commits, setDay: (d: string) => void (day = d) };
}

const meeting = (): Frontmatter =>
  ({
    type: 'meeting',
    summary: 'Pricing with Nordkap',
    date: '2026-08-20',
    participants: ['Åsa'],
  }) as unknown as Frontmatter;

test('a person can vouch for a meeting, whose frontmatter is otherwise frozen', async () => {
  const { ctx, seed, verified } = fakeWorld();
  seed('meetings/nordkap.md', meeting());

  // The generic door: the invariant refuses, which is why this action has its own.
  await assert.rejects(
    () =>
      saveFrontmatter(ctx, 'meetings/nordkap.md', {
        ...meeting(),
        verified: [{ by: 'human:Erik', at: '2026-08-24' }],
      } as unknown as Frontmatter),
    /immutable/,
  );

  assert.deepEqual(await markNoteChecked(ctx, 'meetings/nordkap.md', 'human:Erik'), { ok: true });
  assert.deepEqual(verified('meetings/nordkap.md'), [{ by: 'human:Erik', at: '2026-08-24' }]);
  assert.equal(trustTier(verified('meetings/nordkap.md')), 'human');
});

test('the same person on the same day is the same check', async () => {
  const { ctx, seed, verified, commits } = fakeWorld();
  seed('meetings/nordkap.md', meeting());

  await markNoteChecked(ctx, 'meetings/nordkap.md', 'human:Erik');
  assert.deepEqual(await markNoteChecked(ctx, 'meetings/nordkap.md', 'human:Erik'), { ok: false });
  assert.equal(verified('meetings/nordkap.md').length, 1, 'a second click adds nothing');
  assert.equal(commits.length, 1, 'and writes nothing');
});

test('checking again another day appends, and nothing already on the note moves', async () => {
  const { ctx, seed, fmOf, verified, setDay } = fakeWorld();
  seed('sessions/2026-08-20-weekly-update.md', {
    type: 'session',
    summary: 'Weekly update',
    verified: [{ by: 'librarian/1', at: '2026-08-21' }],
    reads: ['[[decisions/adopt-workos]]'],
  } as unknown as Frontmatter);

  await markNoteChecked(ctx, 'sessions/2026-08-20-weekly-update.md', 'human:Erik');
  setDay('2026-08-25');
  await markNoteChecked(ctx, 'sessions/2026-08-20-weekly-update.md', 'human:Erik');

  assert.deepEqual(verified('sessions/2026-08-20-weekly-update.md'), [
    { by: 'librarian/1', at: '2026-08-21' },
    { by: 'human:Erik', at: '2026-08-24' },
    { by: 'human:Erik', at: '2026-08-25' },
  ]);
  // The receipt's own fields are the reason this write only ever appends.
  const fm = fmOf('sessions/2026-08-20-weekly-update.md');
  assert.deepEqual(fm['reads'], ['[[decisions/adopt-workos]]']);
  assert.equal(fm['type'], 'session');
});
