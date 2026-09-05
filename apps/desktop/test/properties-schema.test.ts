import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NoteType } from '@qale/ipc';
import { FACTS, FIELDS, HIDDEN_KEYS } from '../src/renderer/src/state/properties-schema.js';

const TYPES = Object.keys(FIELDS) as NoteType[];

function fieldKeys(type: NoteType): string[] {
  return (FIELDS[type] ?? []).map((f) => f.key);
}

test('tags are the agent’s: every tags row reads and never edits', () => {
  for (const type of TYPES) {
    const tags = (FIELDS[type] ?? []).find((f) => f.key === 'tags');
    if (!tags) continue;
    assert.equal(tags.agentOwned, true, `${type} offers a cursor on tags`);
  }
});

test('a person’s own words about a person stay editable', () => {
  const cares = (FIELDS.person ?? []).find((f) => f.key === 'cares_about');
  assert.ok(cares, 'person lost its "Cares about" row');
  assert.equal(cares.widget, 'tags');
  assert.notEqual(cares.agentOwned, true);
});

test('relationship and stance are off the screen and still in the file', () => {
  assert.ok(HIDDEN_KEYS.has('relationship'));
  assert.ok(HIDDEN_KEYS.has('stance'));
  for (const type of TYPES) {
    const keys = fieldKeys(type);
    assert.ok(!keys.includes('relationship'), `${type} still draws a relationship row`);
    assert.ok(!keys.includes('stance'), `${type} still draws a stance row`);
  }
  for (const [type, facts] of Object.entries(FACTS)) {
    assert.ok(!facts.includes('relationship'), `${type} still leads with relationship`);
    assert.ok(!facts.includes('stance'), `${type} still leads with stance`);
  }
});

test('the lifecycles that carry logic keep their rows', () => {
  assert.ok(fieldKeys('decision').includes('standing'));
  assert.ok(fieldKeys('todo').includes('commitment'));
  assert.ok(fieldKeys('meeting').includes('processing'));
});

test('processing offers only the two states code writes', () => {
  for (const type of TYPES) {
    const processing = (FIELDS[type] ?? []).find((f) => f.key === 'processing');
    if (!processing) continue;
    assert.deepEqual(
      processing.options?.map((o) => o.value),
      ['new', 'processed'],
      `${type} still offers a processing state nothing writes`,
    );
  }
});

test('every fact a strip states has a field row behind it', () => {
  for (const [type, facts] of Object.entries(FACTS)) {
    const keys = fieldKeys(type as NoteType);
    for (const fact of facts) {
      assert.ok(keys.includes(fact), `${type} states "${fact}" with no row behind it`);
    }
  }
});

test('no row is drawn for a key the panel hides', () => {
  for (const type of TYPES) {
    for (const key of fieldKeys(type)) {
      assert.ok(!HIDDEN_KEYS.has(key), `${type} draws "${key}", which is hidden`);
    }
  }
});
