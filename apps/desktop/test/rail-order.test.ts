import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NoteType } from '@qale/ipc';
import {
  MEMORY_SHELVES,
  MIRROR_SHELVES,
  RAIL_ORDER,
  surfaceForType,
} from '../src/renderer/src/lib/nav.js';

test('the rail is seven places, in the order the PM asked for', () => {
  assert.deepEqual(
    [...RAIL_ORDER],
    ['home', 'inbox', 'calendar', 'todos', 'chats', 'documents', 'memory'],
  );
});

test('Memory is one entry point holding six types, kept apart behind it', () => {
  assert.deepEqual(
    [...MEMORY_SHELVES],
    ['source', 'decision', 'insight', 'theme', 'customer', 'person'],
  );
});

test('a person is a type inside Memory, never a rail row of its own', () => {
  assert.ok(MEMORY_SHELVES.includes('person'));
  assert.equal(surfaceForType('person'), 'memory');
  assert.ok(!(RAIL_ORDER as readonly string[]).includes('people'));
});

test('meetings and notes are not on the Memory page — they have their own rails', () => {
  for (const type of ['meeting', 'note'] as const) {
    assert.ok(!MEMORY_SHELVES.includes(type), type);
    assert.ok(!MIRROR_SHELVES.includes(type), type);
  }
  assert.equal(surfaceForType('meeting'), 'calendar');
  assert.equal(surfaceForType('note'), 'documents');
});

test('the two mirrored types group under Memory, not beside it', () => {
  assert.deepEqual([...MIRROR_SHELVES], ['ticket', 'wikipage']);
  assert.equal(surfaceForType('ticket'), 'memory');
  assert.equal(surfaceForType('wikipage'), 'memory');
});

test('every note type has one surface, or none, and never two', () => {
  const types: NoteType[] = [
    'source',
    'meeting',
    'decision',
    'insight',
    'customer',
    'theme',
    'person',
    'session',
    'skill',
    'agent',
    'todo',
    'note',
    'ticket',
    'wikipage',
  ];
  // Skills, agents and session receipts are reached by their own doors, so a
  // null here is the right answer, not a gap.
  const homeless = types.filter((t) => surfaceForType(t) === null);
  assert.deepEqual(homeless, ['session', 'skill', 'agent']);
  // Nothing sits on two shelves.
  const onBoth = MEMORY_SHELVES.filter((t) => MIRROR_SHELVES.includes(t));
  assert.deepEqual(onBoth, []);
});
