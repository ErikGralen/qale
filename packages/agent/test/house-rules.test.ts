import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UseCaseContext } from '@qale/application';
import { HOUSE_RULES, SessionHarness, parseRunnable } from '@qale/sessions';
import { createUseSkillTool, listLoadableSkills } from '../src/tools.js';

/**
 * The house rules are the one file a session never loads: the runtime puts them
 * in the system prompt of every session (SK-3), so offering them again through
 * `use_skill` would teach the model that its instructions repeat.
 *
 * Everything else in `skills/` is loadable, and nothing in the file decides it
 * any more — `starts` is gone (SK-2), so a skill is reachable because it is a
 * skill.
 */

const SYNTHESIS = `---
type: skill
title: Find the pattern
summary: Reads a stack of interviews and says what they add up to.
can: [draft-outbound, keep-working-files]
---

Read them all.
`;

const PROCESS = `---
type: skill
title: Tidy a note
summary: Turns a dumped note into filed cards.
---

Read it, then file it.
`;

function ctxWith(files: Record<string, string>): UseCaseContext {
  const notes = Object.keys(files).map((path) => ({
    path,
    slug: path.replace(/\/(SKILL|AGENT)\.md$/, '').replace(/\.md$/, ''),
    type: path.startsWith('agents/') ? 'agent' : 'skill',
  }));
  return {
    vault: { readRaw: async (p: string) => files[p] ?? null },
    index: { all: () => notes },
  } as unknown as UseCaseContext;
}

const WORKSPACE = {
  'skills/house-rules/SKILL.md': HOUSE_RULES,
  'skills/synthesis/SKILL.md': SYNTHESIS,
  'skills/process-note/SKILL.md': PROCESS,
};

test('every skill is loadable except the house rules', async () => {
  const skills = await listLoadableSkills(ctxWith(WORKSPACE));
  assert.deepEqual(
    skills.map((s) => s.config.name).sort(),
    ['process-note', 'synthesis'],
    'the house rules are already in the prompt, and nothing else is held back',
  );
});

test('a loaded skill arrives in force and brings its capabilities', async () => {
  const ctx = ctxWith(WORKSPACE);
  const harness = new SessionHarness('s1', parseRunnable(PROCESS, 'process-note'), '2026-08-21');
  assert.equal(harness.outbound, false);

  const tool = createUseSkillTool(ctx, harness);
  const said = await (
    tool.execute as unknown as (id: string, p: unknown) => Promise<{ content: { text: string }[] }>
  )('call-1', { name: 'synthesis' });

  assert.match(said.content[0]!.text, /Skill now in force: synthesis/);
  assert.equal(harness.outbound, true, 'an arriving skill adds what it may do');
  assert.equal(harness.activeSkillName, 'synthesis');
});

/**
 * The rules the individual skills used to each restate. They live here now
 * because the runtime puts this one file in every system prompt, so a rule
 * written once is in force everywhere and cannot drift between six bodies.
 * `UNATTENDED_RULES` used to carry the last two; it carries only what changes
 * when nobody is watching (see unattended-rules.test.ts).
 */
test('the house rules carry the rules every session used to be told twice', () => {
  const body = parseRunnable(HOUSE_RULES, 'house-rules').body;

  assert.match(body, /## Reading the memory/);
  assert.match(body, /Delivery comes from the ticket mirror/);
  assert.match(body, /Follow `supersedes` to the end of the chain/);

  assert.match(body, /## Proposing/);
  assert.match(body, /A contradiction is its own card/);
  assert.match(body, /An empty result is a result/);
  assert.match(body, /Follow the output template/);
  assert.match(body, /Where a skill's body ends with a fenced block/);
  assert.match(body, /Never reorder, rename, merge or drop a section/);
  // The three claim labels, each with what the word promises.
  assert.match(body, /\*\*Fact\*\*, \*\*Inference\*\* or \*\*Assumption\*\*/);
  assert.match(body, /Three labels, and there is no fourth/);
});

test('the house rules cannot be loaded by name', async () => {
  const ctx = ctxWith(WORKSPACE);
  const tool = createUseSkillTool(ctx);
  const said = await (
    tool.execute as unknown as (id: string, p: unknown) => Promise<{ content: { text: string }[] }>
  )('call-1', { name: 'house-rules' });

  assert.match(said.content[0]!.text, /No skill named "house-rules" is available on demand/);
});
