import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isReservedFile,
  isFolderIndex,
  renderFolderIndex,
  renderRootIndex,
  documentFolderPurpose,
  dayOf,
  OKF_VERSION,
  type IndexEntry,
  type IndexFolder,
} from '../src/index.js';

/**
 * OKF §8 index.md rendering + §3.1 reserved-filename handling
 * (OKF alignment, phase 1). Pure builders, so asserted on their exact
 * output — the app compares generated content byte-for-byte to decide whether to
 * rewrite, so format stability is a real contract here.
 */

test('isReservedFile matches index.md/log.md at root and in folders; isFolderIndex only folder hubs', () => {
  assert.equal(isReservedFile('index.md'), true);
  assert.equal(isReservedFile('log.md'), true);
  assert.equal(isReservedFile('insights/index.md'), true);
  assert.equal(isReservedFile('decisions/log.md'), true);
  assert.equal(isReservedFile('insights/acme.md'), false);
  assert.equal(isReservedFile('notes/index-of-things.md'), false);
  // Root index.md is reserved but is NOT a folder hub — the older predicate misses it.
  assert.equal(isFolderIndex('index.md'), false);
  assert.equal(isReservedFile('index.md'), true);
});

test('renderFolderIndex groups by lifecycle, projects summary to description, sorts by title', () => {
  const folder: IndexFolder = {
    dir: 'insights',
    label: 'Insights',
    purpose: 'analyses over the raw layer',
    entries: [
      {
        path: 'insights/zeta.md',
        title: 'Zeta',
        description: 'Zeta wants SSO.',
        lifecycle: 'processed',
      },
      {
        path: 'insights/acme.md',
        title: 'Acme',
        description: 'Acme wants SCIM.',
        lifecycle: 'processed',
      },
      {
        path: 'insights/old.md',
        title: 'Old finding',
        description: 'No longer holds.',
        lifecycle: 'stale',
      },
    ],
  };
  const out = renderFolderIndex(folder);
  assert.match(out, /^---\ndescription: Insights — analyses over the raw layer\n---\n/);
  assert.match(out, /# Insights/);
  // "Gone through" precedes Stale (attention-first order), Acme before Zeta (title sort).
  const processed = out.indexOf('## Gone through');
  const stale = out.indexOf('## Stale');
  assert.ok(processed > 0 && stale > processed, '"Gone through" section comes before Stale');
  assert.ok(out.indexOf('[Acme]') < out.indexOf('[Zeta]'), 'entries sort by title');
  // Description projected from summary, entry links are vault-relative.
  assert.match(out, /\* \[Acme\]\(insights\/acme\.md\) — Acme wants SCIM\./);
});

test('renderFolderIndex with no lifecycle values renders one flat list', () => {
  const folder: IndexFolder = {
    dir: 'people',
    label: 'People',
    purpose: 'people the work touches',
    entries: [
      { path: 'people/asa.md', title: 'Åsa', description: 'VP Eng at Nordkap.' },
      { path: 'people/jonas.md', title: 'Jonas', description: 'PM at Kranelund.' },
    ],
  };
  const out = renderFolderIndex(folder);
  assert.doesNotMatch(out, /## /, 'no subsections when nothing carries a lifecycle');
  assert.match(out, /\* \[Jonas\]\(people\/jonas\.md\) — PM at Kranelund\./);
});

test('renderRootIndex stamps okf_version, links non-empty folders with counts', () => {
  const folders: IndexFolder[] = [
    {
      dir: 'decisions',
      label: 'Decisions',
      purpose: 'the append-only decision spine',
      entries: [
        { path: 'decisions/a.md', title: 'A', description: 'x', lifecycle: 'active' },
        { path: 'decisions/b.md', title: 'B', description: 'y', lifecycle: 'active' },
      ],
    },
    { dir: 'notes', label: 'Notes', purpose: 'authored notes', entries: [] },
  ];
  const out = renderRootIndex(folders, 'vault-dev');
  assert.match(out, new RegExp(`okf_version: "${OKF_VERSION}"`));
  assert.match(out, /# vault-dev/);
  assert.match(
    out,
    /\* \[Decisions\]\(decisions\/index\.md\) — the append-only decision spine \(2\)/,
  );
  assert.doesNotMatch(out, /Notes/, 'empty folders are omitted from the root map');
});

test('renderRootIndex lists notes once, counting every document under it', () => {
  const folders: IndexFolder[] = [
    {
      dir: 'notes',
      label: 'Notes',
      purpose: 'the documents you write',
      entries: [{ path: 'notes/scratch.md', title: 'Scratch', description: 's' }],
      subfolders: [{ dir: 'notes/specs', label: 'Specs', purpose: 'p', count: 2 }],
    },
    {
      dir: 'notes/specs',
      label: 'Specs',
      purpose: 'p',
      entries: [
        { path: 'notes/specs/a.md', title: 'A', description: 'a' },
        { path: 'notes/specs/b.md', title: 'B', description: 'b' },
      ],
      subfolders: [],
    },
  ];
  const out = renderRootIndex(folders, 'vault-dev');
  assert.match(out, /\* \[Notes\]\(notes\/index\.md\) — the documents you write \(3\)/);
  assert.doesNotMatch(
    out,
    /notes\/specs\/index\.md/,
    'subfolders are reached through notes/index.md',
  );
  assert.equal(out.match(/\(notes\/index\.md\)/g)?.length, 1);
});

test('renderers collapse newlines in titles/descriptions so a row never breaks', () => {
  const out = renderFolderIndex({
    dir: 'notes',
    label: 'Notes',
    purpose: 'x',
    entries: [{ path: 'notes/a.md', title: 'Multi\nline', description: 'a\n\nb' }],
  });
  assert.match(out, /\* \[Multi line\]\(notes\/a\.md\) — a b/);
});

/* IM-1, IM-4, IM-10: the meetings map. */

function meeting(date: string | undefined, slug: string, extra: Partial<IndexEntry> = {}) {
  return {
    path: `meetings/${slug}.md`,
    title: slug,
    description: `about ${slug}`,
    ...(date !== undefined ? { date } : {}),
    ...extra,
  } satisfies IndexEntry;
}

const meetingsFolder = (entries: IndexEntry[]): IndexFolder => ({
  dir: 'meetings',
  label: 'Meetings',
  purpose: 'meeting pages',
  entries,
});

test('meetings group by month, newest month first, newest meeting first, date on every line', () => {
  const out = renderFolderIndex(
    meetingsFolder([
      meeting('2026-07-02', 'july-early'),
      meeting('2026-08-10', 'aug'),
      meeting('2026-07-14', 'july-late'),
    ]),
    { today: '2026-09-05' },
  );
  const aug = out.indexOf('## 2026-08');
  const jul = out.indexOf('## 2026-07');
  assert.ok(aug > 0 && jul > aug, 'newest month first');
  assert.ok(out.indexOf('2026-07-14 [july-late]') < out.indexOf('2026-07-02 [july-early]'));
  assert.match(out, /\* 2026-08-10 \[aug\]\(meetings\/aug\.md\) — about aug\n/);
  assert.doesNotMatch(out, /Undated/);
});

test('meetings older than two months before this one collapse to one line; upcoming stay full', () => {
  const out = renderFolderIndex(
    meetingsFolder([
      meeting('2026-03-03', 'march-a'),
      meeting('2026-03-20', 'march-b'),
      meeting('2026-06-30', 'june'),
      meeting('2026-07-01', 'july'),
      meeting('2026-09-30', 'this-month'),
      meeting('2027-01-15', 'next-year'),
    ]),
    { today: '2026-09-05' },
  );
  assert.match(out, /^## 2026-03 \(2 meetings, use vault_list since\/until\)$/m);
  assert.match(out, /^## 2026-06 \(1 meeting, use vault_list since\/until\)$/m);
  assert.doesNotMatch(out, /march-a|march-b|\[june\]/, 'collapsed months list no lines');
  assert.match(out, /## 2026-07\n\n\* 2026-07-01 \[july\]/, 'two months back is still full');
  assert.match(out, /## 2027-01\n\n\* 2027-01-15 \[next-year\]/, 'upcoming months are full');
  assert.ok(out.indexOf('## 2027-01') < out.indexOf('## 2026-09'));
});

test('the collapse window is the same on every day of a month, and crosses a year boundary', () => {
  const entries = [meeting('2025-11-05', 'nov'), meeting('2025-10-05', 'oct')];
  const a = renderFolderIndex(meetingsFolder(entries), { today: '2026-01-01' });
  const b = renderFolderIndex(meetingsFolder(entries), { today: '2026-01-31' });
  assert.equal(a, b, 'byte-identical within a month');
  assert.match(a, /## 2025-11\n\n\* 2025-11-05/, 'November is inside the window from January');
  assert.match(a, /^## 2025-10 \(1 meeting/m, 'October is outside it');
});

test('a meeting with no date, or a date that is not a day, goes under Undated at the end', () => {
  const out = renderFolderIndex(
    meetingsFolder([
      meeting(undefined, 'no-date'),
      meeting('sometime in July', 'vague'),
      meeting('2026-09-01', 'dated'),
    ]),
    { today: '2026-09-05' },
  );
  assert.ok(out.indexOf('## Undated') > out.indexOf('## 2026-09'));
  assert.match(
    out,
    /## Undated\n\n\* \[no-date\]\(meetings\/no-date\.md\) — about no-date\n\* \[vague\]/,
  );
});

test('a meeting line ends with the resolved customer as a path link and the series slug', () => {
  const out = renderFolderIndex(
    meetingsFolder([
      meeting('2026-09-01', 'checkin', {
        customer: { title: 'Nordkap Payments', path: 'customers/nordkap-payments.md' },
        series: 'nordkap-checkin',
      }),
      meeting('2026-09-02', 'lost-link', { customer: { title: 'customers/gone' } }),
    ]),
    { today: '2026-09-05' },
  );
  assert.match(
    out,
    /\* 2026-09-01 \[checkin\]\(meetings\/checkin\.md\) — about checkin \(customer: \[Nordkap Payments\]\(customers\/nordkap-payments\.md\)\) \(series: nordkap-checkin\)/,
  );
  assert.match(out, /\(customer: customers\/gone\)/, 'an unresolved link prints its bare target');
  assert.doesNotMatch(out, /\[\[/, 'a map never prints a wikilink');
});

test('without today the meetings map lists every month in full', () => {
  const out = renderFolderIndex(meetingsFolder([meeting('2020-01-01', 'old')]));
  assert.match(out, /## 2020-01\n\n\* 2020-01-01 \[old\]/);
});

/* IM-2: the todos map. */

test('open todos sort by due date, undated last, with the due day and owner on the line', () => {
  const sara = { title: 'Sara Lindqvist', path: 'people/sara-lindqvist.md' };
  const out = renderFolderIndex({
    dir: 'todos',
    label: 'Todos',
    purpose: 'tracked commitments',
    entries: [
      { path: 'todos/z.md', title: 'Zed', description: 'z', lifecycle: 'open', due: '2026-07-20' },
      { path: 'todos/a.md', title: 'Alpha', description: 'a', lifecycle: 'open' },
      {
        path: 'todos/s.md',
        title: 'Scope',
        description: 'send it',
        lifecycle: 'open',
        due: '2026-07-16',
        owner: sara,
      },
      {
        path: 'todos/f.md',
        title: 'Friday',
        description: 'f',
        lifecycle: 'open',
        due: 'next Friday',
      },
      {
        path: 'todos/d.md',
        title: 'Done thing',
        description: 'd',
        lifecycle: 'done',
        due: '2026-01-01',
      },
      { path: 'todos/x.md', title: 'Dropped thing', description: 'x', lifecycle: 'dropped' },
    ],
  });
  const open = out.slice(out.indexOf('## Open'), out.indexOf('## Done'));
  const lines = open.trim().split('\n').slice(2);
  assert.deepEqual(lines, [
    '* due 2026-07-16 · [Sara Lindqvist](people/sara-lindqvist.md) — [Scope](todos/s.md) — send it',
    '* due 2026-07-20 — [Zed](todos/z.md) — z',
    '* undated — [Alpha](todos/a.md) — a',
    '* undated — [Friday](todos/f.md) — f',
  ]);
  // Done and Dropped keep the plain title-ordered line.
  assert.match(out, /## Done\n\n\* \[Done thing\]\(todos\/d\.md\) — d\n/);
  assert.match(out, /## Dropped\n\n\* \[Dropped thing\]\(todos\/x\.md\) — x\n/);
});

test('dayOf accepts only YYYY-MM-DD', () => {
  assert.equal(dayOf('2026-07-16'), '2026-07-16');
  assert.equal(dayOf('next Friday'), null);
  assert.equal(dayOf('2026-7-16'), null);
  assert.equal(dayOf(undefined), null);
});

/* IM-5: the Documents tree. */

test('a Documents folder lists subfolders first, then its documents, and its description is its purpose', () => {
  const out = renderFolderIndex({
    dir: 'notes',
    label: 'Notes',
    purpose: 'the documents you write',
    entries: [{ path: 'notes/scratch.md', title: 'Scratch', description: 'loose ends' }],
    subfolders: [
      { dir: 'notes/specs', label: 'Specs', purpose: 'what we are building', count: 3 },
      { dir: 'notes/briefs', label: 'Briefs', purpose: documentFolderPurpose('Briefs'), count: 0 },
    ],
  });
  assert.equal(
    out,
    '---\ndescription: the documents you write\n---\n\n# Notes\n\nthe documents you write\n\n' +
      '## Folders\n\n' +
      '* [Briefs](notes/briefs/index.md) — Briefs, a folder of your documents (0)\n' +
      '* [Specs](notes/specs/index.md) — what we are building (3)\n\n' +
      '## Documents\n\n' +
      '* [Scratch](notes/scratch.md) — loose ends\n',
  );
});

test('a Documents folder re-emits the purpose marker it was given (IM-7)', () => {
  const out = renderFolderIndex({
    dir: 'notes/specs',
    label: 'Specs',
    purpose: 'where the auth specs live',
    entries: [{ path: 'notes/specs/a.md', title: 'A', description: 'a' }],
    subfolders: [],
    purposeOf: '1a2b3c 4d5e6f',
  });
  assert.equal(
    out,
    '---\ndescription: where the auth specs live\npurpose_of: 1a2b3c 4d5e6f\n---\n\n' +
      '# Specs\n\nwhere the auth specs live\n\n* [A](notes/specs/a.md) — a\n',
  );
});

test('a Documents folder with no subfolders is a flat list; an empty one is a header only', () => {
  const flat = renderFolderIndex({
    dir: 'notes/specs',
    label: 'Specs',
    purpose: 'what we are building',
    entries: [{ path: 'notes/specs/a.md', title: 'A', description: 'a' }],
    subfolders: [],
  });
  assert.equal(
    flat,
    '---\ndescription: what we are building\n---\n\n# Specs\n\nwhat we are building\n\n' +
      '* [A](notes/specs/a.md) — a\n',
  );
  const empty = renderFolderIndex({
    dir: 'notes/empty',
    label: 'Empty',
    purpose: documentFolderPurpose('Empty'),
    entries: [],
    subfolders: [],
  });
  assert.equal(
    empty,
    '---\ndescription: Empty, a folder of your documents\n---\n\n# Empty\n\nEmpty, a folder of your documents\n',
  );
});
