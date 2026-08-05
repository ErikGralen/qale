import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rename, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { GitAdapter, resetGitAvailability } from '../src/git.js';

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

test('history returns commits newest-first and fileAt reads a past version', async () => {
  const vault = await tmp();
  const git = new GitAdapter(vault);
  await git.init();
  await writeFile(join(vault, 'note.md'), 'v1\n');
  await git.commitPaths(['note.md'], 'create: note');
  await writeFile(join(vault, 'note.md'), 'v2\n');
  await git.commitPaths(['note.md'], 'edit: note');

  const history = await git.history('note.md');
  assert.equal(history.length, 2);
  assert.equal(history[0]!.message, 'edit: note'); // newest first
  assert.equal(history[1]!.message, 'create: note');

  const old = await git.fileAt('note.md', history[1]!.hash);
  assert.equal(old, 'v1\n');
  const recent = await git.fileAt('note.md', history[0]!.hash);
  assert.equal(recent, 'v2\n');
});

test('history is empty (not an error) when the vault is not a repo', async () => {
  const vault = await tmp();
  const git = new GitAdapter(vault);
  await writeFile(join(vault, 'note.md'), 'body\n');
  assert.deepEqual(await git.history('note.md'), []);
  assert.equal(await git.fileAt('note.md', 'HEAD'), null);
});

test('session working files are ignored — the memory is versioned, scratch is not', async () => {
  const vault = await tmp();
  const git = new GitAdapter(vault);
  await git.init();
  assert.ok((await readFile(join(vault, '.gitignore'), 'utf8')).includes('sessions/.files/'));

  await mkdir(join(vault, 'sessions/.files/a1b2c3'), { recursive: true });
  await writeFile(join(vault, 'sessions/.files/a1b2c3/brief.md'), 'scratch\n');
  await writeFile(join(vault, 'sessions/2026-07-28-synthesis-a1b2c3.md'), '# receipt\n');
  await git.commitPaths(['sessions/2026-07-28-synthesis-a1b2c3.md', 'sessions/.files/a1b2c3/brief.md'], 'session: synthesis');

  const tracked = await simpleGit(vault).raw(['ls-files']);
  assert.ok(tracked.includes('sessions/2026-07-28-synthesis-a1b2c3.md'), 'the receipt is tracked');
  assert.ok(!tracked.includes('.files'), 'the scratch body is not');
});

/**
 * A stand-in `xcode-select` at the front of PATH, so the macOS probe can be
 * steered on a machine that does have the developer tools. It records every
 * call, which is how the caching assertions count probes.
 */
async function fakeXcodeSelect(exitCode: number): Promise<{ dir: string; calls: () => Promise<number> }> {
  const dir = await mkdtemp(join(tmpdir(), 'pm-bin-'));
  const log = join(dir, 'calls.txt');
  const bin = join(dir, 'xcode-select');
  await writeFile(bin, `#!/bin/sh\necho call >> "${log}"\nexit ${exitCode}\n`);
  await chmod(bin, 0o755);
  return {
    dir,
    calls: async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).length,
  };
}

async function withPath<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const original = process.env['PATH'];
  process.env['PATH'] = `${dir}:${original ?? ''}`;
  resetGitAvailability();
  try {
    return await fn();
  } finally {
    process.env['PATH'] = original;
    resetGitAvailability();
  }
}

test('macOS: no developer tools means no git — history stays empty and the stub is never run', { skip: process.platform !== 'darwin' }, async () => {
  const vault = await tmp();
  const git = new GitAdapter(vault);
  await git.init();
  await writeFile(join(vault, 'note.md'), 'v1\n');
  await git.commitPaths(['note.md'], 'create: note');

  const fake = await fakeXcodeSelect(1);
  await withPath(fake.dir, async () => {
    assert.equal(await git.available(), false);
    // A real repo with a real commit: the empty answer can only come from the
    // developer-tools check, which is the point — we never touch /usr/bin/git.
    assert.deepEqual(await git.history('note.md'), []);
    assert.equal(await git.fileAt('note.md', 'HEAD'), null);
    assert.ok((await fake.calls()) >= 1, 'the safe check ran');
  });

  // The one every open goes through: a vault with no `.git` of its own can only
  // be answered by asking git, so it must be answered by the safe check instead.
  const outer = await tmp();
  await simpleGit(outer).init();
  const nested = join(outer, 'vault');
  await mkdir(nested);
  const fake2 = await fakeXcodeSelect(1);
  await withPath(fake2.dir, async () => {
    assert.equal(await new GitAdapter(nested).isRepo(), false);
    assert.ok((await fake2.calls()) >= 1, 'the safe check ran instead of git');
  });
});

test('the availability probe is cached — a save does not spawn a process per call', { skip: process.platform !== 'darwin' }, async () => {
  const vault = await tmp();
  const git = new GitAdapter(vault);
  const fake = await fakeXcodeSelect(0);
  await withPath(fake.dir, async () => {
    // Concurrent and sequential: neither may probe twice.
    const [a, b] = await Promise.all([git.available(), git.available()]);
    assert.equal(a, true);
    assert.equal(b, true);
    assert.equal(await git.available(), true);
    // A second adapter asks about the same machine, not a second machine.
    assert.equal(await new GitAdapter(await tmp()).available(), true);
    assert.equal(await fake.calls(), 1);
  });
});

test('ensureIgnored is additive and idempotent — a vault that predates a rule catches up', async () => {
  const vault = await tmp();
  const git = new GitAdapter(vault);
  await writeFile(join(vault, '.gitignore'), '.DS_Store\nmy-own-rule\n');
  await git.ensureIgnored(['sessions/.files/', '.DS_Store']);
  let ignore = await readFile(join(vault, '.gitignore'), 'utf8');
  assert.equal(ignore, '.DS_Store\nmy-own-rule\nsessions/.files/\n');
  await git.ensureIgnored(['sessions/.files/']);
  ignore = await readFile(join(vault, '.gitignore'), 'utf8');
  assert.equal(ignore.match(/sessions\/\.files\//g)?.length, 1);
});
