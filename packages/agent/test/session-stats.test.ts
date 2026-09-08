import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager, parseSessionEntries, type FileEntry } from '@earendil-works/pi-coding-agent';
import { sessionStats } from '../src/session-stats.js';

const user = (text: string) => ({ role: 'user' as const, content: text, timestamp: 1 });

function assistant(
  content: unknown[],
  usage: { output: number; reasoning?: number } = { output: 1 },
) {
  return {
    role: 'assistant' as const,
    content,
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-test',
    usage: {
      input: 1,
      output: usage.output,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: usage.output + 1,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      ...(usage.reasoning !== undefined ? { reasoning: usage.reasoning } : {}),
    },
    stopReason: 'stop' as const,
    timestamp: 2,
  };
}

function toolResult(toolCallId: string, toolName: string, text: string, isError = false) {
  return {
    role: 'toolResult' as const,
    toolCallId,
    toolName,
    content: [{ type: 'text' as const, text }],
    isError,
    timestamp: 3,
  };
}

/**
 * Builds a fixture the way `history.test.ts` does: a real `SessionManager`
 * writes real pi entries to a real session file. That is the one thing this
 * parser must not get wrong, so nothing here is hand-typed JSONL.
 *
 * `appendMessage` stamps `new Date().toISOString()` on every entry with no
 * way to pass one in, which would make every turn in a fixture a few
 * microseconds long and every duration-based assertion flaky. So this reads
 * the file back with pi's own `parseSessionEntries` (the same call
 * `scripts/session-stats.ts` makes) and hands back entries whose shape is
 * entirely pi's, with only the timestamps rewritten to a controlled
 * sequence: entry `i` lands at `startMs + offsetsMs[i]`.
 */
function buildFixture(
  build: (manager: SessionManager) => void,
  offsetsMs: number[],
  startMs = Date.parse('2026-09-07T12:00:00.000Z'),
): FileEntry[] {
  const dir = mkdtempSync(join(tmpdir(), 'pm-session-stats-'));
  const manager = SessionManager.create(process.cwd(), dir, { id: 'aaaaaaaa-0000-0000-0000-000000000000' });
  build(manager);
  const file = manager.getSessionFile();
  assert.ok(file, 'fixture session must have flushed to a file');
  const entries = parseSessionEntries(readFileSync(file, 'utf8'));
  assert.equal(entries.length, offsetsMs.length, 'offsetsMs must cover every entry in the file');
  rmSync(dir, { recursive: true, force: true });
  return entries.map((entry, i) => ({
    ...entry,
    timestamp: new Date(startMs + offsetsMs[i]!).toISOString(),
  }));
}

test('sessionStats reports wall time, tokens, thinking and the residual', () => {
  // session, user (0s), assistant turn 1 (+5s), toolResult (+0.5s: the
  // residual), assistant turn 2 (+2.5s).
  const entries = buildFixture(
    (m) => {
      m.appendMessage(user('Read the transcript and file it.') as never);
      m.appendMessage(
        assistant(
          [
            { type: 'thinking', thinking: 'Check the meetings map first.' },
            { type: 'toolCall', id: 'tc1', name: 'vault_read', arguments: { path: 'meetings/index.md' } },
          ],
          { output: 100, reasoning: 20 },
        ) as never,
      );
      m.appendMessage(toolResult('tc1', 'vault_read', 'meetings/index.md: ...') as never);
      m.appendMessage(assistant([{ type: 'text', text: 'Filed.' }], { output: 50 }) as never);
    },
    [0, 0, 5_000, 5_500, 8_000],
  );

  const stats = sessionStats(entries);

  assert.equal(stats.empty, false);
  assert.equal(stats.wallTimeSec, 8);
  assert.equal(stats.modelCalls, 2);
  assert.equal(stats.outputTokens, 150);
  assert.equal(stats.thinkingTokens, 20);
  assert.ok(Math.abs(stats.thinkingPercent - (20 / 150) * 100) < 1e-9);
  assert.equal(stats.turnModelTimeSec, 7.5); // 5s (turn 1) + 2.5s (turn 2)
  assert.equal(stats.residualSec, 0.5); // the toolResult gap: the tool exec, not the model
  assert.ok(Math.abs(stats.residualPercent - (0.5 / 8) * 100) < 1e-9);
  assert.equal(stats.setupSec, 5); // first user message to first model call

  assert.equal(stats.turns.length, 2);
  assert.equal(stats.turns[0]!.durationSec, 5);
  assert.equal(stats.turns[0]!.outputTokens, 100);
  assert.equal(stats.turns[0]!.thinkingTokens, 20);
  assert.equal(stats.turns[0]!.tokensPerSec, 20); // 100 tokens / 5s, per turn, not a run-wide average
  assert.deepEqual(stats.turns[0]!.toolCalls, ['vault_read']);
  assert.equal(stats.turns[1]!.durationSec, 2.5);
  assert.equal(stats.turns[1]!.tokensPerSec, 20); // 50 tokens / 2.5s

  assert.equal(stats.firstProposalSec, null);
  assert.equal(stats.timeAfterFirstProposalSec, null);
  assert.deepEqual(stats.proposalCountsByKind, {});
  assert.deepEqual(stats.askUserParks, []);
});

test('sessionStats finds the first proposal, the time after it, and counts by kind', () => {
  const entries = buildFixture(
    (m) => {
      m.appendMessage(user('One meeting, file it.') as never);
      m.appendMessage(
        assistant([{ type: 'toolCall', id: 'tc1', name: 'propose_meeting', arguments: {} }]) as never,
      );
      m.appendMessage(toolResult('tc1', 'propose_meeting', 'ok') as never);
      m.appendMessage(
        assistant([
          { type: 'toolCall', id: 'tc2', name: 'propose_todo', arguments: {} },
          { type: 'toolCall', id: 'tc3', name: 'propose_todo', arguments: {} },
        ]) as never,
      );
      m.appendMessage(toolResult('tc2', 'propose_todo', 'ok') as never);
      m.appendMessage(toolResult('tc3', 'propose_todo', 'ok') as never);
    },
    [0, 0, 10_000, 10_100, 40_000, 40_100, 40_100],
  );

  const stats = sessionStats(entries);

  assert.equal(stats.firstProposalSec, 10); // wall start (user, 0s) to the propose_meeting call
  assert.equal(stats.timeAfterFirstProposalSec, 30.1); // wall time (40.1s) minus firstProposalSec
  assert.deepEqual(stats.proposalCountsByKind, { propose_meeting: 1, propose_todo: 2 });
});

test('sessionStats reports an ask_user park, answered and still open', () => {
  const answered = buildFixture(
    (m) => {
      m.appendMessage(user('Go.') as never);
      m.appendMessage(assistant([{ type: 'toolCall', id: 'tc1', name: 'ask_user', arguments: {} }]) as never);
      m.appendMessage(toolResult('tc1', 'ask_user', 'the PM answered') as never);
      m.appendMessage(assistant([{ type: 'text', text: 'Thanks.' }]) as never);
    },
    [0, 0, 1_000, 601_000, 601_500], // parked for 600s (10 minutes) between the call and the answer
  );
  const answeredStats = sessionStats(answered);
  assert.equal(answeredStats.askUserParks.length, 1);
  assert.equal(answeredStats.askUserParks[0]!.gapSec, 600);

  const stillParked = buildFixture(
    (m) => {
      m.appendMessage(user('Go.') as never);
      m.appendMessage(assistant([{ type: 'toolCall', id: 'tc1', name: 'ask_user', arguments: {} }]) as never);
      // No toolResult: the file ends mid-park, the way a truncated or
      // in-progress run's file would.
    },
    [0, 0, 1_000],
  );
  const parkedStats = sessionStats(stillParked);
  assert.equal(parkedStats.askUserParks.length, 1);
  assert.equal(parkedStats.askUserParks[0]!.gapSec, null);
});

test('sessionStats returns the five slowest turns, sorted, and drops the rest', () => {
  const durationsSec = [1, 9, 3, 7, 2, 8, 4]; // 7 turns; the slowest 5 are 9,8,7,4,3
  let offsetMs = 0;
  const offsets: number[] = [0, 0]; // header, then the user message, both at t=0
  const entries = buildFixture(
    (m) => {
      m.appendMessage(user('Go.') as never);
      let n = 0;
      for (const d of durationsSec) {
        const toolCallId = `tc${n++}`;
        m.appendMessage(
          assistant([{ type: 'toolCall', id: toolCallId, name: 'vault_read', arguments: {} }], {
            output: 10,
          }) as never,
        );
        offsetMs += d * 1000;
        offsets.push(offsetMs);
        m.appendMessage(toolResult(toolCallId, 'vault_read', 'ok') as never);
        offsets.push(offsetMs);
      }
    },
    offsets,
  );

  const stats = sessionStats(entries);
  assert.equal(stats.turns.length, 7);
  assert.equal(stats.slowestTurns.length, 5);
  assert.deepEqual(
    stats.slowestTurns.map((t) => t.durationSec),
    [9, 8, 7, 4, 3],
  );
});

test('sessionStats does not throw on an empty or truncated file', () => {
  assert.equal(sessionStats([]).empty, true);
  assert.equal(sessionStats([]).wallTimeSec, 0);
  assert.deepEqual(sessionStats([]).turns, []);

  // A file with only a header, no message yet: `SessionManager` itself never
  // flushes a file until the first assistant message arrives (`_persist` in
  // session-manager.js), so this shape cannot come from a fixture built the
  // normal way. It is what a session file looks like for the few
  // milliseconds between creation and the first turn, or after a crash right
  // there. The header is a flat, four-field, stable shape (unlike a
  // message's nested content/usage), so writing it directly here does not
  // risk the drift the fixture-from-SessionManager rule is guarding against.
  const header: FileEntry = {
    type: 'session',
    version: 3,
    id: 'aaaaaaaa-0000-0000-0000-000000000000',
    timestamp: '2026-09-07T12:00:00.000Z',
    cwd: process.cwd(),
  };
  const stats = sessionStats([header]);
  assert.equal(stats.empty, true);
  assert.equal(stats.modelCalls, 0);
});

test('sessionStats handles a turn cut off by a provider error without throwing', () => {
  const entries = buildFixture(
    (m) => {
      m.appendMessage(user('Go.') as never);
      // A refused turn: pi records it with empty content and no usage field
      // reaching this parser the normal way. Build the shape by hand only
      // for the one field this test needs to be missing (`errorMessage` etc.
      // are not read by sessionStats, so they are left out).
      m.appendMessage({
        role: 'assistant' as const,
        content: [],
        api: 'anthropic-messages',
        provider: 'anthropic',
        model: 'claude-test',
        usage: {
          input: 1,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 1,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'error' as const,
        errorMessage: 'network error',
        timestamp: 2,
      } as never);
    },
    [0, 0, 3_000],
  );

  const stats = sessionStats(entries);
  assert.equal(stats.empty, false);
  assert.equal(stats.modelCalls, 1);
  assert.equal(stats.turns[0]!.outputTokens, 0);
  assert.deepEqual(stats.turns[0]!.toolCalls, []);
});
