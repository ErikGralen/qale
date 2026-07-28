import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  backlinkTypeLabel,
  linkTypeLabel,
  linkTypeOptions,
  linkTypeToken,
  normalizeLinkTarget,
  normalizeLinkType,
} from '../src/index.js';

test('normalizeLinkType canonicalizes inverse spellings and synonyms', () => {
  assert.deepEqual(normalizeLinkType('blocks'), { type: 'blocks', reversed: false });
  assert.deepEqual(normalizeLinkType('blocked-by'), { type: 'blocks', reversed: true });
  assert.deepEqual(normalizeLinkType('Blocked By'), { type: 'blocks', reversed: true });
  assert.deepEqual(normalizeLinkType('superseded_by'), { type: 'supersedes', reversed: true });
  assert.deepEqual(normalizeLinkType('contains'), { type: 'part-of', reversed: true });
  assert.deepEqual(normalizeLinkType('relates to'), { type: 'relates', reversed: false });
  // Free text kebabs; empty/garbage is null (caller degrades to untyped).
  assert.deepEqual(normalizeLinkType('waiting on'), { type: 'waiting-on', reversed: false });
  assert.equal(normalizeLinkType(''), null);
  assert.equal(normalizeLinkType('::'), null);
});

test('labels read correctly from both ends of the edge', () => {
  assert.equal(linkTypeLabel('blocks'), 'blocks');
  assert.equal(linkTypeLabel('blocks', true), 'blocked by');
  assert.equal(backlinkTypeLabel('blocks'), 'blocked by');
  assert.equal(backlinkTypeLabel('blocks', true), 'blocks');
  assert.equal(backlinkTypeLabel('evidence'), 'evidence for');
  assert.equal(linkTypeLabel('waiting-on'), 'waiting on');
});

test('linkTypeToken round-trips the author direction', () => {
  assert.equal(linkTypeToken('blocks'), 'blocks');
  assert.equal(linkTypeToken('blocks', true), 'blocked-by');
  assert.equal(linkTypeToken('waiting-on', true), 'waiting-on');
});

test('normalizeLinkTarget parses type::target#anchor|alias, degrading safely', () => {
  assert.deepEqual(normalizeLinkTarget('blocks::PAY-142'), {
    target: 'PAY-142',
    anchor: undefined,
    alias: undefined,
    linkType: 'blocks',
    reversed: undefined,
  });
  assert.deepEqual(normalizeLinkTarget('evidence::sources/call#pricing|the call'), {
    target: 'sources/call',
    anchor: 'pricing',
    alias: 'the call',
    linkType: 'evidence',
    reversed: undefined,
  });
  assert.equal(normalizeLinkTarget('blocked-by::PAY-1').reversed, true);
  // Empty type or empty target: the whole text stays an untyped target.
  assert.equal(normalizeLinkTarget('::PAY-1').linkType, undefined);
  assert.equal(normalizeLinkTarget('blocks::').target, 'blocks::');
});

test('linkTypeOptions offers only relationships that fit the target', () => {
  const labels = (t: Parameters<typeof linkTypeOptions>[0]) =>
    linkTypeOptions(t).map((o) => o.label);

  // A person is not a document: nothing supersedes them, nothing blocks them.
  const person = labels('person');
  assert.ok(!person.includes('supersedes'));
  assert.ok(!person.includes('blocked by'));
  assert.ok(!person.includes('part of'));
  // What's left still says something useful, and is never empty.
  assert.deepEqual(person, ['source', 'source for', 'about', 'relates to']);

  // A ticket is where the blocking vocabulary belongs — both directions.
  const ticket = labels('ticket');
  assert.ok(ticket.includes('blocks'));
  assert.ok(ticket.includes('blocked by'));
  assert.ok(!ticket.includes('supersedes'));

  // Unknown target (a note that doesn't exist yet) offers everything.
  assert.ok(labels(null).includes('supersedes'));
});

test('linkTypeOptions writes the token for the direction it offers', () => {
  const blockedBy = linkTypeOptions('ticket').find((o) => o.label === 'blocked by');
  assert.deepEqual(blockedBy, { type: 'blocks', reversed: true, token: 'blocked-by', label: 'blocked by' });
  // Symmetric / backlink-only inverses are never offered as an authoring choice.
  assert.ok(!linkTypeOptions(null).some((o) => o.label === 'related to' || o.label === 'mentioned in'));
});
