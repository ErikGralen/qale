import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  writePolicy,
  appliesSilently,
  describeWritePolicy,
  isMachineryField,
  type WriteFacts,
} from '../src/index.js';

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

// Place is the first axis of the policy (docs/background-system.md ticket 2).
// These cases pin the two places against each other, one write at a time.

test('the same write reads differently in the two places', () => {
  for (const [kind, memory] of [
    ['note', 'silent'],
    ['update', 'grouped'],
    ['decision', 'grouped'],
  ] as const) {
    assert.equal(writePolicy({ kind, targetPath: 'notes/brief.md' }).disposition, 'ask', kind);
    assert.equal(writePolicy({ kind, targetPath: 'themes/pricing.md' }).disposition, memory, kind);
  }
});

test('the rules that hold everywhere hold in both places', () => {
  for (const targetPath of ['notes/brief.md', 'themes/pricing.md']) {
    assert.equal(writePolicy({ kind: 'outbound', targetPath }).disposition, 'ask', targetPath);
    assert.equal(writePolicy({ kind: 'delete', targetPath }).disposition, 'ask', targetPath);
    assert.equal(
      writePolicy({ kind: 'note', noteType: 'todo', targetPath }).disposition,
      'ask',
      targetPath,
    );
    assert.equal(
      writePolicy({ kind: 'note', noteType: 'skill', asked: true, targetPath }).disposition,
      'silent',
      targetPath,
    );
    assert.equal(
      writePolicy({ kind: 'note', noteType: 'skill', targetPath }).disposition,
      'ask',
      targetPath,
    );
    assert.equal(writePolicy({ kind: 'note', asked: true, targetPath }).disposition, 'silent');
  }
});

// The machinery exception: the fields a maintenance pass writes on its own.

test('the derived labels and the tags are known to the policy file', () => {
  for (const field of ['summary', 'summary_at', 'purpose_of', 'type', 'captured', 'tags']) {
    assert.equal(isMachineryField(field), true, field);
  }
  for (const field of ['title', 'due', 'status', 'participants']) {
    assert.equal(isMachineryField(field), false, field);
  }
});

// The Settings section reads the policy, so it can never say something the
// policy does not do (docs/background-system.md ticket 6).

test('the description covers both places, and says which is which', () => {
  const places = describeWritePolicy();
  assert.deepEqual(
    places.map((p) => p.place),
    ['documents', 'memory'],
  );
  assert.deepEqual(
    places.map((p) => p.title),
    ['In your documents', 'In its memory'],
  );
});

test('every row of the description is the policy answering for that place', () => {
  // The same list the description walks, in the same order. Two rows follow it:
  // the labels and the tags, which no pass asks the policy about.
  const writes: WriteFacts[] = [
    { kind: 'outbound' },
    { kind: 'delete' },
    { kind: 'note', noteType: 'todo' },
    { kind: 'update', noteType: 'skill', appendOnly: true, asked: true },
    { kind: 'note', noteType: 'skill' },
    { kind: 'note', asked: true },
    { kind: 'note' },
    { kind: 'update', appendOnly: true },
    { kind: 'update' },
    { kind: 'decision' },
  ];
  const paths = { documents: 'notes/pricing-brief.md', memory: 'themes/pricing.md' };

  for (const place of describeWritePolicy()) {
    assert.equal(place.rows.length, writes.length + 2, place.place);
    writes.forEach((facts, i) => {
      const row = place.rows[i]!;
      const ruling = writePolicy({ ...facts, targetPath: paths[place.place] });
      assert.equal(row.reason, ruling.reason, `${place.place} row ${i}`);
      assert.equal(row.disposition, ruling.disposition, `${place.place} row ${i}`);
    });
    for (const row of place.rows.slice(writes.length)) {
      assert.equal(row.disposition, 'silent', row.what);
    }
  }
});

test('every row of the description reads as one plain sentence', () => {
  for (const place of describeWritePolicy()) {
    for (const row of place.rows) {
      assert.ok(row.what.length > 0, 'a row says nothing');
      assert.ok(row.reason.endsWith('.'), `${row.what} has no sentence`);
      assert.ok(!row.what.includes('—') && !row.reason.includes('—'), `${row.what}: em dash`);
      for (const word of ['outbound', 'vault', 'frontmatter', 'proposal card', 'kind']) {
        assert.ok(!row.what.toLowerCase().includes(word), `${row.what} says "${word}"`);
      }
    }
  }
});
