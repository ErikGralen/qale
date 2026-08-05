import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NoteType } from '@qale/domain';
import { generateIndexFiles, searchNotes, reconcileIndex } from '../src/index.js';
import type { IndexedNote, IndexPort, UseCaseContext, VaultPort } from '../src/ports.js';

/**
 * The librarian's index.md pass end to end (OKF alignment, phase 1):
 * which folders get mapped, that generation is idempotent (no write, no commit
 * on an unchanged tick), that session receipts are skipped, and that reserved
 * files stay out of the index and out of search.
 */

function inote(path: string, type: NoteType, summary: string, lifecycle: string | null = null): IndexedNote {
  const slug = path.replace(/\.md$/, '');
  return {
    path,
    slug,
    type,
    layer: 'authored',
    title: slug.split('/').pop()!,
    summary,
    lifecycle,
    hasBody: true,
    mtime: 1,
    frontmatter: { type, summary },
    links: [],
  };
}

/** A minimal in-memory ctx: file store + a fixed note set + a commit recorder. */
function fakeCtx(notes: IndexedNote[]) {
  const files = new Map<string, string>();
  const commits: { paths: string[]; message: string }[] = [];
  const vault = {
    root: () => '/tmp/vault-dev',
    readRaw: async (p: string) => files.get(p) ?? null,
    writeRaw: async (p: string, content: string) => void files.set(p, content),
  } as unknown as VaultPort;
  const index = {
    all: () => notes,
  } as unknown as IndexPort;
  const git = {
    commitPaths: async (paths: string[], message: string) => void commits.push({ paths, message }),
  } as unknown as UseCaseContext['git'];
  const ctx = { vault, index, git } as unknown as UseCaseContext;
  return { ctx, files, commits };
}

test('generateIndexFiles maps content folders, skips sessions, stamps root, commits once', async () => {
  const notes = [
    inote('decisions/adopt-workos.md', 'decision', 'Adopt WorkOS for auth.', 'active'),
    inote('decisions/old.md', 'decision', 'Superseded call.', 'superseded'),
    inote('insights/acme-scim.md', 'insight', 'Acme wants SCIM before rollout.', 'active'),
    inote('sessions/2026-07-20-after-meeting.md', 'session', 'receipt', null),
  ];
  const { ctx, files, commits } = fakeCtx(notes);

  const res = await generateIndexFiles(ctx);
  assert.ok(res.written.includes('index.md'), 'root index written');
  assert.ok(res.written.includes('decisions/index.md'));
  assert.ok(res.written.includes('insights/index.md'));
  assert.ok(!res.written.includes('sessions/index.md'), 'session receipts are not mapped');
  assert.equal(commits.length, 1, 'one commit for the whole batch');

  // Root map links folders with counts; decisions map groups by standing.
  assert.match(files.get('index.md')!, /\* \[Decisions\]\(decisions\/index\.md\).*\(2\)/);
  assert.match(files.get('decisions/index.md')!, /## Active/);
  assert.match(files.get('decisions/index.md')!, /## Superseded/);
  // Description is the projected summary.
  assert.match(files.get('insights/index.md')!, /Acme wants SCIM before rollout\./);
});

test('generateIndexFiles is idempotent — a second pass writes nothing and does not commit', async () => {
  const notes = [inote('notes/a.md', 'note', 'A note.')];
  const { ctx, commits } = fakeCtx(notes);
  const first = await generateIndexFiles(ctx);
  assert.ok(first.written.length > 0);
  const second = await generateIndexFiles(ctx);
  assert.equal(second.written.length, 0, 'unchanged content is not rewritten');
  assert.equal(commits.length, 1, 'no second commit');
});

test('searchNotes drops reserved orientation files from results', () => {
  const hits = [
    { path: 'insights/acme.md', slug: 'insights/acme', type: 'insight', title: 'Acme', summary: 's', snippet: '', score: 2 },
    { path: 'insights/index.md', slug: 'insights/index', type: 'insight', title: 'Index', summary: 's', snippet: '', score: 1 },
  ];
  const ctx = { index: { search: () => hits } } as unknown as UseCaseContext;
  const out = searchNotes(ctx, 'acme');
  assert.deepEqual(out.map((h) => h.path), ['insights/acme.md']);
});

test('reconcileIndex never indexes reserved files, and evicts any already indexed', async () => {
  const reindexed: string[] = [];
  const removed: string[] = [];
  const list = [
    { path: 'insights/acme.md', mtime: 5 },
    { path: 'index.md', mtime: 5 },
    { path: 'insights/index.md', mtime: 5 },
  ];
  const vault = {
    list: async () => list,
    readNote: async (p: string) => ({ path: p }),
  } as unknown as VaultPort;
  const index = {
    // A pre-reserved-handling index still holds a folder index.md as a "note".
    all: () => [{ path: 'insights/index.md', mtime: 1 } as IndexedNote],
    reindex: (n: { path: string }) => void reindexed.push(n.path),
    removeByPath: (p: string) => void removed.push(p),
  } as unknown as IndexPort;

  await reconcileIndex(vault, index);
  assert.deepEqual(reindexed, ['insights/acme.md'], 'only the real note is indexed');
  assert.ok(removed.includes('insights/index.md'), 'the stale reserved row is evicted');
});
