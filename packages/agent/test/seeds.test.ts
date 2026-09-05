import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GitTouch, IndexPort, IndexedNote } from '@qale/application';
import { scopedNotes, tagsInUse, whatMoved } from '../src/runtime.js';

/**
 * The two hints that ride under the vault map: the tag vocabulary a proposal
 * draws from (IM-12) and what the PM has been working on (IM-15).
 */

function note(path: string, summary: string): IndexedNote {
  return { path, summary } as unknown as IndexedNote;
}

function indexOf(paths: Record<string, string>): Pick<IndexPort, 'get'> {
  return { get: (path: string) => (paths[path] ? note(path, paths[path]!) : null) };
}

function touches(...days: [string, string][]): GitTouch[] {
  return days.map(([day, prefix]) => ({ day, prefix }));
}

test('tags come back with their counts, most used first', () => {
  const seed = tagsInUse([
    { frontmatter: { tags: ['pricing', 'sso'] } },
    { frontmatter: { tags: ['pricing'] } },
    { frontmatter: { tags: 'pricing' } }, // the single-value shape the schema allows
    { frontmatter: { tags: ['  sso  ', '', 7] } },
    { frontmatter: {} },
  ]);
  assert.match(seed, /## Tags in use/);
  assert.match(seed, /pricing \(3\), sso \(2\)/);
  assert.match(seed, /Take the tags for anything you propose from this list/);
});

test('a workspace with no tags gets no line at all', () => {
  assert.equal(tagsInUse([{ frontmatter: {} }, { frontmatter: { tags: [] } }]), '');
  assert.equal(tagsInUse([]), '');
});

test('what moved counts days, not commits, and says who', () => {
  const seed = whatMoved(
    new Map([
      // Fifteen autosaves in one afternoon are one day.
      [
        'notes/scratch.md',
        touches(
          ['2026-09-04', 'edit'],
          ['2026-09-04', 'edit'],
          ['2026-09-04', 'edit'],
          ['2026-09-04', 'edit'],
        ),
      ],
      [
        'customers/nordkap.md',
        touches(['2026-09-01', 'note'], ['2026-09-03', 'update'], ['2026-09-04', 'edit']),
      ],
      ['decisions/sso.md', touches(['2026-09-02', 'decision'], ['2026-09-03', 'decision'])],
    ]),
    indexOf({
      'notes/scratch.md': 'Friday scratch',
      'customers/nordkap.md': 'Nordkap Payments',
      'decisions/sso.md': 'SSO goes to WorkOS',
    }),
  );

  const lines = seed.split('\n').filter((l) => l.startsWith('- '));
  assert.deepEqual(lines, [
    '- customers/nordkap.md · Nordkap Payments · 3 days · you and Qale',
    '- decisions/sso.md · SSO goes to WorkOS · 2 days · approved or asked',
    '- notes/scratch.md · Friday scratch · 1 day · you',
  ]);
  assert.match(seed, /## What moved this week/);
  assert.match(seed, /A hint about what is in play, not the way in/);
});

test('housekeeping commits do not make a note move', () => {
  const seed = whatMoved(
    new Map([
      ['meetings/a.md', touches(['2026-09-01', 'sync'], ['2026-09-02', 'librarian'])],
      ['index.md', touches(['2026-09-02', 'edit'])],
      ['sessions/s1.md', touches(['2026-09-02', 'session'])],
      ['notes/gone.md', touches(['2026-09-02', 'edit'])], // not in the index
    ]),
    indexOf({ 'meetings/a.md': 'Nordkap check-in', 'index.md': 'map', 'sessions/s1.md': 'run' }),
  );
  assert.equal(seed, '', 'nothing a person did, so no block');
});

test('the list stops at ten', () => {
  const map = new Map<string, GitTouch[]>();
  const paths: Record<string, string> = {};
  for (let i = 0; i < 14; i++) {
    const path = `notes/n${i}.md`;
    map.set(path, touches(['2026-09-01', 'edit'], [`2026-09-0${(i % 4) + 2}`, 'edit']));
    paths[path] = `note ${i}`;
  }
  const lines = whatMoved(map, indexOf(paths))
    .split('\n')
    .filter((l) => l.startsWith('- '));
  assert.equal(lines.length, 10);
});

test('a prefix in neither list still counts the day, and names nobody', () => {
  const seed = whatMoved(
    new Map([['sources/talk.md', touches(['2026-09-01', 'mystery'], ['2026-09-02', 'mystery'])]]),
    indexOf({ 'sources/talk.md': 'A customer call' }),
  );
  assert.match(seed, /- sources\/talk\.md · A customer call · 2 days$/m);
});

/**
 * The scope block (IM-13): the notes a scoped Ask was asked over, listed at
 * session start instead of left for the session to find.
 */

function scoped(
  path: string,
  fm: Record<string, unknown>,
  extra: Partial<IndexedNote> = {},
): IndexedNote {
  return {
    path,
    type: 'note',
    lifecycle: null,
    summary: `about ${path}`,
    mtime: Date.parse('2026-09-01T00:00:00Z'),
    frontmatter: fm,
    ...extra,
  } as unknown as IndexedNote;
}

test('a tag scope lists the notes carrying it, whatever shape the tags are in', () => {
  const seed = scopedNotes({ tags: ['Pricing'] }, [
    scoped('notes/tiers.md', { tags: ['pricing', 'sso'] }),
    scoped('notes/plan.md', { tags: 'PRICING' }), // the single-value shape
    scoped('notes/other.md', { tags: ['sso'] }),
    scoped('notes/bare.md', {}),
    scoped('notes/index.md', { tags: ['pricing'] }), // a folder map, not a note
  ]);
  assert.match(seed, /## Scope/);
  assert.match(seed, /The PM asked this from the #pricing page\./);
  const lines = seed.split('\n').filter((l) => l.startsWith('- '));
  assert.deepEqual(lines, [
    '- notes/plan.md [note] 2026-09-01 — about notes/plan.md',
    '- notes/tiers.md [note] 2026-09-01 — about notes/tiers.md',
  ]);
  assert.match(seed, /Start from these notes, and say so if the answer needs notes outside/);
});

test('a folder scope lists what is under it, and a meeting keeps its own day', () => {
  const seed = scopedNotes({ folder: 'product' }, [
    scoped('notes/product/pricing.md', {}),
    scoped('notes/product/sub/deep.md', {}),
    scoped('notes/other/thing.md', {}),
    scoped('meetings/a.md', { date: '2026-07-14' }, { type: 'meeting', lifecycle: 'processed' }),
  ]);
  assert.match(seed, /The PM asked this from the Documents folder notes\/product\/\./);
  const lines = seed.split('\n').filter((l) => l.startsWith('- '));
  assert.deepEqual(lines, [
    '- notes/product/pricing.md [note] 2026-09-01 — about notes/product/pricing.md',
    '- notes/product/sub/deep.md [note] 2026-09-01 — about notes/product/sub/deep.md',
  ]);
});

test('the list stops at the cap and says how to get the rest', () => {
  const notes = Array.from({ length: 44 }, (_, i) =>
    scoped(`notes/n${String(i).padStart(2, '0')}.md`, { tags: ['pricing'] }),
  );
  const seed = scopedNotes({ tags: ['pricing'] }, notes);
  assert.equal(seed.split('\n').filter((l) => l.startsWith('- ')).length, 40);
  assert.match(seed, /4 more notes carry this tag\. Call vault_list with tags \["pricing"\]/);

  const folderSeed = scopedNotes(
    { folder: 'product' },
    Array.from({ length: 41 }, (_, i) => scoped(`notes/product/n${i}.md`, {})),
  );
  assert.match(
    folderSeed,
    /1 more note is in this folder\. Call vault_list and keep the rows whose path starts with notes\/product\//,
  );
});

test('a scope that matches nothing says so rather than listing nothing', () => {
  const seed = scopedNotes({ tags: ['pricing'] }, [scoped('notes/a.md', { tags: ['sso'] })]);
  assert.match(seed, /## Scope/);
  assert.match(seed, /Nothing in the workspace matches it yet\./);
  assert.equal(seed.split('\n').filter((l) => l.startsWith('- ')).length, 0);
});

test('no scope, no block', () => {
  assert.equal(scopedNotes({}, [scoped('notes/a.md', { tags: ['sso'] })]), '');
  assert.equal(scopedNotes({ tags: [] }, [scoped('notes/a.md', {})]), '');
});
