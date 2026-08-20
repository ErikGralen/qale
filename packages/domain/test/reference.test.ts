import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontmatterReference, SCHEMA_BY_TYPE, type NoteType } from '../src/index.js';

/**
 * FH-2. The point of generating this is that it cannot drift from the schemas,
 * so the tests are about the connection rather than the wording.
 */

test('every authored type is described, and the machine-written ones are not', () => {
  const ref = frontmatterReference();
  for (const type of [
    'note',
    'insight',
    'decision',
    'theme',
    'customer',
    'person',
    'todo',
    'meeting',
  ]) {
    assert.match(ref, new RegExp(`\\*\\*${type}\\*\\*`), `${type} is missing from the reference`);
  }
  // A session never authors a mirror or a receipt, and a shape in the prompt is
  // an invitation to write one.
  for (const type of ['ticket', 'wikipage', 'session', 'source', 'skill', 'agent']) {
    assert.doesNotMatch(ref, new RegExp(`\\*\\*${type}\\*\\*`), `${type} must not be offered`);
  }
});

test("the shapes are the schema's own, not a description of it", () => {
  const ref = frontmatterReference();
  // Enums are listed in full, so "which words may commitment hold" is answered
  // here rather than guessed.
  assert.match(ref, /commitment \(open \| done \| dropped\)/);
  assert.match(ref, /stance \(exploring \| watching \| committed \| wont-do\)/);
  // Lists say they are lists — the mistake this whole reference exists for.
  assert.match(ref, /tags \(list\)/);
  assert.match(ref, /verified \(list of \{by, at\}\)/);
  // A field behind a preprocess is still required, which the JSON projection
  // alone gets wrong.
  assert.match(ref, /evidence \(list, required\)/);
  assert.match(ref, /summary \(required\)/);
  // Days say so.
  assert.match(ref, /due \(YYYY-MM-DD\)/);
  assert.match(ref, /duration_minutes \(number\)/);
});

test('one type can be asked for on its own, for a refusal that answers itself', () => {
  const one = frontmatterReference(['todo']);
  assert.match(one, /\*\*todo\*\*/);
  assert.doesNotMatch(one, /\*\*meeting\*\*/);
  assert.match(one, /Every note carries/, 'the shared fields still apply to it');
});

test('every field the reference names is a field that type really has', () => {
  // The anti-drift check: the line for each type is read back and every field
  // on it has to exist in that type's schema. A reference that can say a field
  // the schema does not have is a reference that can lie, which is the whole
  // failure it was built to end.
  for (const line of frontmatterReference().split('\n')) {
    const match = /^- \*\*(\w+)\*\* \([^)]*\): (.*)$/.exec(line);
    if (!match) continue;
    const type = match[1] as NoteType;
    const shape = SCHEMA_BY_TYPE[type].shape as Record<string, unknown>;
    for (const field of match[2]!.split(/,(?![^(]*\))/)) {
      const name = field.trim().replace(/ \(.*$/, '');
      if (!name || name.startsWith('nothing beyond')) continue;
      assert.ok(
        name in shape,
        `the ${type} reference names "${name}", which ${type} does not have`,
      );
    }
  }
});
