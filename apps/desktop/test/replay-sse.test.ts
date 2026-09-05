import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatEvent, replayEvents } from '../src/main/demo/replay-sse.js';
import type { WireResponse } from '../src/main/demo/replay-recordings.js';

/**
 * pi always asks for a stream, so the replayed answer has to arrive as the same
 * event sequence the API sends (docs/demo-mode.md DM-5). A missing
 * `content_block_stop` or an un-streamed tool input reaches the app as a broken
 * turn, not as an error, so the shape is asserted here rather than in a run.
 */

const answer: WireResponse = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5',
  content: [
    { type: 'text', text: 'Filing it now.' },
    { type: 'tool_use', id: 'tu_1', name: 'propose_todo', input: { due: '2026-07-25' } },
  ],
  stop_reason: 'tool_use',
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 7 },
};

test('the event order is the Anthropic one, block by block', () => {
  const events = replayEvents(answer, { leadMs: 0, charsPerSecond: 0 });
  assert.deepEqual(
    events.map((e) => e.event),
    [
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ],
  );
  const start = events[0]?.data.message as WireResponse;
  assert.deepEqual(start.content, []);
  assert.equal(start.stop_reason, null);
  assert.deepEqual(events[2]?.data.delta, { type: 'text_delta', text: 'Filing it now.' });
  assert.deepEqual(events[4]?.data.content_block, {
    type: 'tool_use',
    id: 'tu_1',
    name: 'propose_todo',
    input: {},
  });
  assert.deepEqual(events[5]?.data.delta, {
    type: 'input_json_delta',
    partial_json: '{"due":"2026-07-25"}',
  });
  assert.deepEqual(events[7]?.data.delta, { stop_reason: 'tool_use', stop_sequence: null });
  assert.deepEqual(events[7]?.data.usage, { input_tokens: 10, output_tokens: 7 });
});

test('text is cut into deltas and paced, the rest of the turn is not', () => {
  const long = { ...answer, content: [{ type: 'text', text: 'x'.repeat(400) }] };
  const events = replayEvents(long, { leadMs: 5000, charsPerSecond: 400 });
  const deltas = events.filter((e) => e.event === 'content_block_delta');
  assert.equal(deltas.length, Math.ceil(400 / 24));
  assert.equal(
    deltas.map((d) => String((d.data.delta as { text: string }).text)).join(''),
    'x'.repeat(400),
  );
  assert.equal(events[0]?.pauseMs, 5000);
  // 400 characters at 400 a second is a second, whatever the chunk size is.
  assert.equal(
    deltas.reduce((sum, d) => sum + d.pauseMs, 0),
    1000,
  );
});

test('an event on the wire carries its name and one JSON line', () => {
  const line = formatEvent({ event: 'message_stop', data: { type: 'message_stop' }, pauseMs: 0 });
  assert.equal(line, 'event: message_stop\ndata: {"type":"message_stop"}\n\n');
});
