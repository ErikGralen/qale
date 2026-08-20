import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugFromPath } from '@qale/domain';
import { shippedHash, type DefaultSkill, type RetiredSkill } from '@qale/sessions';
import {
  applyShippedSkill,
  createSkill,
  dismissSkillNotice,
  ensureDefaultSkills,
  reviewSkillPack,
} from '../src/index.js';
import type {
  CheckLedgerPort,
  IndexedNote,
  IndexPort,
  UseCaseContext,
  VaultPort,
} from '../src/ports.js';

/**
 * The upgrade path. A workspace is seeded once and then kept for good, so what
 * matters is what happens to a file that is ALREADY there when we ship a new
 * version of it. Three cases, and the whole design is telling the middle one
 * from the last: absent (seed), untouched (update without a word), edited
 * (never overwrite, offer a review).
 */

const V1 = `---\ntype: skill\ntitle: Tidy a note\nsummary: v1\n---\n\nThe first thing we shipped.\n`;
const V2 = `---\ntype: skill\ntitle: Tidy a note\nsummary: v2\n---\n\nThe second thing we shipped.\n`;
const MINE = `---\ntype: skill\ntitle: Tidy a note\nsummary: mine\n---\n\nMy own words, thanks.\n`;

/** The pack as it stands "now": V2 ships, V1 is remembered. */
const PACK: DefaultSkill[] = [
  { file: 'skills/tidy/SKILL.md', content: V2, shipped: [shippedHash(V1), shippedHash(V2)] },
];

const GONE: RetiredSkill[] = [{ file: 'skills/old-way.md', shipped: [shippedHash(V1)] }];

/** A vault, an index and a ledger, all in memory. */
function world(files: Record<string, string> = {}) {
  const disk = new Map(Object.entries(files));
  const indexed = new Map<string, IndexedNote>();
  for (const path of disk.keys())
    indexed.set(path, { path, slug: slugFromPath(path) } as IndexedNote);
  const committed: string[] = [];
  const ledger = new Map<string, string>();

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
  const checks: CheckLedgerPort = {
    get: (k) => ledger.get(k) ?? null,
    set: (k, v) => void ledger.set(k, v),
  };
  return {
    disk,
    indexed,
    committed,
    ctx: { vault, index, git, checks } as unknown as UseCaseContext,
  };
}

test('absent: the file is seeded', async () => {
  const w = world();
  const out = await ensureDefaultSkills(w.ctx, PACK, GONE);
  assert.deepEqual(out.seeded, ['skills/tidy/SKILL.md']);
  assert.equal(w.disk.get('skills/tidy/SKILL.md'), V2);
  assert.ok(w.indexed.has('skills/tidy/SKILL.md'));
});

test('untouched: an older version of ours is brought up to date, and nothing is said', async () => {
  const w = world({ 'skills/tidy/SKILL.md': V1 });
  const out = await ensureDefaultSkills(w.ctx, PACK, GONE);

  assert.deepEqual(out.updated, ['skills/tidy/SKILL.md']);
  assert.equal(w.disk.get('skills/tidy/SKILL.md'), V2);
  // The whole point of the silent path: no row, no prompt, nothing to dismiss.
  const review = await reviewSkillPack(w.ctx, PACK, GONE);
  assert.deepEqual(review.updates, []);
  assert.deepEqual(review.retired, []);
});

test('already current: nothing is written and nothing is committed', async () => {
  const w = world({ 'skills/tidy/SKILL.md': V2 });
  const out = await ensureDefaultSkills(w.ctx, PACK, GONE);
  assert.deepEqual(out, { seeded: [], updated: [], removed: [], retired: [] });
  assert.deepEqual(w.committed, []);
});

test('edited: the file is left alone and offered as a review', async () => {
  const w = world({ 'skills/tidy/SKILL.md': MINE });
  const out = await ensureDefaultSkills(w.ctx, PACK, GONE);

  assert.deepEqual(out.updated, []);
  assert.equal(w.disk.get('skills/tidy/SKILL.md'), MINE, 'their writing was overwritten');

  const review = await reviewSkillPack(w.ctx, PACK, GONE);
  assert.equal(review.updates.length, 1);
  assert.equal(review.updates[0]?.file, 'skills/tidy/SKILL.md');
  assert.equal(review.updates[0]?.yours, MINE);
  assert.equal(review.updates[0]?.ours, V2);
  // Titled by THEIR copy: the row has to name what they see in the list.
  assert.equal(review.updates[0]?.title, 'Tidy a note');
});

test('keep mine is durable for that version, and comes back when we change it again', async () => {
  const w = world({ 'skills/tidy/SKILL.md': MINE });
  await ensureDefaultSkills(w.ctx, PACK, GONE);
  dismissSkillNotice(w.ctx, PACK, 'skills/tidy/SKILL.md');

  assert.deepEqual((await reviewSkillPack(w.ctx, PACK, GONE)).updates, []);

  const V3 = `${V2}\nA third thing.\n`;
  const later: DefaultSkill[] = [
    { file: 'skills/tidy/SKILL.md', content: V3, shipped: [...PACK[0]!.shipped, shippedHash(V3)] },
  ];
  assert.equal((await reviewSkillPack(w.ctx, later, GONE)).updates.length, 1);
});

test('use the new version replaces theirs, and the row goes', async () => {
  const w = world({ 'skills/tidy/SKILL.md': MINE });
  assert.equal(await applyShippedSkill(w.ctx, PACK, 'skills/tidy/SKILL.md'), true);
  assert.equal(w.disk.get('skills/tidy/SKILL.md'), V2);
  assert.deepEqual((await reviewSkillPack(w.ctx, PACK, GONE)).updates, []);
});

test('a retired file nobody touched is simply taken away', async () => {
  const w = world({ 'skills/old-way.md': V1 });
  const out = await ensureDefaultSkills(w.ctx, PACK, GONE);
  assert.deepEqual(out.removed, ['skills/old-way.md']);
  assert.equal(w.disk.has('skills/old-way.md'), false);
  assert.deepEqual((await reviewSkillPack(w.ctx, PACK, GONE)).retired, []);
});

test('a retired file they edited is kept, out of force, and said once', async () => {
  const w = world({ 'skills/old-way.md': MINE });
  const out = await ensureDefaultSkills(w.ctx, PACK, GONE);

  assert.deepEqual(out.retired, ['skills/old-way.md']);
  // Their words survive, byte for byte, in the skill's own folder.
  assert.equal(w.disk.get('skills/old-way/RETIRED-SKILL.md'), MINE);
  // And it genuinely stopped firing: gone from both the paths a runnable
  // resolves from, and out of the index.
  assert.equal(w.disk.has('skills/old-way.md'), false);
  assert.equal(w.disk.has('skills/old-way/SKILL.md'), false);
  assert.equal(w.indexed.has('skills/old-way.md'), false);

  const review = await reviewSkillPack(w.ctx, PACK, GONE);
  assert.equal(review.retired.length, 1);
  assert.equal(review.retired[0]?.keptAt, 'skills/old-way/RETIRED-SKILL.md');

  dismissSkillNotice(w.ctx, PACK, 'skills/old-way.md');
  assert.deepEqual((await reviewSkillPack(w.ctx, PACK, GONE)).retired, []);
});

test('retiring twice keeps both copies rather than writing over the first', async () => {
  const w = world({ 'skills/old-way.md': MINE });
  await ensureDefaultSkills(w.ctx, PACK, GONE);
  w.disk.set('skills/old-way.md', `${MINE}\nA second try.\n`);
  await ensureDefaultSkills(w.ctx, PACK, GONE);

  assert.equal(w.disk.get('skills/old-way/RETIRED-SKILL.md'), MINE);
  assert.ok(w.disk.get('skills/old-way/RETIRED-SKILL-2.md')?.includes('A second try.'));
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

test('an agent of the same name is a collision too — one resolver serves both folders', async () => {
  const w = world({ 'agents/librarian/AGENT.md': MINE });
  const made = await createSkill(w.ctx, 'Librarian');
  assert.equal(made.path, 'skills/librarian-2/SKILL.md');
});
