import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSource, wordCount } from '../src/renderer/src/lib/source-body.js';

/**
 * A source keeps one address (E-18): the summary on top, the original
 * underneath. The page shows the first and folds the second, and this is the
 * split it folds on.
 *
 * The questions worth asking are all about the pages that have no summary. A
 * source filed before this existed, and one filed without being read, must read
 * exactly as they always have: no fold, no empty section, nothing hidden.
 */

const READ = `## Summary

They will not renew without SSO.

## Original

Erik: thanks for joining.
Jonas: we need SSO before June.
`;

test('a source that was read shows its summary and folds the original', () => {
  const parts = splitSource(READ);
  assert.ok(parts, 'the heading is the seam, so this body splits');
  assert.equal(parts.summary, '## Summary\n\nThey will not renew without SSO.');
  assert.match(parts.original, /^Erik: thanks for joining\./);
  assert.equal(parts.original.includes('## Original'), false, 'the seam itself is not shown twice');
  assert.equal(parts.words, 10);
});

test('a source with no summary is left exactly as it is', () => {
  assert.equal(splitSource('Erik: thanks for joining.\nJonas: we need SSO.\n'), null);
});

test('a heading with nothing above or below it is not a split', () => {
  assert.equal(splitSource('## Original\n\nthe whole thing\n'), null);
  assert.equal(splitSource('## Summary\n\nthey want SSO\n\n## Original\n'), null);
});

test('a heading inside the original does not split the page', () => {
  // `## Original` mid-line is prose, not the seam: the regex anchors to a line
  // of its own, so a transcript that quotes the words keeps its summary.
  const body = 'They quoted the ## Original spec at us.\n';
  assert.equal(splitSource(body), null);
});

test('the word count is what the fold offers to show', () => {
  assert.equal(wordCount(''), 0);
  assert.equal(wordCount('  '), 0);
  assert.equal(wordCount('one two\nthree\t four '), 4);
});
