import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNote, serializeNote, spliceBody, extractLinks } from '../src/index.js';

test('parse → serialize round-trip keeps frontmatter fields and body', () => {
  const raw = '---\ntype: decision\nsummary: pick X\nsources:\n  - "[[meetings/kickoff]]"\n---\n\nWe picked X.\n';
  const parsed = parseNote(raw);
  assert.equal(parsed.frontmatter['type'], 'decision');
  const out = serializeNote(parsed.frontmatter, parsed.body);
  const reparsed = parseNote(out);
  assert.deepEqual(reparsed.frontmatter, parsed.frontmatter);
  assert.equal(reparsed.body.trim(), 'We picked X.');
});

test('parseNote handles BOM, CRLF, and malformed YAML without dropping the body', () => {
  const bom = parseNote('﻿---\ntype: note\nsummary: s\n---\nBody.\n');
  assert.equal(bom.frontmatter['type'], 'note');

  const crlf = parseNote('---\r\ntype: note\r\nsummary: s\r\n---\r\nBody.\r\n');
  assert.equal(crlf.frontmatter['summary'], 's');

  const bad = parseNote('---\n{not yaml\n---\nBody survives.\n');
  assert.deepEqual(bad.frontmatter, {});
  assert.ok(bad.body.includes('Body survives.'));
});

test('spliceBody preserves the raw frontmatter block byte-for-byte', () => {
  // deliberately odd but valid YAML formatting that a re-serialize would normalize
  const raw = '---\ntype: insight\nstatus: wip\nweird:   "  spacing  "\n---\n\nOld.\n';
  const out = spliceBody(raw, 'New body.');
  assert.ok(out.startsWith('---\ntype: insight\nstatus: wip\nweird:   "  spacing  "\n---\n'));
  assert.ok(out.endsWith('New body.\n'));
  assert.ok(!out.includes('Old.'));
});

test('spliceBody on a frontmatter-less file writes just the body', () => {
  assert.equal(spliceBody('plain text\n', 'New.'), 'New.\n');
});

test('extractLinks finds wikilinks with alias and anchor', () => {
  const links = extractLinks('See [[decisions/pick-x|the call]] and [[notes/y#section]].\n');
  assert.equal(links.length, 2);
});

test('extractLinks carries the canonical type of [[type::target]] links', () => {
  const links = extractLinks('Held by [[blocked-by::PAY-155]], see [[evidence::sources/call|the call]] and [[notes/y]].\n');
  assert.equal(links.length, 3);
  assert.deepEqual(
    links.map((l) => ({ target: l.target, linkType: l.linkType, reversed: l.reversed })),
    [
      { target: 'PAY-155', linkType: 'blocks', reversed: true },
      { target: 'sources/call', linkType: 'evidence', reversed: undefined },
      { target: 'notes/y', linkType: undefined, reversed: undefined },
    ],
  );
});
