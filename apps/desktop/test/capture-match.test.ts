import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankCaptureMatch, type AgendaMeeting } from '../src/main/services/sync-service.js';

const NOW = Date.parse('2026-07-28T15:04:00Z');
const min = (n: number): number => n * 60_000;

function mtg(id: string, startOffsetMin: number, endOffsetMin: number, cancelled = false): AgendaMeeting {
  return {
    notePath: `meetings/${id}.md`,
    title: id,
    startMs: NOW + min(startOffsetMin),
    endMs: NOW + min(endOffsetMin),
    cancelled,
  };
}

test('capture match: the meeting just ended wins over an upcoming one', () => {
  // 14:00–15:00 ended 4 min ago; a 15:30 stand-up is still ahead.
  const ended = mtg('nordkap', -64, -4);
  const upcoming = mtg('standup', 26, 41);
  assert.equal(rankCaptureMatch([upcoming, ended], NOW)?.notePath, ended.notePath);
});

test('capture match: a meeting in progress beats one that just ended', () => {
  const inProgress = mtg('now-live', -10, 20);
  const ended = mtg('earlier', -60, -5);
  assert.equal(rankCaptureMatch([ended, inProgress], NOW)?.notePath, inProgress.notePath);
});

test('capture match: among ended meetings, the most recent one wins', () => {
  const older = mtg('older', -80, -40);
  const recent = mtg('recent', -50, -6);
  assert.equal(rankCaptureMatch([older, recent], NOW)?.notePath, recent.notePath);
});

test('capture match: cancelled meetings never match', () => {
  const cancelled = mtg('called-off', -30, -2, true);
  assert.equal(rankCaptureMatch([cancelled], NOW), null);
});

test('capture match: with nothing ended, the soonest upcoming is offered', () => {
  const soon = mtg('soon', 8, 38);
  const later = mtg('later', 20, 50);
  assert.equal(rankCaptureMatch([later, soon], NOW)?.notePath, soon.notePath);
});

test('capture match: an empty window yields no match', () => {
  assert.equal(rankCaptureMatch([], NOW), null);
});
