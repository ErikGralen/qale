import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXTERNAL_CHANGE_KEPT,
  mergeBody,
  resolveExternalChange,
} from '../src/renderer/src/lib/merge-body.js';

/**
 * The dirty-editor race, as text.
 *
 * The editor itself needs a DOM and a ProseMirror view, and the harness has
 * neither, so `NoteEditor` is left to the type checker and the decision it makes
 * is checked here. Everything the component adds around these two functions is
 * mechanical: read the editor's markdown, hand the three texts over, put the
 * answer back in the doc.
 */

const PAGE = [
  '# Nordkap check-in',
  '',
  '## Prep',
  '',
  'Ask about the SSO dates.',
  '',
  '## Notes',
  '',
  'Åsa is on the pilot.',
].join('\n');

// ---------------------------------------------------------------------------
// The three cases the race can end in
// ---------------------------------------------------------------------------

test('an external change with nothing unsaved replaces the body, as it always did', () => {
  const theirs = PAGE.replace('## Notes', '## Summary\n\nThe dates go out on Friday.\n\n## Notes');
  const outcome = resolveExternalChange({ base: PAGE, mine: null, theirs });
  assert.deepEqual(outcome, { kind: 'replace', body: theirs });
});

test('an edit in another paragraph survives, and so does the write', () => {
  // The PM types under `## Notes` while the agent adds a summary above it.
  const mine = PAGE.replace('Åsa is on the pilot.', 'Åsa is on the pilot. She wants the dates.');
  const theirs = PAGE.replace('## Notes', '## Summary\n\nThe dates go out on Friday.\n\n## Notes');
  const outcome = resolveExternalChange({ base: PAGE, mine, theirs });
  assert.equal(outcome.kind, 'merged');
  assert.ok(outcome.kind === 'merged');
  assert.match(outcome.body, /She wants the dates\./);
  assert.match(outcome.body, /The dates go out on Friday\./);
  // And in the right order: the summary stays above the notes.
  assert.ok(outcome.body.indexOf('## Summary') < outcome.body.indexOf('## Notes'));
});

test('two edits to the same line keep the PM and say so', () => {
  const mine = PAGE.replace('Åsa is on the pilot.', 'Åsa owns the pilot.');
  const theirs = PAGE.replace('Åsa is on the pilot.', 'Åsa is on the pilot, from week 38.');
  const outcome = resolveExternalChange({ base: PAGE, mine, theirs });
  assert.deepEqual(outcome, { kind: 'kept' });
});

test('the toast names the side that won and where the other one went', () => {
  assert.match(EXTERNAL_CHANGE_KEPT, /Your text is kept\./);
  assert.match(EXTERNAL_CHANGE_KEPT, /Version history/);
});

// ---------------------------------------------------------------------------
// The merge itself
// ---------------------------------------------------------------------------

test('a side that changed nothing hands the whole body to the other', () => {
  const theirs = `${PAGE}\n\nOne more line.`;
  assert.equal(mergeBody(PAGE, PAGE, theirs), theirs);
  assert.equal(mergeBody(PAGE, theirs, PAGE), theirs);
});

test('two appends to the same end of the file are a refusal, not a guess', () => {
  assert.equal(mergeBody(PAGE, `${PAGE}\nmine`, `${PAGE}\ntheirs`), null);
});

test('an append below and an edit above both land', () => {
  const mine = PAGE.replace('Ask about the SSO dates.', 'Ask about the SSO dates and the price.');
  const theirs = `${PAGE}\n\n## Summary\n\nDates on Friday.`;
  const merged = mergeBody(PAGE, mine, theirs);
  assert.ok(merged);
  assert.match(merged, /and the price\./);
  assert.match(merged, /Dates on Friday\./);
});

test('a line the PM deleted stays deleted when the write is elsewhere', () => {
  const mine = PAGE.replace('\nAsk about the SSO dates.', '');
  const theirs = PAGE.replace('Åsa is on the pilot.', 'Åsa is on the pilot. Confirmed.');
  const merged = mergeBody(PAGE, mine, theirs);
  assert.ok(merged);
  assert.ok(!merged.includes('Ask about the SSO dates.'));
  assert.match(merged, /Confirmed\./);
});

test('changes on neighbouring lines are not a conflict', () => {
  const mine = PAGE.replace('## Prep', '## Prep, before Thursday');
  const theirs = PAGE.replace('Ask about the SSO dates.', 'Ask about the SSO dates and Entra.');
  const merged = mergeBody(PAGE, mine, theirs);
  assert.ok(merged);
  assert.match(merged, /## Prep, before Thursday/);
  assert.match(merged, /dates and Entra\./);
});

test('an edit on the last line and a block added under it both land', () => {
  const mine = PAGE.replace('Åsa is on the pilot.', 'Åsa owns the pilot.');
  const theirs = `${PAGE}\n\n## Summary\n\nDates on Friday.`;
  const merged = mergeBody(PAGE, mine, theirs);
  assert.equal(
    merged,
    `${PAGE.replace('Åsa is on the pilot.', 'Åsa owns the pilot.')}\n\n## Summary\n\nDates on Friday.`,
  );
});

test('both sides making the same change is not a conflict', () => {
  const both = PAGE.replace('Åsa is on the pilot.', 'Åsa owns the pilot.');
  assert.equal(mergeBody(PAGE, both, both), both);
});

test('a trailing newline is not an edit', () => {
  // The vault normalizes the tail. Either tail is the same text, so the merge
  // takes one of them and never reports a conflict.
  assert.equal(mergeBody(PAGE, PAGE, `${PAGE}\n`), `${PAGE}\n`);
  assert.equal(mergeBody(PAGE, `${PAGE}\n`, PAGE), PAGE);
  const mine = `${PAGE}\n`.replace('Åsa is on the pilot.', 'Åsa owns the pilot.');
  const theirs = `${PAGE}\n\n## Summary\n\nDates on Friday.`;
  const merged = mergeBody(PAGE, mine, theirs);
  assert.ok(merged);
  assert.match(merged, /Åsa owns the pilot\./);
  assert.match(merged, /Dates on Friday\./);
});

test('two texts too big to compare refuse rather than hold the editor', () => {
  const base = Array.from({ length: 600 }, (_, i) => `line ${i}`).join('\n');
  const mine = base.replace('line 5', 'line five');
  const theirs = base.replace('line 500', 'line five hundred');
  assert.equal(mergeBody(base, mine, theirs), null);
});
