import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NoteRefDTO } from '@qale/ipc';
import {
  FLIGHT,
  MIRROR_KEYS,
  SHELF_KEYS,
  STATE_TONE,
  sortNotes,
  stateRank,
  updatedMs,
} from '../src/renderer/src/lib/folder-sort.js';

/** Only the fields the comparators read. The rest of a ref is not their
 *  business, so the fixtures do not carry it. */
function ref(p: Partial<NoteRefDTO> & { title: string }): NoteRefDTO {
  return {
    path: `tickets/jira/${p.title}.md`,
    slug: `tickets/jira/${p.title}`,
    title: p.title,
    type: 'ticket',
    summary: '',
    mtime: 0,
    ...p,
  } as NoteRefDTO;
}

const titles = (rows: NoteRefDTO[]): string[] => rows.map((r) => r.title);

test('a state with no category ranks past every state that has one', () => {
  assert.equal(stateRank(ref({ title: 'a', stateCategory: 'open' })), 0);
  assert.equal(stateRank(ref({ title: 'b', stateCategory: 'done' })), FLIGHT.length - 1);
  assert.equal(stateRank(ref({ title: 'c' })), FLIGHT.length);
});

test('State sorts in flight order, not alphabetically', () => {
  // Alphabetically these run Blocked, Done, In progress, To do. By flight they
  // run To do, In progress, Blocked, Done, which is what the board shows.
  const rows = [
    ref({ title: 'done', stateCategory: 'done' }),
    ref({ title: 'blocked', stateCategory: 'blocked' }),
    ref({ title: 'todo', stateCategory: 'open' }),
    ref({ title: 'doing', stateCategory: 'in_progress' }),
  ];
  assert.deepEqual(titles(sortNotes(rows, { key: 'state', dir: 'asc' })), [
    'todo',
    'doing',
    'blocked',
    'done',
  ]);
  assert.deepEqual(titles(sortNotes(rows, { key: 'state', dir: 'desc' })), [
    'done',
    'blocked',
    'doing',
    'todo',
  ]);
});

test('Updated reads the upstream time first, and falls back to the file', () => {
  const remote = ref({ title: 'remote', remoteUpdated: '2026-05-01T00:00:00.000Z', mtime: 0 });
  assert.equal(updatedMs(remote), Date.parse('2026-05-01T00:00:00.000Z'));
  // A mirror written before the field existed, and one whose value is junk.
  assert.equal(updatedMs(ref({ title: 'local', mtime: 1234 })), 1234);
  assert.equal(updatedMs(ref({ title: 'bad', remoteUpdated: 'soon', mtime: 99 })), 99);
});

test('Updated orders ISO text and a file time on one scale', () => {
  const rows = [
    ref({ title: 'old', remoteUpdated: '2026-01-01T00:00:00.000Z' }),
    ref({ title: 'newest', mtime: Date.parse('2026-09-01T00:00:00.000Z') }),
    ref({ title: 'middle', remoteUpdated: '2026-06-01T00:00:00.000Z' }),
  ];
  assert.deepEqual(titles(sortNotes(rows, { key: 'updated', dir: 'desc' })), [
    'newest',
    'middle',
    'old',
  ]);
});

test('the name breaks every tie, so one list renders the same way twice', () => {
  const rows = [
    ref({ title: 'Zebra', stateCategory: 'open' }),
    ref({ title: 'Alpha', stateCategory: 'open' }),
    ref({ title: 'Mango', stateCategory: 'open' }),
  ];
  const once = titles(sortNotes(rows, { key: 'state', dir: 'asc' }));
  const twice = titles(sortNotes([...rows].reverse(), { key: 'state', dir: 'asc' }));
  assert.deepEqual(once, ['Alpha', 'Mango', 'Zebra']);
  assert.deepEqual(once, twice);
});

test('sorting answers a new array and leaves the one it was given alone', () => {
  const rows = [ref({ title: 'b' }), ref({ title: 'a' })];
  const sorted = sortNotes(rows, { key: 'name', dir: 'asc' });
  assert.deepEqual(titles(rows), ['b', 'a']);
  assert.deepEqual(titles(sorted), ['a', 'b']);
});

test('every state category the board colours has a tone, and no extras', () => {
  assert.deepEqual(Object.keys(STATE_TONE).sort(), [...FLIGHT].sort());
});

test('a shelf offers two columns and a mirror three, and both start with Name', () => {
  assert.deepEqual([...SHELF_KEYS], ['name', 'date']);
  assert.deepEqual([...MIRROR_KEYS], ['name', 'state', 'updated']);
});
