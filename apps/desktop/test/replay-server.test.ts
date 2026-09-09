import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildKickoff } from '@qale/sessions';
import { startReplayServer, type ReplayServer } from '../src/main/demo/replay-server.js';
import type { WireMessage } from '../src/main/demo/replay-recordings.js';
import type { Scenario } from '../src/main/demo/scenario.js';

/**
 * The whole path, over HTTP: a request in, a scripted turn out, dated for the
 * demo day (docs/plan-demo-replay.md). Pacing is turned off here; the timing
 * is asserted in replay-sse.test.ts, where it costs no seconds.
 */

const SYSTEM = 'You are the embedded agent inside "Qale".';
const FIXTURE = join(import.meta.dirname, 'fixtures', 'scenario-s1.json');
const KICKOFF = buildKickoff({
  skill: 'arrival',
  instruction: '1 source just landed in your session folder, unfiled: steering.vtt.',
});

function said(text: string): WireMessage {
  return { role: 'user', content: [{ type: 'text', text }] };
}

/** A second scenario, with no off-script line of its own. */
const S2: Scenario = {
  version: 1,
  id: 's2',
  title: 'Who is waiting',
  do: 'Type the question.',
  conversations: [
    {
      id: 'ask',
      trigger: { kind: 'typed' },
      title: 'Who is waiting on swaps',
      turns: [{ text: 'Café Nord and Fjord Sports.' }],
    },
  ],
};

async function withServer(
  run: (server: ReplayServer, scenariosDir: string) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'qale-replay-'));
  const scenariosDir = join(dir, 'scenarios');
  const recordingsDir = join(dir, 'recordings');
  mkdirSync(scenariosDir);
  mkdirSync(recordingsDir);
  copyFileSync(FIXTURE, join(scenariosDir, 's1.json'));
  writeFileSync(join(scenariosDir, 's2.json'), JSON.stringify(S2));
  writeFileSync(
    join(recordingsDir, '_fallback.json'),
    JSON.stringify({
      version: 1,
      key: '_fallback',
      turns: [
        {
          request: { system: '', messages: [], model: 'claude-opus-5' },
          response: {
            id: 'msg_demo_fallback',
            type: 'message',
            role: 'assistant',
            model: 'claude-opus-5',
            content: [{ type: 'text', text: 'I only know the walkthrough.' }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        },
      ],
    }),
  );
  const server = await startReplayServer({
    mode: 'replay',
    scenariosDir,
    recordingsDir,
    dateOffsetDays: 50,
    pacing: { leadMs: 0, charsPerSecond: 0 },
  });
  try {
    await run(server, scenariosDir);
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

async function answerText(baseUrl: string, messages: WireMessage[]): Promise<string> {
  const res = await post(baseUrl, { model: 'claude-opus-5', system: SYSTEM, messages });
  const body = (await res.json()) as { content: { text?: string }[] };
  return body.content[0]?.text ?? '';
}

test('a streamed kickoff gets turn 0 of the skill conversation, dated for today', async () => {
  await withServer(async ({ baseUrl }) => {
    const res = await post(baseUrl, {
      model: 'claude-opus-5',
      system: SYSTEM,
      stream: true,
      messages: [said(KICKOFF)],
    });
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    const text = await res.text();
    assert.ok(text.startsWith('event: message_start\n'));
    assert.ok(text.endsWith('event: message_stop\ndata: {"type":"message_stop"}\n\n'));
    const events = text
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice(6)) as Record<string, any>);
    const start = events.find((e) => e.type === 'content_block_start');
    assert.equal(start?.content_block.type, 'tool_use');
    assert.equal(start?.content_block.name, 'file_source');
    const input = events.find((e) => e.delta?.type === 'input_json_delta');
    // The anchor plus fifty days is 2026-09-05.
    assert.deepEqual(JSON.parse(input?.delta.partial_json), {
      path: 'sources/2026-09-05-steering-transcript.md',
      from: 'steering.vtt',
    });
    assert.equal(events.at(-2)?.delta.stop_reason, 'tool_use');
  });
});

test('the next turn is picked by the assistant count, and never by its text', async () => {
  await withServer(async ({ baseUrl }) => {
    await answerText(baseUrl, [said(KICKOFF)]);
    const text = await answerText(baseUrl, [
      said(KICKOFF),
      { role: 'assistant', content: 'Whatever the app sent back.' },
      said('a typed line with a typo in it'),
    ]);
    assert.equal(
      text,
      'Filed it as [[sources/2026-09-05-steering-transcript]]. The workshop is on 2026-09-13.',
    );
  });
});

test('typed sessions bind in id order, and past every script the fallback answers', async () => {
  await withServer(async (server) => {
    assert.deepEqual(
      server.scenarios().map((s) => s.id),
      ['s1', 's2'],
    );
    assert.equal(
      await answerText(server.baseUrl, [said('SCH-231 is done. Who needs to know?')]),
      'Three people need to know, and Oskar first.',
    );
    assert.equal(
      await answerText(server.baseUrl, [said('What did we tell Fjord Sports?')]),
      'Oskar was told Q4 in May.',
    );
    assert.equal(
      await answerText(server.baseUrl, [said('Who is waiting on shift swaps?')]),
      'Café Nord and Fjord Sports.',
    );
    // Every typed conversation is taken and nothing is pinned, so the fallback answers.
    assert.equal(
      await answerText(server.baseUrl, [said('And what about Q3?')]),
      'I only know the walkthrough.',
    );
  });
});

test('a session past the end of its script gets its scenario’s off-script line', async () => {
  await withServer(async (server) => {
    const kickoff = said(KICKOFF);
    const history: WireMessage[] = [kickoff];
    for (let turn = 0; turn < 3; turn += 1) {
      await answerText(server.baseUrl, history);
      history.push({ role: 'assistant', content: `turn ${turn}` }, said('go on'));
    }
    // s1's drop conversation has three turns; the fourth request is past it.
    assert.equal(
      await answerText(server.baseUrl, history),
      'That is outside what this scenario can show in the demo build.',
    );
    // A kickoff no scenario has a conversation for binds nothing and gets the fallback.
    assert.equal(
      await answerText(server.baseUrl, [
        said(buildKickoff({ skill: 'weekly-update', instruction: '' })),
      ]),
      'I only know the walkthrough.',
    );
  });
});

test('reset re-reads the folder and clears the bindings, so a hand edit needs no relaunch', async () => {
  await withServer(async (server, scenariosDir) => {
    await answerText(server.baseUrl, [said('SCH-231 is done. Who needs to know?')]);
    const s1 = JSON.parse(readFileSync(join(scenariosDir, 's1.json'), 'utf8')) as Scenario;
    s1.conversations[1]!.turns[0]!.text = 'Three people, and sharpened.';
    writeFileSync(join(scenariosDir, 's1.json'), JSON.stringify(s1));
    server.reset();
    assert.equal(
      await answerText(server.baseUrl, [said('SCH-231 is done. Who needs to know?')]),
      'Three people, and sharpened.',
    );
  });
});

test('the model list answers a key check, and nothing else is served', async () => {
  await withServer(async ({ baseUrl }) => {
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
