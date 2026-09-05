import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { startReplayServer } from '../src/main/demo/replay-server.js';
import type { Recording } from '../src/main/demo/replay-recordings.js';

/**
 * Record mode (docs/demo-mode.md DM-3): the app must not be able to tell it is
 * there. The bytes it gets are the upstream bytes, and the recording is built
 * from the same stream on the way past. The upstream here is a stub, so the
 * test costs no tokens.
 */

const EVENTS = [
  {
    type: 'message_start',
    message: {
      id: 'msg_up',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 11, output_tokens: 0 },
    },
  },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Filing ' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'it.' } },
  { type: 'content_block_stop', index: 0 },
  {
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'tool_use', id: 'tu_1', name: 'propose_todo', input: {} },
  },
  {
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'input_json_delta', partial_json: '{"due":' },
  },
  {
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'input_json_delta', partial_json: '"2026-07-25"}' },
  },
  { type: 'content_block_stop', index: 1 },
  {
    type: 'message_delta',
    delta: { stop_reason: 'tool_use', stop_sequence: null },
    usage: { output_tokens: 24 },
  },
  { type: 'message_stop' },
];

const WIRE = EVENTS.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');

/** The stub Anthropic. It records what it was asked, so the headers can be checked. */
function stubUpstream(seen: { key?: string; version?: string; body?: string }): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
  server: Server;
}> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        seen.key = String(req.headers['x-api-key'] ?? '');
        seen.version = String(req.headers['anthropic-version'] ?? '');
        seen.body = Buffer.concat(chunks).toString('utf8');
        assert.equal(req.url, '/v1/messages');
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(WIRE);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        server,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

test('a recorded run streams upstream bytes back and keeps the turn', async () => {
  const seen: { key?: string; version?: string; body?: string } = {};
  const upstream = await stubUpstream(seen);
  const dir = mkdtempSync(join(tmpdir(), 'qale-record-'));
  const server = await startReplayServer({
    mode: 'record',
    recordingsDir: dir,
    dateOffsetDays: 0,
    upstreamApiKey: 'sk-ant-real',
    upstreamBaseUrl: upstream.baseUrl,
  });
  try {
    const first = {
      model: 'claude-opus-5',
      system: 'You are Qale.',
      stream: true,
      tools: [{ name: 'propose_todo', input_schema: { type: 'object' } }],
      messages: [{ role: 'user', content: 'Go through the Nordkap transcript' }],
    };
    const res = await fetch(`${server.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'demo',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(first),
    });
    assert.equal(await res.text(), WIRE);
    // The real key goes upstream; the one the app holds is ignored.
    assert.equal(seen.key, 'sk-ant-real');
    assert.equal(seen.version, '2023-06-01');
    assert.equal(seen.body, JSON.stringify(first));

    const files = readdirSync(dir);
    assert.equal(files.length, 1);
    assert.ok(files[0]?.startsWith('go-through-the-nordkap-transcript-'));
    const saved = JSON.parse(readFileSync(join(dir, files[0]!), 'utf8')) as Recording;
    assert.equal(saved.version, 1);
    assert.equal(saved.turns.length, 1);
    assert.deepEqual(saved.turns[0]?.request.tools, ['propose_todo']);
    assert.equal(saved.turns[0]?.request.model, 'claude-opus-5');
    assert.ok(!JSON.stringify(saved).includes('sk-ant-real'));
    const content = saved.turns[0]!.response.content;
    assert.equal(content[0]?.text, 'Filing it.');
    assert.deepEqual(content[1]?.input, { due: '2026-07-25' });
    assert.equal(saved.turns[0]?.response.stop_reason, 'tool_use');
    assert.equal(saved.turns[0]?.response.usage.output_tokens, 24);

    // The next turn of the same conversation joins the same file.
    await fetch(`${server.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...first,
        messages: [
          ...first.messages,
          { role: 'assistant', content: 'Filing it.' },
          { role: 'user', content: 'Approve it' },
        ],
      }),
    });
    const again = JSON.parse(readFileSync(join(dir, files[0]!), 'utf8')) as Recording;
    assert.equal(again.turns.length, 2);
    assert.equal(readdirSync(dir).length, 1);

    // A conversation that opens on something else gets its own file.
    await fetch(`${server.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...first,
        messages: [{ role: 'user', content: 'Tidy the standup note' }],
      }),
    });
    assert.equal(readdirSync(dir).length, 2);
  } finally {
    await server.close();
    await upstream.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
