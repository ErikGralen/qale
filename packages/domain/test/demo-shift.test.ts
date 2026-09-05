import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ANCHOR,
  appDbBasename,
  copyVault,
  daysBetween,
  extractLinks,
  shiftDate,
  shiftFile,
  shiftProse,
  shiftVaultDates,
  todoLanes,
  validateVault,
} from '../src/demo/shift.js';

/**
 * The date shift the demo runs on (docs/demo-mode.md DM-9). Two callers share
 * it: `scripts/refresh-demo.ts` and the demo build's Reset. What these tests
 * pin is the part a caller cannot see it get wrong — a link whose slug carries
 * a date, a frontmatter key that holds a reference rather than a date.
 */

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'qale-shift-'));
}

test('daysBetween counts whole days, either direction', () => {
  assert.equal(daysBetween('2026-07-17', '2026-07-17'), 0);
  assert.equal(daysBetween('2026-07-17', '2026-07-25'), 8);
  assert.equal(daysBetween('2026-07-25', '2026-07-17'), -8);
  // Across a DST change in Europe, where a local-time subtraction is off by one.
  assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2);
});

test('shiftDate crosses month and year ends', () => {
  assert.equal(shiftDate('2026-07-31', 1), '2026-08-01');
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
});

test('a date inside a wikilink is never shifted', () => {
  const { out, count } = shiftProse(
    'See [[meetings/2026-07-14-nordkap-checkin]], agreed 2026-07-14.',
    10,
  );
  assert.equal(out, 'See [[meetings/2026-07-14-nordkap-checkin]], agreed 2026-07-24.');
  assert.equal(count, 1);
});

test('shiftFile moves date keys and prose keys, and leaves reference keys alone', () => {
  const raw = [
    '---',
    'type: todo',
    'due: 2026-07-20',
    'summary: SSO answer owed 2026-07-20',
    'sources:',
    '  - meetings/2026-07-14-nordkap-checkin',
    '---',
    '',
    'Due 2026-07-20, see [[meetings/2026-07-14-nordkap-checkin]].',
  ].join('\n');
  const { text, fm, body } = shiftFile(raw, 7);
  assert.match(text, /due: 2026-07-27/);
  assert.match(text, /summary: SSO answer owed 2026-07-27/);
  // A `sources:` list item is a slug, not a date: it must survive byte-exact.
  assert.match(text, /- meetings\/2026-07-14-nordkap-checkin/);
  assert.match(text, /Due 2026-07-27, see \[\[meetings\/2026-07-14-nordkap-checkin\]\]/);
  assert.equal(fm, 2);
  assert.equal(body, 1);
});

test('shiftFile keeps the time of day on a full ISO timestamp', () => {
  const { text } = shiftFile('---\ntype: ticket\nremote_updated: 2026-07-17T09:30:00Z\n---\n', 3);
  assert.match(text, /remote_updated: 2026-07-20T09:30:00Z/);
});

test('a file with no frontmatter still shifts its prose', () => {
  const { text, fm, body } = shiftFile('Standup on 2026-07-17.\n', 2);
  assert.equal(text, 'Standup on 2026-07-19.\n');
  assert.equal(fm, 0);
  assert.equal(body, 1);
});

test('a wikilink inside a fence is not a reference', () => {
  assert.deepEqual(extractLinks('```\n[[people/…]]\n```\n[[people/tom-devlin]]'), [
    'people/tom-devlin',
  ]);
  // Alias, anchor and a typed prefix all resolve to the bare target.
  assert.deepEqual(extractLinks('[[owns::tickets/PAY-1|the epic#top]]'), ['tickets/PAY-1']);
});

test('appDbBasename is the app rule: 12 hex chars of sha256(root)', () => {
  const name = appDbBasename('/tmp/workspace');
  assert.match(name, /^app-[0-9a-f]{12}\.db$/);
  assert.equal(appDbBasename('/tmp/workspace'), name);
  assert.notEqual(appDbBasename('/tmp/other'), name);
});

test('copyVault leaves the sessions folder empty, and shiftVaultDates skips it', () => {
  const root = scratch();
  try {
    const source = join(root, 'src');
    mkdirSync(join(source, 'notes'), { recursive: true });
    mkdirSync(join(source, 'sessions', 'abc'), { recursive: true });
    writeFileSync(join(source, 'notes', 'a.md'), '---\ntype: note\ndate: 2026-07-17\n---\n');
    writeFileSync(join(source, 'sessions', 'abc', 'brief.md'), 'Ran 2026-07-17.\n');

    const target = join(root, 'out');
    copyVault(source, target);
    assert.deepEqual(
      readFileSync(join(target, 'notes', 'a.md'), 'utf8'),
      '---\ntype: note\ndate: 2026-07-17\n---\n',
    );
    assert.equal(
      // The session's own folder must not have come along.
      validateVault(target).noteCount,
      1,
    );

    const result = shiftVaultDates(target, 5);
    assert.equal(result.filesTouched, 1);
    assert.equal(result.fm, 1);
    assert.match(readFileSync(join(target, 'notes', 'a.md'), 'utf8'), /date: 2026-07-22/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('shiftVaultDates with write off counts but writes nothing', () => {
  const root = scratch();
  try {
    mkdirSync(join(root, 'notes'), { recursive: true });
    const file = join(root, 'notes', 'a.md');
    writeFileSync(file, '---\ntype: note\ndate: 2026-07-17\n---\n');
    const result = shiftVaultDates(root, 5, false);
    assert.equal(result.filesTouched, 1);
    assert.match(readFileSync(file, 'utf8'), /date: 2026-07-17/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validateVault names the broken link and the note with no type', () => {
  const root = scratch();
  try {
    mkdirSync(join(root, 'notes'), { recursive: true });
    writeFileSync(
      join(root, 'notes', 'a.md'),
      '---\ntype: note\n---\n[[notes/b]] [[notes/gone]]\n',
    );
    writeFileSync(join(root, 'notes', 'b.md'), '---\nsummary: no type here\n---\n');
    const { unresolved, untyped, noteCount } = validateVault(root);
    assert.equal(noteCount, 2);
    assert.deepEqual(untyped, ['notes/b.md']);
    assert.equal(unresolved.length, 1);
    assert.match(unresolved[0]!, /notes\/gone/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('todoLanes reads the lane a due date lands in', () => {
  const root = scratch();
  try {
    mkdirSync(join(root, 'todos'), { recursive: true });
    const todo = (name: string, fm: string): void =>
      writeFileSync(join(root, 'todos', `${name}.md`), `---\ntype: todo\n${fm}\n---\n`);
    todo('late', "due: '2026-07-10'");
    todo('now', 'due: 2026-07-17');
    todo('soon', 'due: 2026-07-30');
    todo('nodate', 'title: someday');
    todo('theirs', 'due: 2026-07-30\nowner: tom');
    todo('done', 'due: 2026-07-10\ncommitment: kept');
    assert.deepEqual(todoLanes(root, ANCHOR), {
      overdue: 1,
      today: 1,
      upcoming: 1,
      someday: 1,
      waiting: 1,
      closed: 1,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
