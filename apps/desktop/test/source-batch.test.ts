import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ArrivalProgressDTO } from '@qale/ipc';
import { sourceModelId } from '@qale/domain';
import {
  isPile,
  pileWarning,
  progressLine,
  receiptLine,
  submitLabel,
} from '../src/renderer/src/lib/source-batch.js';

/**
 * The backfill receipt (docs/critical-mass.md CM-2): what a dropped pile says
 * before, during and after. Every line is built from counts main gathered from
 * filings that happened, so these tests are about which numbers reach the page
 * and which are left to the session's own reply.
 */

function batch(over: Partial<ArrivalProgressDTO> = {}): ArrivalProgressDTO {
  return { sessionId: 's1', total: 24, filed: 0, matched: 0, done: false, ...over };
}

test('the button names the number once a drop is a pile', () => {
  assert.equal(submitLabel(0), 'Add source');
  assert.equal(submitLabel(1), 'Add source');
  assert.equal(submitLabel(3), 'Add 3 files');
  assert.equal(submitLabel(4), 'Read 4 files');
  assert.equal(submitLabel(24), 'Read 24 files');
});

test('only a pile warns about the wait', () => {
  assert.equal(pileWarning(3), null);
  assert.equal(pileWarning(4), 'This takes a few minutes and runs in the background.');
});

test('the running line counts what has landed, and nothing before it lands', () => {
  assert.equal(progressLine(batch()), 'Reading 24 files.');
  assert.equal(progressLine(batch({ filed: 9 })), 'Reading 24 files. 9 filed.');
  assert.equal(
    progressLine(batch({ filed: 9, matched: 3 })),
    'Reading 24 files. 9 filed, 3 matched to meetings.',
  );
});

test('the closing sentence splits filed into meetings and notes', () => {
  assert.equal(
    receiptLine(batch({ total: 20, filed: 20, matched: 14, done: true })),
    '20 files read. 14 matched to meetings on your calendar, 6 filed as notes.',
  );
});

test('what was read but not filed is counted, never named a duplicate', () => {
  const line = receiptLine(batch({ total: 24, filed: 20, matched: 14, done: true }));
  assert.match(line, /4 not filed\.$/);
  assert.doesNotMatch(line, /already there/);
});

test('a batch nothing was filed from still says what was read', () => {
  assert.equal(
    receiptLine(batch({ total: 5, filed: 0, done: true })),
    '5 files read. 5 not filed.',
  );
});

test('singulars read like a person wrote them', () => {
  assert.equal(
    receiptLine(batch({ total: 4, filed: 2, matched: 1, done: true })),
    '4 files read. 1 matched to a meeting on your calendar, 1 filed as a note, 2 not filed.',
  );
});

test('a small drop is never counted out loud', () => {
  assert.equal(isPile(undefined), false);
  assert.equal(isPile(batch({ total: 3 })), false);
  assert.equal(isPile(batch({ total: 4 })), true);
});

test('the tray opens on the provider’s own filing model', () => {
  assert.equal(sourceModelId('anthropic'), 'claude-sonnet-5');
  assert.equal(sourceModelId('google'), 'gemini-3.6-flash');
  // An unknown tag off disk is the default provider's, never a dead id.
  assert.equal(sourceModelId(null), 'claude-sonnet-5');
});
