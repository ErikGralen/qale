import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenizeWikilink,
  wikilinkAttrs,
  renderWikilink,
} from '../src/renderer/src/components/editor/wikilink.js';

/** tokenize → attrs → render must reproduce the source exactly. */
function roundTrip(src: string): string {
  const token = tokenizeWikilink(src);
  assert.ok(token, `expected a wikilink token at start of: ${src}`);
  return renderWikilink(wikilinkAttrs(token.raw, token.text));
}

test('wikilink round-trip is byte-exact', () => {
  for (const src of [
    '[[decisions/2026-07-01-drop-sso]]',
    '[[nordkap|Nordkap AB]]',
    '[[releases/tavla-1.2#Scope|the 1.2 scope]]',
    '[[weird  spacing | alias with spaces ]]',
  ]) {
    assert.equal(roundTrip(src), src);
  }
});

test('tokenize matches only at the start and stops at the first ]]', () => {
  assert.equal(tokenizeWikilink('text [[a]]'), undefined);
  assert.equal(tokenizeWikilink('[[a]] and [[b]]')?.raw, '[[a]]');
  assert.equal(tokenizeWikilink('[[unclosed'), undefined);
  assert.equal(tokenizeWikilink('[not-a-wikilink](x.md)'), undefined);
  assert.equal(tokenizeWikilink('[[]]'), undefined);
});

test('attrs normalize like the indexer (alias, anchor, .md stripping)', () => {
  assert.deepEqual(wikilinkAttrs('[[a/b.md#H|Alias]]', 'a/b.md#H|Alias'), {
    raw: '[[a/b.md#H|Alias]]',
    target: 'a/b',
    anchor: 'H',
    alias: 'Alias',
  });
  assert.deepEqual(wikilinkAttrs('[[a/b]]', 'a/b'), {
    raw: '[[a/b]]',
    target: 'a/b',
    anchor: null,
    alias: null,
  });
});

test('renderWikilink reconstructs from parts when raw is missing', () => {
  assert.equal(renderWikilink({ raw: '', target: 'a/b', anchor: 'H', alias: 'X' }), '[[a/b#H|X]]');
  assert.equal(renderWikilink({ raw: '', target: 'a/b', anchor: null, alias: null }), '[[a/b]]');
});
