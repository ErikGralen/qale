import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NoteType } from '@qale/ipc';
import {
  FACTS,
  FIELDS,
  HIDDEN_KEYS,
  OFF_ROW_OWNERS,
  type FieldSpec,
} from '../src/renderer/src/state/properties-schema.js';

const TYPES = Object.keys(FIELDS) as NoteType[];

function fieldKeys(type: NoteType): string[] {
  return (FIELDS[type] ?? []).map((f) => f.key);
}

/** What the panel reads: a spec with no owner is the PM's. */
function ownerOf(spec: FieldSpec): string {
  return spec.owner ?? 'user';
}

/** Every row that draws this key, across every type. */
function rowsFor(key: string): { type: NoteType; spec: FieldSpec }[] {
  const rows: { type: NoteType; spec: FieldSpec }[] = [];
  for (const type of TYPES) {
    const spec = (FIELDS[type] ?? []).find((f) => f.key === key);
    if (spec) rows.push({ type, spec });
  }
  return rows;
}

test('tags are the agent’s: every tags row reads and never edits', () => {
  for (const { type, spec } of rowsFor('tags')) {
    assert.equal(ownerOf(spec), 'agent', `${type} offers a cursor on tags`);
  }
});

test('what Qale writes, the PM only reads', () => {
  for (const key of ['tags', 'processing']) {
    const rows = rowsFor(key);
    assert.ok(rows.length > 0, `no type draws "${key}" any more`);
    for (const { type, spec } of rows) {
      assert.notEqual(ownerOf(spec), 'user', `${type} hands the PM "${key}"`);
    }
  }
  assert.equal(OFF_ROW_OWNERS['verified'], 'agent');
});

test('what the PM writes stays the PM’s', () => {
  for (const key of ['due', 'commitment']) {
    const rows = rowsFor(key);
    assert.ok(rows.length > 0, `no type draws "${key}" any more`);
    for (const { type, spec } of rows) {
      assert.equal(ownerOf(spec), 'user', `${type} takes "${key}" out of the PM’s hands`);
    }
  }
  assert.equal(OFF_ROW_OWNERS['title'], 'user');
});

test('a spec with no owner reads as the PM’s', () => {
  const bare: FieldSpec = { key: 'whatever', label: 'Whatever', widget: 'text' };
  assert.equal(ownerOf(bare), 'user');
});

test('the summary stays editable, tier or no tier', () => {
  const summary = (FIELDS.note ?? []).find((f) => f.key === 'summary');
  assert.ok(summary, 'a note lost its summary row');
  assert.equal(summary.owner, 'derived');
  // PropertiesBlock draws the summary with SummaryEditor, not with the spec
  // loop, so `derived` says who writes it and takes no cursor away.
  assert.equal(summary.widget, 'textarea');
});

test('a person’s own words about a person stay editable', () => {
  const cares = (FIELDS.person ?? []).find((f) => f.key === 'cares_about');
  assert.ok(cares, 'person lost its "Cares about" row');
  assert.equal(cares.widget, 'tags');
  assert.equal(cares.owner ?? 'user', 'user');
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

test('processing is Qale’s field and the PM still keeps the select', () => {
  for (const type of Object.keys(FIELDS) as NoteType[]) {
    const processing = (FIELDS[type] ?? []).find((f) => f.key === 'processing');
    if (!processing) continue;
    assert.equal(ownerOf(processing), 'agent', `${type} hands processing to the PM`);
    assert.equal(processing.keepsCursor, true, `${type} takes the PM's override away`);
  }
  const tags = FIELDS.note?.find((f) => f.key === 'tags');
  assert.ok(tags && !tags.keepsCursor, 'tags must not offer a cursor');
});
