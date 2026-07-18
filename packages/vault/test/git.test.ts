import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { GitAdapter } from '../src/git.js';

// Isolate from the developer's global/system git config so identity-fallback
// behavior is deterministic.
process.env['GIT_CONFIG_GLOBAL'] = '/dev/null';
process.env['GIT_CONFIG_NOSYSTEM'] = '1';

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pm-git-'));
}

test('isRepo is false for a vault nested inside another repo (regression: vault commits leaked into the source repo)', async () => {
  const outer = await tmp();
  await simpleGit(outer).init();
  const vault = join(outer, 'vault');
  await mkdir(vault);
  await writeFile(join(vault, 'note.md'), '# hi\n');

  const git = new GitAdapter(vault);
  assert.equal(await git.isRepo(), false);

  // commitPaths must refuse — nothing may land in the outer repo
  await git.commitPaths(['note.md'], 'edit: note');
  const log = await simpleGit(outer).log().catch(() => null);
  assert.equal(log?.total ?? 0, 0);
});

test('isRepo is true when the vault root is the repo root', async () => {
  const vault = await tmp();
  const git = new GitAdapter(vault);
  assert.equal(await git.isRepo(), false);
  await git.init();
  assert.equal(await git.isRepo(), true);
});

test('init seeds identity + .gitignore so commits work without global git config', async () => {
  const vault = await tmp();
  const git = new GitAdapter(vault);
  await git.init();

  const ignore = await readFile(join(vault, '.gitignore'), 'utf8');
  assert.ok(ignore.includes('.DS_Store'));

  await writeFile(join(vault, 'a.md'), 'alpha\n');
  await git.commitPaths(['a.md', '.gitignore'], 'create: a');
  const log = await simpleGit(vault).log();
  assert.equal(log.total, 1);
  assert.equal(log.latest?.message, 'create: a');
});

test('commitPaths survives a bad pathspec in the batch (rename of a never-committed file)', async () => {
  const vault = await tmp();
  const git = new GitAdapter(vault);
  await git.init();
  await writeFile(join(vault, 'old.md'), 'body\n');
  await rename(join(vault, 'old.md'), join(vault, 'new.md'));

  // old.md was never tracked: adding it throws pathspec errors, but new.md
  // must still be committed.
  await git.commitPaths(['old.md', 'new.md'], 'rename: old -> new');
  const log = await simpleGit(vault).log();
  assert.equal(log.total, 1);
});
