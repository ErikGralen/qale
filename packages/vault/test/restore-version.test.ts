import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  restoreNoteVersion,
  revertNoteChange,
  runSummaryPass,
  type UseCaseContext,
} from '@qale/application';
import type { ActivityRecord, CreateActivityInput } from '@qale/domain';
import { FsVault } from '../src/fs-vault.js';
import { GitAdapter } from '../src/git.js';

// Undo against a real repo and a real file: the whole point of the feature is
// that the earlier text comes back and the record of what happened does not
// change. A fake git would test the wiring and none of that.

process.env['GIT_CONFIG_GLOBAL'] = '/dev/null';
process.env['GIT_CONFIG_NOSYSTEM'] = '1';

const NOOP_INDEX: UseCaseContext['index'] = {
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
};

async function workspace(): Promise<{ dir: string; ctx: UseCaseContext; git: GitAdapter }> {
  const dir = await mkdtemp(join(tmpdir(), 'pm-restore-'));
  await mkdir(join(dir, 'notes'), { recursive: true });
  const git = new GitAdapter(dir);
  await git.init();
  const ctx = {
    vault: new FsVault(dir),
    index: NOOP_INDEX,
    git,
    clock: { now: () => '2026-08-02T00:00:00.000Z' },
    proposals: {
      create: () => {
        throw new Error('unused');
      },
      get: () => null,
      list: () => [],
      setStatus: () => {},
      pendingCount: () => 0,
      markStaleFor: () => {},
    },
  } as unknown as UseCaseContext;
  return { dir, ctx, git };
}

test('restoring writes the old text forward: later versions survive and the content matches', async () => {
  const { dir, ctx, git } = await workspace();
  const path = 'notes/x.md';
  const file = join(dir, path);

  await writeFile(file, '---\ntype: note\nsummary: s\n---\n\nFirst draft.\n');
  await git.commitPaths([path], 'create: x');
  await writeFile(file, '---\ntype: note\nsummary: s\n---\n\nWhat the agent wrote.\n');
  await git.commitPaths([path], 'edit: x');

  const before = await git.history(path);
  assert.equal(before.length, 2);
  const first = before[1]!; // oldest

  const note = await restoreNoteVersion(ctx, { path, hash: first.hash });
  assert.equal(note.body.trim(), 'First draft.');
  assert.equal((await readFile(file, 'utf8')).includes('First draft.'), true);

  const after = await git.history(path);
  // Three versions, not one: the restore is a new version on top and nothing
  // that happened in between was discarded.
  assert.equal(after.length, 3);
  assert.equal(after[0]!.message, 'restored an earlier version');
  assert.equal(after[1]!.hash, before[0]!.hash);
  assert.equal(after[2]!.hash, before[1]!.hash);

  // The version we undid is still readable, so the undo is itself undoable.
  const undone = await git.fileAt(path, before[0]!.hash);
  assert.ok(undone?.includes('What the agent wrote.'));
});

test('restoring brings back the text, not the properties', async () => {
  const { dir, ctx, git } = await workspace();
  const path = 'notes/todo.md';
  const file = join(dir, path);

  // `commitment: open` and the invalid `status: wip` are the live state: an old
  // version must not re-open finished work or rewrite fields it never validated.
  await writeFile(
    file,
    '---\ntype: note\nsummary: s\nstatus: wip\ncommitment: open\n---\n\nOld text.\n',
  );
  await git.commitPaths([path], 'create: todo');
  const [old] = await git.history(path);

  await writeFile(
    file,
    '---\ntype: note\nsummary: s\nstatus: wip\ncommitment: done\n---\n\nNew text.\n',
  );
  await git.commitPaths([path], 'edit: todo');

  await restoreNoteVersion(ctx, { path, hash: old!.hash });
  const raw = await readFile(file, 'utf8');
  assert.ok(raw.includes('Old text.'));
  assert.ok(!raw.includes('New text.'));
  assert.ok(raw.includes('commitment: done'), 'the current properties stand');
  assert.ok(raw.includes('status: wip'), 'and are kept byte for byte');
});

test('restoring twice returns to where it started, because the record never shrinks', async () => {
  const { dir, ctx, git } = await workspace();
  const path = 'notes/x.md';
  const file = join(dir, path);
  await writeFile(file, '---\ntype: note\nsummary: s\n---\n\nA.\n');
  await git.commitPaths([path], 'create: x');
  await writeFile(file, '---\ntype: note\nsummary: s\n---\n\nB.\n');
  await git.commitPaths([path], 'edit: x');

  const list = await git.history(path);
  await restoreNoteVersion(ctx, { path, hash: list[1]!.hash }); // back to A
  assert.ok((await readFile(file, 'utf8')).includes('A.'));
  // Undoing the undo: B is still a version, so it can be picked again.
  await restoreNoteVersion(ctx, { path, hash: list[0]!.hash });
  assert.ok((await readFile(file, 'utf8')).includes('B.'));
  assert.equal((await git.history(path)).length, 4);
});

test('a note whose body nobody may rewrite refuses the restore (the UI hides the control for the same reason)', async () => {
  const { dir, ctx, git } = await workspace();
  await mkdir(join(dir, 'sources'), { recursive: true });
  const path = 'sources/t.md';
  const file = join(dir, path);
  const fm = '---\ntype: source\nsummary: s\nprocessing: new\ncaptured: 2026-08-02\n---\n';
  await writeFile(file, `${fm}\nWhat was said.\n`);
  await git.commitPaths([path], 'source: t');
  const [only] = await git.history(path);
  await writeFile(file, `${fm}\nTampered.\n`);

  // The message is user-facing (a toast prints it), so it names the note, not
  // its path or its layer.
  await assert.rejects(
    () => restoreNoteVersion(ctx, { path, hash: only!.hash }),
    /nobody rewrites/,
  );
});

// ---------------------------------------------------------------------------
// The undo (E-2). Same real repo, because "the note comes back" is a claim
// about git and a stand-in would prove none of it.
// ---------------------------------------------------------------------------

const FM = '---\ntype: note\nsummary: s\ntags: [alpha]\n---\n';

test('undoing an edit puts the whole file back, properties included', async () => {
  const { dir, ctx, git } = await workspace();
  const path = 'notes/x.md';
  const file = join(dir, path);
  await writeFile(file, `${FM}\nWhat I wrote.\n`);
  await git.commitPaths([path], 'create: x');
  await writeFile(
    file,
    '---\ntype: note\nsummary: s\ntags: [alpha, beta]\n---\n\nWhat the agent wrote.\n',
  );
  await git.commitPaths([path], 'update: x');

  const applied = (await git.history(path))[0]!;
  const result = await revertNoteChange(ctx, { path, hash: applied.hash });
  assert.deepEqual(result, { path, outcome: 'restored' });

  const raw = await readFile(file, 'utf8');
  assert.ok(raw.includes('What I wrote.'));
  // The tag the agent added goes too. Half an undo leaves a note nobody wrote.
  assert.ok(!raw.includes('beta'));
  // Forward, not a rewind: the undone change is still a version, so it can be
  // put back in turn.
  assert.equal((await git.history(path)).length, 3);
  assert.ok((await git.fileAt(path, applied.hash))?.includes('What the agent wrote.'));
});

test('undoing a delete brings the note back', async () => {
  const { dir, ctx, git } = await workspace();
  const path = 'notes/x.md';
  const file = join(dir, path);
  await writeFile(file, `${FM}\nStill wanted.\n`);
  await git.commitPaths([path], 'create: x');
  await rm(file);
  await git.commitPaths([path], 'delete: x');
  assert.equal(existsSync(file), false);

  const deleted = (await git.history(path))[0]!;
  const result = await revertNoteChange(ctx, { path, hash: deleted.hash });
  assert.deepEqual(result, { path, outcome: 'undeleted' });
  assert.ok((await readFile(file, 'utf8')).includes('Still wanted.'));
});

test('undoing a change that created the note takes the note away', async () => {
  const { dir, ctx, git } = await workspace();
  const path = 'notes/agent-wrote-this.md';
  const file = join(dir, path);
  await writeFile(join(dir, 'notes/other.md'), `${FM}\nUnrelated.\n`);
  await git.commitPaths(['notes/other.md'], 'create: other');
  await writeFile(file, `${FM}\nFiled without asking.\n`);
  await git.commitPaths([path], 'note: agent-wrote-this');

  const created = (await git.history(path))[0]!;
  const result = await revertNoteChange(ctx, { path, hash: created.hash });
  assert.deepEqual(result, { path, outcome: 'removed' });
  assert.equal(existsSync(file), false);
  assert.ok(existsSync(join(dir, 'notes/other.md')), 'nothing else was touched');
  // And it is still in the record, so the undo can be undone.
  assert.ok((await git.fileAt(path, created.hash))?.includes('Filed without asking.'));
});

test('undoing a rename puts the note back under the name it had', async () => {
  const { dir, ctx, git } = await workspace();
  const from = 'notes/old-name.md';
  const to = 'notes/new-name.md';
  await writeFile(join(dir, from), `${FM}\nA body long enough for git to see the rename.\n`);
  await git.commitPaths([from], 'create: old-name');
  await writeFile(join(dir, to), `${FM}\nA body long enough for git to see the rename.\n`);
  await rm(join(dir, from));
  await git.commitPaths([from, to], 'rename: old-name → new-name');

  const renamed = (await git.history(to))[0]!;
  const result = await revertNoteChange(ctx, { path: to, hash: renamed.hash });
  assert.deepEqual(result, { path: from, outcome: 'undeleted' });
  assert.equal(existsSync(join(dir, to)), false, 'the new name goes');
  assert.ok((await readFile(join(dir, from), 'utf8')).includes('A body long enough'));
});

test('a hash from another note is refused, and nothing is written', async () => {
  const { dir, ctx, git } = await workspace();
  await writeFile(join(dir, 'notes/a.md'), `${FM}\nA.\n`);
  await git.commitPaths(['notes/a.md'], 'create: a');
  await writeFile(join(dir, 'notes/b.md'), `${FM}\nB.\n`);
  await git.commitPaths(['notes/b.md'], 'create: b');
  const other = (await git.history('notes/a.md'))[0]!;

  await assert.rejects(
    () => revertNoteChange(ctx, { path: 'notes/b.md', hash: other.hash }),
    /did not touch this note/,
  );
  assert.ok((await readFile(join(dir, 'notes/b.md'), 'utf8')).includes('B.'));
});

test('there is nothing to restore when the note did not exist in that version', async () => {
  const { dir, ctx, git } = await workspace();
  await writeFile(join(dir, 'notes/a.md'), '---\ntype: note\nsummary: s\n---\n\nA.\n');
  await git.commitPaths(['notes/a.md'], 'create: a');
  const [first] = await git.history('notes/a.md');

  await writeFile(join(dir, 'notes/b.md'), '---\ntype: note\nsummary: s\n---\n\nB.\n');
  await git.commitPaths(['notes/b.md'], 'create: b');

  await assert.rejects(
    () => restoreNoteVersion(ctx, { path: 'notes/b.md', hash: first!.hash }),
    /no longer available/,
  );
  // And the note on disk is untouched.
  assert.ok((await readFile(join(dir, 'notes/b.md'), 'utf8')).includes('B.'));
});

// ---------------------------------------------------------------------------
// A label the summary pass wrote (docs/background-system.md ticket 3). The row
// it leaves has no proposal behind it, so this is the whole way back: the pass
// writes, the pass commits, the row carries that commit, and the undo runs on a
// real repo.
// ---------------------------------------------------------------------------

/** The index entry the pass reads before it opens a file. */
function entry(path: string, title: string) {
  return {
    path,
    slug: path.replace(/\.md$/, ''),
    type: 'note',
    layer: 'authored',
    title,
    summary: title,
    lifecycle: null,
    hasBody: true,
    mtime: Date.UTC(2026, 7, 1),
    frontmatter: {},
    links: [],
  };
}

test('a label the pass wrote can be put back from its Activity row', async () => {
  const { dir, ctx, git } = await workspace();
  const plan = 'notes/q3-plan.md';
  const renewals = 'notes/renewals.md';
  const planRaw = '---\ntype: note\ntitle: Q3 plan\nsummary: Q3 plan\n---\n\nShip SCIM first.\n';
  const renewalsRaw =
    '---\ntype: note\ntitle: Renewals\nsummary: Renewals\n---\n\nNovember is heavy.\n';
  await writeFile(join(dir, plan), planRaw);
  await writeFile(join(dir, renewals), renewalsRaw);
  await git.commitPaths([plan, renewals], 'create: the two notes');

  const rows: ActivityRecord[] = [];
  const notes = [entry(plan, 'Q3 plan'), entry(renewals, 'Renewals')];
  const passCtx = {
    ...ctx,
    index: {
      ...NOOP_INDEX,
      all: () => notes,
      get: (p: string) => notes.find((n) => n.path === p) ?? null,
    },
    activity: {
      record: (input: CreateActivityInput, now: number) => {
        const row = { ...input, id: `a_${rows.length + 1}`, at: now, reverted: null };
        rows.push(row);
        return row;
      },
      list: () => [...rows].reverse(),
      get: (id: string) => rows.find((r) => r.id === id) ?? null,
      latestLearned: () => [],
      markReverted: () => {},
    },
  } as unknown as UseCaseContext;

  await runSummaryPass(passCtx, {
    summarise: async () => 'One line about the note.\ntags: pricing',
  });

  const commit = (await git.history(plan))[0]!;
  assert.equal(commit.message, 'maintenance: labels');
  assert.equal(rows.length, 2);
  const row = rows.find((r) => r.path === plan)!;
  assert.equal(row.proposalId, null);
  assert.deepEqual(row.revert, { commit: commit.hash, undo: 'restore' });
  assert.ok((await readFile(join(dir, plan), 'utf8')).includes('tags:'), 'the label landed');

  const result = await revertNoteChange(ctx, { path: row.path!, hash: row.revert.commit! });

  assert.deepEqual(result, { path: plan, outcome: 'restored' });
  assert.equal(await readFile(join(dir, plan), 'utf8'), planRaw, 'byte for byte, labels gone');
  // One row, one note. The pass commit touched both, and the undo asked about
  // one, so the other keeps what the pass wrote.
  assert.ok((await readFile(join(dir, renewals), 'utf8')).includes('tags:'));
});
