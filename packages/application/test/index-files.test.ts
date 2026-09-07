import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NoteType } from '@qale/domain';
import { generateIndexFiles, searchNotes, reconcileIndex, notIndexable } from '../src/index.js';
import { VaultBoundaryError } from '../src/ports.js';
import type { IndexedNote, IndexPort, UseCaseContext, VaultPort } from '../src/ports.js';

/**
 * The librarian's index.md pass end to end (OKF alignment, phase 1):
 * which folders get mapped, that generation is idempotent (no write, no commit
 * on an unchanged tick), that session receipts are skipped, and that reserved
 * files stay out of the index and out of search.
 */

function inote(
  path: string,
  type: NoteType,
  summary: string,
  lifecycle: string | null = null,
  frontmatter: Record<string, unknown> = {},
): IndexedNote {
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
    frontmatter: { type, summary, ...frontmatter },
    links: [],
  };
}

/**
 * A minimal in-memory ctx: file store + a fixed note set + a commit recorder.
 * `refuse` stands in for the containment guard turning a path down. Files
 * seeded into the store also show up in `vault.list`, the way a folder's stub
 * index.md does on disk.
 */
function fakeCtx(notes: IndexedNote[], refuse?: (path: string) => boolean) {
  const files = new Map<string, string>();
  const commits: { paths: string[]; message: string }[] = [];
  const vault = {
    root: () => '/tmp/vault-dev',
    readRaw: async (p: string) => files.get(p) ?? null,
    writeRaw: async (p: string, content: string) => {
      if (refuse?.(p)) throw new VaultBoundaryError(p);
      files.set(p, content);
    },
    list: async () => [
      ...notes.map((n) => ({ path: n.path, mtime: n.mtime })),
      ...[...files.keys()].map((path) => ({ path, mtime: 1 })),
    ],
  } as unknown as VaultPort;
  const byPath = new Map(notes.map((n) => [n.path, n]));
  const index = {
    all: () => notes,
    get: (p: string) => byPath.get(p) ?? null,
    resolve: (target: string) => (byPath.has(`${target}.md`) ? `${target}.md` : null),
  } as unknown as IndexPort;
  const git = {
    commitPaths: async (paths: string[], message: string) => void commits.push({ paths, message }),
  } as unknown as UseCaseContext['git'];
  const clock = { now: () => '2026-09-05T10:00:00.000Z' };
  const ctx = { vault, index, git, clock } as unknown as UseCaseContext;
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
  const notes = [
    inote('notes/a.md', 'note', 'A note.'),
    inote('notes/specs/b.md', 'note', 'A spec.'),
    inote('meetings/2026-09-01-x.md', 'meeting', 'm', null, { date: '2026-09-01' }),
    inote('meetings/2026-03-01-y.md', 'meeting', 'm', null, { date: '2026-03-01' }),
  ];
  const { ctx, commits } = fakeCtx(notes);
  const first = await generateIndexFiles(ctx);
  assert.ok(first.written.length > 0);
  const second = await generateIndexFiles(ctx);
  assert.equal(second.written.length, 0, 'unchanged content is not rewritten');
  assert.equal(commits.length, 1, 'no second commit');
});

test('a refused map is raised by name, and the maps that landed still commit', async () => {
  // OW8, and the exact shape of OpenWiki #496: a write the guard turned down,
  // absorbed quietly, shows up as retrieval getting worse rather than as an
  // error. An orientation map missing has to be a sentence in the log.
  const notes = [
    inote('decisions/adopt-workos.md', 'decision', 'Adopt WorkOS for auth.', 'active'),
    inote('insights/acme-scim.md', 'insight', 'Acme wants SCIM before rollout.', 'active'),
  ];
  const { ctx, files, commits } = fakeCtx(notes, (p) => p === 'insights/index.md');

  await assert.rejects(
    () => generateIndexFiles(ctx),
    /insights\/index\.md/,
    'the refused map must be named, not swallowed',
  );
  // The rest of the refresh is not thrown away with it: a partial map beats a
  // stale one, and the commit is what makes it survive.
  assert.ok(files.has('index.md'), 'the root map still landed');
  assert.ok(files.has('decisions/index.md'), 'the folder that could be written still landed');
  assert.equal(files.has('insights/index.md'), false);
  assert.equal(commits.length, 1, 'what landed is committed before the refusal is raised');
});

test('the meetings map carries the date, the resolved customer and the series, collapsed by month', async () => {
  const notes = [
    inote('customers/nordkap.md', 'customer', 'Nordkap Payments AB', 'active'),
    inote('meetings/2026-09-01-checkin.md', 'meeting', 'SSO date confirmed.', null, {
      date: '2026-09-01',
      customer: '[[customers/nordkap]]',
      series: 'nordkap-checkin',
    }),
    inote('meetings/2026-03-04-kickoff.md', 'meeting', 'Kickoff.', null, {
      date: '2026-03-04',
      customer: '[[customers/nordkap]]',
    }),
    inote('meetings/someday.md', 'meeting', 'No date yet.', null, { date: 'next week' }),
  ];
  const { ctx, files } = fakeCtx(notes);
  await generateIndexFiles(ctx);
  const map = files.get('meetings/index.md')!;
  assert.ok(
    map.includes(
      '## 2026-09\n\n* 2026-09-01 [2026-09-01-checkin](meetings/2026-09-01-checkin.md) — SSO date confirmed. (customer: [nordkap](customers/nordkap.md)) (series: nordkap-checkin)\n',
    ),
    map,
  );
  assert.match(map, /^## 2026-03 \(1 meeting, use vault_list since\/until\)$/m);
  assert.match(map, /## Undated\n\n\* \[someday\]/, 'a day field that is not a day is undated');
  assert.doesNotMatch(map, /\[\[/);
});

test('the todos map resolves the owner and treats a due that is not a day as undated', async () => {
  const notes = [
    inote('people/sara-lindqvist.md', 'person', 'VP Eng at Nordkap.'),
    inote('todos/scope.md', 'todo', 'Send the scope.', 'open', {
      due: '2026-07-16',
      owner: '[[people/sara-lindqvist]]',
    }),
    inote('todos/friday.md', 'todo', 'Sometime.', 'open', { due: 'next Friday' }),
    inote('todos/later.md', 'todo', 'Later.', 'open', { due: '2026-08-01' }),
  ];
  const { ctx, files } = fakeCtx(notes);
  await generateIndexFiles(ctx);
  const map = files.get('todos/index.md')!;
  const open = map.slice(map.indexOf('## Open')).trim().split('\n').slice(2);
  assert.deepEqual(open, [
    '* due 2026-07-16 · [sara-lindqvist](people/sara-lindqvist.md) — [scope](todos/scope.md) — Send the scope.',
    '* due 2026-08-01 — [later](todos/later.md) — Later.',
    '* undated — [friday](todos/friday.md) — Sometime.',
  ]);
});

test('the Documents tree gets one map per folder, and a folder keeps its description', async () => {
  const notes = [
    inote('notes/scratch.md', 'note', 'Loose ends.'),
    inote('notes/specs/sso.md', 'note', 'The SSO spec.'),
    inote('notes/specs/2026/roadmap.md', 'note', 'Next year.'),
    inote('research/product.md', 'research', 'What the product is.'),
  ];
  const { ctx, files } = fakeCtx(notes);
  // An empty folder exists because its stub is on disk; a filled one has a
  // purpose somebody wrote.
  files.set('notes/briefs/index.md', '---\ndescription: Briefs, a folder of your documents\n---\n\n# Briefs\n');
  files.set('notes/specs/index.md', '---\ndescription: what we are building, one page each\n---\n\n# Specs\n');

  await generateIndexFiles(ctx);

  const root = files.get('notes/index.md')!;
  assert.match(root, /## Folders\n\n/);
  assert.match(root, /\* \[Briefs\]\(notes\/briefs\/index\.md\) — Briefs, a folder of your documents \(0\)/);
  assert.match(root, /\* \[Specs\]\(notes\/specs\/index\.md\) — what we are building, one page each \(2\)/);
  assert.match(root, /## Documents\n\n\* \[scratch\]\(notes\/scratch\.md\) — Loose ends\.\n/);
  assert.doesNotMatch(root, /sso\.md|roadmap\.md|product\.md/, 'only this level, never research');

  const specs = files.get('notes/specs/index.md')!;
  assert.match(specs, /^---\ndescription: what we are building, one page each\n---\n/, 'kept');
  assert.match(specs, /\* \[2026\]\(notes\/specs\/2026\/index\.md\) — 2026, a folder of your documents \(1\)/);
  assert.match(specs, /## Documents\n\n\* \[sso\]\(notes\/specs\/sso\.md\)/);

  const deep = files.get('notes/specs/2026/index.md')!;
  assert.match(deep, /# 2026\n\n2026, a folder of your documents\n\n\* \[roadmap\]/);
  assert.match(files.get('notes/briefs/index.md')!, /# Briefs\n\nBriefs, a folder of your documents\n$/);
  assert.match(files.get('research/index.md')!, /product\.md/, 'research has its own map');
  assert.match(files.get('index.md')!, /\* \[Notes\]\(notes\/index\.md\) — .* \(3\)/, 'root counts every document');

  // A second pass keeps the written purpose and changes nothing.
  const again = await generateIndexFiles(ctx);
  assert.deepEqual(again.written, []);
});

test('searchNotes drops reserved orientation files from results', () => {
  const hits = [
    {
      path: 'insights/acme.md',
      slug: 'insights/acme',
      type: 'insight',
      title: 'Acme',
      summary: 's',
      snippet: '',
      score: 2,
    },
    {
      path: 'insights/index.md',
      slug: 'insights/index',
      type: 'insight',
      title: 'Index',
      summary: 's',
      snippet: '',
      score: 1,
    },
  ];
  const ctx = { index: { search: () => hits } } as unknown as UseCaseContext;
  const out = searchNotes(ctx, 'acme');
  assert.deepEqual(
    out.map((h) => h.path),
    ['insights/acme.md'],
  );
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

test('a session working file is not a note, and a row holding one is evicted', async () => {
  const reindexed: string[] = [];
  const removed: string[] = [];
  // The scan cannot see these (the dot folder is skipped), so they arrive here as
  // rows the live watcher put in before it agreed with the scan.
  const stale = ['sessions/.files/abc123/input.md', 'sessions/.files/abc123/source/kranelund.md'];
  const vault = {
    list: async () => [{ path: 'sessions/2026-08-13-arrival-abc123.md', mtime: 5 }],
    readNote: async (p: string) => ({ path: p }),
  } as unknown as VaultPort;
  const index = {
    all: () => stale.map((path) => ({ path, mtime: 1 }) as IndexedNote),
    reindex: (n: { path: string }) => void reindexed.push(n.path),
    removeByPath: (p: string) => void removed.push(p),
  } as unknown as IndexPort;

  await reconcileIndex(vault, index);
  assert.deepEqual(
    reindexed,
    ['sessions/2026-08-13-arrival-abc123.md'],
    'the session note itself is a note',
  );
  assert.deepEqual(removed.sort(), [...stale].sort(), 'every phantom Input row goes');
});

test('notIndexable covers all three kinds of not-a-note, and nothing else', () => {
  for (const path of [
    'index.md',
    'insights/index.md',
    'skills/librarian/reference.md',
    'sessions/.files/abc123/input.md',
  ]) {
    assert.equal(notIndexable(path), true, `${path} is not a note`);
  }
  for (const path of [
    'insights/acme.md',
    'sessions/2026-08-13-arrival-abc123.md',
    'meetings/weekly.md',
  ]) {
    assert.equal(notIndexable(path), false, `${path} is a note`);
  }
});
