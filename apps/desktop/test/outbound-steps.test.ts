import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentOutbound, stepOutbound } from '../src/renderer/src/lib/outbound-steps.js';

const ids = ['a', 'b', 'c'];

test('the first waiting outbound update opens when nothing is picked', () => {
  assert.equal(currentOutbound(ids, new Set(['a', 'b', 'c']), null), 'a');
  assert.equal(currentOutbound(ids, new Set(['b', 'c']), null), 'b');
});

test('a picked outbound update stays open while it waits', () => {
  assert.equal(currentOutbound(ids, new Set(['a', 'b', 'c']), 'c'), 'c');
});

test('once the picked outbound update has left, the next waiting one below it opens', () => {
  assert.equal(currentOutbound(ids, new Set(['a', 'c']), 'b'), 'c');
});

test('with nothing waiting below, the first waiting outbound update opens', () => {
  assert.equal(currentOutbound(ids, new Set(['a']), 'c'), 'a');
});

test('a picked outbound update that was discarded falls back to the first waiting one', () => {
  assert.equal(currentOutbound(['b', 'c'], new Set(['b', 'c']), 'a'), 'b');
});

test('nothing waiting means nothing is open', () => {
  assert.equal(currentOutbound(ids, new Set(), 'a'), null);
});

test('a step skips the outbound updates that already left and stops at the ends', () => {
  const waiting = new Set(['a', 'c']);
  assert.equal(stepOutbound(ids, waiting, 'a', 1), 'c');
  assert.equal(stepOutbound(ids, waiting, 'c', -1), 'a');
  assert.equal(stepOutbound(ids, waiting, 'c', 1), null);
  assert.equal(stepOutbound(ids, waiting, 'a', -1), null);
  assert.equal(stepOutbound(ids, waiting, null, 1), null);
});
