import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UseCaseContext } from '@qale/application';
import { createVaultTools } from '../src/tools.js';

/**
 * The two filters the folder maps cannot carry (IM-3, IM-11) and the tool that
 * walks inbound edges (IM-9).
 *
 * A map groups one folder by lifecycle. It says nothing about days and nothing
 * about tags, so a time question and a tag question both land here. What these
 * tests hold down is the part that bites in a real workspace: day fields are
 * unchecked strings, tags are written three different ways, and an edge can
 * outlive the note that wrote it.
 */

const out = async (tool: unknown, params: unknown) =>
  (
    tool as {
      execute: (
        id: string,
        p: unknown,
        s?: AbortSignal,
      ) => Promise<{ content: { text: string }[] }>;
    }
  )
    .execute('call-1', params, undefined)
    .then((r) => r.content[0]!.text);

interface FakeNote {
  path: string;
  slug: string;
  type: string;
  layer: string;
  title: string;
  summary: string;
  lifecycle: string | null;
  mtime: number;
  frontmatter: Record<string, unknown>;
}

const note = (n: Partial<FakeNote> & { path: string }): FakeNote => ({
  slug: n.path.replace(/\.md$/, ''),
  type: 'note',
  layer: 'authored',
  title: n.path,
  summary: 'a summary',
  lifecycle: null,
  mtime: 1_000,
  frontmatter: {},
  ...n,
});

/** A day in June 2026 as a millisecond stamp, for the mtime cases. */
const june = (day: number) => Date.parse(`2026-06-${String(day).padStart(2, '0')}T12:00:00Z`);

function ctxOf(
  notes: FakeNote[],
  links: { fromPath: string; toSlug: string; type?: string; reversed?: boolean }[] = [],
): UseCaseContext {
  return {
    vault: { contain: (p: string) => p, readRaw: async () => null },
    index: {
      all: () => notes,
      get: (p: string) => notes.find((n) => n.path === p) ?? null,
      resolve: (target: string) => {
        const clean = target.replace(/\.md$/, '');
        return (
          notes.find((n) => n.slug === clean)?.path ??
          notes.find((n) => n.slug.split('/').pop() === clean)?.path ??
          null
        );
      },
      backlinks: (slug: string) =>
        links
          .filter((l) => l.toSlug === slug)
          .map((l) => ({ fromPath: l.fromPath, type: l.type, reversed: l.reversed })),
    },
  } as unknown as UseCaseContext;
}

const listTool = (ctx: UseCaseContext) => createVaultTools(ctx)[2]!;
const backlinksTool = (ctx: UseCaseContext) => createVaultTools(ctx)[5]!;

const DAYS = [
  note({
    path: 'meetings/2026-05-31-kickoff.md',
    type: 'meeting',
    frontmatter: { date: '2026-05-31' },
  }),
  note({
    path: 'meetings/2026-06-01-nordkap.md',
    type: 'meeting',
    frontmatter: { date: '2026-06-01' },
  }),
  note({
    path: 'meetings/2026-06-30-review.md',
    type: 'meeting',
    frontmatter: { date: '2026-06-30' },
  }),
  note({
    path: 'meetings/2026-07-01-retro.md',
    type: 'meeting',
    frontmatter: { date: '2026-07-01' },
  }),
];

test('since and until keep both bounds', async () => {
  const got = await out(listTool(ctxOf(DAYS)), { since: '2026-06-01', until: '2026-06-30' });
  assert.match(got, /2026-06-01-nordkap/);
  assert.match(got, /2026-06-30-review/);
  assert.doesNotMatch(got, /kickoff/);
  assert.doesNotMatch(got, /retro/);
});

test('a day the note does not carry as YYYY-MM-DD is undated', async () => {
  const notes = [
    note({ path: 'todos/call-sara.md', type: 'todo', frontmatter: { due: 'next Friday' } }),
    note({ path: 'todos/send-quote.md', type: 'todo', frontmatter: { due: '2026-06-10' } }),
  ];
  // "next Friday" is greater than every real date as a string, so a naive
  // filter would let it through the top bound. It matches nothing instead.
  const filtered = await out(listTool(ctxOf(notes)), { since: '2026-06-01', until: '2026-06-30' });
  assert.match(filtered, /send-quote/);
  assert.doesNotMatch(filtered, /call-sara/);

  const sorted = await out(listTool(ctxOf(notes)), { sort: 'date' });
  const rows = sorted.split('\n');
  assert.match(rows[0]!, /send-quote/);
  assert.match(rows[1]!, /call-sara/);
  // The undated row carries no day at all, rather than an invented one.
  assert.doesNotMatch(rows[1]!, /next Friday|\d{4}-\d{2}-\d{2} —/);
});

test('sort date runs newest first, and the row shows the day', async () => {
  const got = await out(listTool(ctxOf(DAYS)), { sort: 'date' });
  const paths = got.split('\n').map((r) => r.split(' ')[1]!);
  assert.deepEqual(paths, [
    'meetings/2026-07-01-retro.md',
    'meetings/2026-06-30-review.md',
    'meetings/2026-06-01-nordkap.md',
    'meetings/2026-05-31-kickoff.md',
  ]);
  assert.match(got, /meetings\/2026-07-01-retro\.md \[meeting\] 2026-07-01 — /);
});

test('sort title is alphabetical, sort modified is newest change first', async () => {
  const notes = [
    note({ path: 'notes/beta.md', title: 'Beta', mtime: june(1) }),
    note({ path: 'notes/alpha.md', title: 'Alpha', mtime: june(20) }),
  ];
  const byTitle = await out(listTool(ctxOf(notes)), { sort: 'title' });
  assert.match(byTitle.split('\n')[0]!, /notes\/alpha\.md/);

  const byModified = await out(listTool(ctxOf(notes)), { sort: 'modified' });
  assert.match(byModified.split('\n')[0]!, /notes\/alpha\.md/);
  // A note with no day field of its own is dated by its last change.
  assert.match(byModified, /notes\/beta\.md \[note\] 2026-06-01 — /);
});

test('a note with no day field of its own is filtered by its last change', async () => {
  const notes = [
    note({ path: 'customers/nordkap.md', type: 'customer', mtime: june(5) }),
    note({ path: 'customers/kranelund.md', type: 'customer', mtime: june(25) }),
  ];
  const got = await out(listTool(ctxOf(notes)), { since: '2026-06-20' });
  assert.match(got, /kranelund/);
  assert.doesNotMatch(got, /nordkap/);
});

test('tags match any, whether frontmatter holds a list or one string', async () => {
  const notes = [
    note({ path: 'notes/one.md', frontmatter: { tags: ['pricing', 'sso'] } }),
    note({ path: 'notes/two.md', frontmatter: { tags: 'pricing' } }),
    note({ path: 'notes/three.md', frontmatter: { tags: ['onboarding'] } }),
    note({ path: 'notes/four.md' }),
  ];
  const got = await out(listTool(ctxOf(notes)), { tags: ['pricing', 'onboarding'] });
  assert.match(got, /notes\/one\.md/);
  assert.match(got, /notes\/two\.md/);
  assert.match(got, /notes\/three\.md/);
  assert.doesNotMatch(got, /notes\/four\.md/);

  const one = await out(listTool(ctxOf(notes)), { tags: ['sso'] });
  assert.equal(one.split('\n').length, 1);
  assert.match(one, /notes\/one\.md/);
});

test('a tag filter composes with a day filter in one call', async () => {
  const notes = [
    note({
      path: 'meetings/a.md',
      type: 'meeting',
      frontmatter: { date: '2026-06-10', tags: ['pricing'] },
    }),
    note({
      path: 'meetings/b.md',
      type: 'meeting',
      frontmatter: { date: '2026-05-10', tags: ['pricing'] },
    }),
  ];
  const got = await out(listTool(ctxOf(notes)), { since: '2026-06-01', tags: ['pricing'] });
  assert.match(got, /meetings\/a\.md/);
  assert.doesNotMatch(got, /meetings\/b\.md/);
});

test('backlinks group by relationship, and untyped links come last', async () => {
  const notes = [
    note({ path: 'customers/nordkap.md', type: 'customer', title: 'Nordkap' }),
    note({
      path: 'meetings/2026-06-01-nordkap.md',
      type: 'meeting',
      frontmatter: { date: '2026-06-01' },
    }),
    note({
      path: 'decisions/keep-sso.md',
      type: 'decision',
      lifecycle: 'active',
      frontmatter: { date: '2026-06-02' },
    }),
  ];
  const links = [
    { fromPath: 'meetings/2026-06-01-nordkap.md', toSlug: 'customers/nordkap' },
    { fromPath: 'decisions/keep-sso.md', toSlug: 'customers/nordkap', type: 'customer' },
    // The same note, the same relationship, twice: one row.
    { fromPath: 'decisions/keep-sso.md', toSlug: 'customers/nordkap', type: 'customer' },
  ];
  const got = await out(backlinksTool(ctxOf(notes, links)), { path: 'customers/nordkap.md' });
  const headings = got.split('\n').filter((l) => l.startsWith('## '));
  assert.equal(headings.length, 2);
  assert.equal(headings.at(-1), '## Linked from');
  assert.equal(got.match(/decisions\/keep-sso\.md/g)?.length, 1);
  // Rows read like vault_list rows, day and all.
  assert.match(got, /- decisions\/keep-sso\.md \[decision\/active\] 2026-06-02 — /);
});

test('backlinks accept a slug and skip a row whose note is gone', async () => {
  const notes = [
    note({ path: 'customers/nordkap.md', type: 'customer' }),
    note({
      path: 'meetings/2026-06-01-nordkap.md',
      type: 'meeting',
      frontmatter: { date: '2026-06-01' },
    }),
  ];
  const links = [
    { fromPath: 'meetings/2026-06-01-nordkap.md', toSlug: 'customers/nordkap' },
    { fromPath: 'meetings/deleted.md', toSlug: 'customers/nordkap' },
  ];
  const got = await out(backlinksTool(ctxOf(notes, links)), { path: 'nordkap' });
  assert.match(got, /meetings\/2026-06-01-nordkap\.md/);
  assert.doesNotMatch(got, /deleted/);
});

test('backlinks say so when nothing links there, and when the note is not found', async () => {
  const notes = [note({ path: 'customers/nordkap.md', type: 'customer' })];
  assert.match(
    await out(backlinksTool(ctxOf(notes)), { path: 'customers/nordkap.md' }),
    /^Nothing links to customers\/nordkap\.md\.$/,
  );
  assert.match(
    await out(backlinksTool(ctxOf(notes)), { path: 'customers/gone.md' }),
    /^Not found:/,
  );
});
