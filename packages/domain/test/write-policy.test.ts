import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writePolicy, appliesSilently } from '../src/index.js';

// The write policy, one case per row of the table in docs/easier-tickets.md E-3.
// This is the whole argument for the build: a write is graded by the damage it
// can do, in one place, and only the ones that can hurt cost the PM a decision.

test('what the PM asked for in the chat lands without a card', () => {
  assert.equal(writePolicy({ kind: 'note', asked: true }).disposition, 'silent');
  assert.equal(writePolicy({ kind: 'update', asked: true }).disposition, 'silent');
  assert.equal(writePolicy({ kind: 'decision', asked: true }).disposition, 'silent');
});

test('material arriving lands a new note, and an append, without a card', () => {
  assert.equal(writePolicy({ kind: 'note', noteType: 'meeting' }).disposition, 'silent');
  assert.equal(writePolicy({ kind: 'note', noteType: 'insight' }).disposition, 'silent');
  assert.equal(writePolicy({ kind: 'update', appendOnly: true }).disposition, 'silent');
});

// Where a page lands is part of what the write does (E-14). `notes/` is the PM's
// own Documents folder; the rest of the workspace is the memory the agent keeps.

test('a new page in the Documents folder asks', () => {
  assert.equal(
    writePolicy({ kind: 'note', targetPath: 'notes/spec-pricing.md' }).disposition,
    'ask',
  );
  assert.equal(
    writePolicy({ kind: 'note', targetPath: 'notes/2026-09-02-sales-ask.md' }).disposition,
    'ask',
  );
});

test('a page the PM asked for in the chat still lands in Documents without a card', () => {
  assert.equal(
    writePolicy({ kind: 'note', asked: true, targetPath: 'notes/spec-pricing.md' }).disposition,
    'silent',
  );
});

test('a page the agent files for itself lands without a card, wherever the memory keeps it', () => {
  for (const path of [
    'insights/nordkap-needs-scim.md',
    'meetings/2026-09-02-standup.md',
    'understanding/product.md',
  ]) {
    assert.equal(writePolicy({ kind: 'note', targetPath: path }).disposition, 'silent', path);
  }
});

test('an append into a Documents page asks, and the same append into the memory does not', () => {
  assert.equal(
    writePolicy({ kind: 'update', appendOnly: true, targetPath: 'notes/q3-priorities.md' })
      .disposition,
    'ask',
  );
  assert.equal(
    writePolicy({ kind: 'update', appendOnly: true, targetPath: 'themes/pricing.md' }).disposition,
    'silent',
  );
});

test('a folder that only starts like Documents is not Documents', () => {
  assert.equal(writePolicy({ kind: 'note', targetPath: 'notebooks/x.md' }).disposition, 'silent');
});

test('a standing rule is still remembered without a card, wherever it is written', () => {
  assert.equal(
    writePolicy({
      kind: 'update',
      noteType: 'skill',
      appendOnly: true,
      targetPath: 'notes/x.md',
      asked: true,
    }).disposition,
    'silent',
  );
});

test('a patch over existing text, and a decision, are grouped', () => {
  assert.equal(writePolicy({ kind: 'update' }).disposition, 'grouped');
  assert.equal(writePolicy({ kind: 'update', appendOnly: false }).disposition, 'grouped');
  assert.equal(writePolicy({ kind: 'decision' }).disposition, 'grouped');
});

test('a todo always asks, however it arrived', () => {
  assert.equal(writePolicy({ kind: 'note', noteType: 'todo' }).disposition, 'ask');
  assert.equal(writePolicy({ kind: 'note', noteType: 'todo', asked: true }).disposition, 'ask');
  // Closing one, or moving its date, is the same promise changing.
  assert.equal(
    writePolicy({ kind: 'update', noteType: 'todo', appendOnly: true }).disposition,
    'ask',
  );
});

test('outbound always asks, and never groups', () => {
  for (const asked of [true, false]) {
    const ruling = writePolicy({ kind: 'outbound', asked });
    assert.equal(ruling.disposition, 'ask');
    assert.notEqual(ruling.disposition, 'grouped');
  }
});

test('a delete always asks', () => {
  assert.equal(writePolicy({ kind: 'delete' }).disposition, 'ask');
  assert.equal(writePolicy({ kind: 'delete', asked: true }).disposition, 'ask');
  // Even a page the PM asked to lose. There is no undelete behind it.
  assert.equal(writePolicy({ kind: 'delete', noteType: 'note', asked: true }).disposition, 'ask');
});

test('a standing rule the PM stated is remembered without a card', () => {
  assert.equal(
    writePolicy({ kind: 'update', noteType: 'skill', appendOnly: true, asked: true }).disposition,
    'silent',
  );
  assert.equal(writePolicy({ kind: 'note', noteType: 'skill', asked: true }).disposition, 'silent');
  assert.equal(
    writePolicy({ kind: 'update', noteType: 'agent', appendOnly: true, asked: true }).disposition,
    'silent',
  );
});

test('a rule file the agent wrote on its own asks', () => {
  // Reading a team's Jira and writing up how they work (E-25) is a whole file
  // made with nobody watching. "You said it should hold from now on" would be a
  // lie on that card.
  assert.equal(writePolicy({ kind: 'note', noteType: 'skill' }).disposition, 'ask');
  assert.equal(
    writePolicy({ kind: 'update', noteType: 'agent', appendOnly: true }).disposition,
    'ask',
  );
});

test('a rule file is still never deleted without asking', () => {
  assert.equal(writePolicy({ kind: 'delete', noteType: 'skill' }).disposition, 'ask');
});

test('a kind nobody has graded asks, because asking cannot surprise anyone', () => {
  assert.equal(writePolicy({ kind: 'something-new' }).disposition, 'ask');
});

test('every ruling says why, in one sentence', () => {
  for (const kind of ['note', 'update', 'decision', 'outbound', 'delete']) {
    const { reason } = writePolicy({ kind });
    assert.ok(reason.length > 0, `${kind} has no reason`);
    assert.ok(reason.endsWith('.'), `${kind}'s reason is not a sentence`);
    assert.ok(!reason.includes('—'), `${kind}'s reason uses an em dash`);
  }
});

test('appliesSilently agrees with the ruling', () => {
  assert.equal(appliesSilently({ kind: 'note' }), true);
  assert.equal(appliesSilently({ kind: 'outbound' }), false);
  assert.equal(appliesSilently({ kind: 'update' }), false);
});
