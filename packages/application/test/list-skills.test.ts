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
    listDir: async (dir: string) =>
      Object.keys(files)
        .filter((p) => p.startsWith(`${dir}/`))
        .sort(),
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
  assert.deepEqual(skill.can, ['draft-outbound']);
  assert.deepEqual(skill.errors, []);
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

test('the switch is an agent switch: a skill file cannot veto anything', () => {
  // A skill runs when you ask for it, and deleting it is how you stop asking,
  // so `enabled` says nothing on one (SK-2) and its page flags the key.
  const off = SYNTHESIS.replace('type: skill', 'type: skill\nenabled: false');
  return Promise.all([
    runnableEnabled(ctxWith({ 'skills/synthesis.md': off }), 'synthesis').then((on) =>
      assert.equal(on, true),
    ),
    // The agent file still decides, in either layout.
    runnableEnabled(ctxWith({ 'agents/librarian/AGENT.md': OFF }), 'librarian').then((on) =>
      assert.equal(on, false),
    ),
    // And a skill of the same name cannot switch the agent back on.
    runnableEnabled(
      ctxWith({ 'agents/librarian/AGENT.md': OFF, 'skills/librarian/SKILL.md': SYNTHESIS }),
      'librarian',
    ).then((on) => assert.equal(on, false)),
  ]);
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

/**
 * SK-6: a voice is filed as a skill note in `voices/`, so the row has to say
 * which it is. Without that mark the picker would offer a voice as work to run,
 * and the Skills page would count it as a skill.
 */
test('a voice comes back on the same list, marked as a voice', async () => {
  const VOICE = `---\ntype: skill\ntitle: Exec voice\nsummary: Short, decided, quantified.\n---\n\nSay it flat.\n`;
  const rows = await listSkills(
    ctxWith({ 'skills/synthesis/SKILL.md': SYNTHESIS, 'voices/exec.md': VOICE }),
  );
  const voice = rows.find((r) => r.name === 'exec');
  const skill = rows.find((r) => r.name === 'synthesis');
  assert.equal(voice?.kind, 'voice');
  assert.equal(voice?.title, 'Exec voice');
  assert.equal(skill?.kind, 'skill');
});
