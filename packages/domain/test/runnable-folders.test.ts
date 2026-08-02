import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRunnableEntry,
  isRunnableResource,
  runnableCandidates,
  runnableEntryPath,
  runnableForms,
  runnableNameFromPath,
  slugFromPath,
} from '../src/index.js';

/**
 * A skill (and an agent) is a folder: `skills/spec-review/SKILL.md` plus its own
 * material beside it. The vocabulary here is what keeps that one change from
 * touching every caller — the entry file's slug is its FOLDER, so the name a
 * skill is invoked by is the same in both layouts.
 */

test('the entry file is slugged as its folder, in both folders', () => {
  assert.equal(slugFromPath('skills/spec-review/SKILL.md'), 'skills/spec-review');
  assert.equal(slugFromPath('agents/librarian/AGENT.md'), 'agents/librarian');
  // Which is what makes the last segment the invocation name either way.
  assert.equal(slugFromPath('skills/spec-review.md').split('/').pop(), 'spec-review');
  assert.equal(slugFromPath('skills/spec-review/SKILL.md').split('/').pop(), 'spec-review');
});

test('ordinary notes are untouched, including ones that merely live deep', () => {
  assert.equal(slugFromPath('insights/nordkap-needs-scim.md'), 'insights/nordkap-needs-scim');
  assert.equal(slugFromPath('skills/spec-review/checklist.md'), 'skills/spec-review/checklist');
});

test('either entry name counts in either folder: a hand-made file still resolves', () => {
  assert.equal(isRunnableEntry('skills/x/SKILL.md'), true);
  assert.equal(isRunnableEntry('agents/x/AGENT.md'), true);
  assert.equal(isRunnableEntry('agents/x/SKILL.md'), true);
  assert.equal(isRunnableEntry('skills/x.md'), false);
  assert.equal(isRunnableEntry('notes/x/SKILL.md'), false);
});

test('everything else in the folder is material, and material is never a note', () => {
  assert.equal(isRunnableResource('skills/spec-review/checklist.md'), true);
  assert.equal(isRunnableResource('skills/spec-review/examples/one.md'), true);
  assert.equal(isRunnableResource('skills/spec-review/table.csv'), true);
  assert.equal(isRunnableResource('skills/spec-review/SKILL.md'), false);
  assert.equal(isRunnableResource('skills/spec-review.md'), false);
});

test('a name is read off either layout; orientation files are not runnables', () => {
  assert.equal(runnableNameFromPath('skills/synthesis/SKILL.md'), 'synthesis');
  assert.equal(runnableNameFromPath('skills/synthesis.md'), 'synthesis');
  assert.equal(runnableNameFromPath('agents/librarian/AGENT.md'), 'librarian');
  assert.equal(runnableNameFromPath('skills/synthesis/checklist.md'), null);
  assert.equal(runnableNameFromPath('skills/index.md'), null);
  assert.equal(runnableNameFromPath('insights/x.md'), null);
});

test('skills still shadow agents, and the folder form still shadows the flat file', () => {
  const order = runnableCandidates('librarian');
  // The precedence that must not change: every `skills/` form is consulted
  // before any `agents/` form, so a customised copy keeps beating the agent file.
  const firstAgent = order.findIndex((p) => p.startsWith('agents/'));
  assert.ok(order.slice(0, firstAgent).every((p) => p.startsWith('skills/')));
  assert.equal(order[0], 'skills/librarian/SKILL.md');
  assert.equal(order[firstAgent], 'agents/librarian/AGENT.md');
  // And inside each folder the new layout is read before the legacy file.
  assert.ok(order.indexOf('skills/librarian/SKILL.md') < order.indexOf('skills/librarian.md'));
  assert.ok(order.indexOf('agents/librarian/AGENT.md') < order.indexOf('agents/librarian.md'));
});

test('both forms of one file are reachable from either spelling', () => {
  assert.equal(runnableEntryPath('agents', 'librarian'), 'agents/librarian/AGENT.md');
  assert.deepEqual(runnableForms('skills/ask.md'), ['skills/ask/SKILL.md', 'skills/ask.md']);
  assert.deepEqual(runnableForms('skills/ask/SKILL.md'), ['skills/ask/SKILL.md', 'skills/ask.md']);
  assert.deepEqual(runnableForms('insights/x.md'), ['insights/x.md']);
});
