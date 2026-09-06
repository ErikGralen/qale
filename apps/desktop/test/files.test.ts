import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  childFolders,
  docsAt,
  fileCount,
  folderKeys,
  folderMtimes,
  folderOf,
  sortFolders,
  visibleRows,
} from '../src/renderer/src/lib/files.js';
import {
  nextListSort,
  parseListSort,
  readListSort,
  sortDocuments,
  writeListSort,
  type ListSort,
} from '../src/renderer/src/lib/list-sort.js';

// The point of the split: none of this knows about `notes/`. Every case below
// runs over a different root.

// ---------------------------------------------------------------------------
// Folders over any directory
// ---------------------------------------------------------------------------

test('a file at the top of its directory is in no folder', () => {
  assert.equal(folderOf('decisions/2026-05-20-adopt-workos.md', 'decisions/'), '');
});

test('a file in a folder names it relative to that directory', () => {
  assert.equal(folderOf('tickets/jira/PAY-1.md', 'tickets/'), 'jira');
  assert.equal(folderOf('tickets/jira/2026/PAY-1.md', 'tickets/'), 'jira/2026');
});

test('a directory written without its slash means the same directory', () => {
  assert.equal(folderOf('tickets/jira/PAY-1.md', 'tickets'), 'jira');
});

test('a path already relative to the directory answers the same', () => {
  assert.equal(folderOf('jira/PAY-1.md', 'tickets/'), 'jira');
});

test('an index file alone makes its folder exist', () => {
  const folders = folderKeys(['tickets/jira/PAY-1.md', 'tickets/jira/index.md'], 'tickets/');
  assert.deepEqual(
    folders.map((f) => f.key),
    ['jira'],
  );
  assert.deepEqual(folders[0], { key: 'jira', name: 'jira', depth: 0 });
});

test('a parent always comes straight before its children', () => {
  const folders = folderKeys(
    ['tickets/jirax/a.md', 'tickets/jira/2026/b.md', 'tickets/jira/c.md'],
    'tickets/',
  );
  assert.deepEqual(
    folders.map((f) => f.key),
    ['jira', 'jira/2026', 'jirax'],
  );
  assert.deepEqual(
    folders.map((f) => f.depth),
    [0, 1, 0],
  );
});

test('childFolders gives one level, not the whole subtree', () => {
  const folders = folderKeys(
    ['tickets/jira/PAY-1.md', 'tickets/jira/2026/PAY-2.md', 'tickets/linear/index.md'],
    'tickets/',
  );
  assert.deepEqual(
    childFolders(folders, '').map((f) => f.key),
    ['jira', 'linear'],
  );
  assert.deepEqual(
    childFolders(folders, 'jira').map((f) => f.key),
    ['jira/2026'],
  );
});

test('docsAt gives the files at that level only, and never an index file', () => {
  const files = [
    { path: 'tickets/loose.md' },
    { path: 'tickets/jira/index.md' },
    { path: 'tickets/jira/PAY-1.md' },
    { path: 'tickets/jira/2026/PAY-2.md' },
  ];
  assert.deepEqual(
    docsAt(files, 'tickets/', '').map((f) => f.path),
    ['tickets/loose.md'],
  );
  assert.deepEqual(
    docsAt(files, 'tickets/', 'jira').map((f) => f.path),
    ['tickets/jira/PAY-1.md'],
  );
});

test('fileCount is recursive and never counts index files', () => {
  const paths = [
    'tickets/jira/index.md',
    'tickets/jira/PAY-1.md',
    'tickets/jira/2026/index.md',
    'tickets/jira/2026/PAY-2.md',
    'tickets/jirax/other.md',
  ];
  assert.equal(fileCount(paths, 'tickets/', 'jira'), 2);
  assert.equal(fileCount(paths, 'tickets/', 'jira/2026'), 1);
});

test('an empty folder counts 0, not 1', () => {
  assert.equal(fileCount(['tickets/jira/index.md'], 'tickets/', 'jira'), 0);
});

test('a folder is as new as the newest thing inside it, subfolders included', () => {
  const times = folderMtimes(
    [
      { path: 'tickets/jira/PAY-1.md', mtime: 200 },
      { path: 'tickets/jira/2026/PAY-2.md', mtime: 900 },
      // An index file is navigation: it must not date the folder.
      { path: 'tickets/linear/index.md', mtime: 9999 },
    ],
    'tickets/',
  );
  assert.equal(times.get('jira'), 900);
  assert.equal(times.get('jira/2026'), 900);
  assert.equal(times.get('linear'), undefined);
});

test('the level shows its folders first, then its files', () => {
  const paths = [
    'tickets/jira/index.md',
    'tickets/jira/PAY-1.md',
    'tickets/linear/index.md',
    'tickets/loose.md',
  ];
  const folders = folderKeys(paths, 'tickets/');
  const files = paths.map((path) => ({ path }));
  const rows = visibleRows(folders, files, 'tickets/', '', new Set(['jira']));
  assert.deepEqual(
    rows.map(
      (r) => '  '.repeat(r.depth) + (r.kind === 'folder' ? `${r.folder.key}/` : r.note.path),
    ),
    ['jira/', '  tickets/jira/PAY-1.md', 'linear/', 'tickets/loose.md'],
  );
});

test('folders sort by name and by time, both ways', () => {
  const paths = ['tickets/jira/PAY-1.md', 'tickets/linear/LIN-1.md'];
  const folders = folderKeys(paths, 'tickets/');
  const times = folderMtimes(
    [
      { path: 'tickets/jira/PAY-1.md', mtime: 100 },
      { path: 'tickets/linear/LIN-1.md', mtime: 400 },
    ],
    'tickets/',
  );
  assert.deepEqual(
    sortFolders(folders, { key: 'name', dir: 'desc' }, times).map((f) => f.key),
    ['linear', 'jira'],
  );
  assert.deepEqual(
    sortFolders(folders, { key: 'modified', dir: 'asc' }, times).map((f) => f.key),
    ['jira', 'linear'],
  );
});

// ---------------------------------------------------------------------------
// The remembered sort
// ---------------------------------------------------------------------------

const FALLBACK: ListSort = { key: 'updated', dir: 'desc' };

test('a stored sort survives, and anything else falls back', () => {
  assert.deepEqual(parseListSort('{"key":"state","dir":"asc"}', FALLBACK), {
    key: 'state',
    dir: 'asc',
  });
  assert.deepEqual(parseListSort(null, FALLBACK), FALLBACK);
  assert.deepEqual(parseListSort('not json', FALLBACK), FALLBACK);
  assert.deepEqual(parseListSort('{"key":"state","dir":"sideways"}', FALLBACK), FALLBACK);
});

test('a key the screen no longer has falls back', () => {
  // Mirrors added a State column. A build without one must not sort by it.
  assert.deepEqual(parseListSort('{"key":"state","dir":"asc"}', FALLBACK, ['name', 'updated']), {
    key: 'updated',
    dir: 'desc',
  });
});

test('a list still sorts where there is no localStorage at all', () => {
  // The packaged build runs from file://, and this test runner has none either.
  assert.equal(typeof localStorage, 'undefined');
  assert.deepEqual(readListSort('mirror.jira', FALLBACK), FALLBACK);
  assert.doesNotThrow(() => writeListSort('mirror.jira', { key: 'name', dir: 'asc' }));
});

test('clicking the sorted column turns it around', () => {
  assert.deepEqual(nextListSort({ key: 'name', dir: 'asc' }, 'name', 'asc'), {
    key: 'name',
    dir: 'desc',
  });
  assert.deepEqual(nextListSort({ key: 'name', dir: 'desc' }, 'name', 'asc'), {
    key: 'name',
    dir: 'asc',
  });
});

test('a fresh column opens the way the caller says it reads', () => {
  assert.deepEqual(nextListSort({ key: 'name', dir: 'asc' }, 'updated', 'desc'), {
    key: 'updated',
    dir: 'desc',
  });
  assert.deepEqual(nextListSort({ key: 'updated', dir: 'desc' }, 'name', 'asc'), {
    key: 'name',
    dir: 'asc',
  });
});

test('a column the sort does not know about orders by time', () => {
  // State sorting is the mirror's own job. The shared sort must still be stable.
  const rows = [
    { title: 'Beta', mtime: 300 },
    { title: 'Alpha', mtime: 100 },
  ];
  assert.deepEqual(
    sortDocuments(rows, { key: 'state', dir: 'desc' }).map((r) => r.title),
    ['Beta', 'Alpha'],
  );
});
