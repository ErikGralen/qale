import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  writePolicy,
  appliesSilently,
  describeWritePolicy,
  isMachineryField,
  isStyleFile,
  STYLE_FILES,
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
    'research/competitors.md',
    'about/product.md',
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
    writePolicy({ kind: 'update', appendOnly: true, targetPath: 'research/pricing.md' })
      .disposition,
    'silent',
  );
});

// Research is the folder for the pages Qale keeps for itself (docs/memory-types.md
// MT-5): the case for a problem, a competitor scan. About is the folder for what
// is true about the PM and the company (docs/learning-how-you-work.md, ticket
// 16). Both sit in Memory, so the policy needs no rule of its own for either.
// These cases say so.

test('a new research page lands without a card', () => {
  assert.equal(
    writePolicy({ kind: 'note', noteType: 'research', targetPath: 'research/competitors.md' })
      .disposition,
    'silent',
  );
});

test('a research page that is rewritten is grouped, and one that only grows is silent', () => {
  const page = { noteType: 'research', targetPath: 'research/competitors.md' };
  assert.equal(writePolicy({ kind: 'update', ...page }).disposition, 'grouped');
  assert.equal(writePolicy({ kind: 'update', appendOnly: false, ...page }).disposition, 'grouped');
  assert.equal(writePolicy({ kind: 'update', appendOnly: true, ...page }).disposition, 'silent');
});

test('a research page written into Documents asks, because the folder wins over the type', () => {
  assert.equal(
    writePolicy({ kind: 'note', noteType: 'research', targetPath: 'notes/competitors.md' })
      .disposition,
    'ask',
  );
  assert.equal(
    writePolicy({
      kind: 'update',
      noteType: 'research',
      appendOnly: true,
      targetPath: 'notes/competitors.md',
    }).disposition,
    'ask',
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

// Qale's own notes on how the PM works (docs/learning-how-you-work.md, ticket 5):
// the Jira and Confluence files written from their own tickets and pages, and a
// voice rewritten after a style pick. The file is the record, so no card.

test('the style files Qale writes from a first read land without a card', () => {
  for (const targetPath of STYLE_FILES) {
    assert.equal(isStyleFile(targetPath), true, targetPath);
    const ruling = writePolicy({ kind: 'note', noteType: 'skill', targetPath });
    assert.equal(ruling.disposition, 'silent', targetPath);
    assert.equal(ruling.reason, "Qale's own notes about how you work, and the file is the record.");
    // Filling the sections in later is the same notebook.
    assert.equal(
      writePolicy({ kind: 'update', noteType: 'skill', targetPath }).disposition,
      'silent',
      targetPath,
    );
  }
});

test('a voice changed by a style pick lands without a card', () => {
  assert.equal(isStyleFile('voices/exec.md'), true);
  assert.equal(isStyleFile('voices/cs.md'), true);
  assert.equal(writePolicy({ kind: 'update', targetPath: 'voices/exec.md' }).disposition, 'silent');
  assert.equal(writePolicy({ kind: 'note', targetPath: 'voices/exec.md' }).disposition, 'silent');
});

test('a rule the PM stated into a style file keeps its own reason', () => {
  const ruling = writePolicy({
    kind: 'update',
    noteType: 'skill',
    appendOnly: true,
    asked: true,
    targetPath: 'skills/jira/SKILL.md',
  });
  assert.equal(ruling.disposition, 'silent');
  assert.equal(ruling.reason, 'You said it should hold from now on.');
});

test('a style file is still never deleted without asking', () => {
  for (const targetPath of [...STYLE_FILES, 'voices/exec.md']) {
    assert.equal(writePolicy({ kind: 'delete', targetPath }).disposition, 'ask', targetPath);
  }
});

test('any other skill, and anything that only looks like a voice, is not a style file', () => {
  for (const path of [
    'skills/arrival/SKILL.md',
    'skills/house-rules/SKILL.md',
    'skills/jira/notes.md',
    'notes/voices/exec.md',
    undefined,
    null,
  ]) {
    assert.equal(isStyleFile(path), false, String(path));
  }
  assert.equal(
    writePolicy({ kind: 'note', noteType: 'skill', targetPath: 'skills/arrival/SKILL.md' })
      .disposition,
    'ask',
  );
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
    assert.equal(
      writePolicy({ kind, targetPath: 'research/pricing.md' }).disposition,
      memory,
      kind,
    );
  }
});

test('the rules that hold everywhere hold in both places', () => {
  for (const targetPath of ['notes/brief.md', 'research/pricing.md']) {
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
  // the labels and the tags, which no pass asks the policy about. The style
  // files live in Memory, so their row is asked about its own path and is
  // listed there only.
  const writes: WriteFacts[] = [
    { kind: 'outbound' },
    { kind: 'delete' },
    { kind: 'note', noteType: 'todo' },
    { kind: 'update', noteType: 'skill', appendOnly: true, asked: true },
    { kind: 'note', noteType: 'skill' },
    { kind: 'note', noteType: 'skill', targetPath: 'skills/jira/SKILL.md' },
    { kind: 'note', asked: true },
    { kind: 'note' },
    { kind: 'update', appendOnly: true },
    { kind: 'update' },
    { kind: 'decision' },
  ];
  const paths = { documents: 'notes/pricing-brief.md', memory: 'research/pricing.md' };

  for (const place of describeWritePolicy()) {
    const expected = writes.filter((w) => place.place === 'memory' || !w.targetPath);
    assert.equal(place.rows.length, expected.length + 2, place.place);
    expected.forEach((facts, i) => {
      const row = place.rows[i]!;
      const ruling = writePolicy({ ...facts, targetPath: facts.targetPath ?? paths[place.place] });
      assert.equal(row.reason, ruling.reason, `${place.place} row ${i}`);
      assert.equal(row.disposition, ruling.disposition, `${place.place} row ${i}`);
    });
    for (const row of place.rows.slice(expected.length)) {
      assert.equal(row.disposition, 'silent', row.what);
    }
  }
});

test('the Settings section names the notes Qale keeps on how the PM writes', () => {
  const memory = describeWritePolicy().find((p) => p.place === 'memory')!;
  const row = memory.rows.find((r) => r.what.startsWith('The notes Qale keeps'))!;
  assert.ok(row, 'no row for the style files');
  assert.equal(row.disposition, 'silent');
  assert.equal(row.reason, "Qale's own notes about how you work, and the file is the record.");
  const documents = describeWritePolicy().find((p) => p.place === 'documents')!;
  assert.equal(
    documents.rows.some((r) => r.what.startsWith('The notes Qale keeps')),
    false,
  );
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
