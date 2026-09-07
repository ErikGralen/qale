import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dismissSidebarMeeting,
  sidebarMeetingState,
  undoSidebarMeeting,
} from '../src/use-cases/sidebar-meetings.js';
import type { CheckLedgerPort, UseCaseContext } from '../src/ports.js';

/** A minimal in-memory ledger — the same shape the real check table gives
 *  `ctx.checks`, just backed by a Map instead of SQLite. */
function fakeChecks(): CheckLedgerPort {
  const rows = new Map<string, string>();
  return {
    get: (key) => rows.get(key) ?? null,
    set: (key, value) => void rows.set(key, value),
    list: (prefix) =>
      [...rows.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value })),
    remove: (key) => void rows.delete(key),
  };
}

function ctxWith(checks?: CheckLedgerPort): UseCaseContext {
  return { checks } as UseCaseContext;
}

test('sidebar meeting dismiss: a dismissed path shows up in state', () => {
  const ctx = ctxWith(fakeChecks());
  assert.deepEqual(sidebarMeetingState(ctx), { dismissed: [] });
  const state = dismissSidebarMeeting(ctx, 'meetings/standup.md', 1);
  assert.deepEqual(state, { dismissed: ['meetings/standup.md'] });
  assert.deepEqual(sidebarMeetingState(ctx), state);
});

test('sidebar meeting undo: takes one dismissal back, leaves the rest', () => {
  const ctx = ctxWith(fakeChecks());
  dismissSidebarMeeting(ctx, 'meetings/a.md', 1);
  dismissSidebarMeeting(ctx, 'meetings/b.md', 2);
  const state = undoSidebarMeeting(ctx, 'meetings/a.md');
  assert.deepEqual(state, { dismissed: ['meetings/b.md'] });
});

test('sidebar meeting ledger: no checks port answers empty rather than throwing', () => {
  const ctx = ctxWith(undefined);
  assert.deepEqual(sidebarMeetingState(ctx), { dismissed: [] });
  assert.deepEqual(dismissSidebarMeeting(ctx, 'meetings/a.md', 1), { dismissed: [] });
  assert.deepEqual(undoSidebarMeeting(ctx, 'meetings/a.md'), { dismissed: [] });
});

test('sidebar meeting dismiss: independent of the capture nudge ledger', () => {
  const ctx = ctxWith(fakeChecks());
  dismissSidebarMeeting(ctx, 'meetings/standup.md', 1);
  // The capture nudge reads its own prefix, so a sidebar dismissal never
  // silences the "did you take notes" nudge for the same meeting.
  assert.deepEqual(ctx.checks!.list('capture-nudge:'), []);
});
