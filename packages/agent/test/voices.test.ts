import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UseCaseContext } from '@qale/application';
import { listVoices, resolveVoice, voiceBrief, voiceRoster } from '../src/voices.js';
import { listLoadableSkills } from '../src/tools.js';

/**
 * Voice resolution (SK-6). A voice is tone and language, applied at drafting
 * time and at no other moment. The two properties that matter here are that a
 * name resolves to the file the PM wrote, and that a name with no file resolves
 * to NOTHING: a draft in an invented voice is worse than a plain one, because
 * nobody can tell it was invented.
 */

const EXEC = `---
type: skill
title: Exec voice
summary: Short, decided, quantified.
---

Three sentences. Say it flat.
`;

const CS = `---
type: skill
title: CS voice
summary: For customers. Warm, plain, exact about dates.
---

Never write "soon".
`;

const SKILL = `---
type: skill
title: Find the pattern
summary: Reads a stack of interviews.
---

Read them all.
`;

function ctxWith(files: Record<string, string>): UseCaseContext {
  const notes = Object.keys(files).map((path) => ({
    path,
    slug: path.replace(/\/SKILL\.md$/, '').replace(/\.md$/, ''),
    type: 'skill',
  }));
  return {
    vault: { readRaw: async (p: string) => files[p] ?? null },
    index: { all: () => notes },
  } as unknown as UseCaseContext;
}

const WORKSPACE = {
  'voices/exec.md': EXEC,
  'voices/cs.md': CS,
  'skills/synthesis/SKILL.md': SKILL,
};

test('a voice resolves by name, and brings the brief the PM wrote', async () => {
  const voice = await resolveVoice(ctxWith(WORKSPACE), 'exec');
  assert.ok(voice);
  assert.equal(voice.name, 'exec');
  assert.equal(voice.title, 'Exec voice');
  assert.equal(voice.path, 'voices/exec.md');
  assert.match(voice.body, /Say it flat/);
});

test('a name with no file resolves to nothing, and never to something close', async () => {
  const ctx = ctxWith(WORKSPACE);
  assert.equal(await resolveVoice(ctx, 'board'), null);
  assert.equal(await resolveVoice(ctx, ''), null);
  assert.equal(await resolveVoice(ctx, 'execs'), null);
});

test('the ways a model spells a voice all land on the same file', async () => {
  const ctx = ctxWith(WORKSPACE);
  for (const spelling of ['exec', 'EXEC', 'voices/exec', 'exec.md', 'Exec voice']) {
    const voice = await resolveVoice(ctx, spelling);
    assert.equal(voice?.name, 'exec', `"${spelling}" should resolve`);
  }
});

test('a skill is not a voice, whatever it is called', async () => {
  const ctx = ctxWith({ ...WORKSPACE, 'skills/exec/SKILL.md': SKILL });
  const voice = await resolveVoice(ctx, 'exec');
  assert.equal(
    voice?.path,
    'voices/exec.md',
    'the folder decides, so a skill cannot shadow a voice',
  );
});

test('the roster is what the drafting tools tell the model', async () => {
  const voices = await listVoices(ctxWith(WORKSPACE));
  assert.deepEqual(
    voices.map((v) => v.name),
    ['cs', 'exec'],
  );
  const roster = voiceRoster(voices);
  assert.match(roster, /"exec"/);
  assert.match(roster, /"cs"/);
  assert.match(roster, /Never invent a voice/);
  // The summary is carried whole, because who a voice is for is the half of it
  // that makes it choosable.
  assert.match(roster, /For customers/);
  // Preferred, not compelled: a draft nobody in the roster is written for is a
  // plain draft, and that has to stay sayable.
  assert.match(roster, /Prefer the one written for whoever reads this draft/);
  assert.match(roster, /leave `voice` out/);
});

test('a workspace with no voices says so, rather than listing nothing', () => {
  const roster = voiceRoster([]);
  assert.match(roster, /no voices/);
  assert.match(roster, /leave `voice` out/);
});

test('the brief arrives as tone in force, and says what it may not touch', async () => {
  const voice = await resolveVoice(ctxWith(WORKSPACE), 'cs');
  const brief = voiceBrief(voice!);
  assert.match(brief, /Voice in force: cs/);
  assert.match(brief, /tone, register and wording/);
  assert.match(brief, /may not add a fact/);
  assert.match(brief, /Never write "soon"/);
});

test('a voice is never offered as a skill the model can load', async () => {
  const skills = await listLoadableSkills(ctxWith(WORKSPACE));
  assert.deepEqual(
    skills.map((s) => s.config.name),
    ['synthesis'],
  );
});
