import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBodyChange, applyPatch } from '../src/index.js';

// The core of the "changed underneath the card" false positive: an exact-only
// applyPatch returned null whenever the LLM's anchor drifted in insignificant
// whitespace, and previewProposal reported that null as staleness. These lock in
// the whitespace-tolerant fallback so anchors match when the note is unchanged.

test('exact match still applies', () => {
  assert.equal(applyPatch('one two three', [{ search: 'two', replace: 'TWO' }]), 'one TWO three');
});

test('tolerates doubled internal spacing on the anchor line', () => {
  const body = 'Heading\n\n    indented   line\n\nTail';
  // Body has three spaces between the words; the anchor has one. Exact indexOf
  // misses, the fuzzy `\s+` matcher lands it, and surrounding structure is kept.
  const out = applyPatch(body, [{ search: 'indented line', replace: 'edited line' }]);
  assert.equal(out, 'Heading\n\n    edited line\n\nTail');
});

test('collapses internal whitespace runs between words', () => {
  const body = 'due  today   and not done';
  const out = applyPatch(body, [{ search: 'due today and not done', replace: 'done' }]);
  assert.equal(out, 'done');
});

test('escapes regex metacharacters in the anchor', () => {
  const body = 'price is $5.00 (final)';
  const out = applyPatch(body, [{ search: '$5.00 (final)', replace: '$6.00 (final)' }]);
  assert.equal(out, 'price is $6.00 (final)');
});

test('returns null when the anchor is genuinely absent', () => {
  assert.equal(applyPatch('nothing here', [{ search: 'missing anchor', replace: 'x' }]), null);
});

test('does not lose structural whitespace when the anchor has a trailing space', () => {
  const body = 'alpha\n- ship the thing\nomega';
  // Anchor ends with a space that the file lacks; the newline after "thing" must
  // survive (a naive trailing `\s*` would eat it).
  const out = applyPatch(body, [{ search: '- ship the thing ', replace: '- shipped the thing' }]);
  assert.equal(out, 'alpha\n- shipped the thing\nomega');
});

test('refuses an ambiguous fuzzy anchor rather than guessing a location', () => {
  // Exact indexOf misses (doubled spaces), and the fuzzy matcher sees the anchor
  // twice — it must bail to null instead of editing a guessed occurrence.
  const body = 'the  cat\nthe  cat';
  assert.equal(applyPatch(body, [{ search: 'the cat', replace: 'X' }]), null);
});

// `append` is the lever for a note with nothing to anchor in. Every meeting page
// the calendar mirrors is frontmatter and no body, and that is exactly where a
// write-up goes — search/replace could never land there, so the whole documented
// path (attach the transcript, write onto the page that exists) used to dead-end
// in a card the Inbox could only report as unanchored.

test('appending onto an empty body writes just the appended text', () => {
  assert.equal(
    applyBodyChange('', { append: '## Summary\n\nWhat was decided.' }),
    '## Summary\n\nWhat was decided.',
  );
  // A calendar mirror's body is whitespace, not the empty string.
  assert.equal(applyBodyChange('\n\n', { append: '## Summary' }), '## Summary');
});

test('appending onto a written body keeps it and adds a blank line between', () => {
  assert.equal(
    applyBodyChange('## Notes\n\nalready here\n', { append: '## Prep\n\nnew' }),
    '## Notes\n\nalready here\n\n## Prep\n\nnew',
  );
});

test('a patch and an append in one card apply in that order', () => {
  const out = applyBodyChange('alpha\nomega', {
    patch: [{ search: 'alpha', replace: 'ALPHA' }],
    append: 'tail',
  });
  assert.equal(out, 'ALPHA\nomega\n\ntail');
});

test('a missed anchor still refuses, and the append never lands on its own', () => {
  assert.equal(
    applyBodyChange('nothing here', {
      patch: [{ search: 'absent', replace: 'x' }],
      append: 'tail',
    }),
    null,
  );
});

test('no body levers at all (a frontmatter-only card) leaves the body untouched', () => {
  assert.equal(applyBodyChange('as written', {}), 'as written');
  assert.equal(applyBodyChange('as written', { append: '   ' }), 'as written');
});
