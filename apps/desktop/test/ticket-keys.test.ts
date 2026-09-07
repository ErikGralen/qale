import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitTicketKeys, TICKET_KEY_RE } from '../src/renderer/src/lib/ticket-keys.js';

test('a key typed into a sentence is split out of it', () => {
  assert.deepEqual(splitTicketKeys('File the story under SCH-231.'), [
    'File the story under ',
    { key: 'SCH-231' },
    '.',
  ]);
  assert.deepEqual(splitTicketKeys('SCH-231 blocks PAY-1042'), [
    { key: 'SCH-231' },
    ' blocks ',
    { key: 'PAY-1042' },
  ]);
  // A line that is nothing but the key still comes back as the key.
  assert.deepEqual(splitTicketKeys('SCH-231'), [{ key: 'SCH-231' }]);
});

test('a line with no key comes back whole', () => {
  assert.deepEqual(splitTicketKeys('Nothing to see here.'), ['Nothing to see here.']);
  assert.deepEqual(splitTicketKeys(''), ['']);
});

test('a key is a whole word or it is not a key', () => {
  for (const line of ['xSCH-231', 'SCH-231a', 'lower-231', 'SCH-abc', '2026-09-06']) {
    assert.deepEqual(splitTicketKeys(line), [line], line);
  }
  // Punctuation and brackets around it are still boundaries.
  assert.deepEqual(splitTicketKeys('(SCH-231)'), ['(', { key: 'SCH-231' }, ')']);
});

test('a word that only wears the shape is still split out, for the lookup to refuse', () => {
  // "COVID-19" has no mirror, so the chip falls back to plain text. Deciding
  // that is the caller's job — this one only knows the shape.
  assert.deepEqual(splitTicketKeys('after COVID-19'), ['after ', { key: 'COVID-19' }]);
});

test('the running-text split and the bare-key shape agree', () => {
  for (const part of splitTicketKeys('SCH-231 and PAY-1042 and COVID-19')) {
    if (typeof part !== 'string') assert.ok(TICKET_KEY_RE.test(part.key), part.key);
  }
});
