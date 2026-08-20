import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugFromPath } from '@qale/domain';
import { migrateRunnableFolders, reconcileIndex } from '../src/index.js';
import type { IndexedNote, IndexPort, UseCaseContext, VaultPort } from '../src/ports.js';

/**
 * Moving a vault to one-folder-per-skill. Every skill in a workspace is
 * somebody's writing, so the bar is higher than "it ends up in the right place":
 * the bytes must survive untouched, a second run must do nothing, and an
 * interrupted run must be finishable rather than ambiguous.
 */

/** The smallest vault that can be moved around: a path → content map. */
function world(files: Record<string, string>) {
  const disk = new Map(Object.entries(files));
  const indexed = new Map<string, IndexedNote>();
  for (const path of disk.keys()) {
    indexed.set(path, { path, slug: slugFromPath(path), type: 'skill', mtime: 1 } as IndexedNote);
  }
  const committed: string[] = [];
  const vault = {
    list: async () => [...disk.keys()].map((path) => ({ path, mtime: 1 })),
    listDir: async (dir: string) => [...disk.keys()].filter((p) => p.startsWith(`${dir}/`)).sort(),
    readRaw: async (p: string) => disk.get(p) ?? null,
    writeRaw: async (p: string, c: string) => void disk.set(p, c),
    remove: async (p: string) => void disk.delete(p),
    exists: async (p: string) => disk.has(p),
    readNote: async (p: string) =>
      disk.has(p) ? ({ path: p, slug: slugFromPath(p), body: disk.get(p) } as never) : null,
  } as unknown as VaultPort;
  const index = {
    all: () => [...indexed.values()],
    get: (p: string) => indexed.get(p) ?? null,
    reindex: (n: { path: string }) =>
      void indexed.set(n.path, {
        path: n.path,
        slug: slugFromPath(n.path),
        type: 'skill',
        mtime: 1,
      } as IndexedNote),
    removeByPath: (p: string) => void indexed.delete(p),
  } as unknown as IndexPort;
  const git = { commitPaths: async (paths: string[]) => void committed.push(...paths) };
  return { disk, indexed, committed, ctx: { vault, index, git } as unknown as UseCaseContext };
}

// Frontmatter a note round-trip would happily reformat: an unmodelled key, a
// quoted scalar, trailing whitespace, no closing newline.
const AUTHORED = `---\ntype: skill\nsummary: "Mine, thanks"\nfavourite_colour: green   \n---\n\n# Mine\n\nDo it my way.`;

test('the move is bytes-in, bytes-out — an authored skill comes out identical', async () => {
  const w = world({ 'skills/mine.md': AUTHORED, 'agents/watcher.md': AUTHORED });
  const { moved, left } = await migrateRunnableFolders(w.ctx);

  assert.equal(w.disk.get('skills/mine/SKILL.md'), AUTHORED);
  assert.equal(w.disk.get('agents/watcher/AGENT.md'), AUTHORED);
  assert.equal(w.disk.has('skills/mine.md'), false);
  assert.equal(w.disk.has('agents/watcher.md'), false);
  assert.deepEqual(left, []);
  assert.equal(moved.length, 4);
  // The index follows the file rather than waiting for a rescan, and the entry
  // keeps answering to its folder, which is the name it is invoked by.
  assert.equal(w.indexed.has('skills/mine.md'), false);
  assert.equal(w.indexed.get('skills/mine/SKILL.md')?.slug, 'skills/mine');
  assert.ok(w.committed.includes('skills/mine/SKILL.md'));
});

test('running it twice is running it once', async () => {
  const w = world({ 'skills/mine.md': AUTHORED });
  await migrateRunnableFolders(w.ctx);
  const second = await migrateRunnableFolders(w.ctx);
  assert.deepEqual(second, { moved: [], left: [] });
  assert.deepEqual([...w.disk.keys()], ['skills/mine/SKILL.md']);
  assert.equal(w.disk.get('skills/mine/SKILL.md'), AUTHORED);
});

test('an interrupted move finishes on the next run instead of leaving a shadow', async () => {
  // The crash window: written to the folder, not yet removed from the flat path.
  const w = world({ 'skills/mine.md': AUTHORED, 'skills/mine/SKILL.md': AUTHORED });
  const { moved, left } = await migrateRunnableFolders(w.ctx);
  assert.deepEqual([...w.disk.keys()], ['skills/mine/SKILL.md']);
  assert.equal(w.disk.get('skills/mine/SKILL.md'), AUTHORED);
  assert.deepEqual(left, []);
  assert.ok(moved.includes('skills/mine.md'));
});

test('when the two copies disagree, both are left alone and the path is reported', async () => {
  // Someone edited the flat file after a half-migration. There is no honest way
  // to pick a winner, and picking the wrong one silently deletes their writing.
  const w = world({
    'skills/mine.md': `${AUTHORED}\n\nEdited later.`,
    'skills/mine/SKILL.md': AUTHORED,
  });
  const { moved, left } = await migrateRunnableFolders(w.ctx);
  assert.deepEqual(moved, []);
  assert.deepEqual(left, ['skills/mine.md']);
  assert.equal(w.disk.get('skills/mine.md'), `${AUTHORED}\n\nEdited later.`);
  assert.equal(w.disk.get('skills/mine/SKILL.md'), AUTHORED);
});

test('it moves runnables and nothing else', async () => {
  const w = world({
    'skills/mine.md': AUTHORED,
    'skills/index.md': '# map',
    'skills/mine/checklist.md': '# 60 points',
    'insights/x.md': 'note',
  });
  await migrateRunnableFolders(w.ctx);
  assert.equal(w.disk.has('skills/index.md'), true);
  assert.equal(w.disk.has('insights/x.md'), true);
  assert.equal(w.disk.get('skills/mine/checklist.md'), '# 60 points');
});

test('material beside the entry is never indexed, so it cannot load itself', async () => {
  const w = world({});
  w.indexed.clear();
  const files: Record<string, string> = {
    'skills/mine/SKILL.md': AUTHORED,
    'skills/mine/checklist.md': '# 60 points',
    'skills/mine/notes/deep.md': 'deeper still',
    'skills/index.md': '# map',
    'insights/x.md': 'note',
  };
  for (const [p, c] of Object.entries(files)) w.disk.set(p, c);
  await reconcileIndex(w.ctx.vault, w.ctx.index);

  assert.deepEqual([...w.indexed.keys()].sort(), ['insights/x.md', 'skills/mine/SKILL.md']);
});

test('a stale index built before folders drops its material rows on the next reconcile', async () => {
  const w = world({ 'skills/mine/SKILL.md': AUTHORED, 'skills/mine/checklist.md': '# 60 points' });
  // What an older index would hold: the checklist as a second skill.
  assert.ok(w.indexed.has('skills/mine/checklist.md'));
  await reconcileIndex(w.ctx.vault, w.ctx.index);
  assert.deepEqual([...w.indexed.keys()], ['skills/mine/SKILL.md']);
});
