import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnBlocks, type AnyPart } from '../src/renderer/src/lib/turn-parts.js';

/**
 * How a turn lays out in the chat (docs/chat-order.md). The rule these tests
 * hold to: every text the assistant wrote draws as prose where it was written,
 * and nothing the PM has read moves into the folded trail afterwards.
 */

const text = (body: string): AnyPart => ({ type: 'text', text: body });
const read = (path: string): AnyPart => ({
  type: 'tool-vault_read',
  state: 'output-available',
  input: { path },
  output: '# Nordkap',
});
const thinking: AnyPart = { type: 'reasoning', text: 'Two notes to check first.' };

/** The blocks in reading order, one word each, for a short assertion. */
const kinds = (parts: AnyPart[]) => turnBlocks(parts).map((b) => b.kind);

test('the work folds into a trail and the paragraph draws under it', () => {
  const blocks = turnBlocks([thinking, read('notes/nordkap.md'), text('Three people waited.')]);
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ['trail', 'prose'],
  );
  const trail = blocks[0]!;
  const answer = blocks[1]!;
  assert.equal(trail.kind === 'trail' ? trail.parts.length : 0, 2);
  assert.equal(answer.kind === 'prose' ? answer.text : '', 'Three people waited.');
});

test('a paragraph stays prose when the turn carries on with tools', () => {
  // The turn as the PM watched it, chunk by chunk: the paragraph is prose the
  // moment it lands, and every later step leaves it exactly where it was.
  const streamed: AnyPart[] = [thinking, text('Three people waited.')];
  assert.deepEqual(kinds(streamed), ['trail', 'prose']);
  streamed.push(read('notes/asa-lind.md'));
  assert.deepEqual(kinds(streamed), ['trail', 'prose', 'trail']);
  streamed.push({ type: 'tool-propose_update', state: 'output-available', input: {} });
  assert.deepEqual(kinds(streamed), ['trail', 'prose', 'trail']);
});

test('a second text never folds the first one into the trail', () => {
  const blocks = turnBlocks([
    text('Three people waited.'),
    read('notes/nordkap.md'),
    text('So I updated the note.'),
  ]);
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ['prose', 'trail', 'prose'],
  );
  assert.deepEqual(
    blocks.flatMap((b) => (b.kind === 'prose' ? [b.text] : [])),
    ['Three people waited.', 'So I updated the note.'],
  );
});

test('the replayed turn reads the same as the streamed one', () => {
  const parts: AnyPart[] = [
    thinking,
    text('Let me read the check-in.'),
    read('notes/nordkap.md'),
    text('Three people waited.'),
  ];
  // Streamed: the blocks after each chunk are the head of the finished reading,
  // so nothing that is on screen changes kind or place as the turn goes on.
  for (let n = 1; n <= parts.length; n++) {
    const sofar = kinds(parts.slice(0, n));
    assert.deepEqual(sofar, kinds(parts).slice(0, sofar.length));
  }
  assert.deepEqual(kinds(parts), ['trail', 'prose', 'trail', 'prose']);
});

test('a text with nothing in it yet draws nothing', () => {
  assert.deepEqual(kinds([text(''), read('notes/nordkap.md')]), ['trail']);
  assert.deepEqual(kinds([text('   \n')]), []);
});

test('a draft panel breaks the trail and keeps its place', () => {
  const panel: AnyPart = {
    type: 'tool-draft_text',
    state: 'output-available',
    input: { title: 'Update', variants: [{ label: 'Short', body: 'Ships Friday.' }] },
  };
  assert.deepEqual(kinds([thinking, panel, text('Pick one.')]), ['trail', 'panel', 'prose']);
  // A call still running has nothing to show, so it folds in like any step.
  assert.deepEqual(kinds([{ ...panel, state: 'input-available' }]), ['trail']);
});

test('a part the chat has no row for is dropped, not heaped into the trail', () => {
  assert.deepEqual(kinds([{ type: 'step-start' }, text('Done.')]), ['prose']);
});
