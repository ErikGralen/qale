import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

/**
 * Codebase discovery and pull-before-run (docs/claude-code-tickets.md CC-2,
 * CC-4). The runner itself (CC-5) is next door in codebase-runner.test.ts,
 * which needs a stand-in `claude` binary and a PATH of its own.
 *
 * What matters in this suite is that `freshen` reports the truth. A run that
 * did not pull must say why, because the report it feeds is filed against the
 * commit it names, and a reader who is told the code is current when it is not
 * has been handed a wrong answer with a straight face.
 */

/** The scratch userData the settings service reads and writes. */
let userData = '';

mock.module('electron', {
  namedExports: {
    app: { getPath: () => userData, getLocale: () => 'en-US' },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value: string) => Buffer.from(value, 'utf8'),
      decryptString: (buf: Buffer) => buf.toString('utf8'),
    },
  },
});

const { SettingsService } = await import('../src/main/services/settings-service.js');
const { CodebaseService } = await import('../src/main/services/codebase-service.js');

const run = promisify(execFile);

/** A scratch folder for one test, plus the settings file that goes with it. */
async function scratch(name: string): Promise<string> {
  const dir = join(
    tmpdir(),
    `qale-codebase-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** A real repo with one commit on `main`. */
async function makeRepo(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await run('git', ['init', '-b', 'main'], { cwd: dir });
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await run('git', ['config', 'user.name', 'Test'], { cwd: dir });
  await fs.writeFile(join(dir, 'README.md'), 'one\n', 'utf8');
  await run('git', ['add', '.'], { cwd: dir });
  await run('git', ['commit', '-m', 'first'], { cwd: dir });
}

/** A settings service pointed at a fresh userData, holding the given folders. */
async function settingsWith(
  paths: { path: string; gitPull: boolean }[],
): Promise<InstanceType<typeof SettingsService>> {
  userData = await scratch('settings');
  const settings = new SettingsService();
  await settings.load();
  await settings.setCodebasePaths(paths);
  return settings;
}

test('a configured folder with a .git is one repo', async () => {
  const root = await scratch('one');
  const repo = join(root, 'checkout');
  await makeRepo(repo);
  const settings = await settingsWith([{ path: repo, gitPull: false }]);
  const service = new CodebaseService(settings, () => {});

  const repos = await service.listRepos();
  assert.deepEqual(repos, [{ name: 'checkout', dir: repo, parentPath: repo }]);
});

test('a folder of repos yields every direct subfolder that has a .git', async () => {
  const root = await scratch('many');
  await makeRepo(join(root, 'alpha'));
  await makeRepo(join(root, 'beta'));
  // Not a repo, so not a row. Nobody meant to point at their Downloads folder.
  await fs.mkdir(join(root, 'notes'), { recursive: true });
  const settings = await settingsWith([{ path: root, gitPull: false }]);
  const service = new CodebaseService(settings, () => {});

  const repos = await service.listRepos();
  assert.deepEqual(
    repos.map((r) => r.name),
    ['alpha', 'beta'],
  );
  assert.equal(repos[0]?.parentPath, root);
});

test('two repos with the same basename are qualified with their parent folder', async () => {
  const root = await scratch('collide');
  await makeRepo(join(root, 'work', 'api'));
  await makeRepo(join(root, 'side', 'api'));
  const settings = await settingsWith([
    { path: join(root, 'work'), gitPull: false },
    { path: join(root, 'side'), gitPull: false },
  ]);
  const service = new CodebaseService(settings, () => {});

  const repos = await service.listRepos();
  assert.deepEqual(repos.map((r) => r.name).sort(), ['side/api', 'work/api']);
});

test('the same repo reached through two configured folders is one repo', async () => {
  const root = await scratch('dup');
  const repo = join(root, 'api');
  await makeRepo(repo);
  const settings = await settingsWith([
    { path: root, gitPull: false },
    { path: repo, gitPull: false },
  ]);
  const service = new CodebaseService(settings, () => {});

  assert.equal((await service.listRepos()).length, 1);
});

test('freshen skips when git pull is off for the folder, and still reports HEAD', async () => {
  const root = await scratch('off');
  const repo = join(root, 'api');
  await makeRepo(repo);
  const settings = await settingsWith([{ path: repo, gitPull: false }]);
  const service = new CodebaseService(settings, () => {});

  const state = await service.freshen(repo);
  assert.equal(state.freshened, false);
  assert.equal(state.skippedWhy, 'git pull is off for this folder');
  assert.equal(state.branch, 'main');
  assert.match(state.commit, /^[0-9a-f]{40}$/);
});

test('freshen skips a dirty working tree', async () => {
  const root = await scratch('dirty');
  const repo = join(root, 'api');
  await makeRepo(repo);
  await fs.writeFile(join(repo, 'README.md'), 'edited\n', 'utf8');
  const settings = await settingsWith([{ path: repo, gitPull: true }]);
  const service = new CodebaseService(settings, () => {});

  const state = await service.freshen(repo);
  assert.equal(state.freshened, false);
  assert.equal(state.skippedWhy, 'the working tree has uncommitted changes');
});

test('freshen skips a checkout that is not on the default branch', async () => {
  const root = await scratch('branch');
  const origin = join(root, 'origin.git');
  const repo = join(root, 'api');
  await makeRepo(join(root, 'seed'));
  await run('git', ['clone', '--bare', join(root, 'seed'), origin]);
  await run('git', ['clone', origin, repo]);
  await run('git', ['checkout', '-b', 'spike'], { cwd: repo });
  const settings = await settingsWith([{ path: repo, gitPull: true }]);
  const service = new CodebaseService(settings, () => {});

  const state = await service.freshen(repo);
  assert.equal(state.freshened, false);
  assert.equal(state.branch, 'spike');
  assert.match(state.skippedWhy ?? '', /not the default branch main/);
});

test('freshen fast-forwards a clean checkout, then leaves it alone for 15 minutes', async () => {
  const root = await scratch('pull');
  const origin = join(root, 'origin.git');
  const seed = join(root, 'seed');
  const repo = join(root, 'api');
  await makeRepo(seed);
  await run('git', ['clone', '--bare', seed, origin]);
  await run('git', ['clone', origin, repo]);
  const before = (await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();

  // Somebody else pushes.
  await run('git', ['remote', 'add', 'origin', origin], { cwd: seed });
  await fs.writeFile(join(seed, 'README.md'), 'two\n', 'utf8');
  await run('git', ['commit', '-am', 'second'], { cwd: seed });
  await run('git', ['push', 'origin', 'main'], { cwd: seed });

  const settings = await settingsWith([{ path: repo, gitPull: true }]);
  const service = new CodebaseService(settings, () => {});

  const pulled = await service.freshen(repo);
  assert.equal(pulled.freshened, true);
  assert.equal(pulled.skippedWhy, undefined);
  assert.notEqual(pulled.commit, before);

  // Asked again straight away: nothing to gain, so nothing is spent.
  const again = await service.freshen(repo);
  assert.equal(again.freshened, false);
  assert.equal(again.skippedWhy, 'it was pulled less than 15 minutes ago');
  assert.equal(again.commit, pulled.commit);
});

test('freshen leaves a branch that cannot fast-forward exactly where it is', async () => {
  const root = await scratch('diverge');
  const origin = join(root, 'origin.git');
  const seed = join(root, 'seed');
  const repo = join(root, 'api');
  await makeRepo(seed);
  await run('git', ['clone', '--bare', seed, origin]);
  await run('git', ['clone', origin, repo]);
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await run('git', ['config', 'user.name', 'Test'], { cwd: repo });

  // Somebody else pushes.
  await run('git', ['remote', 'add', 'origin', origin], { cwd: seed });
  await fs.writeFile(join(seed, 'README.md'), 'theirs\n', 'utf8');
  await run('git', ['commit', '-am', 'theirs'], { cwd: seed });
  await run('git', ['push', 'origin', 'main'], { cwd: seed });

  // And the PM committed on main themselves, so the two have diverged and a
  // pull would have to merge. Merging in somebody's own clone is the one thing
  // this feature must never do.
  await fs.writeFile(join(repo, 'NOTES.md'), 'mine\n', 'utf8');
  await run('git', ['add', '.'], { cwd: repo });
  await run('git', ['commit', '-m', 'mine'], { cwd: repo });
  const before = (await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();

  const settings = await settingsWith([{ path: repo, gitPull: true }]);
  const service = new CodebaseService(settings, () => {});

  const state = await service.freshen(repo);
  assert.equal(state.freshened, false);
  assert.equal(state.skippedWhy, 'it cannot fast-forward');
  assert.equal(state.commit, before, 'the clone is exactly where the PM left it');
  assert.equal(state.branch, 'main');

  // And it says the same thing the next time it is asked. A pull that did not
  // happen must never be stamped as one: the report would then tell the reader
  // the code was pulled recently, which is the opposite of what happened.
  const again = await service.freshen(repo);
  assert.equal(again.freshened, false);
  assert.equal(again.skippedWhy, 'it cannot fast-forward');
});

test('freshen skips a repo with nowhere to pull from', async () => {
  const root = await scratch('local');
  const repo = join(root, 'api');
  await makeRepo(repo);
  const settings = await settingsWith([{ path: repo, gitPull: true }]);
  const service = new CodebaseService(settings, () => {});

  const state = await service.freshen(repo);
  assert.equal(state.freshened, false);
  assert.equal(state.skippedWhy, 'there is no remote to pull from');
  assert.equal(state.branch, 'main');
});

test('an empty folder list clears the settings record back to null', async () => {
  const root = await scratch('clear');
  const settings = await settingsWith([{ path: root, gitPull: true }]);
  assert.equal(settings.getCodebasePaths().length, 1);

  await settings.setCodebasePaths([]);
  assert.deepEqual(settings.getCodebasePaths(), []);
  assert.equal(settings.get().codebase, null);
});

test('the port is absent until a folder is configured', async () => {
  const settings = await settingsWith([]);
  const service = new CodebaseService(settings, () => {});
  assert.equal(service.port(), undefined);
});
