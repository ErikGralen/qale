import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restoreNoteVersion, type UseCaseContext } from '@qale/application';
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
