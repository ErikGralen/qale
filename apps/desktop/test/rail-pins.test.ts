import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NoteRefDTO, VaultTreeDTO } from '@qale/ipc';
import { isPinnable, unprocessedSourceCount } from '../src/renderer/src/lib/note-status.js';

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

/** One group per type, the shape `vault:tree` returns. */
function tree(notes: NoteRefDTO[]): VaultTreeDTO {
  const byType = new Map<NoteRefDTO['type'], NoteRefDTO[]>();
  for (const n of notes) byType.set(n.type, [...(byType.get(n.type) ?? []), n]);
  return {
    groups: [...byType].map(([type, rows]) => ({
      dir: `${type}s`,
      type,
      layer: 'authored' as VaultTreeDTO['groups'][number]['layer'],
      notes: rows,
    })),
  };
}

test('types with a home of their own never reach the rail', () => {
  for (const type of ['todo', 'skill', 'agent', 'session'] as const) {
    assert.equal(isPinnable(type), false, type);
  }
});

test('a meeting belongs to the Calendar, so the rail never holds one', () => {
  assert.equal(isPinnable('meeting'), false);
});

test('no memory page pins: the rail refuses all six shelves', () => {
  for (const type of ['source', 'decision', 'insight', 'theme', 'customer', 'person'] as const) {
    assert.equal(isPinnable(type), false, type);
  }
});

test('what you write and what Qale copied are the three that pin', () => {
  for (const type of ['note', 'ticket', 'wikipage'] as const) {
    assert.equal(isPinnable(type), true, type);
  }
});

test('a source nobody has read is counted, never pinned', () => {
  const t = tree([
    note('source', 'call', { lifecycle: 'new' }),
    note('source', 'old', { lifecycle: 'stale' }),
    note('source', 'done', { lifecycle: 'processed' }),
  ]);
  assert.equal(unprocessedSourceCount(t), 2);
  assert.equal(isPinnable('source'), false);
});

test("only a source counts: an unread meeting is the Calendar's business", () => {
  const t = tree([
    note('meeting', 'kranelund', { date: '2026-07-27', lifecycle: 'new' }),
    note('theme', 'checkout-drop-off', { lifecycle: 'new' }),
  ]);
  assert.equal(unprocessedSourceCount(t), 0);
});

test('a folder index is navigation, so it never counts as unread material', () => {
  const t = tree([note('source', 'index', { lifecycle: 'new', path: 'sources/index.md' })]);
  assert.equal(unprocessedSourceCount(t), 0);
});

test('no tree yet is zero rather than a throw', () => {
  assert.equal(unprocessedSourceCount(null), 0);
});
