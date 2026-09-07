import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Recorder } from '../src/main/demo/replay-recorder.js';
import type { RecordedRequest, WireResponse } from '../src/main/demo/replay-recordings.js';

/**
 * Two conversations that open with the same line (every drop starts "1 source
 * just landed") are two recordings. The second must not join the first and
 * truncate it, which is how Flow 3 once overwrote Flow 1.
 */

const OPENING = 'Run the arrival skill: 1 source just landed in your session.';

function reply(id: string): WireResponse {
  return {
    id,
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [{ type: 'tool_use', id: `tu_${id}`, name: 'files_read', input: { path: 'input.md' } }],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

function turn0(): RecordedRequest {
  return {
    system: 'sys',
    model: 'claude-opus-5',
    messages: [{ role: 'user', content: [{ type: 'text', text: OPENING }] }],
  };
}

function turn1(listing: string, id: string): RecordedRequest {
  return {
    system: 'sys',
    model: 'claude-opus-5',
    messages: [
      { role: 'user', content: [{ type: 'text', text: OPENING }] },
      { role: 'assistant', content: reply(id).content },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: `tu_${id}`, content: listing }],
      },
    ],
  };
}

test('a second conversation with the same opening line starts its own file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qale-rec-'));
  const recorder = new Recorder(dir);

  const a0 = recorder.append(turn0(), reply('a0'));
  const a1 = recorder.append(turn1('source/steering.vtt', 'a0'), reply('a1'));
  assert.equal(a1, a0);

  const b0 = recorder.append(turn0(), reply('b0'));
  assert.notEqual(b0, a0);
  const b1 = recorder.append(turn1('source/support-thread.md', 'b0'), reply('b1'));
  assert.equal(b1, b0);

  const files = readdirSync(dir).sort();
  assert.equal(files.length, 2);
  // The first conversation still has both its turns.
  const first = JSON.parse(readFileSync(a0, 'utf8'));
  assert.equal(first.turns.length, 2);
  const second = JSON.parse(readFileSync(b0, 'utf8'));
  assert.equal(second.turns.length, 2);
  assert.match(second.turns[1].request.messages[2].content[0].content, /support-thread/);

  rmSync(dir, { recursive: true, force: true });
});
