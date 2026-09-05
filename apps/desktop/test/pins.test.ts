import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NoteRefDTO, NoteType, VaultTreeDTO } from '@qale/ipc';
import { documentPins, memoryPins } from '../src/renderer/src/lib/pins.js';

const DAY = 86_400_000;
const NOW = new Date(2026, 8, 5, 9).getTime();

function note(path: string, type: NoteType, extra: Partial<NoteRefDTO> = {}): NoteRefDTO {
  const slug = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
  return {
    path,
    slug,
    type,
    title: slug,
    summary: '',
    mtime: NOW,
    ...extra,
  };
}

/** One group per type, the shape `vault:tree` returns. */
function tree(notes: NoteRefDTO[]): VaultTreeDTO {
  const byType = new Map<NoteType, NoteRefDTO[]>();
  for (const n of notes) byType.set(n.type, [...(byType.get(n.type) ?? []), n]);
  return {
    groups: [...byType].map(([type, rows]) => ({
      dir: `${type}s`,
      type,
      layer: 'authored' as VaultTreeDTO['groups'][number]['layer'],
      notes: rows,
    })),
  };
}

const DOC = note('notes/q3-priorities.md', 'note');
const DOC_IN_FOLDER = note('notes/specs/checkout.md', 'note', { mtime: NOW - DAY });
const FOLDER_INDEX = note('notes/specs/index.md', 'note');
const UNDERSTANDING = note('understanding/product.md', 'note');
const PERSON = note('people/lina-berg.md', 'person');
const THEME = note('themes/checkout-drop-off.md', 'theme', { mtime: NOW - DAY });
const TICKET = note('tickets/jira/PAY-142.md', 'ticket', { mtime: NOW - 2 * DAY });
const MEETING = note('meetings/2026-09-04-kranelund.md', 'meeting');
const TODO = note('todos/send-the-brief.md', 'todo');
const SESSION = note('sessions/2026-09-04-read.md', 'session');

const ALL = [
  DOC,
  DOC_IN_FOLDER,
  FOLDER_INDEX,
  UNDERSTANDING,
  PERSON,
  THEME,
  TICKET,
  MEETING,
  TODO,
  SESSION,
];
const EVERY_PATH = ALL.map((n) => n.path);

test('a pin goes to its own place: documents under Documents, memory under Memory', () => {
  const t = tree(ALL);
  assert.deepEqual(
    documentPins(t, EVERY_PATH).map((n) => n.path),
    [DOC.path, DOC_IN_FOLDER.path],
  );
  assert.deepEqual(
    memoryPins(t, EVERY_PATH).map((n) => n.path),
    [PERSON.path, THEME.path, TICKET.path],
  );
});

test('an understanding note is not a document: the path says so, not the type', () => {
  const paths = documentPins(tree(ALL), EVERY_PATH).map((n) => n.path);
  assert.ok(!paths.includes(UNDERSTANDING.path));
  assert.ok(!memoryPins(tree(ALL), EVERY_PATH).some((n) => n.path === UNDERSTANDING.path));
});

test('a folder index is navigation, so it never holds a row', () => {
  const paths = documentPins(tree([DOC, FOLDER_INDEX]), [DOC.path, FOLDER_INDEX.path]);
  assert.deepEqual(
    paths.map((n) => n.path),
    [DOC.path],
  );
});

test('Calendar owns a meeting, so it shows in neither list', () => {
  const t = tree(ALL);
  assert.ok(!documentPins(t, EVERY_PATH).some((n) => n.type === 'meeting'));
  assert.ok(!memoryPins(t, EVERY_PATH).some((n) => n.type === 'meeting'));
});

test('todos, sessions, skills and agents stay in the places that own them', () => {
  const t = tree(ALL);
  const shown = [...documentPins(t, EVERY_PATH), ...memoryPins(t, EVERY_PATH)].map((n) => n.type);
  for (const type of ['todo', 'session'] as const) assert.ok(!shown.includes(type), type);
});

test('each list is flat and most recent first', () => {
  const older = note('notes/old.md', 'note', { mtime: NOW - 5 * DAY });
  const newest = note('notes/new.md', 'note', { mtime: NOW });
  const middle = note('notes/middle.md', 'note', { mtime: NOW - DAY });
  const rows = documentPins(tree([older, newest, middle]), [older.path, newest.path, middle.path]);
  assert.deepEqual(
    rows.map((n) => n.path),
    [newest.path, middle.path, older.path],
  );
});

test('the frontmatter date wins over mtime when a page carries one', () => {
  const dated = note('themes/dated.md', 'theme', {
    mtime: NOW - 10 * DAY,
    date: new Date(NOW).toISOString(),
  });
  const rows = memoryPins(tree([THEME, dated]), [THEME.path, dated.path]);
  assert.deepEqual(
    rows.map((n) => n.path),
    [dated.path, THEME.path],
  );
});

test('nothing pinned, or no tree yet, is an empty list rather than a throw', () => {
  assert.deepEqual(documentPins(null, EVERY_PATH), []);
  assert.deepEqual(memoryPins(null, EVERY_PATH), []);
  assert.deepEqual(documentPins(tree(ALL), []), []);
  assert.deepEqual(memoryPins(tree(ALL), []), []);
});

test('a favourite the tree no longer holds drops out of both lists', () => {
  const t = tree([DOC, PERSON]);
  assert.deepEqual(
    documentPins(t, [DOC.path, 'notes/deleted.md']).map((n) => n.path),
    [DOC.path],
  );
  assert.deepEqual(
    memoryPins(t, [PERSON.path, 'people/gone.md']).map((n) => n.path),
    [PERSON.path],
  );
});
