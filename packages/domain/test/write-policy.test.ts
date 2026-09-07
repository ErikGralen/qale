import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  writePolicy,
  appliesSilently,
  describeWritePolicy,
  isMachineryField,
  isStyleFile,
  isUsersSphere,
  STYLE_FILES,
} from '../src/index.js';

// The write policy, two spheres (docs/review-rework.md RR-1). The PM's
// documents, todos and meetings wait for them; a send and a delete wait
// anywhere; everything else is Qale's memory and lands as it is written.

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

test('a page in the PM folders asks, whatever the write does', () => {
  for (const targetPath of [
    'notes/spec-pricing.md',
    'todos/2026-09-07-send-the-dates.md',
    'meetings/2026-09-02-standup.md',
  ]) {
    assert.equal(writePolicy({ kind: 'note', targetPath }).disposition, 'ask', targetPath);
    assert.equal(writePolicy({ kind: 'update', targetPath }).disposition, 'ask', targetPath);
    assert.equal(
      writePolicy({ kind: 'update', appendOnly: true, targetPath }).disposition,
      'ask',
      targetPath,
    );
  }
});

test('a meeting page asks, and so does the write-up added to it', () => {
  assert.equal(writePolicy({ kind: 'note', noteType: 'meeting' }).disposition, 'ask');
  assert.equal(
    writePolicy({
      kind: 'update',
      noteType: 'meeting',
      appendOnly: true,
      targetPath: 'meetings/2026-09-02-standup.md',
    }).disposition,
    'ask',
  );
});

test('a todo asks, made, closed or moved', () => {
  assert.equal(writePolicy({ kind: 'note', noteType: 'todo' }).disposition, 'ask');
  assert.equal(
    writePolicy({ kind: 'update', noteType: 'todo', appendOnly: true }).disposition,
    'ask',
  );
  assert.equal(
    writePolicy({ kind: 'update', targetPath: 'todos/2026-09-07-send.md' }).disposition,
    'ask',
  );
});

test('a folder that only starts like a PM folder is not one', () => {
  assert.equal(writePolicy({ kind: 'note', targetPath: 'notebooks/x.md' }).disposition, 'silent');
});

// Qale's memory: what it keeps for the PM. A page here costs them nothing to
// have, git commits it, and Activity puts it back, so it lands.

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

test('a research page written into Documents asks, because the folder wins over the type', () => {
  assert.equal(
    writePolicy({ kind: 'note', noteType: 'research', targetPath: 'notes/competitors.md' })
      .disposition,
    'ask',
  );
});

// The rules that hold in both spheres.

test('outbound always asks', () => {
  for (const asked of [true, false]) {
    assert.equal(writePolicy({ kind: 'outbound', asked }).disposition, 'ask');
  }
});

test('a delete always asks', () => {
  assert.equal(writePolicy({ kind: 'delete' }).disposition, 'ask');
  assert.equal(writePolicy({ kind: 'delete', asked: true }).disposition, 'ask');
  assert.equal(
    writePolicy({ kind: 'delete', targetPath: 'research/pricing.md' }).disposition,
    'ask',
  );
  assert.equal(writePolicy({ kind: 'delete', noteType: 'skill' }).disposition, 'ask');
});

test('what the PM asked for in the chat lands, in either sphere', () => {
  assert.equal(
    writePolicy({ kind: 'note', asked: true, targetPath: 'notes/spec-pricing.md' }).disposition,
    'silent',
  );
  assert.equal(
    writePolicy({ kind: 'update', asked: true, targetPath: 'notes/spec-pricing.md' }).disposition,
    'silent',
  );
  assert.equal(writePolicy({ kind: 'note', asked: true }).disposition, 'silent');
  assert.equal(writePolicy({ kind: 'decision', asked: true }).disposition, 'silent');
  // A todo they dictated is the exception: a promise asks whoever asked for it.
  assert.equal(writePolicy({ kind: 'note', noteType: 'todo', asked: true }).disposition, 'ask');
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
  // A voice sits in the memory too, so the same answer with no rule of its own.
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

test('anything that only looks like a voice is not a style file', () => {
  for (const path of ['skills/jira/notes.md', 'notes/voices/exec.md', undefined, null]) {
    assert.equal(isStyleFile(path), false, String(path));
  }
});

test('a kind nobody has graded asks, because asking cannot surprise anyone', () => {
  assert.equal(writePolicy({ kind: 'something-new' }).disposition, 'ask');
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
});

test('the same write reads differently in the two spheres', () => {
  for (const kind of ['note', 'update', 'decision']) {
    assert.equal(writePolicy({ kind, targetPath: 'notes/brief.md' }).disposition, 'ask', kind);
    assert.equal(
      writePolicy({ kind, targetPath: 'research/pricing.md' }).disposition,
      'silent',
      kind,
    );
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

test('the description covers both spheres, and says which is which', () => {
  const places = describeWritePolicy();
  assert.deepEqual(
    places.map((p) => p.place),
    ['yours', 'memory'],
  );
  assert.deepEqual(
    places.map((p) => p.title),
    ['Your documents, to-dos and meetings', "Qale's memory"],
  );
});

test('the PM sphere asks for everything but what they asked for', () => {
  const yours = describeWritePolicy().find((p) => p.place === 'yours')!;
  const asks = yours.rows.filter((r) => r.disposition === 'ask');
  assert.equal(asks.length, 4);
  assert.ok(yours.rows.some((r) => r.what.startsWith('Anything sent to')));
  assert.ok(yours.rows.some((r) => r.what.startsWith('Deleting a page')));
  const asked = yours.rows.find((r) => r.what.startsWith('A page or an edit you asked for'))!;
  assert.equal(asked.disposition, 'silent');
});

test('every row of the memory list lands', () => {
  const memory = describeWritePolicy().find((p) => p.place === 'memory')!;
  for (const row of memory.rows) {
    assert.equal(row.disposition, 'silent', row.what);
  }
});

test('the two label rows are on both lists', () => {
  for (const place of describeWritePolicy()) {
    const labels = place.rows.filter(
      (r) => r.what.startsWith('The summary line') || r.what === 'The tags on a page',
    );
    assert.equal(labels.length, 2, place.place);
    for (const row of labels) assert.equal(row.disposition, 'silent', row.what);
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
