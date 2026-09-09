import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appDbBasename, copyVault, shiftVaultDates } from '@qale/domain/demo';
import { AppDb, FsVault, GitAdapter, SqliteIndex } from '@qale/vault';
import {
  ensureDefaultSkills,
  migrateProductPagesToAbout,
  migrateRunnableFolders,
  migrateThemesToResearch,
  openVault,
  retireDefaultSkills,
  type UseCaseContext,
} from '@qale/application';
import {
  DEFAULT_AGENTS,
  DEFAULT_NOTES,
  DEFAULT_SKILLS,
  DEFAULT_VOICES,
  RETIRED_SKILLS,
} from '@qale/sessions';
import { repoRootFrom } from '../scripts/lint-scenarios.js';

/**
 * The seed vault is already migrated (ticket: the demo's `themes/` move).
 *
 * `afterOpen` in `handlers.ts` runs three one-time migrations, then retires and
 * seeds the starter pack, every time a workspace opens. `vault-dev/` is opened
 * fresh on every demo Start, so anything left for those passes to do runs in
 * front of an audience: an Activity row nobody asked for, and a script naming a
 * path the app has just renamed.
 *
 * So the seed has to be what a workspace looks like AFTER they have run. This
 * opens a copy of it the way the lint does and holds every pass to writing
 * nothing. When a new migration arrives from `main`, this fails, and the fix is
 * to run it over `vault-dev/` once and commit the result.
 */

// better-sqlite3 in this workspace is rebuilt for Electron's ABI; skip under a
// plain-node runner that cannot load it rather than failing the whole suite.
const skip = await (async () => {
  try {
    new SqliteIndex(join(mkdtempSync(join(tmpdir(), 'qale-seed-abi-')), 'index.db')).close();
    return false;
  } catch (err) {
    return (
      (err as NodeJS.ErrnoException).code === 'ERR_DLOPEN_FAILED' &&
      'better-sqlite3 built for a different ABI'
    );
  }
})();

const repoRoot = repoRootFrom(import.meta.dirname);

interface Opened {
  ctx: UseCaseContext;
  close(): void;
}

/** `vault-dev/` copied, dated and opened, the way `buildWorkspace` opens it. */
async function openSeed(offset: number): Promise<Opened> {
  const root = mkdtempSync(join(tmpdir(), 'qale-seed-'));
  const path = join(root, 'workspace');
  copyVault(join(repoRoot, 'vault-dev'), path);
  shiftVaultDates(path, offset);

  const index = new SqliteIndex(join(root, 'index.db'));
  const appDb = new AppDb(join(root, appDbBasename(path)));
  const ctx: UseCaseContext = {
    vault: new FsVault(path),
    index,
    git: new GitAdapter(path),
    clock: { now: () => '2026-07-17T09:00:00.000Z' },
    proposals: appDb.proposals,
    activity: appDb.activity,
    asks: appDb.asks,
    checks: appDb.checks,
  };
  await openVault(ctx);
  return {
    ctx,
    close: () => {
      index.close();
      appDb.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('the three afterOpen migrations write nothing on the seed vault', { skip }, async () => {
  const seed = await openSeed(0);
  try {
    const runnable = await migrateRunnableFolders(seed.ctx);
    assert.deepEqual(runnable.moved, [], 'a skill or agent file is still outside its folder');
    assert.deepEqual(runnable.left, []);

    const research = await migrateThemesToResearch(seed.ctx);
    assert.deepEqual(research.themes, [], 'themes/ is still in the seed');
    assert.deepEqual(research.understanding, [], 'understanding/ is still in the seed');
    assert.deepEqual(research.changed, [], 'the research move would rewrite the seed');

    const about = await migrateProductPagesToAbout(seed.ctx);
    assert.deepEqual(about.moved, [], 'a product page is still in research/');
    assert.deepEqual(about.changed, [], 'the about move would rewrite the seed');
  } finally {
    seed.close();
  }
});

test('the starter pack is complete in the seed, and holds nothing retired', { skip }, async () => {
  const seed = await openSeed(0);
  try {
    const retired = await retireDefaultSkills(seed.ctx, RETIRED_SKILLS);
    assert.deepEqual(retired, [], 'the seed ships a skill the pack has retired');
    const seeded = await ensureDefaultSkills(seed.ctx, [
      ...DEFAULT_SKILLS,
      ...DEFAULT_AGENTS,
      ...DEFAULT_VOICES,
      ...DEFAULT_NOTES,
    ]);
    assert.deepEqual(seeded, [], 'the seed is missing a file the starter pack ships');
  } finally {
    seed.close();
  }
});

test('the folders the migrations empty are gone from the seed', { skip }, () => {
  for (const dir of ['themes', 'understanding']) {
    assert.equal(existsSync(join(repoRoot, 'vault-dev', dir)), false, `vault-dev/${dir} is back`);
  }
});
