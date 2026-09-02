import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NoteRefDTO } from '@qale/ipc';
import { isPinnable, qualifiesForRail } from '../src/renderer/src/lib/note-status.js';

const NOW = new Date(2026, 6, 28, 9).getTime();

function note(type: NoteRefDTO['type'], slug: string, extra: Partial<NoteRefDTO> = {}): NoteRefDTO {
  return {
    path: `${type}s/${slug}.md`,
    slug,
    type,
    title: slug,
    summary: '',
    mtime: NOW,
    ...extra,
  };
}

test('a source nobody has read is the one thing the rail pins on its own', () => {
  assert.equal(qualifiesForRail(note('source', 'call', { lifecycle: 'new' })), true);
  assert.equal(qualifiesForRail(note('source', 'old', { lifecycle: 'stale' })), true);
  assert.equal(qualifiesForRail(note('source', 'done', { lifecycle: 'processed' })), false);
});

test("today's meetings no longer pin themselves", () => {
  const today = note('meeting', 'standup', { date: '2026-07-28', time: '09:30' });
  assert.equal(qualifiesForRail(today), false);
});

test('a meeting waiting to be read no longer pins itself either', () => {
  const past = note('meeting', 'kranelund', { date: '2026-07-27', lifecycle: 'new' });
  assert.equal(qualifiesForRail(past), false);
});

test('an open ticket no longer pins itself', () => {
  assert.equal(qualifiesForRail(note('ticket', 'PAY-142', { stateCategory: 'inProgress' })), false);
});

test('an open theme no longer pins itself', () => {
  assert.equal(qualifiesForRail(note('theme', 'checkout-drop-off')), false);
});

test('nothing the PM authors pins itself — their own hand puts it there', () => {
  for (const type of ['note', 'decision', 'insight', 'customer', 'person'] as const) {
    assert.equal(qualifiesForRail(note(type, 'x')), false, type);
  }
});

test('types with a home of their own never reach the rail', () => {
  for (const type of ['todo', 'skill', 'agent', 'session'] as const) {
    assert.equal(isPinnable(type), false, type);
  }
});

test('everything else the PM can work in is pinnable', () => {
  for (const type of [
    'note',
    'meeting',
    'decision',
    'insight',
    'customer',
    'theme',
    'person',
    'ticket',
    'wikipage',
    'source',
  ] as const) {
    assert.equal(isPinnable(type), true, type);
  }
});
