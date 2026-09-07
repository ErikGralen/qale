import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionRows } from '../src/renderer/src/lib/session-meta.js';
import type { SessionOverview } from '../src/renderer/src/state/app-state.js';

const NOW = new Date(2026, 8, 6, 12).getTime();
const NONE = new Set<string>();

function session(over: Partial<SessionOverview> = {}): SessionOverview {
  return {
    id: 's1',
    title: 'Session',
    updated: NOW,
    running: false,
    pendingCards: 0,
    unread: false,
    messageCount: 1,
    lifecycle: 'active',
    modelId: null,
    automatic: false,
    ...over,
  };
}

test('an automatic session that found nothing never appears, running or not', () => {
  const running = session({ automatic: true, running: true, updated: NOW });
  const justFinished = session({ automatic: true, updated: NOW - 5 * 60 * 1000 });
  assert.deepEqual(sessionRows([running], NONE, NOW), []);
  assert.deepEqual(sessionRows([justFinished], NONE, NOW), []);
});

test('an automatic session with a card, or a parked question, appears', () => {
  const withCard = session({ id: 'card', automatic: true, pendingCards: 1 });
  const withQuestion = session({ id: 'ask', automatic: true, updated: NOW - 5 * 60 * 1000 });
  const asking = new Set(['ask']);
  assert.deepEqual(
    sessionRows([withCard, withQuestion], asking, NOW).map((s) => s.id),
    ['ask', 'card'],
  );
});

test('a manual session still shows just for running, or for finishing within the hour', () => {
  const running = session({ id: 'running', automatic: false, running: true });
  const recent = session({ id: 'recent', automatic: false, updated: NOW - 30 * 60 * 1000 });
  const stale = session({ id: 'stale', automatic: false, updated: NOW - 2 * 60 * 60 * 1000 });
  const ids = sessionRows([running, recent, stale], NONE, NOW).map((s) => s.id);
  assert.deepEqual(ids, ['running', 'recent']);
});
