import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRunnableResource, slugFromPath } from '@qale/domain';
import { listSkills, listAgentFiles, runnableEnabled } from '../src/index.js';
import type { IndexedNote, IndexPort, UseCaseContext, VaultPort } from '../src/ports.js';

/**
 * The name a skill or agent is LISTED under is the name it is INVOKED by — the
 * runtime resolves it under its folder. Parsing under the vault slug made the
 * composer's picker send "skills/synthesis", which resolved to
 * `skills/skills/synthesis.md`: the pick silently did nothing.
 */

const SYNTHESIS = `---
type: skill
starts: [you-run-it, model-picks-it-up]
title: Find the pattern
summary: Reads a stack of interviews and says what they add up to.
can: [draft-outbound]
---

## When
A pile of interviews needs reading.
`;

/**
 * The folder IS the type, exactly as the vault index reads it — including the
 * fold that gives a runnable folder's entry file the FOLDER as its slug, and
 * the rule that material beside the entry is not indexed at all.
 */
function ctxWith(files: Record<string, string>): UseCaseContext {
  const notes: IndexedNote[] = Object.keys(files)
    .filter((path) => !isRunnableResource(path))
    .map((path) => {
      const type = path.startsWith('agents/') ? 'agent' : 'skill';
      return {
        path,
        slug: slugFromPath(path),
        type,
        layer: 'authored',
        title: path,
        summary: '',
        status: null,
        hasBody: true,
        mtime: 1,
        frontmatter: { type },
        links: [],
      };
    }) as IndexedNote[];
  const vault = {
    readRaw: async (p: string) => files[p] ?? null,
    listDir: async (dir: string) => Object.keys(files).filter((p) => p.startsWith(`${dir}/`)).sort(),
  } as unknown as VaultPort;
  const index = { all: () => notes } as unknown as IndexPort;
  return { vault, index } as unknown as UseCaseContext;
}

test('a listed skill carries its bare invocation name and its human title', async () => {
  const [skill] = await listSkills(ctxWith({ 'skills/synthesis.md': SYNTHESIS }));
  assert.ok(skill);
  assert.equal(skill.slug, 'skills/synthesis');
  // What `use_skill` / the picker sends — never folder-qualified.
  assert.equal(skill.name, 'synthesis');
  assert.equal(skill.title, 'Find the pattern');
  assert.deepEqual(skill.starts, ['you-run-it', 'model-picks-it-up']);
  assert.deepEqual(skill.can, ['draft-outbound']);
  assert.equal(skill.enabled, true);
});

test('a skill with no title falls back to a readable filename, not a path', async () => {
  const bare = `---\ntype: skill\nsummary: s\n---\nX.\n`;
  const [skill] = await listSkills(ctxWith({ 'skills/before-meeting.md': bare }));
  assert.equal(skill?.name, 'before-meeting');
  assert.equal(skill?.title, 'Before meeting');
});

const LIBRARIAN = `---
type: agent
title: Librarian
summary: Keeps the memory consistent.
can: [draft-outbound]
---

Keep the memory consistent.
`;

test('listAgentFiles carries name, title, the switch and what it may do', async () => {
  const [agent] = await listAgentFiles(ctxWith({ 'agents/librarian.md': LIBRARIAN }));
  assert.ok(agent);
  assert.equal(agent.name, 'librarian');
  assert.equal(agent.title, 'Librarian');
  assert.equal(agent.enabled, true);
  assert.deepEqual(agent.can, ['draft-outbound']);
  // The file declares no clock — main merges those on.
  assert.deepEqual(agent.starts, ['you-run-it', 'model-picks-it-up']);
  assert.deepEqual(agent.errors, []);
});

const OFF = LIBRARIAN.replace('type: agent', 'type: agent\nenabled: false');

test('runnableEnabled reads the file switch; a missing file reads as on', async () => {
  const on = ctxWith({ 'agents/librarian.md': LIBRARIAN });
  assert.equal(await runnableEnabled(on, 'librarian'), true);
  assert.equal(await runnableEnabled(ctxWith({ 'agents/librarian.md': OFF }), 'librarian'), false);
  // No file: the sweep must not silently die — the seed restores it on open.
  assert.equal(await runnableEnabled(ctxWith({}), 'librarian'), true);
});

test('the switch is a floor: a skill file carries it too, and either folder can veto', async () => {
  // Skills have the same switch as agents, and the runtime fires both by name.
  assert.equal(
    await runnableEnabled(ctxWith({ 'skills/synthesis.md': SYNTHESIS }), 'synthesis'),
    true,
  );
  assert.equal(
    await runnableEnabled(
      ctxWith({ 'skills/synthesis.md': SYNTHESIS.replace('type: skill', 'type: skill\nenabled: false') }),
      'synthesis',
    ),
    false,
  );
  // A name in BOTH folders: off anywhere is off. `skills/x` shadows `agents/x`
  // when a session starts, so a floor that let the shadowed file decide would
  // hand a switched-off agent a way back in. True in both layouts, and in a
  // half-migrated vault where the two names are in different ones.
  assert.equal(
    await runnableEnabled(
      ctxWith({ 'agents/librarian.md': OFF, 'skills/librarian.md': SYNTHESIS }),
      'librarian',
    ),
    false,
  );
  assert.equal(
    await runnableEnabled(
      ctxWith({ 'agents/librarian/AGENT.md': OFF, 'skills/librarian/SKILL.md': SYNTHESIS }),
      'librarian',
    ),
    false,
  );
  assert.equal(
    await runnableEnabled(
      ctxWith({ 'agents/librarian/AGENT.md': OFF, 'skills/librarian.md': SYNTHESIS }),
      'librarian',
    ),
    false,
  );
});

test('a folder skill lists under its folder name, not "SKILL"', async () => {
  const [skill] = await listSkills(ctxWith({ 'skills/synthesis/SKILL.md': SYNTHESIS }));
  assert.ok(skill);
  assert.equal(skill.name, 'synthesis');
  assert.equal(skill.slug, 'skills/synthesis');
  assert.equal(skill.title, 'Find the pattern');
  const [agent] = await listAgentFiles(ctxWith({ 'agents/librarian/AGENT.md': LIBRARIAN }));
  assert.equal(agent?.name, 'librarian');
});

test('material beside the entry is listed as attached, never as a skill of its own', async () => {
  const skills = await listSkills(
    ctxWith({
      'skills/synthesis/SKILL.md': SYNTHESIS,
      'skills/synthesis/checklist.md': '# 60 points\n',
      'skills/synthesis/questions.csv': 'a,b\n',
    }),
  );
  // One skill, not three — the material is not indexed, so it can never reach
  // the prompt's skill index or a picker.
  assert.equal(skills.length, 1);
  assert.deepEqual(skills[0]?.files, [
    'skills/synthesis/checklist.md',
    'skills/synthesis/questions.csv',
  ]);
  // Names only. Nothing here carries content, which is the whole point.
  assert.ok(!JSON.stringify(skills[0]).includes('60 points'));
});

test('a legacy flat skill still lists, and simply has nowhere to attach anything', async () => {
  const [skill] = await listSkills(ctxWith({ 'skills/synthesis.md': SYNTHESIS }));
  assert.equal(skill?.name, 'synthesis');
  assert.deepEqual(skill?.files, []);
});
