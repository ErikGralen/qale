import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEEDS_SUMMARY_FIELD, BROKEN_FRONTMATTER_FIELD, type NoteType } from '@qale/domain';
import { serializeNote } from '@qale/markdown';
import { normalizeVaultFrontmatter } from '../src/index.js';
import type { IndexedNote, IndexPort, UseCaseContext, VaultPort } from '../src/ports.js';

/**
 * The normalization pass end to end (OW4): which files it reads, what it writes,
 * that an already-clean workspace makes no write and no commit, and that a note
 * whose frontmatter would not parse keeps every byte of it.
 */

function inote(path: string, type: NoteType): IndexedNote {
  return {
    path,
    slug: path.replace(/\.md$/, ''),
    type,
    layer: 'authored',
    title: path,
    summary: '',
    lifecycle: null,
    hasBody: true,
    mtime: Date.UTC(2026, 7, 1),
    frontmatter: {},
    links: [],
  } as IndexedNote;
}

function fakeCtx(files: Record<string, string>, notes: IndexedNote[]) {
  const store = new Map(Object.entries(files));
  const commits: { paths: string[]; message: string }[] = [];
  const reindexed: string[] = [];
  const vault = {
    readRaw: async (p: string) => store.get(p) ?? null,
    writeNote: async (p: string, fm: Record<string, unknown>, body: string) => {
      store.set(p, serializeNote(fm, body));
      return { path: p, slug: p.replace(/\.md$/, ''), frontmatter: fm, body };
    },
  } as unknown as VaultPort;
  const index = {
    all: () => notes,
    get: (p: string) => notes.find((n) => n.path === p) ?? null,
    reindex: (n: { path: string }) => void reindexed.push(n.path),
  } as unknown as IndexPort;
  const git = {
    commitPaths: async (paths: string[], message: string) => void commits.push({ paths, message }),
  } as unknown as UseCaseContext['git'];
  const clock = { now: () => '2026-08-07T09:00:00.000Z' };
  const ctx = { vault, index, git, clock } as unknown as UseCaseContext;
  return { ctx, store, commits, reindexed };
}

test('a thin note is filled, marked, reindexed and committed once', async () => {
  const { ctx, store, commits, reindexed } = fakeCtx(
    {
      'sources/2026-07-30-nordkap.md': '# Nordkap check-in\n\nThey want SCIM first.\n',
      'notes/settled.md': '---\ntype: note\nsummary: A settled note.\n---\n\nBody.\n',
    },
    [inote('sources/2026-07-30-nordkap.md', 'source'), inote('notes/settled.md', 'note')],
  );

  const res = await normalizeVaultFrontmatter(ctx);
  assert.deepEqual(
    res.written,
    ['sources/2026-07-30-nordkap.md'],
    'only the thin one is rewritten',
  );
  assert.deepEqual(res.marked, ['sources/2026-07-30-nordkap.md']);
  assert.deepEqual(reindexed, ['sources/2026-07-30-nordkap.md']);
  assert.equal(commits.length, 1, 'one commit for the batch');

  const written = store.get('sources/2026-07-30-nordkap.md')!;
  assert.match(written, /type: source/);
  assert.match(written, /captured: 2026-07-30/);
  assert.match(written, new RegExp(`${NEEDS_SUMMARY_FIELD}: true`));
  assert.match(written, /They want SCIM first\./, 'the body is carried through untouched');
  assert.equal(
    store.get('notes/settled.md'),
    '---\ntype: note\nsummary: A settled note.\n---\n\nBody.\n',
  );
});

test('a settled workspace makes no write and no commit', async () => {
  const { ctx, commits } = fakeCtx(
    { 'notes/a.md': '---\ntype: note\nsummary: A note.\n---\n\nBody.\n' },
    [inote('notes/a.md', 'note')],
  );
  const res = await normalizeVaultFrontmatter(ctx);
  assert.deepEqual(res.written, []);
  assert.equal(commits.length, 0);
});

test('running twice changes nothing the second time', async () => {
  const { ctx, store, commits } = fakeCtx({ 'notes/thin.md': 'Just a body, no frontmatter.\n' }, [
    inote('notes/thin.md', 'note'),
  ]);
  const first = await normalizeVaultFrontmatter(ctx);
  assert.deepEqual(first.written, ['notes/thin.md']);
  const after = store.get('notes/thin.md');

  const second = await normalizeVaultFrontmatter(ctx);
  assert.deepEqual(second.written, [], 'idempotent');
  assert.equal(store.get('notes/thin.md'), after, 'byte-identical');
  assert.equal(commits.length, 1);
});

test('frontmatter that would not parse survives whole', async () => {
  const broken = '---\ntype: source\n  summary: "unclosed\ntags: [a, b\n---\n\nThe transcript.\n';
  const { ctx, store } = fakeCtx({ 'sources/mess.md': broken }, [
    inote('sources/mess.md', 'source'),
  ]);

  const res = await normalizeVaultFrontmatter(ctx);
  assert.deepEqual(res.written, ['sources/mess.md']);
  const written = store.get('sources/mess.md')!;
  assert.match(written, new RegExp(BROKEN_FRONTMATTER_FIELD));
  // Every line of the original block is still in the file, verbatim.
  for (const line of ['type: source', 'summary: "unclosed', 'tags: [a, b']) {
    assert.ok(written.includes(line), `lost: ${line}`);
  }
  assert.match(written, /The transcript\./, 'and so is the body');
});

test('generated, reserved and runnable files are never read, let alone written', async () => {
  const reads: string[] = [];
  const { ctx } = fakeCtx({}, []);
  const paths = ['index.md', 'insights/index.md', 'skills/librarian/SKILL.md', 'agents/x/AGENT.md'];
  const spied = {
    ...ctx,
    vault: {
      ...ctx.vault,
      readRaw: async (p: string) => {
        reads.push(p);
        return null;
      },
    },
    index: { ...ctx.index, all: () => paths.map((p) => inote(p, 'note')) },
  } as unknown as UseCaseContext;

  const res = await normalizeVaultFrontmatter(spied);
  assert.deepEqual(reads, [], 'skipped by path, before anything is opened');
  assert.deepEqual(res.written, []);
});
