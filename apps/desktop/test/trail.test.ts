import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliedReceipt, appliedRowLine } from '@qale/domain';
import {
  failedSteps,
  showsInTrail,
  stepLabel,
  stripLinks,
  trailSteps,
  trailSummary,
} from '../src/renderer/src/lib/trail.js';
import type { AnyPart } from '../src/renderer/src/lib/turn-parts.js';

/**
 * What the folded trail keeps and what it says (docs/chat-order.md).
 *
 * The rule these tests hold to: a step with a surface of its own is not in the
 * trail, a step that failed always is, and the collapsed row is a sentence
 * about what happened rather than a noun with counts after it.
 */

const think = (text = 'Two notes to check first.'): AnyPart => ({ type: 'reasoning', text });

const read = (path: string): AnyPart => ({
  type: 'tool-vault_read',
  state: 'output-available',
  input: { path },
  output: '# Nordkap',
});

const search = (query: string): AnyPart => ({
  type: 'tool-search_vault',
  state: 'output-available',
  input: { query },
  output: '3 hits',
});

const landed = (path: string, title: string): AnyPart => ({
  type: 'tool-propose_update',
  state: 'output-available',
  input: { path },
  output: `${appliedReceipt('updated', title)}.\nSay what you did in one short line.\n${appliedRowLine(
    { verb: 'Changed', path, title, activityId: 'a1' },
  )}`,
});

const failedStep = (type: string, errorText: string): AnyPart => ({
  type,
  state: 'output-error',
  input: { path: 'notes/nordkap.md' },
  errorText,
});

test('a write that landed leaves the trail, and its failed twin stays', () => {
  const parts = [think(), landed('notes/brasserie-lund.md', 'Brasserie Lund'), read('notes/x.md')];
  assert.deepEqual(
    trailSteps(parts).map((p) => p.type),
    ['reasoning', 'tool-vault_read'],
  );
  const gaveUp = failedStep('tool-propose_update', 'the text it points at is gone');
  assert.equal(showsInTrail(gaveUp), true);
  assert.equal(failedSteps([gaveUp, read('notes/x.md')]), 1);
});

test('a proposal and a draft draw elsewhere, so neither is in the trail', () => {
  const card: AnyPart = {
    type: 'tool-propose_note',
    state: 'output-available',
    input: { title: 'Send Lena the October plan' },
    output: 'Proposed.',
  };
  const draft: AnyPart = {
    type: 'tool-draft_ticket',
    state: 'output-available',
    input: { title: 'Fix the booking sync' },
    output: 'Drafted.',
  };
  assert.equal(showsInTrail(card), false);
  assert.equal(showsInTrail(draft), false);
});

test('reads, searches and the odd step in between all stay', () => {
  const voice: AnyPart = {
    type: 'tool-get_voice',
    state: 'output-available',
    input: { name: 'internal' },
    output: 'Short sentences.',
  };
  assert.equal(showsInTrail(read('notes/x.md')), true);
  assert.equal(showsInTrail(search('booking')), true);
  assert.equal(showsInTrail(voice), true);
  // An empty thought has nothing to show, so it is not a step.
  assert.equal(showsInTrail(think('')), false);
});

test('one or two notes are named, three are counted', () => {
  assert.equal(
    trailSummary([read('meetings/2026-07-17-the-transcript.md')], null),
    'Read The Transcript',
  );
  assert.equal(
    trailSummary([read('notes/nordkap.md'), read('notes/bord-weekly.md')], null),
    'Read Nordkap and Bord Weekly',
  );
  assert.equal(
    trailSummary([read('notes/a.md'), read('notes/b.md'), read('notes/c.md')], null),
    'Read 3 notes',
  );
  // The same note twice is one note.
  assert.equal(trailSummary([read('notes/a.md'), read('notes/a.md')], null), 'Read A');
});

test('the summary is a sentence, and the clock is the last thing in it', () => {
  const parts = [
    think(),
    read('notes/a.md'),
    read('notes/b.md'),
    read('notes/c.md'),
    search('booking'),
    search('sync'),
  ];
  assert.equal(trailSummary(parts, '12s'), 'Read 3 notes · searched twice · 12s');
  assert.equal(trailSummary(parts, null), 'Read 3 notes · searched twice');
});

test('a search of Jira says which system it checked', () => {
  const jira: AnyPart = {
    type: 'tool-jira_search',
    state: 'output-available',
    input: { jql: 'project = PAY' },
    output: '2 issues',
  };
  assert.equal(trailSummary([jira], null), 'Checked Jira');
  const ticket: AnyPart = {
    type: 'tool-jira_get_issue',
    state: 'output-available',
    input: { key: 'PAY-12' },
    output: 'PAY-12',
  };
  assert.equal(trailSummary([ticket], null), 'Read PAY-12');
});

test('nothing but thinking reads as thinking', () => {
  assert.equal(trailSummary([think()], '8s'), 'Thought for 8s');
  assert.equal(trailSummary([think()], null), 'Thought');
});

test('a trail of failures still says how long it took', () => {
  const parts = [failedStep('tool-vault_read', 'no such note')];
  assert.equal(trailSummary(parts, '3s'), 'Worked for 3s');
  assert.equal(failedSteps(parts), 1);
});

test('a trail whose every step has a row of its own has no steps left', () => {
  assert.deepEqual(trailSteps([landed('notes/brasserie-lund.md', 'Brasserie Lund')]), []);
});

test('a wikilink in a label reads as the page title', () => {
  assert.equal(
    stripLinks('Send Brasserie Lund the paperwork (waiting on [[people/marcus-holm]])'),
    'Send Brasserie Lund the paperwork (waiting on Marcus Holm)',
  );
  assert.equal(stripLinks('[[notes/nordkap-check-in|the check-in]]'), 'the check-in');
  assert.equal(stripLinks('[[tickets/jira/PAY-12]]'), 'PAY-12');
  assert.equal(stripLinks('nothing to strip'), 'nothing to strip');
});

test('a read step hands over the note it read, to open', () => {
  assert.deepEqual(stepLabel(read('notes/nordkap-check-in.md')), {
    verb: 'Read',
    detail: 'Nordkap Check In',
    path: 'notes/nordkap-check-in.md',
  });
  const gaveUp = failedStep('tool-vault_read', 'no such note');
  assert.equal(stepLabel(gaveUp).verb, 'Tried reading');
});
