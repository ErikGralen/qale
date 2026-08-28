import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runnableNameFromPath, slugFromPath } from '@qale/domain';
import { DEFAULT_VOICES, RETIRED_SKILLS, type DefaultSkill } from '@qale/sessions';
import { createSkill, ensureDefaultSkills, retireDefaultSkills } from '../src/index.js';
import type { IndexedNote, IndexPort, UseCaseContext, VaultPort } from '../src/ports.js';

/**
 * Seeding, and only seeding. The pack fills a workspace that does not have the
 * file yet. A file that is already there stays exactly as it is, whatever we
 * ship today: once a workspace holds a skill, that skill is the PM's. Nothing
 * compares a file to a version we shipped any more.
 */

const OURS = `---\ntype: skill\ntitle: Tidy a note\nsummary: v2\n---\n\nThe thing we ship.\n`;
const MINE = `---\ntype: skill\ntitle: Tidy a note\nsummary: mine\n---\n\nMy own words, thanks.\n`;

const PACK: DefaultSkill[] = [{ file: 'skills/tidy/SKILL.md', content: OURS }];

/** A vault and an index, both in memory. */
function world(files: Record<string, string> = {}) {
  const disk = new Map(Object.entries(files));
  const indexed = new Map<string, IndexedNote>();
  for (const path of disk.keys())
    indexed.set(path, { path, slug: slugFromPath(path) } as IndexedNote);
  const committed: string[] = [];

  const vault = {
    readRaw: async (p: string) => disk.get(p) ?? null,
    writeRaw: async (p: string, c: string) => void disk.set(p, c),
    remove: async (p: string) => void disk.delete(p),
    exists: async (p: string) => disk.has(p),
    readNote: async (p: string) =>
      disk.has(p) ? ({ path: p, slug: slugFromPath(p) } as never) : null,
  } as unknown as VaultPort;
  const index = {
    reindex: (n: { path: string }) =>
      void indexed.set(n.path, { path: n.path, slug: slugFromPath(n.path) } as IndexedNote),
    removeByPath: (p: string) => void indexed.delete(p),
  } as unknown as IndexPort;
  const git = { commitPaths: async (paths: string[]) => void committed.push(...paths) };
  return {
    disk,
    indexed,
    committed,
    ctx: { vault, index, git } as unknown as UseCaseContext,
  };
}

test('absent: the file is seeded, and the index picks it up', async () => {
  const w = world();
  const seeded = await ensureDefaultSkills(w.ctx, PACK);
  assert.deepEqual(seeded, ['skills/tidy/SKILL.md']);
  assert.equal(w.disk.get('skills/tidy/SKILL.md'), OURS);
  assert.ok(w.indexed.has('skills/tidy/SKILL.md'));
  assert.deepEqual(w.committed, ['skills/tidy/SKILL.md']);
});

test('already there: their copy is left alone, even when it differs from ours', async () => {
  const w = world({ 'skills/tidy/SKILL.md': MINE });
  const seeded = await ensureDefaultSkills(w.ctx, PACK);
  assert.deepEqual(seeded, []);
  assert.equal(w.disk.get('skills/tidy/SKILL.md'), MINE, 'their writing was overwritten');
  assert.deepEqual(w.committed, [], 'nothing to write, nothing to commit');
});

test('a flat file counts as present, so seeding never shadows an unmigrated copy', async () => {
  // A workspace whose folder migration has not run holds the PM's edits under
  // `skills/tidy.md`. Writing the folder form beside it would win the resolver
  // and hide their file.
  const w = world({ 'skills/tidy.md': MINE });
  assert.deepEqual(await ensureDefaultSkills(w.ctx, PACK), []);
  assert.equal(w.disk.has('skills/tidy/SKILL.md'), false);
});

test('seeding twice writes once', async () => {
  const w = world();
  await ensureDefaultSkills(w.ctx, PACK);
  assert.deepEqual(await ensureDefaultSkills(w.ctx, PACK), []);
});

test('a new skill lands where it can be invoked, named from what the PM typed', async () => {
  const w = world();
  const made = await createSkill(w.ctx, 'Chase renewals');
  assert.equal(made.name, 'chase-renewals');
  assert.equal(made.path, 'skills/chase-renewals/SKILL.md');
  assert.ok(w.disk.get(made.path)?.includes('title: "Chase renewals"'));
  assert.ok(w.indexed.has(made.path));
});

test('a name already in use takes a number instead of landing on top of it', async () => {
  const w = world({ 'skills/chase-renewals/SKILL.md': MINE });
  const made = await createSkill(w.ctx, 'Chase renewals');
  assert.equal(made.path, 'skills/chase-renewals-2/SKILL.md');
  assert.equal(w.disk.get('skills/chase-renewals/SKILL.md'), MINE);
});

test('an agent of the same name is a collision too: one resolver serves both folders', async () => {
  const w = world({ 'agents/librarian/AGENT.md': MINE });
  const made = await createSkill(w.ctx, 'Librarian');
  assert.equal(made.path, 'skills/librarian-2/SKILL.md');
});

/**
 * SK-6: the voices seed like everything else in the pack, into their own folder.
 * The second half is the point of the folder: a voice has no name the skill
 * resolver answers to, so nothing can invoke one as work.
 */
test('a voice seeds into voices/, and is not a runnable anybody can invoke', async () => {
  const w = world();
  const seeded = await ensureDefaultSkills(w.ctx, DEFAULT_VOICES);
  assert.deepEqual(
    seeded,
    DEFAULT_VOICES.map((v) => v.file),
  );
  for (const { file } of DEFAULT_VOICES) {
    assert.ok(file.startsWith('voices/'));
    assert.equal(runnableNameFromPath(file), null, `${file} resolves as a runnable`);
  }
});

/**
 * Retiring, which is seeding's opposite and follows the same rule about whose
 * words these are. The file leaves the picker and the index; every word in it
 * stays on disk under a basename nothing resolves.
 */
test('retired: the file is out of force, and not one word of it is lost', async () => {
  const w = world({ 'skills/tidy/SKILL.md': MINE });
  const touched = await retireDefaultSkills(w.ctx, ['skills/tidy/SKILL.md']);
  assert.deepEqual(touched, ['skills/tidy/SKILL.md', 'skills/tidy/RETIRED-SKILL.md']);
  assert.equal(w.disk.has('skills/tidy/SKILL.md'), false);
  assert.equal(w.disk.get('skills/tidy/RETIRED-SKILL.md'), MINE);
  assert.equal(w.indexed.has('skills/tidy/SKILL.md'), false, 'it still lists as a skill');
  assert.deepEqual(w.committed, touched);
});

test('a flat file is retired too, so an unmigrated workspace is caught', async () => {
  const w = world({ 'skills/tidy.md': MINE });
  await retireDefaultSkills(w.ctx, ['skills/tidy/SKILL.md']);
  assert.equal(w.disk.has('skills/tidy.md'), false);
  assert.equal(w.disk.get('skills/tidy/RETIRED-SKILL.md'), MINE);
});

test('retiring twice writes once, and a workspace that never had it is untouched', async () => {
  const w = world({ 'skills/tidy/SKILL.md': MINE });
  await retireDefaultSkills(w.ctx, ['skills/tidy/SKILL.md']);
  assert.deepEqual(await retireDefaultSkills(w.ctx, ['skills/tidy/SKILL.md']), []);
  const fresh = world();
  assert.deepEqual(await retireDefaultSkills(fresh.ctx, RETIRED_SKILLS), []);
  assert.equal(fresh.disk.size, 0);
});

/** A retired name has to land somewhere, or an old receipt opens nothing. */
test('every retired skill keeps a name that resolves', async () => {
  const { DEFAULT_SKILL_BY_NAME } = await import('@qale/sessions');
  for (const file of RETIRED_SKILLS) {
    const name = runnableNameFromPath(file);
    assert.ok(name, `${file} has no invocation name`);
    assert.ok(DEFAULT_SKILL_BY_NAME[name], `${name} resolves to nothing`);
  }
});
