import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch } from '../src/index.js';

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
