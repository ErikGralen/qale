import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WRITE_DISPOSITIONS, describeWritePolicy } from '@qale/domain';
import { DISPOSITION_WORDS, writePolicyBlocks } from '../src/renderer/src/lib/write-policy-copy.js';

/**
 * The Settings section that says what Qale does on its own
 * (docs/background-system.md ticket 6, docs/fewer-approvals.md FA-1). The
 * screen groups the policy's rows and gives each answer a word. These tests
 * hold it to both: the grouping loses no row and reorders none, and one answer
 * never gets two words.
 */

test('both lists are shown, with the policy titles', () => {
  const blocks = writePolicyBlocks();
  assert.deepEqual(
    blocks.map((b) => b.place),
    ['lands', 'waits'],
  );
  assert.deepEqual(
    blocks.map((b) => b.title),
    describeWritePolicy().map((p) => p.title),
  );
});

test('every row the policy describes is on the screen, once', () => {
  const places = describeWritePolicy();
  writePolicyBlocks().forEach((block, i) => {
    const shown = block.groups.flatMap((g) => g.rows.map((r) => r.what));
    const expected = places[i]!.rows.map((r) => r.what);
    assert.equal(shown.length, expected.length, block.place);
    assert.deepEqual([...shown].sort(), [...expected].sort(), block.place);
  });
});

test('a group keeps the policy order, and carries the policy reason', () => {
  const places = describeWritePolicy();
  writePolicyBlocks().forEach((block, i) => {
    const rows = places[i]!.rows;
    for (const group of block.groups) {
      const expected = rows.filter((r) => r.disposition === group.disposition);
      assert.deepEqual(group.rows, expected, `${block.place} ${group.disposition}`);
    }
  });
});

test('the groups run silent, then ask, and an empty one is left out', () => {
  for (const block of writePolicyBlocks()) {
    const order = block.groups.map((g) => g.disposition);
    assert.deepEqual(
      order,
      WRITE_DISPOSITIONS.filter((d) => order.includes(d)),
      block.place,
    );
    for (const group of block.groups) assert.ok(group.rows.length > 0, group.disposition);
  }
  // One answer per block now, so each one has a single group.
  assert.deepEqual(
    writePolicyBlocks().map((b) => b.groups.map((g) => g.disposition)),
    [['silent'], ['ask']],
  );
});

test('one answer, one word, and no word says two things', () => {
  const words = WRITE_DISPOSITIONS.map((d) => DISPOSITION_WORDS[d]);
  assert.equal(new Set(words).size, WRITE_DISPOSITIONS.length);
  for (const block of writePolicyBlocks()) {
    for (const group of block.groups) {
      assert.equal(group.word, DISPOSITION_WORDS[group.disposition]);
    }
  }
  assert.deepEqual(words, ['Lands, listed in Activity', 'Asks every time']);
});
