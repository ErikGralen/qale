import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extended,
  selectionKeyDown,
  toggled,
  type Selection,
} from '../src/renderer/src/lib/selection.js';

/**
 * The two selection models, as set maths.
 *
 * `useSelection` is a hook, and the harness has no DOM to render one in. Every
 * rule that matters is in these two functions and in `selectionKeyDown`, so the
 * hook is left to the type checker and the gestures are checked here.
 *
 * The list stands in for one screen of rows, in the order the eye reads them.
 */
const ROWS = ['a', 'b', 'c', 'd', 'e'];

const set = (...paths: string[]) => new Set(paths);
const list = (s: Set<string>) => ROWS.filter((p) => s.has(p));

// ---------------------------------------------------------------------------
// Click, ⌘click, ⇧click
// ---------------------------------------------------------------------------

test('⌘click adds a row and keeps the rest, where a plain click would not', () => {
  // The plain click is `only`, a fresh set of one row. ⌘click is this.
  const one = toggled(set('a'), 'c');
  assert.deepEqual(list(one), ['a', 'c']);
  assert.deepEqual(list(toggled(one, 'a')), ['c']);
});

test('⌘click on an empty list starts the selection', () => {
  assert.deepEqual(list(toggled(set(), 'b')), ['b']);
});

test('⇧click takes the anchor through the clicked row, in either direction', () => {
  assert.deepEqual(list(extended(ROWS, 'b', 'd')), ['b', 'c', 'd']);
  assert.deepEqual(list(extended(ROWS, 'd', 'b')), ['b', 'c', 'd']);
});

test('⇧click replaces the range rather than growing it', () => {
  // Sweep out to d, then back to c: the range ends at c, it does not keep d.
  const wide = extended(ROWS, 'b', 'd');
  assert.deepEqual(list(wide), ['b', 'c', 'd']);
  assert.deepEqual(list(extended(ROWS, 'b', 'c')), ['b', 'c']);
});

test('⇧click with no anchor yet is just that row', () => {
  assert.deepEqual(list(extended(ROWS, null, 'c')), ['c']);
});

test('⇧click from a row the list stopped showing is just that row', () => {
  // The anchor's row was deleted or filtered away under the pointer.
  assert.deepEqual(list(extended(ROWS, 'gone', 'c')), ['c']);
});

// ---------------------------------------------------------------------------
// ⌘A and Escape
// ---------------------------------------------------------------------------

/** A Selection whose calls are recorded, so the key handler can be watched. */
function spy(active: boolean): Selection & { calls: string[] } {
  const calls: string[] = [];
  return {
    paths: active ? ['a'] : [],
    count: active ? 1 : 0,
    all: false,
    active,
    isSelected: () => false,
    toggle: () => calls.push('toggle'),
    only: () => calls.push('only'),
    extend: () => calls.push('extend'),
    selectAll: () => calls.push('selectAll'),
    clear: () => calls.push('clear'),
    calls,
  };
}

/** The one shape `selectionKeyDown` reads off a React keyboard event. */
function key(k: string, opts: { meta?: boolean; tag?: string } = {}) {
  let prevented = false;
  return {
    key: k,
    metaKey: opts.meta ?? false,
    ctrlKey: false,
    target: { tagName: opts.tag ?? 'DIV', isContentEditable: false },
    preventDefault: () => {
      prevented = true;
    },
    get prevented() {
      return prevented;
    },
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const send = (e: unknown, s: Selection) => selectionKeyDown(e as any, s);

test('Escape clears a selection, and is left alone when there is none', () => {
  const armed = spy(true);
  assert.equal(send(key('Escape'), armed), true);
  assert.deepEqual(armed.calls, ['clear']);

  const idle = spy(false);
  assert.equal(send(key('Escape'), idle), false);
  assert.deepEqual(idle.calls, []);
});

test('⌘A takes the whole list, with nothing selected yet', () => {
  // The rows ARE the selection, so the list never has to be armed first.
  const idle = spy(false);
  assert.equal(send(key('a', { meta: true }), idle), true);
  assert.deepEqual(idle.calls, ['selectAll']);
});

test('⌘A inside a field is the field’s', () => {
  const typing = spy(true);
  assert.equal(send(key('a', { meta: true, tag: 'INPUT' }), typing), false);
  assert.deepEqual(typing.calls, []);
});
