import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANCHOR } from '@qale/domain/demo';
import { MATCH_SYSTEM_PROMPT } from '@qale/agent';
import { draftScenario } from '../src/main/demo/script-from-recording.js';
import type { Recording, WireResponse } from '../src/main/demo/replay-recordings.js';
import { turnText } from '../src/main/demo/scenario.js';

/**
 * The converter that drafts a scenario script from a recording
 * (docs/plan-demo-replay.md, section 4.7). A small, hand-built recording
 * stands in for the real 36 files: it is enough to prove what the converter
 * throws away, what it keeps, and what it flags.
 */

const SYSTEM = 'You are the embedded agent inside "Qale".';
const OFFSET_DAYS = 10; // record day = ANCHOR + 10 = 2026-07-27.

function message(response: Partial<WireResponse> & { content: WireResponse['content'] }): WireResponse {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
    ...response,
  };
}

function sessionRecording(): Recording {
  return {
    version: 1,
    key: 'test-session',
    offsetDays: OFFSET_DAYS,
    turns: [
      {
        request: {
          system: SYSTEM,
          model: 'claude-opus-5',
          messages: [{ role: 'user', content: 'Something happened at steering. What do I do?' }],
        },
        response: message({
          content: [{ type: 'tool_use', id: 't0', name: 'vault_read', input: { path: 'x.md' } }],
        }),
      },
      {
        request: { system: SYSTEM, model: 'claude-opus-5', messages: [] },
        response: message({
          content: [{ type: 'tool_use', id: 't1', name: 'get_voice', input: { voice: 'cs' } }],
        }),
      },
      {
        request: { system: SYSTEM, model: 'claude-opus-5', messages: [] },
        response: message({
          content: [{ type: 'tool_use', id: 't2', name: 'vault_list', input: { type: 'decision' } }],
        }),
      },
      {
        request: { system: SYSTEM, model: 'claude-opus-5', messages: [] },
        response: message({
          content: [
            {
              type: 'text',
              text: 'Filed on 2026-07-25, see [[meetings/2026-07-26-steering]] and decisions/2026-01-01-old-decision.md.',
            },
            {
              type: 'tool_use',
              id: 't3',
              name: 'withdraw_proposal',
              input: { ids: ['p_abc123'], reason: 'no longer needed' },
            },
          ],
        }),
      },
      {
        request: { system: SYSTEM, model: 'claude-opus-5', messages: [] },
        response: message({ content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' }),
      },
    ],
  };
}

test('drops read tools, keeps get_voice, un-slides dates, and merges empty turns', () => {
  const { scenario, flags } = draftScenario({
    recordings: [sessionRecording()],
    scenarioId: 's-test',
    anchor: ANCHOR,
  });

  assert.equal(scenario.draft, true);
  assert.equal(scenario.conversations.length, 1);
  const [conversation] = scenario.conversations;

  // The two read-only turns (vault_read, vault_list) contributed nothing and
  // are not separate turns: they merged forward into the next real one.
  assert.equal(conversation!.turns.length, 3);

  // get_voice survives even though every read around it was dropped.
  assert.deepEqual(conversation!.turns[0]!.tools, [{ name: 'get_voice', input: { voice: 'cs' } }]);
  assert.ok(!conversation!.turns[0]!.text, 'the merged-forward read turns carried no text');

  // Dates: the plain prose date un-slides by offsetDays; the calendar mirror
  // (dated one day before the record day) is templated instead of un-slid;
  // the old, far-off decision path is left exactly as recorded.
  const text = turnText(conversation!.turns[1]!);
  assert.match(text, /Filed on 2026-07-15/);
  assert.match(text, /\[\[meetings\/\{\{date:2026-07-16\}\}-steering\]\]/);
  assert.match(text, /decisions\/2026-01-01-old-decision\.md/);

  // The script ends on a text turn, exactly as recorded.
  assert.equal(turnText(conversation!.turns[2]!), 'Done.');
  assert.ok(!conversation!.turns[2]!.tools?.length);

  // withdraw_proposal and its proposal id are both flagged for the author.
  assert.ok(flags.some((f) => f.includes('p_abc123')), 'flags a proposal id');
  assert.ok(flags.some((f) => f.includes('withdraws a proposal')), 'flags withdraw_proposal');
});

test('drops read tools only when keepReads is not set', () => {
  const { scenario } = draftScenario({
    recordings: [sessionRecording()],
    scenarioId: 's-test',
    anchor: ANCHOR,
    keepReads: true,
  });
  const turns = scenario.conversations[0]!.turns;
  assert.ok(turns.some((t) => t.tools?.some((tool) => tool.name === 'vault_read')));
  assert.ok(turns.some((t) => t.tools?.some((tool) => tool.name === 'vault_list')));
});

function claimRecording(): Recording {
  return {
    version: 1,
    key: 'claim-test',
    offsetDays: OFFSET_DAYS,
    turns: [
      {
        request: {
          system: MATCH_SYSTEM_PROMPT,
          model: 'claude-haiku-4-5-20251001',
          messages: [{ role: 'user', content: 'Claim: Åsa reverses H2 order\n\nExcerpts:\n...' }],
        },
        response: message({
          content: [{ type: 'text', text: 'CONFLICT | decisions/2026-05-18-h2-order-payroll-first.md | She flipped it.' }],
          stop_reason: 'end_turn',
        }),
      },
    ],
  };
}

test('fills lookups.claims from a single-turn claim recording', () => {
  const { scenario } = draftScenario({
    recordings: [claimRecording()],
    scenarioId: 's-test',
    anchor: ANCHOR,
  });
  assert.equal(scenario.conversations.length, 0);
  assert.equal(
    scenario.lookups?.claims?.['Åsa reverses H2 order'],
    'CONFLICT | decisions/2026-05-18-h2-order-payroll-first.md | She flipped it.',
  );
});
