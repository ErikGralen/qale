import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assistantCount,
  matchRequest,
  normalise,
  prefixLength,
  userSide,
} from '../src/main/demo/replay-matcher.js';
import {
  shiftDatesDeep,
  shiftDatesInText,
  shiftDay,
  shiftResponseDates,
} from '../src/main/demo/replay-dates.js';
import type {
  LoadedRecording,
  RecordedTurn,
  WireMessage,
  WireResponse,
} from '../src/main/demo/replay-recordings.js';

/**
 * The matcher is what makes a recorded demo survive a second run
 * (docs/demo-mode.md DM-4). Two runs never send the same bytes: the session id,
 * the dates and the byte counts all move. So these tests are about what is
 * allowed to move and what is not.
 */

function said(text: string): WireMessage {
  return { role: 'user', content: [{ type: 'text', text }] };
}

function answered(text: string): WireMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] };
}

function toolResult(text: string): WireMessage {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text }] }],
  };
}

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

function recording(key: string, turns: RecordedTurn[]): LoadedRecording {
  return { file: `/tmp/${key}.json`, recording: { version: 1, key, turns } };
}

function turn(messages: WireMessage[], text: string, system = 'You are Qale.'): RecordedTurn {
  return {
    request: { system, messages, model: 'claude-opus-5' },
    response: response(text),
  };
}

test('normalising takes out everything that moves between two runs', () => {
  const before =
    'session 3f0d9a1e-2b7c-4a55-9f31-7c2e5a1b8d40 wrote 2026-07-17 at 2026-07-17T09:30:00Z, 128456 bytes';
  const after =
    'session 5c1e8b2f-9a04-4d13-8e77-1b6a3c9f0e22 wrote 2026-09-05 at 2026-09-05T11:02:13.500Z, 99871 bytes';
  assert.equal(normalise(before), normalise(after));
  assert.equal(normalise('due 2026-07-25'), 'due <date>');
  assert.equal(normalise('page 3 of 12'), 'page 3 of 12');
});

test('a message is typed when a person wrote any of it', () => {
  const side = userSide([said('hello'), toolResult('12 files')]);
  assert.deepEqual(
    side.map((s) => s.typed),
    [true, false],
  );
  assert.equal(side[1]?.text, '12 files');
});

test('the longest matching user prefix wins and the turn index is the assistant count', () => {
  const opening = said('Go through the Nordkap transcript');
  const nordkap = recording('nordkap', [
    turn([opening], 'Reading it now.'),
    turn([opening, answered('Reading it now.'), said('Approve the first card')], 'Done.'),
  ]);
  const other = recording('standup', [turn([said('Tidy the standup note')], 'Tidying.')]);

  const first = matchRequest({ system: 'You are Qale.', messages: [opening] }, [nordkap, other]);
  assert.equal(first?.loaded.recording.key, 'nordkap');
  assert.equal(first?.turnIndex, 0);
  assert.equal(first?.turn.response.content[0]?.text, 'Reading it now.');

  const second = matchRequest(
    {
      system: 'You are Qale.',
      // The app sends a hand-edited answer back. The matcher must not care.
      messages: [opening, answered('Reading it NOW, edited.'), said('Approve the first card')],
    },
    [nordkap, other],
  );
  assert.equal(second?.turnIndex, 1);
  assert.equal(second?.turn.response.content[0]?.text, 'Done.');
  assert.equal(assistantCount(second ? [opening, answered('x'), said('y')] : []), 1);
});

test('the system prompt breaks a tie between two conversations that open alike', () => {
  const opening = said('Summarise this');
  const short = recording('short', [turn([opening], 'A summary.', 'Write one line.')]);
  const long = recording('long', [turn([opening], 'A longer summary.', 'Write a paragraph.')]);
  const match = matchRequest({ system: 'Write a paragraph.', messages: [opening] }, [short, long]);
  assert.equal(match?.loaded.recording.key, 'long');
});

test('a typed message nobody recorded finds nothing, so DM-6 answers', () => {
  const opening = said('Go through the Nordkap transcript');
  const rec = recording('nordkap', [
    turn([opening], 'Reading it now.'),
    turn([opening, answered('Reading it now.'), said('Approve the first card')], 'Done.'),
  ]);
  const off = matchRequest(
    {
      system: 'You are Qale.',
      messages: [opening, answered('Reading it now.'), said('What is our ARR?')],
    },
    [rec],
  );
  assert.equal(off, null);
  assert.equal(matchRequest({ system: '', messages: [said('Who are you?')] }, [rec]), null);
});

test('a tool result that drifted is tolerated, up to the ratio', () => {
  const opening = said('Go through the Nordkap transcript');
  const messages = [
    opening,
    answered('Reading.'),
    toolResult('12 files, 40912 bytes'),
    answered('Filing.'),
    toolResult('written'),
  ];
  const rec = recording('nordkap', [
    turn([opening], 'Reading.'),
    turn(messages.slice(0, 3), 'Filing.'),
    turn(messages, 'Filed.'),
  ]);
  const drifted = [...messages];
  drifted[4] = toolResult('written to the vault');
  const match = matchRequest({ system: 'You are Qale.', messages: drifted }, [rec]);
  assert.equal(match?.turnIndex, 2);
  assert.equal(match?.prefix, 2);
  assert.equal(prefixLength(userSide(drifted), userSide(messages)), 2);
});

test('a recorded answer is slid to the demo day, and only the answer', () => {
  assert.equal(shiftDay('2026-07-17', 50), '2026-09-05');
  const recorded: WireResponse = {
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
  const slid = shiftResponseDates(recorded, 50);
  assert.equal(slid.content[0]?.text, 'The workshop is on 2026-09-13.');
  assert.deepEqual(slid.content[1]?.input, {
    due: '2026-09-13',
    note: 'meeting 2026-09-05T09:00:00Z',
    count: 2026,
  });
  // The recording itself is untouched, so the next replay slides the same days.
  assert.equal(recorded.content[0]?.text, 'The workshop is on 2026-07-25.');
  assert.equal(shiftDatesDeep({ a: ['2026-07-17'] }, 1).a[0], '2026-07-18');
});

test('a date inside a path or a wikilink never slides', () => {
  // The vault shift renames nothing, so a dated filename is that file's name on
  // every demo day. Sliding one points a recorded tool call at nothing.
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
  const recorded: WireResponse = {
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
  assert.deepEqual(shiftResponseDates(recorded, 10).content[0]?.input, {
    path: 'todos/2026-09-08-tell-oskar.md',
    due: '2026-09-25',
  });
});
