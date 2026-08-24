import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AGENTS, DEFAULT_SKILLS, DEFAULT_VOICES, HOUSE_RULES_NAME } from '@qale/sessions';
import { isVoicePath, runnableNameFromPath, slugFromPath, basename } from '@qale/domain';
import {
  MOMENTS,
  SKILLS_TABS,
  momentFor,
  tabForFile,
  type SkillsTab,
  type TabbedFile,
} from '../src/renderer/src/lib/skills-tabs.js';

/**
 * Which tab a file lands on (SK-12). The property the page rests on is that
 * every file is on exactly one tab: a file on two would be edited in two
 * places, and one on none would be a file the workspace holds and the app
 * hides. So this walks the whole shipped roster rather than sampling it.
 */

/** The shipped roster, as the two list DTOs would hand it over. */
function seededRoster(): TabbedFile[] {
  const skills: TabbedFile[] = DEFAULT_SKILLS.map((s) => ({
    kind: 'skill',
    name: runnableNameFromPath(s.file) ?? basename(slugFromPath(s.file)),
  }));
  const voices: TabbedFile[] = DEFAULT_VOICES.map((v) => {
    assert.ok(isVoicePath(v.file), `${v.file} is not filed as a voice`);
    return { kind: 'voice', name: basename(slugFromPath(v.file)) };
  });
  const agents: TabbedFile[] = DEFAULT_AGENTS.map((a) => ({
    kind: 'agent',
    name: runnableNameFromPath(a.file) ?? basename(slugFromPath(a.file)),
  }));
  return [...skills, ...voices, ...agents];
}

test('every seeded file lands on exactly one tab', () => {
  const roster = seededRoster();
  assert.ok(roster.length >= 10, `only ${roster.length} files in the roster`);
  const seen = new Map<string, SkillsTab[]>();
  for (const file of roster) {
    const tabs = SKILLS_TABS.filter((t) => tabForFile(file) === t.id).map((t) => t.id);
    assert.equal(tabs.length, 1, `${file.kind} ${file.name} is on ${tabs.length} tabs`);
    seen.set(`${file.kind}:${file.name}`, tabs);
  }
  // And every tab that holds files holds some. A rule that put the whole
  // workspace on one tab would pass the check above.
  const held = new Set([...seen.values()].map((t) => t[0]));
  for (const tab of ['skills', 'house-rules', 'moments', 'voices', 'agents'] as const) {
    assert.ok(held.has(tab), `nothing lands on the ${tab} tab`);
  }
});

test('the house rules file is the only thing on its tab', () => {
  const onTab = seededRoster().filter((f) => tabForFile(f) === 'house-rules');
  assert.deepEqual(
    onTab.map((f) => f.name),
    [HOUSE_RULES_NAME],
  );
});

test('the moments tab is the code roster, and nothing else', () => {
  const onTab = seededRoster()
    .filter((f) => tabForFile(f) === 'moments')
    .map((f) => f.name)
    .sort();
  assert.deepEqual(onTab, MOMENTS.map((m) => m.name).sort());
  // Named, not only derived from the roster. Every one of the three has a
  // dispatch site in the app: arrival from the ingest pipeline, process-note
  // from "Go through this note" on a note page, commitment-check from "Help me
  // handle this" on a todo. A skill whose trigger is gone must not sit here.
  assert.deepEqual(onTab, ['arrival', 'commitment-check', 'process-note']);
  // Each one says what fires it, in words, because the file cannot.
  for (const m of MOMENTS) {
    assert.ok(m.when.startsWith('When '), `${m.name} has no trigger sentence`);
    assert.equal(momentFor(m.name), m);
  }
});

/**
 * The composer's picker is the Skills tab and only it (SkillPicker), so a
 * moment must not be offered there. The product fires these; picking one from
 * the composer would start a session with nothing to work on.
 */
test('a moment is never on the Skills tab', () => {
  for (const m of MOMENTS) {
    assert.equal(tabForFile({ kind: 'skill', name: m.name }), 'moments', `${m.name} is offered`);
  }
  const offered = seededRoster().filter((f) => tabForFile(f) === 'skills');
  assert.ok(!offered.some((f) => f.name === 'process-note'), 'process-note is still asked for');
  assert.ok(offered.length >= 3, `only ${offered.length} skills are left to run`);
});

test('the folder decides a voice and an agent, not the name', () => {
  // A voice named like a moment is still a voice: `voices/` is a separate
  // address space, so nothing there can shadow a skill.
  assert.equal(tabForFile({ kind: 'voice', name: 'arrival' }), 'voices');
  assert.equal(tabForFile({ kind: 'voice', name: HOUSE_RULES_NAME }), 'voices');
  assert.equal(tabForFile({ kind: 'agent', name: 'arrival' }), 'agents');
});

test('a file nobody planned for is a skill', () => {
  assert.equal(tabForFile({ kind: 'skill', name: 'chase-renewals' }), 'skills');
  assert.equal(tabForFile({ kind: 'skill', name: '' }), 'skills');
});
