import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEDULED_PREAMBLE,
  UNATTENDED_PREAMBLE,
  UNATTENDED_RULES,
  unattendedNote,
} from '../src/prompts.js';

/**
 * SK-4: the rules for a run nobody is watching are code now. They shipped as
 * `skills/_unattended/SKILL.md` while any file could declare itself always-on,
 * which put agent plumbing on the Skills page and charged every session for it.
 * The file is gone, so this is the only thing left holding the rules in place.
 */

test('an unattended run is told the budget, the never-invent rule and the rest', () => {
  const prompt = unattendedNote(false, true);
  assert.ok(prompt.includes(UNATTENDED_PREAMBLE), 'the quiet preamble is missing');
  assert.match(prompt, /## Rules for a run nobody is watching/);
  assert.match(prompt, /### The question budget/);
  assert.match(prompt, /Two `ask_user` calls in a run, and no more/);
  assert.match(prompt, /### Invent nothing/);
  assert.match(prompt, /Never write a name, a date, a number, a quote, a ticket key or a link/);
  assert.match(prompt, /### An empty result usually says nothing at all/);
  assert.match(prompt, /call `end_quietly` rather than file a "nothing to report" note/);
  // The label an over-budget run has to leave behind, verbatim.
  assert.match(prompt, /"Assumed:"/);
});

/**
 * The general half of these rules moved into the house rules, which every
 * session already carries (see house-rules.test.ts). What is left here is only
 * what changes because nobody is watching: the question budget, invent nothing,
 * and `end_quietly` instead of a "nothing to report" note. Restating the general
 * rule here is what let the two drift.
 */
test('what the house rules already say is not said again here', () => {
  assert.doesNotMatch(UNATTENDED_RULES, /### Follow the output template/);
  assert.doesNotMatch(UNATTENDED_RULES, /Never reorder, rename, merge or drop one/);
  assert.doesNotMatch(UNATTENDED_RULES, /### An empty result is a result$/m);
});

test('a scheduled run gets the same rules on top of the stricter preamble', () => {
  const prompt = unattendedNote(true, false);
  assert.ok(prompt.includes(SCHEDULED_PREAMBLE), 'the scheduled preamble is missing');
  assert.ok(prompt.includes(UNATTENDED_RULES), 'the librarian tick would lose its rules');
  // Scheduled wins over unattended: it is the one that also takes `ask_user`
  // away, and the two must never both land in one prompt.
  assert.ok(!prompt.includes(UNATTENDED_PREAMBLE));
  assert.equal(unattendedNote(true, true), prompt);
});

test('a run somebody is sitting in front of gets none of it', () => {
  assert.equal(unattendedNote(false, false), '');
});

test('the rules say nothing about being a skill you could open', () => {
  // The old file described itself as a workspace document. It is a run contract,
  // and a sentence pointing at a file nobody can open is worse than no sentence.
  assert.doesNotMatch(UNATTENDED_RULES, /_unattended/);
  assert.doesNotMatch(UNATTENDED_RULES, /type: skill/);
});
