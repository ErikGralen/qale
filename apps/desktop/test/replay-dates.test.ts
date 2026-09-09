import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shiftDatesDeep,
  shiftDatesInText,
  shiftDay,
  shiftResponseDates,
} from '../src/main/demo/replay-dates.js';
import type { WireResponse } from '../src/main/demo/replay-recordings.js';

/**
 * A scripted answer is anchor-dated and slid to the demo day on the way out
 * (docs/demo-mode.md DM-4, docs/plan-demo-replay.md section 4.1). What may
 * move is prose; what must not is a path or a wikilink, because the vault
 * shift renames nothing.
 */

function response(text: string): WireResponse {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

test('an answer is slid to the demo day, and only the answer', () => {
  assert.equal(shiftDay('2026-07-17', 50), '2026-09-05');
  const scripted: WireResponse = {
    ...response('The workshop is on 2026-07-25.'),
    content: [
      { type: 'text', text: 'The workshop is on 2026-07-25.' },
      {
        type: 'tool_use',
        id: 'tu_1',
        name: 'propose_todo',
        input: { due: '2026-07-25', note: 'meeting 2026-07-17T09:00:00Z', count: 2026 },
      },
    ],
  };
  const slid = shiftResponseDates(scripted, 50);
  assert.equal(slid.content[0]?.text, 'The workshop is on 2026-09-13.');
  assert.deepEqual(slid.content[1]?.input, {
    due: '2026-09-13',
    note: 'meeting 2026-09-05T09:00:00Z',
    count: 2026,
  });
  // The source is untouched, so the next serve slides the same days.
  assert.equal(scripted.content[0]?.text, 'The workshop is on 2026-07-25.');
  assert.equal(shiftDatesDeep({ a: ['2026-07-17'] }, 1).a[0], '2026-07-18');
});

test('a date inside a path or a wikilink never slides', () => {
  // The vault shift renames nothing, so a dated filename is that file's name on
  // every demo day. Sliding one points a tool call at nothing.
  const cases: [string, string][] = [
    ['due 2026-09-15, agreed on the call', 'due 2026-09-25, agreed on the call'],
    ['See [[decisions/2026-05-18-h2-order]] now', 'See [[decisions/2026-05-18-h2-order]] now'],
    ['read decisions/2026-05-18-h2-order', 'read decisions/2026-05-18-h2-order'],
    ['2026-09-07-steering.md', '2026-09-07-steering.md'],
    [
      'file meetings/2026-09-07-steering.md before 2026-09-15',
      'file meetings/2026-09-07-steering.md before 2026-09-25',
    ],
    ['Recorded at 2026-09-08T14:20:00Z', 'Recorded at 2026-09-18T14:20:00Z'],
  ];
  for (const [before, after] of cases) assert.equal(shiftDatesInText(before, 10), after);
});

test('a tool input keeps its path and moves its dates', () => {
  const scripted: WireResponse = {
    ...response('filing'),
    content: [
      {
        type: 'tool_use',
        id: 'tu_1',
        name: 'propose_todo',
        input: { path: 'todos/2026-09-08-tell-oskar.md', due: '2026-09-15' },
      },
    ],
  };
  assert.deepEqual(shiftResponseDates(scripted, 10).content[0]?.input, {
    path: 'todos/2026-09-08-tell-oskar.md',
    due: '2026-09-25',
  });
});
