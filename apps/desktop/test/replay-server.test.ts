import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startReplayServer } from '../src/main/demo/replay-server.js';
import type { Recording, WireMessage } from '../src/main/demo/replay-recordings.js';

/**
 * The whole path, over HTTP: a request in, a recorded turn out, dated for the
 * demo day (docs/demo-mode.md DM-3..6). Pacing is turned off here; DM-5's
 * timing is asserted in replay-sse.test.ts, where it costs no seconds.
 */

const SYSTEM = 'You are Qale.';

function said(text: string): WireMessage {
  return { role: 'user', content: [{ type: 'text', text }] };
}

function recording(text: string, second: string): Recording {
  const first = [said('Go through the Nordkap transcript')];
  const then = [...first, { role: 'assistant' as const, content: text }, said('Approve it')];
  return {
    version: 1,
    key: 'nordkap',
    turns: [
      {
        request: { system: SYSTEM, messages: first, model: 'claude-opus-5' },
        response: answer(text),
      },
      {
        request: { system: SYSTEM, messages: then, model: 'claude-opus-5' },
        response: answer(second),
      },
    ],
  };
}

function answer(text: string): Recording['turns'][number]['response'] {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 4, output_tokens: 9 },
  };
}

async function withServer(
  run: (baseUrl: string, dir: string, reset: () => void) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'qale-replay-'));
  writeFileSync(
    join(dir, 'nordkap.json'),
    JSON.stringify(recording('Filed, due 2026-07-25.', 'Approved.')),
  );
  writeFileSync(
    join(dir, '_fallback.json'),
    JSON.stringify({
      version: 1,
      key: '_fallback',
      turns: [
        {
          request: { system: '', messages: [], model: 'claude-opus-5' },
          response: answer('I only know the walkthrough.'),
        },
      ],
    }),
  );
  const server = await startReplayServer({
    mode: 'replay',
    recordingsDir: dir,
    dateOffsetDays: 50,
    pacing: { firstTurnDelayMs: 0, turnDelayMs: 0, charsPerSecond: 0 },
  });
  try {
    await run(server.baseUrl, dir, server.reset);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function post(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'demo' },
    body: JSON.stringify(body),
  });
}

test('a streamed request gets the recorded turn, dated for today', async () => {
  await withServer(async (baseUrl) => {
    const res = await post(baseUrl, {
      model: 'claude-opus-5',
      system: SYSTEM,
      stream: true,
      messages: [said('Go through the Nordkap transcript')],
    });
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    const text = await res.text();
    assert.ok(text.startsWith('event: message_start\n'));
    assert.ok(text.includes('"text_delta"'));
    assert.ok(text.endsWith('event: message_stop\ndata: {"type":"message_stop"}\n\n'));
    const said50 = text
      .split('\n')
      .filter((l) => l.includes('text_delta'))
      .map((l) => JSON.parse(l.slice(5)).delta.text)
      .join('');
    assert.equal(said50, 'Filed, due 2026-09-13.');
  });
});

test('the second turn is picked by the assistant count, and never by its text', async () => {
  await withServer(async (baseUrl) => {
    const res = await post(baseUrl, {
      model: 'claude-opus-5',
      system: SYSTEM,
      messages: [
        said('Go through the Nordkap transcript'),
        { role: 'assistant', content: 'A hand-edited answer.' },
        said('Approve it'),
      ],
    });
    const body = (await res.json()) as { content: { text: string }[] };
    assert.equal(body.content[0]?.text, 'Approved.');
  });
});

test('a question nobody recorded gets the fallback recording', async () => {
  await withServer(async (baseUrl) => {
    const res = await post(baseUrl, {
      model: 'claude-opus-5',
      system: SYSTEM,
      messages: [said('What is our ARR?')],
    });
    const body = (await res.json()) as { content: { text: string }[] };
    assert.equal(body.content[0]?.text, 'I only know the walkthrough.');
  });
});

test('reset re-reads the folder, so a hand edit needs no relaunch', async () => {
  await withServer(async (baseUrl, dir, reset) => {
    writeFileSync(
      join(dir, 'nordkap.json'),
      JSON.stringify(recording('Filed, and sharpened.', 'Approved.')),
    );
    reset();
    const res = await post(baseUrl, {
      model: 'claude-opus-5',
      system: SYSTEM,
      messages: [said('Go through the Nordkap transcript')],
    });
    const body = (await res.json()) as { content: { text: string }[] };
    assert.equal(body.content[0]?.text, 'Filed, and sharpened.');
  });
});

test('the model list answers a key check, and nothing else is served', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/v1/models?limit=1`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: { id: string }[] };
    const ids = body.data.map((m) => m.id);
    assert.ok(ids.includes('claude-opus-5'));
    assert.ok(ids.includes('claude-haiku-4-5-20251001'));
    const missing = await fetch(`${baseUrl}/v1/complete`);
    assert.equal(missing.status, 404);
  });
});
