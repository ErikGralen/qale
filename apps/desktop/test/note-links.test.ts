import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  linkifyNotePaths,
  noteLinkTitle,
  outsideCode,
} from '../src/renderer/src/lib/note-links.js';

/**
 * What a link prints when the author wrote no alias. A question line, an option
 * label and a note body all run through this, so a storage path reaching the
 * reader on one of them and a name on another is the bug it fixes.
 */

test('the name comes off the note tree, exactly as the sidebar shows it', () => {
  const tree = new Map([['research/no-show-fees', 'No-show fees']]);
  assert.equal(noteLinkTitle('research/no-show-fees', tree), 'No-show fees');
  // The `.md` on a linkified bare path is not part of the slug.
  assert.equal(noteLinkTitle('research/no-show-fees.md', tree), 'No-show fees');
});

test('a calendar mirror with no title in its frontmatter still reads as a name', () => {
  const target = 'meetings/2026-06-02-brasserie-lund-review';
  // A row that carries nothing, a row that carries the slug, and no row at all
  // are the three ways the lookup misses. None of them may print a path.
  for (const tree of [
    new Map<string, string>(),
    new Map([[target, '']]),
    new Map([[target, '  ']]),
    new Map([[target, target]]),
  ]) {
    assert.equal(noteLinkTitle(target, tree), 'Brasserie Lund Review');
  }
});

test('a note the tree does not hold yet takes its name from the slug', () => {
  assert.equal(noteLinkTitle('decisions/2026-07-01-drop-sso', new Map()), 'Drop SSO');
});

test('a bare vault path in a sentence becomes a wikilink', () => {
  assert.equal(
    linkifyNotePaths('One idea sits in meetings/2026-06-02-brasserie-lund-review today.'),
    'One idea sits in [[meetings/2026-06-02-brasserie-lund-review]] today.',
  );
  // Already a wikilink, or already a markdown link target: left alone.
  assert.equal(linkifyNotePaths('[[notes/fee-rules]]'), '[[notes/fee-rules]]');
  assert.equal(linkifyNotePaths('[the rules](notes/fee-rules)'), '[the rules](notes/fee-rules)');
});

test('a fenced block is data, so paths inside it stay as written', () => {
  const body = 'See notes/fee-rules.\n```\npath: notes/fee-rules\n```\n';
  assert.equal(
    outsideCode(body, linkifyNotePaths),
    'See [[notes/fee-rules]].\n```\npath: notes/fee-rules\n```\n',
  );
});
