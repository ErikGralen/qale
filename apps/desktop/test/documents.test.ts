import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptsDocuments,
  childFolders,
  docCount,
  docsAt,
  documentDragData,
  documentFolder,
  documentFolders,
  draggedDocuments,
  folderMtimes,
  isDocument,
  nextDocumentSort,
  parseDocumentSort,
  sortDocuments,
  sortFolders,
  toggleExpanded,
  visibleRows,
  DEFAULT_SORT,
} from '../src/renderer/src/lib/documents.js';

test('a document is one by its path, not by its type', () => {
  assert.equal(isDocument('notes/q3-priorities.md'), true);
  assert.equal(isDocument('notes/specs/checkout.md'), true);
  // A note type the agent keeps for itself. It must never reach this screen.
  assert.equal(isDocument('understanding/product.md'), false);
  assert.equal(isDocument('insights/nordkap-needs-scim.md'), false);
  assert.equal(isDocument('notebooks/a.md'), false);
});

test('a document at the top of notes/ is in no folder', () => {
  assert.equal(documentFolder('notes/2026-09-02-scratch.md'), '');
});

test('a document in a folder names it relative to notes/', () => {
  assert.equal(documentFolder('notes/specs/checkout.md'), 'specs');
  assert.equal(documentFolder('notes/specs/2026/checkout.md'), 'specs/2026');
});

test('the folder rail is what the paths say, nothing else', () => {
  const folders = documentFolders([
    'notes/scratch.md',
    'notes/specs/checkout.md',
    'notes/briefs/q3.md',
  ]);
  assert.deepEqual(
    folders.map((f) => f.key),
    ['briefs', 'specs'],
  );
  assert.deepEqual(
    folders.map((f) => f.depth),
    [0, 0],
  );
});

test('a folder shows even when only a subfolder holds documents', () => {
  const folders = documentFolders(['notes/specs/2026/checkout.md']);
  assert.deepEqual(
    folders.map((f) => f.key),
    ['specs', 'specs/2026'],
  );
  assert.deepEqual(
    folders.map((f) => f.name),
    ['specs', '2026'],
  );
  assert.deepEqual(
    folders.map((f) => f.depth),
    [0, 1],
  );
});

test('a parent always comes straight before its children', () => {
  const folders = documentFolders([
    'notes/specsx/a.md',
    'notes/specs/2026/b.md',
    'notes/specs/c.md',
  ]);
  assert.deepEqual(
    folders.map((f) => f.key),
    ['specs', 'specs/2026', 'specsx'],
  );
});

test('no folder appears twice, however many documents it holds', () => {
  const folders = documentFolders(['notes/specs/a.md', 'notes/specs/b.md', 'notes/specs/c.md']);
  assert.equal(folders.length, 1);
});

test('an index file alone makes its folder exist', () => {
  // The empty-folder case: nothing in specs/ but the stub "New folder" wrote.
  const folders = documentFolders(['notes/specs/index.md', 'notes/scratch.md']);
  assert.deepEqual(
    folders.map((f) => f.key),
    ['specs'],
  );
});

test('childFolders gives one level, not the whole subtree', () => {
  const folders = documentFolders([
    'notes/briefs/index.md',
    'notes/specs/checkout.md',
    'notes/specs/2026/q3.md',
  ]);
  assert.deepEqual(
    childFolders(folders, '').map((f) => f.key),
    ['briefs', 'specs'],
  );
  assert.deepEqual(
    childFolders(folders, 'specs').map((f) => f.key),
    ['specs/2026'],
  );
  assert.deepEqual(childFolders(folders, 'specs/2026'), []);
});

test('a sibling with a shared prefix is not a child', () => {
  const folders = documentFolders(['notes/specs/a.md', 'notes/specsx/b.md']);
  assert.deepEqual(childFolders(folders, 'specs'), []);
});

test('docsAt gives the documents at that level only', () => {
  const notes = [
    { path: 'notes/scratch.md' },
    { path: 'notes/specs/checkout.md' },
    { path: 'notes/specs/2026/q3.md' },
  ];
  assert.deepEqual(
    docsAt(notes, '').map((n) => n.path),
    ['notes/scratch.md'],
  );
  assert.deepEqual(
    docsAt(notes, 'specs').map((n) => n.path),
    ['notes/specs/checkout.md'],
  );
});

test('docsAt never lists a folder index file', () => {
  const notes = [{ path: 'notes/specs/index.md' }, { path: 'notes/specs/checkout.md' }];
  assert.deepEqual(
    docsAt(notes, 'specs').map((n) => n.path),
    ['notes/specs/checkout.md'],
  );
});

test('docCount is recursive and never counts index files', () => {
  const paths = [
    'notes/scratch.md',
    'notes/specs/index.md',
    'notes/specs/checkout.md',
    'notes/specs/2026/index.md',
    'notes/specs/2026/q3.md',
    'notes/specsx/other.md',
  ];
  assert.equal(docCount(paths, 'specs'), 2);
  assert.equal(docCount(paths, 'specs/2026'), 1);
});

test('an empty folder counts 0, not 1', () => {
  assert.equal(docCount(['notes/briefs/index.md'], 'briefs'), 0);
});

test('a drag carries the documents it started with', () => {
  const paths = ['notes/scratch.md', 'notes/q3.md'];
  assert.deepEqual(draggedDocuments(documentDragData(paths)), paths);
});

test('a drag from anywhere else carries nothing', () => {
  // Every other draggable thing in the app hands over data of its own shape.
  assert.deepEqual(draggedDocuments({ ticket: 'NORD-14' }), []);
  assert.deepEqual(draggedDocuments({}), []);
});

test('the folder the documents are already in takes no drop', () => {
  assert.equal(acceptsDocuments(['notes/specs/checkout.md'], 'specs'), false);
  assert.equal(acceptsDocuments(['notes/scratch.md'], ''), false);
});

test('any other folder takes the drop', () => {
  assert.equal(acceptsDocuments(['notes/specs/checkout.md'], ''), true);
  assert.equal(acceptsDocuments(['notes/scratch.md'], 'specs'), true);
  // A drop into a subfolder of where they sit is a move like any other.
  assert.equal(acceptsDocuments(['notes/specs/checkout.md'], 'specs/2026'), true);
});

test('a mixed drag lands as long as one document would move', () => {
  const paths = ['notes/specs/checkout.md', 'notes/scratch.md'];
  assert.equal(acceptsDocuments(paths, 'specs'), true);
});

/** What the tree draws, one line per row: an indent, then folder/ or the file. */
function drawn(rows: ReturnType<typeof visibleRows<{ path: string }>>): string[] {
  return rows.map(
    (r) => '  '.repeat(r.depth) + (r.kind === 'folder' ? `${r.folder.key}/` : r.note.path),
  );
}

const TREE = [
  'notes/index.md',
  'notes/scratch.md',
  'notes/q3.md',
  'notes/specs/index.md',
  'notes/specs/checkout.md',
  'notes/specs/2026/q3-spec.md',
  'notes/briefs/index.md',
];
const TREE_FOLDERS = documentFolders(TREE);
const TREE_DOCS = TREE.filter((p) => !p.endsWith('/index.md')).map((path) => ({ path }));

test('the level shows its folders first, then its documents', () => {
  assert.deepEqual(drawn(visibleRows(TREE_FOLDERS, TREE_DOCS, '', new Set())), [
    'briefs/',
    'specs/',
    'notes/scratch.md',
    'notes/q3.md',
  ]);
});

test('the documents keep the order they were handed in', () => {
  const reversed = [...TREE_DOCS].reverse();
  const rows = visibleRows(TREE_FOLDERS, reversed, '', new Set());
  assert.deepEqual(
    rows.flatMap((r) => (r.kind === 'doc' ? [r.note.path] : [])),
    ['notes/q3.md', 'notes/scratch.md'],
  );
});

test('an expanded folder draws its children under it, one level in', () => {
  assert.deepEqual(drawn(visibleRows(TREE_FOLDERS, TREE_DOCS, '', new Set(['specs']))), [
    'briefs/',
    'specs/',
    '  specs/2026/',
    '  notes/specs/checkout.md',
    'notes/scratch.md',
    'notes/q3.md',
  ]);
});

test('expansion is recursive', () => {
  assert.deepEqual(
    drawn(visibleRows(TREE_FOLDERS, TREE_DOCS, '', new Set(['specs', 'specs/2026']))),
    [
      'briefs/',
      'specs/',
      '  specs/2026/',
      '    notes/specs/2026/q3-spec.md',
      '  notes/specs/checkout.md',
      'notes/scratch.md',
      'notes/q3.md',
    ],
  );
});

test('a folder the page is not standing in expands nothing', () => {
  // Keys from a level the PM left stay in the set. They must be inert.
  assert.deepEqual(drawn(visibleRows(TREE_FOLDERS, TREE_DOCS, 'specs', new Set(['briefs']))), [
    'specs/2026/',
    'notes/specs/checkout.md',
  ]);
});

test('an empty folder draws one row and nothing under it', () => {
  assert.deepEqual(drawn(visibleRows(TREE_FOLDERS, TREE_DOCS, 'briefs', new Set())), []);
});

test('a folder index never becomes a row', () => {
  const rows = visibleRows(
    TREE_FOLDERS,
    TREE.map((path) => ({ path })),
    '',
    new Set(['specs']),
  );
  assert.equal(
    rows.some((r) => r.kind === 'doc' && r.note.path.endsWith('/index.md')),
    false,
  );
});

// ---------------------------------------------------------------------------
// Sorting (the Finder header rail)
// ---------------------------------------------------------------------------

/** Four documents across two levels, deliberately out of both orders. */
const DOCS = [
  { path: 'notes/beta.md', title: 'Beta', mtime: 300 },
  { path: 'notes/alpha.md', title: 'Alpha', mtime: 100 },
  { path: 'notes/specs/checkout.md', title: 'Checkout', mtime: 200 },
  { path: 'notes/briefs/q3.md', title: 'Q3 brief', mtime: 400 },
];

const PATHS = [...DOCS.map((d) => d.path), 'notes/specs/index.md', 'notes/briefs/index.md'];

test('the default sort is newest first', () => {
  assert.deepEqual(DEFAULT_SORT, { key: 'modified', dir: 'desc' });
});

test('a stored sort survives, and anything else falls back to the default', () => {
  assert.deepEqual(parseDocumentSort('{"key":"name","dir":"asc"}'), { key: 'name', dir: 'asc' });
  assert.deepEqual(parseDocumentSort(null), DEFAULT_SORT);
  assert.deepEqual(parseDocumentSort('not json'), DEFAULT_SORT);
  // A key from a build that had a third column.
  assert.deepEqual(parseDocumentSort('{"key":"size","dir":"asc"}'), DEFAULT_SORT);
});

test('clicking a column picks it, clicking it again turns it around', () => {
  const modifiedNewest = { key: 'modified', dir: 'desc' } as const;
  assert.deepEqual(nextDocumentSort(modifiedNewest, 'name'), { key: 'name', dir: 'asc' });
  assert.deepEqual(nextDocumentSort(modifiedNewest, 'modified'), { key: 'modified', dir: 'asc' });
  assert.deepEqual(nextDocumentSort({ key: 'name', dir: 'asc' }, 'name'), {
    key: 'name',
    dir: 'desc',
  });
});

test('documents sort by name, both ways', () => {
  assert.deepEqual(
    sortDocuments(DOCS, { key: 'name', dir: 'asc' }).map((d) => d.title),
    ['Alpha', 'Beta', 'Checkout', 'Q3 brief'],
  );
  assert.deepEqual(
    sortDocuments(DOCS, { key: 'name', dir: 'desc' }).map((d) => d.title),
    ['Q3 brief', 'Checkout', 'Beta', 'Alpha'],
  );
});

test('documents sort by modified, both ways', () => {
  assert.deepEqual(
    sortDocuments(DOCS, { key: 'modified', dir: 'desc' }).map((d) => d.title),
    ['Q3 brief', 'Beta', 'Checkout', 'Alpha'],
  );
  assert.deepEqual(
    sortDocuments(DOCS, { key: 'modified', dir: 'asc' }).map((d) => d.title),
    ['Alpha', 'Checkout', 'Beta', 'Q3 brief'],
  );
});

test('two documents modified in the same second still have one order', () => {
  const tie = [
    { title: 'Beta', mtime: 500 },
    { title: 'Alpha', mtime: 500 },
  ];
  assert.deepEqual(
    sortDocuments(tie, { key: 'modified', dir: 'desc' }).map((d) => d.title),
    ['Alpha', 'Beta'],
  );
});

test('a folder is as new as the newest thing inside it, subfolders included', () => {
  const times = folderMtimes([
    { path: 'notes/specs/checkout.md', mtime: 200 },
    { path: 'notes/specs/2026/later.md', mtime: 900 },
    // An index file is navigation: it must not date the folder.
    { path: 'notes/briefs/index.md', mtime: 9999 },
  ]);
  assert.equal(times.get('specs'), 900);
  assert.equal(times.get('specs/2026'), 900);
  assert.equal(times.get('briefs'), undefined);
});

test('folders sort by name, both ways', () => {
  const folders = documentFolders(PATHS);
  const times = folderMtimes(DOCS);
  assert.deepEqual(
    sortFolders(folders, { key: 'name', dir: 'asc' }, times).map((f) => f.key),
    ['briefs', 'specs'],
  );
  assert.deepEqual(
    sortFolders(folders, { key: 'name', dir: 'desc' }, times).map((f) => f.key),
    ['specs', 'briefs'],
  );
});

test('folders sort by modified, both ways', () => {
  const folders = documentFolders(PATHS);
  const times = folderMtimes(DOCS);
  // briefs holds the 400, specs the 200.
  assert.deepEqual(
    sortFolders(folders, { key: 'modified', dir: 'desc' }, times).map((f) => f.key),
    ['briefs', 'specs'],
  );
  assert.deepEqual(
    sortFolders(folders, { key: 'modified', dir: 'asc' }, times).map((f) => f.key),
    ['specs', 'briefs'],
  );
});

test('folders stay above documents however the list is sorted', () => {
  const folders = documentFolders(PATHS);
  const times = folderMtimes(DOCS);
  for (const sort of [
    { key: 'name', dir: 'asc' },
    { key: 'name', dir: 'desc' },
    { key: 'modified', dir: 'asc' },
    { key: 'modified', dir: 'desc' },
  ] as const) {
    const rows = visibleRows(
      sortFolders(folders, sort, times),
      sortDocuments(DOCS, sort),
      '',
      new Set(),
    );
    const kinds = rows.map((r) => r.kind);
    const firstDoc = kinds.indexOf('doc');
    assert.ok(firstDoc > 0, `${sort.key}/${sort.dir}: no folder rows`);
    assert.ok(
      !kinds.slice(firstDoc).includes('folder'),
      `${sort.key}/${sort.dir}: a folder sank below a document`,
    );
  }
});

test('an expanded folder puts its own rows straight under it, still sorted', () => {
  const sort = { key: 'name', dir: 'asc' } as const;
  const folders = documentFolders(PATHS);
  const times = folderMtimes(DOCS);
  const rows = visibleRows(
    sortFolders(folders, sort, times),
    sortDocuments(DOCS, sort),
    '',
    new Set(['briefs']),
  );
  assert.deepEqual(
    rows.map((r) => (r.kind === 'folder' ? r.folder.key : r.note.title)),
    ['briefs', 'Q3 brief', 'specs', 'Alpha', 'Beta'],
  );
});

// ---------------------------------------------------------------------------
// What is open, which lives on the tab's view body
// ---------------------------------------------------------------------------

test('opening a folder in place adds it, clicking again takes it away', () => {
  assert.deepEqual(toggleExpanded([], 'specs'), ['specs']);
  assert.deepEqual(toggleExpanded(['specs'], 'specs'), []);
  // The other levels are untouched, so a tab keeps what it had open.
  assert.deepEqual(toggleExpanded(['briefs', 'specs'], 'specs'), ['briefs']);
  assert.deepEqual(toggleExpanded(['briefs'], 'specs'), ['briefs', 'specs']);
});

test('what is open is an array, so it can ride the tab view body', () => {
  // The view body is JSON-shaped state (it is persisted with the tab). A Set
  // would come back from a restart as `{}`.
  const expanded = toggleExpanded([], 'specs');
  assert.deepEqual(JSON.parse(JSON.stringify(expanded)), ['specs']);
});
