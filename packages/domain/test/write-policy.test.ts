import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  writePolicy,
  appliesSilently,
  describeWritePolicy,
  isMachineryField,
  isStyleFile,
  isUsersSphere,
  NEW_DOCUMENT_WAITS_REASON,
  STYLE_FILES,
  type WriteFacts,
} from '../src/index.js';

// The write policy (docs/fewer-approvals.md FA-1). What a write DOES decides,
// not where the file sits: a send, a delete, a rewrite of the PM's own prose,
// anything Qale assumed, and a new page in Documents wait for them. Everything
// else lands.

// What lands.

test('a meeting page written from a transcript lands', () => {
  assert.equal(
    writePolicy({ kind: 'note', noteType: 'meeting', targetPath: 'meetings/2026-09-02-standup.md' })
      .disposition,
    'silent',
  );
});

test('a todo lands, made, closed or moved', () => {
  assert.equal(writePolicy({ kind: 'note', noteType: 'todo' }).disposition, 'silent');
  assert.equal(
    writePolicy({ kind: 'update', noteType: 'todo', appendOnly: true }).disposition,
    'silent',
  );
  assert.equal(
    writePolicy({ kind: 'update', targetPath: 'todos/2026-09-07-send.md' }).disposition,
    'silent',
  );
  // Waiting-on is the same ledger, and nobody but the PM ever reads it.
  const ruling = writePolicy({ kind: 'note', targetPath: 'todos/2026-09-07-asa-scopes.md' });
  assert.equal(ruling.reason, 'Your list stays on your machine, for you to read.');
});

test('asked says nothing about a todo any more', () => {
  for (const asked of [true, false]) {
    assert.equal(
      writePolicy({ kind: 'note', noteType: 'todo', asked }).disposition,
      'silent',
      String(asked),
    );
  }
});

test('text added at the end of a document lands', () => {
  assert.equal(
    writePolicy({ kind: 'update', appendOnly: true, targetPath: 'notes/spec-pricing.md' })
      .disposition,
    'silent',
  );
  // An update that touches nothing the PM typed lands too, in their folder.
  assert.equal(
    writePolicy({ kind: 'update', targetPath: 'notes/spec-pricing.md' }).disposition,
    'silent',
  );
});

test('a page Qale files for itself lands, wherever the memory keeps it', () => {
  for (const path of [
    'insights/nordkap-needs-scim.md',
    'customers/nordkap.md',
    'people/vera-lund.md',
    'research/competitors.md',
    'about/product.md',
  ]) {
    assert.equal(writePolicy({ kind: 'note', targetPath: path }).disposition, 'silent', path);
  }
});

test('an edit to a page Qale keeps lands, rewritten or added to', () => {
  const page = { targetPath: 'customers/nordkap.md' };
  assert.equal(writePolicy({ kind: 'update', ...page }).disposition, 'silent');
  assert.equal(writePolicy({ kind: 'update', appendOnly: false, ...page }).disposition, 'silent');
  assert.equal(writePolicy({ kind: 'update', appendOnly: true, ...page }).disposition, 'silent');
});

test('a decision lands, because the spine supersedes rather than edits', () => {
  const ruling = writePolicy({ kind: 'decision', targetPath: 'decisions/adopt-workos.md' });
  assert.equal(ruling.disposition, 'silent');
  assert.equal(
    ruling.reason,
    "A decision is Qale's record. A wrong one is superseded by the next.",
  );
});

test("Qale's own skill and agent files land, asked for or not", () => {
  for (const noteType of ['skill', 'agent']) {
    assert.equal(writePolicy({ kind: 'note', noteType }).disposition, 'silent', noteType);
    assert.equal(
      writePolicy({ kind: 'update', noteType, targetPath: 'skills/arrival/SKILL.md' }).disposition,
      'silent',
      noteType,
    );
  }
  for (const targetPath of STYLE_FILES) {
    assert.equal(isStyleFile(targetPath), true, targetPath);
    assert.equal(
      writePolicy({ kind: 'note', noteType: 'skill', targetPath }).disposition,
      'silent',
      targetPath,
    );
  }
  // A voice is one of Qale's own files too, so the same answer with no rule of
  // its own.
  assert.equal(isStyleFile('voices/exec.md'), true);
  assert.equal(writePolicy({ kind: 'update', targetPath: 'voices/exec.md' }).disposition, 'silent');
});

test('a rule the PM stated keeps its own reason', () => {
  const ruling = writePolicy({
    kind: 'update',
    noteType: 'skill',
    appendOnly: true,
    asked: true,
    targetPath: 'skills/house-rules/SKILL.md',
  });
  assert.equal(ruling.disposition, 'silent');
  assert.equal(ruling.reason, 'You said it should hold from now on.');
});

test('what the PM asked for in the chat lands, wherever it goes', () => {
  for (const targetPath of ['notes/spec-pricing.md', 'research/pricing.md', undefined]) {
    assert.equal(
      writePolicy({ kind: 'update', asked: true, targetPath }).disposition,
      'silent',
      String(targetPath),
    );
  }
  assert.equal(writePolicy({ kind: 'decision', asked: true }).disposition, 'silent');
});

// What waits.

test('a send always waits', () => {
  for (const asked of [true, false]) {
    assert.equal(writePolicy({ kind: 'outbound', asked }).disposition, 'ask');
  }
  assert.equal(
    writePolicy({ kind: 'outbound' }).reason,
    'Nothing sent to another system can be taken back.',
  );
});

test('a delete always waits', () => {
  assert.equal(writePolicy({ kind: 'delete' }).disposition, 'ask');
  assert.equal(writePolicy({ kind: 'delete', asked: true }).disposition, 'ask');
  assert.equal(
    writePolicy({ kind: 'delete', targetPath: 'research/pricing.md' }).disposition,
    'ask',
  );
  assert.equal(writePolicy({ kind: 'delete', noteType: 'skill' }).disposition, 'ask');
});

test('a new document waits, and asked does not lift it', () => {
  for (const asked of [true, false]) {
    const ruling = writePolicy({ kind: 'note', targetPath: 'notes/spec-pricing.md', asked });
    assert.equal(ruling.disposition, 'ask', String(asked));
    assert.equal(ruling.reason, NEW_DOCUMENT_WAITS_REASON, String(asked));
  }
  // A folder the PM made under Documents is still Documents.
  assert.equal(
    writePolicy({ kind: 'note', targetPath: 'notes/pricing/brief.md' }).disposition,
    'ask',
  );
});

test('a new page Qale keeps for itself lands, because Documents is not its folder', () => {
  for (const targetPath of ['research/offline-mode.md', 'insights/nordkap-needs-scim.md']) {
    assert.equal(writePolicy({ kind: 'note', targetPath }).disposition, 'silent', targetPath);
  }
});

test('an existing document keeps the old rules, so an append still lands', () => {
  const page = { targetPath: 'notes/spec-pricing.md' };
  assert.equal(writePolicy({ kind: 'update', appendOnly: true, ...page }).disposition, 'silent');
  assert.equal(writePolicy({ kind: 'update', ...page }).disposition, 'silent');
  assert.equal(
    writePolicy({ kind: 'update', rewritesUserText: true, ...page }).disposition,
    'ask',
  );
  assert.equal(
    writePolicy({ kind: 'update', rewritesUserText: true, asked: true, ...page }).disposition,
    'silent',
  );
});

test('a rewrite of what the PM wrote waits, unless they asked for it', () => {
  const rewrite = { kind: 'update', rewritesUserText: true, targetPath: 'notes/runbook.md' };
  const ruling = writePolicy(rewrite);
  assert.equal(ruling.disposition, 'ask');
  assert.equal(ruling.reason, 'This rewrites what you wrote, so you see it first.');
  assert.equal(writePolicy({ ...rewrite, asked: true }).disposition, 'silent');
  // The same page, patched somewhere they never typed, lands.
  assert.equal(
    writePolicy({ kind: 'update', targetPath: 'notes/runbook.md' }).disposition,
    'silent',
  );
});

test('an assumption waits, everywhere, and asked does not clear it', () => {
  for (const facts of [
    { kind: 'note', assumed: true, targetPath: 'research/pricing.md' },
    { kind: 'update', assumed: true, targetPath: 'customers/nordkap.md' },
    { kind: 'note', assumed: true, noteType: 'todo' },
    { kind: 'update', assumed: true, noteType: 'skill', targetPath: STYLE_FILES[0] },
    { kind: 'update', assumed: true, asked: true, targetPath: 'research/pricing.md' },
  ]) {
    const ruling = writePolicy(facts);
    assert.equal(ruling.disposition, 'ask', JSON.stringify(facts));
    assert.equal(ruling.reason, 'Qale assumed something here, so it waits for you.');
  }
});

test('a kind nobody has graded waits, because asking cannot surprise anyone', () => {
  assert.equal(writePolicy({ kind: 'something-new' }).disposition, 'ask');
});

// A send and a delete never land, whatever else is true (docs/fewer-approvals.md,
// the constraint above the tickets). This walks every combination of facts the
// policy reads.

test('no combination of facts makes a send or a delete land', () => {
  const kinds = ['note', 'update', 'decision', 'outbound', 'delete'];
  const noteTypes = [undefined, 'note', 'todo', 'meeting', 'skill', 'agent', 'customer'];
  const paths = [
    undefined,
    'notes/runbook.md',
    'todos/2026-09-07-send.md',
    'meetings/2026-09-02-standup.md',
    'research/pricing.md',
    'skills/house-rules/SKILL.md',
  ];
  const flags = [true, false];
  let checked = 0;
  for (const kind of kinds) {
    for (const noteType of noteTypes) {
      for (const targetPath of paths) {
        for (const asked of flags) {
          for (const appendOnly of flags) {
            for (const rewritesUserText of flags) {
              for (const assumed of flags) {
                const facts: WriteFacts = {
                  kind,
                  noteType,
                  targetPath,
                  asked,
                  appendOnly,
                  rewritesUserText,
                  assumed,
                };
                const { disposition, reason } = writePolicy(facts);
                checked++;
                if (kind === 'outbound' || kind === 'delete') {
                  assert.equal(disposition, 'ask', JSON.stringify(facts));
                }
                assert.ok(reason.endsWith('.'), JSON.stringify(facts));
              }
            }
          }
        }
      }
    }
  }
  assert.equal(checked, kinds.length * noteTypes.length * paths.length * 2 * 2 * 2 * 2);
});

test('every ruling says why, in one plain sentence', () => {
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
  assert.equal(appliesSilently({ kind: 'note', targetPath: 'notes/brief.md' }), false);
  assert.equal(appliesSilently({ kind: 'note', targetPath: 'research/pricing.md' }), true);
  assert.equal(
    appliesSilently({ kind: 'update', rewritesUserText: true, targetPath: 'notes/brief.md' }),
    false,
  );
});

// The sidebar still draws the folder line, and reads this predicate for it.

test('the PM sphere is the three folders, and the three types', () => {
  for (const targetPath of ['notes/brief.md', 'todos/2026-09-07-send.md', 'meetings/x.md']) {
    assert.equal(isUsersSphere({ kind: 'note', targetPath }), true, targetPath);
  }
  for (const noteType of ['note', 'todo', 'meeting']) {
    assert.equal(isUsersSphere({ kind: 'note', noteType }), true, noteType);
  }
  for (const targetPath of ['research/pricing.md', 'decisions/adopt-workos.md', 'notebooks/x.md']) {
    assert.equal(isUsersSphere({ kind: 'note', targetPath }), false, targetPath);
  }
  assert.equal(isUsersSphere({ kind: 'note' }), false);
});

test('anything that only looks like a voice is not a style file', () => {
  for (const path of ['skills/jira/notes.md', 'notes/voices/exec.md', undefined, null]) {
    assert.equal(isStyleFile(path), false, String(path));
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

test('the description is the two answers, in the order lands, then waits', () => {
  const places = describeWritePolicy();
  assert.deepEqual(
    places.map((p) => p.place),
    ['lands', 'waits'],
  );
  assert.deepEqual(
    places.map((p) => p.title),
    ['What lands', 'What waits for you'],
  );
});

test('every row is on the list its answer names', () => {
  for (const place of describeWritePolicy()) {
    const expected = place.place === 'lands' ? 'silent' : 'ask';
    for (const row of place.rows) assert.equal(row.disposition, expected, row.what);
  }
});

test('the list that waits names the send, the delete, the document, the rewrite and the assumption', () => {
  const waits = describeWritePolicy().find((p) => p.place === 'waits')!;
  assert.equal(waits.rows.length, 5);
  assert.ok(waits.rows.some((r) => r.what.startsWith('Anything sent to')));
  assert.ok(waits.rows.some((r) => r.what.startsWith('Deleting a page')));
  assert.ok(waits.rows.some((r) => r.what.startsWith('A new document')));
  assert.ok(waits.rows.some((r) => r.what.startsWith('A rewrite of something you wrote')));
  assert.ok(waits.rows.some((r) => r.what.startsWith('Anything Qale had to assume')));
});

test('the list that lands names the meeting page, the to-do and the memory', () => {
  const lands = describeWritePolicy().find((p) => p.place === 'lands')!;
  assert.ok(lands.rows.some((r) => r.what.startsWith('A meeting page')));
  assert.ok(lands.rows.some((r) => r.what.startsWith('A to-do,')));
  assert.ok(lands.rows.some((r) => r.what.startsWith('A new page Qale keeps')));
  assert.ok(lands.rows.some((r) => r.what.startsWith('A decision written down')));
  // The document moved to the other list, so nothing here may claim it lands.
  assert.ok(!lands.rows.some((r) => r.what.startsWith('A new document')));
});

test('the two label rows sit with what lands', () => {
  const labels = (rows: { what: string }[]) =>
    rows.filter((r) => r.what.startsWith('The summary line') || r.what === 'The tags on a page');
  const [lands, waits] = describeWritePolicy();
  assert.equal(labels(lands!.rows).length, 2);
  assert.equal(labels(waits!.rows).length, 0);
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
