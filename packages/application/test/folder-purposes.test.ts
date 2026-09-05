import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentFolderPurpose, FOLDER_PURPOSE_OF_FIELD, type NoteType } from '@qale/domain';
import {
  changedShare,
  generateIndexFiles,
  purposeMarker,
  runSummaryPass,
  type SummarySubject,
} from '../src/index.js';
import type { IndexedNote, IndexPort, UseCaseContext, VaultPort } from '../src/ports.js';

/**
 * Folder purposes (IM-7) with the model stood in for: which folders the pass
 * asks about, what it writes into the folder map, what it leaves alone, and
 * that the line and its marker survive the next regeneration of the map.
 */

function doc(path: string, title: string, summary: string): IndexedNote {
  return {
    path,
    slug: path.replace(/\.md$/, ''),
    type: 'note' as NoteType,
    layer: 'authored',
    title,
    summary,
    lifecycle: null,
    hasBody: true,
    mtime: 1,
    frontmatter: { type: 'note', title, summary },
    links: [],
  } as IndexedNote;
}

/** The file `createDocumentFolder` writes when the PM makes a folder. */
function stubMap(title: string): string {
  return `---\ndescription: ${documentFolderPurpose(title)}\n---\n\n# ${title}\n`;
}

function fakeCtx(files: Record<string, string>, notes: IndexedNote[]) {
  const store = new Map(Object.entries(files));
  const commits: { paths: string[]; message: string }[] = [];
  const vault = {
    root: () => '/tmp/vault-dev',
    readRaw: async (p: string) => store.get(p) ?? null,
    writeRaw: async (p: string, content: string) => void store.set(p, content),
    list: async () => [
      ...notes.map((n) => ({ path: n.path, mtime: n.mtime })),
      ...[...store.keys()].map((path) => ({ path, mtime: 1 })),
    ],
  } as unknown as VaultPort;
  const byPath = new Map(notes.map((n) => [n.path, n]));
  const index = {
    all: () => notes,
    get: (p: string) => byPath.get(p) ?? null,
    resolve: () => null,
    reindex: () => undefined,
  } as unknown as IndexPort;
  const git = {
    commitPaths: async (paths: string[], message: string) => void commits.push({ paths, message }),
  } as unknown as UseCaseContext['git'];
  const clock = { now: () => '2026-09-05T09:00:00.000Z' };
  return { ctx: { vault, index, git, clock } as unknown as UseCaseContext, store, commits };
}

/** A model that answers by path, and remembers what it was asked. */
function fakeModel(answers: Record<string, string | null> = {}) {
  const asked: SummarySubject[] = [];
  const summarise = async (s: SummarySubject): Promise<string | null> => {
    asked.push(s);
    return s.path in answers ? (answers[s.path] ?? null) : `What ${s.title} is for.`;
  };
  return { summarise, asked };
}

/** The `description` and `purpose_of` of a folder map, off the raw file. */
function metaOf(raw: string): { description?: string; marker?: string } {
  const block = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const lines = block ? block[1]!.split(/\r?\n/) : [];
  const at = (key: string): string | undefined =>
    lines
      .find((l) => l.startsWith(`${key}:`))
      ?.slice(key.length + 1)
      .trim();
  const description = at('description');
  const marker = at(FOLDER_PURPOSE_OF_FIELD);
  return { ...(description ? { description } : {}), ...(marker ? { marker } : {}) };
}

const specs = [
  doc('notes/specs/sso.md', 'SSO spec', 'How single sign-on is set up for Nordkap.'),
  doc('notes/specs/scim.md', 'SCIM spec', 'Which user fields sync, and how often.'),
  doc('notes/specs/audit.md', 'Audit log spec', 'What the audit log records and who reads it.'),
];

test('a folder with two documents is skipped, one with three gets a purpose over the stub', async () => {
  const { ctx, store, commits } = fakeCtx(
    { 'notes/specs/index.md': stubMap('Specs'), 'notes/briefs/index.md': stubMap('Briefs') },
    [
      ...specs,
      doc('notes/briefs/q3.md', 'Q3 brief', 'What Q3 is about.'),
      doc('notes/briefs/q4.md', 'Q4 brief', 'What Q4 is about.'),
    ],
  );
  const model = fakeModel({
    'notes/specs/index.md': 'Where the auth and provisioning specs live.',
  });

  const res = await runSummaryPass(ctx, { summarise: model.summarise, limit: 0 });

  assert.deepEqual(res.foldersAsked, ['notes/specs/index.md'], 'two documents is not enough');
  assert.deepEqual(res.foldersWritten, ['notes/specs/index.md']);
  assert.deepEqual(commits, [{ paths: ['notes/specs/index.md'], message: 'maintenance: labels' }]);

  const meta = metaOf(store.get('notes/specs/index.md')!);
  assert.equal(meta.description, 'Where the auth and provisioning specs live.');
  assert.equal(meta.marker, purposeMarker(specs.map((d) => d.path)));
  assert.match(store.get('notes/specs/index.md')!, /# Specs/, 'the map body is untouched');
  assert.equal(store.get('notes/briefs/index.md'), stubMap('Briefs'));
});

test('the model reads titles and summaries, never a body', async () => {
  const { ctx } = fakeCtx({ 'notes/specs/index.md': stubMap('Specs') }, specs);
  const model = fakeModel();

  await runSummaryPass(ctx, { summarise: model.summarise, limit: 0 });

  const asked = model.asked[0]!;
  assert.equal(asked.kind, 'folder');
  assert.equal(asked.title, 'Specs');
  assert.equal(
    asked.body,
    '- Audit log spec (What the audit log records and who reads it.)\n' +
      '- SCIM spec (Which user fields sync, and how often.)\n' +
      '- SSO spec (How single sign-on is set up for Nordkap.)',
  );
});

test('a purpose somebody wrote is kept until the folder is more than half new', async () => {
  const written = 'Where the auth and provisioning specs live.';
  const marker = purposeMarker(specs.map((d) => d.path));
  const map = `---\ndescription: ${written}\n${FOLDER_PURPOSE_OF_FIELD}: ${marker}\n---\n\n# Specs\n`;

  // Same three documents: nothing to say.
  const same = fakeCtx({ 'notes/specs/index.md': map }, specs);
  const first = await runSummaryPass(same.ctx, { summarise: fakeModel().summarise, limit: 0 });
  assert.deepEqual(first.foldersAsked, []);
  assert.equal(same.store.get('notes/specs/index.md'), map);

  // Two more: five documents, three of them the old ones. 40% new, so it stays.
  const grown = [
    ...specs,
    doc('notes/specs/roles.md', 'Roles spec', 'Which roles exist.'),
    doc('notes/specs/tokens.md', 'Token spec', 'How tokens expire.'),
  ];
  const little = fakeCtx({ 'notes/specs/index.md': map }, grown);
  const second = await runSummaryPass(little.ctx, { summarise: fakeModel().summarise, limit: 0 });
  assert.deepEqual(second.foldersAsked, [], 'under half is not enough');

  // Four more: seven documents, three of them the old ones. 57% new.
  const churned = [
    ...grown,
    doc('notes/specs/rates.md', 'Rate limits', 'What the limits are.'),
    doc('notes/specs/errors.md', 'Error codes', 'What each code means.'),
  ];
  const lots = fakeCtx({ 'notes/specs/index.md': map }, churned);
  const model = fakeModel({
    'notes/specs/index.md': 'How the platform API behaves, spec by spec.',
  });
  const third = await runSummaryPass(lots.ctx, { summarise: model.summarise, limit: 0 });

  assert.deepEqual(third.foldersWritten, ['notes/specs/index.md']);
  const meta = metaOf(lots.store.get('notes/specs/index.md')!);
  assert.equal(meta.description, 'How the platform API behaves, spec by spec.');
  assert.equal(meta.marker, purposeMarker(churned.map((d) => d.path)));
});

test('a regenerated map keeps the purpose and its marker, and settles', async () => {
  const { ctx, store, commits } = fakeCtx({ 'notes/specs/index.md': stubMap('Specs') }, specs);
  const model = fakeModel({
    'notes/specs/index.md': 'Where the auth and provisioning specs live.',
  });

  await runSummaryPass(ctx, { summarise: model.summarise, limit: 0 });
  const marker = purposeMarker(specs.map((d) => d.path));

  const first = await generateIndexFiles(ctx);
  assert.ok(first.written.includes('notes/specs/index.md'), 'the map body is rebuilt once');
  const meta = metaOf(store.get('notes/specs/index.md')!);
  assert.equal(meta.description, 'Where the auth and provisioning specs live.');
  assert.equal(meta.marker, marker);
  assert.match(
    store.get('notes/index.md')!,
    /Where the auth and provisioning specs live\./,
    'the parent map shows the line too',
  );

  const again = await generateIndexFiles(ctx);
  assert.deepEqual(again.written, [], 'nothing left to rewrite');

  // The next pass has nothing to ask about: the purpose is no longer the stub.
  const next = await runSummaryPass(ctx, { summarise: model.summarise, limit: 0 });
  assert.deepEqual(next.foldersAsked, []);
  assert.equal(
    commits.filter((c) => c.message === 'maintenance: labels').length,
    1,
    'one commit for the whole pass',
  );
});

test('at most five folders per pass, and the rest wait', async () => {
  const files: Record<string, string> = {};
  const notes: IndexedNote[] = [];
  for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) {
    files[`notes/${name}/index.md`] = stubMap(name.toUpperCase());
    for (const n of [1, 2, 3]) {
      notes.push(doc(`notes/${name}/${n}.md`, `${name}${n}`, `About ${name}${n}.`));
    }
  }
  const { ctx, commits } = fakeCtx(files, notes);
  const model = fakeModel();

  const res = await runSummaryPass(ctx, { summarise: model.summarise, limit: 0 });

  assert.equal(res.foldersAsked.length, 5);
  assert.deepEqual(res.foldersAsked, [
    'notes/a/index.md',
    'notes/b/index.md',
    'notes/c/index.md',
    'notes/d/index.md',
    'notes/e/index.md',
  ]);
  assert.equal(res.foldersWritten.length, 5);
  assert.equal(commits.length, 1);

  const next = await runSummaryPass(ctx, { summarise: model.summarise, limit: 0 });
  assert.deepEqual(next.foldersAsked, ['notes/f/index.md']);
});

test('a bad answer leaves the stub, and asks again next pass', async () => {
  const { ctx, store, commits } = fakeCtx({ 'notes/specs/index.md': stubMap('Specs') }, specs);
  const bad = fakeModel({ 'notes/specs/index.md': 'Two lines\nabout the specs.' });

  const res = await runSummaryPass(ctx, { summarise: bad.summarise, limit: 0 });

  assert.deepEqual(res.foldersAsked, ['notes/specs/index.md']);
  assert.deepEqual(res.foldersWritten, []);
  assert.equal(commits.length, 0, 'no write, no commit');
  assert.equal(store.get('notes/specs/index.md'), stubMap('Specs'));

  // A colon would break the YAML scalar the line is written as, so it is refused too.
  const colon = fakeModel({ 'notes/specs/index.md': 'Specs: auth and provisioning.' });
  const second = await runSummaryPass(ctx, { summarise: colon.summarise, limit: 0 });
  assert.deepEqual(second.foldersWritten, []);
  assert.equal(store.get('notes/specs/index.md'), stubMap('Specs'));
});

test('a subfolder counts its own documents, and its parent counts them too', async () => {
  const nested = [
    doc('notes/specs/api/list.md', 'List endpoint', 'What list returns.'),
    doc('notes/specs/api/create.md', 'Create endpoint', 'What create takes.'),
    doc('notes/specs/api/delete.md', 'Delete endpoint', 'What delete removes.'),
  ];
  const { ctx } = fakeCtx(
    { 'notes/specs/index.md': stubMap('Specs'), 'notes/specs/api/index.md': stubMap('Api') },
    nested,
  );
  const model = fakeModel();

  const res = await runSummaryPass(ctx, { summarise: model.summarise, limit: 0 });

  assert.deepEqual(res.foldersAsked, ['notes/specs/index.md', 'notes/specs/api/index.md']);
});

test('changedShare counts both sets', () => {
  assert.equal(changedShare('a b c', 'a b c'), 0);
  assert.equal(changedShare('', ''), 0);
  assert.equal(changedShare('a b c', 'd e f'), 1);
  assert.equal(changedShare('a b', 'a b c d'), 0.5);
  assert.equal(changedShare('a b c d', 'a b'), 0.5);
});

test('a folder with no map yet gets one, so the pass never asks about it twice', async () => {
  const { ctx, store } = fakeCtx({}, specs);
  const model = fakeModel({
    'notes/specs/index.md': 'Where the auth and provisioning specs live.',
  });

  const res = await runSummaryPass(ctx, { summarise: model.summarise, limit: 0 });

  assert.deepEqual(res.foldersWritten, ['notes/specs/index.md']);
  const meta = metaOf(store.get('notes/specs/index.md')!);
  assert.equal(meta.description, 'Where the auth and provisioning specs live.');
  assert.equal(meta.marker, purposeMarker(specs.map((d) => d.path)));

  const next = await runSummaryPass(ctx, { summarise: model.summarise, limit: 0 });
  assert.deepEqual(next.foldersAsked, []);
});
