import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Connector } from '@qale/connectors';
import type { Note } from '@qale/domain';
import type { IndexedNote, UseCaseContext } from '@qale/application';
import type { SyncItemRow, SyncStore } from '@qale/vault';
import { SyncService } from '../src/main/services/sync-service.js';

/**
 * The one-time move of flat mirrors under their provider folder
 * (docs/provider-decoupling.md PD-10). What it has to get right: the files move,
 * the sync rows follow them, the wikilinks that named the old path are rewritten,
 * it all lands in one commit, and a second tick does nothing at all.
 *
 * The vault and the index are in-memory doubles, the same idiom the other sync
 * tests use — the migration reads raw text and index metadata, and both are
 * exactly what a double can serve.
 */

const TICKET = `---
type: ticket
title: PAY-142 · SAML SSO
summary: PAY-142 — SAML SSO (Blocked)
provider: jira
external_id: PAY-142
container: PAY
state: Blocked
state_category: blocked
remote_updated: '2026-07-17T09:00:00.000Z'
url: https://tavla.atlassian.net/browse/PAY-142
---

The epic body.
`;

const PAGE = `---
type: wikipage
title: Release checklist
summary: Release checklist — mirrored page in ENG
provider: confluence
external_id: '11111'
container: ENG
version: 3
remote_updated: '2026-07-17T09:00:00.000Z'
url: https://tavla.atlassian.net/wiki/11111
---

The checklist.
`;

const DECISION = `---
type: decision
title: Ship SSO
summary: Ship SSO in Q3
---

We ship behind [[tickets/PAY-142]], against [[wikipages/release-checklist|the checklist]].
A bare [[PAY-142]] stays as it is.
`;

/** Vault + index doubles over one map of raw file text. */
function fakeWorkspace(files: Map<string, string>): {
  ctx: UseCaseContext;
  commits: { paths: string[]; message: string }[];
} {
  const commits: { paths: string[]; message: string }[] = [];
  const indexed = new Map<string, IndexedNote>();
  for (const [path, raw] of files) indexed.set(path, toIndexed(path, raw));

  const ctx = {
    vault: {
      readRaw: async (path: string) => files.get(path) ?? null,
      writeRaw: async (path: string, content: string) => void files.set(path, content),
      remove: async (path: string) => void files.delete(path),
      exists: async (path: string) => files.has(path),
      readNote: async (path: string) => {
        const raw = files.get(path);
        return raw ? (toNote(path, raw) as Note) : null;
      },
      writeNote: async () => {
        throw new Error('the migration must not author notes');
      },
    },
    index: {
      all: () => [...indexed.values()],
      listByType: (type: string) => [...indexed.values()].filter((n) => n.type === type),
      reindex: (note: Note) =>
        void indexed.set(note.path, toIndexed(note.path, files.get(note.path) ?? '')),
      removeByPath: (path: string) => void indexed.delete(path),
    },
    git: {
      commitPaths: async (paths: string[], message: string) =>
        void commits.push({ paths, message }),
    },
  } as unknown as UseCaseContext;
  return { ctx, commits };
}

/** Enough frontmatter for this suite: flat `key: value` lines, quotes stripped. */
function parseRaw(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  const end = raw.indexOf('\n---', 4);
  if (!raw.startsWith('---') || end === -1) return { frontmatter: {}, body: raw };
  const frontmatter: Record<string, unknown> = {};
  for (const line of raw.slice(4, end).split('\n')) {
    const at = line.indexOf(':');
    if (at === -1) continue;
    frontmatter[line.slice(0, at).trim()] = line
      .slice(at + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }
  return { frontmatter, body: raw.slice(end + 5) };
}

function toNote(path: string, raw: string): Note {
  const { frontmatter, body } = parseRaw(raw);
  return {
    path,
    slug: path.replace(/\.md$/, ''),
    type: frontmatter['type'],
    layer: 'raw',
    frontmatter,
    body,
    mtime: 0,
  } as unknown as Note;
}

function toIndexed(path: string, raw: string): IndexedNote {
  const { frontmatter, body } = parseRaw(raw);
  const links = [...body.matchAll(/\[\[([^\]\n]+)\]\]/g)].map((m) => ({
    target: (m[1] ?? '')
      .split('|')[0]!
      .split('#')[0]!
      .split('::')
      .pop()!
      .replace(/\.md$/, '')
      .trim(),
  }));
  return {
    path,
    slug: path.replace(/\.md$/, ''),
    type: String(frontmatter['type'] ?? 'note'),
    title: String(frontmatter['title'] ?? ''),
    frontmatter,
    links,
    mtime: 0,
  } as unknown as IndexedNote;
}

/** A store holding the rows, the note-path bindings and the migration flag. */
function fakeStore(rows: SyncItemRow[]): SyncStore {
  const meta = new Map<string, string>();
  return {
    getMeta: (key: string) => meta.get(key) ?? null,
    setMeta: (key: string, value: string) => void meta.set(key, value),
    itemsByKind: (kind: string) => rows.filter((r) => r.kind === kind),
    setNotePath: (provider: string, externalId: string, notePath: string) => {
      const row = rows.find((r) => r.provider === provider && r.externalId === externalId);
      if (row) row.notePath = notePath;
    },
    listContainers: () => [],
    followedContainers: () => [],
    upsertContainer: () => {},
  } as unknown as SyncStore;
}

function row(externalId: string, kind: 'ticket' | 'wikipage', notePath: string): SyncItemRow {
  return { provider: 'atlassian', kind, externalId, notePath } as SyncItemRow;
}

/** Bound, credential-free: the tick keeps the connector it is handed. */
function withConnector(service: SyncService): void {
  const connector = {
    id: 'atlassian',
    providers: { ticket: 'jira', wikipage: 'confluence' },
    listContainers: async () => [],
  } as unknown as Connector;
  (service as unknown as { conns: Map<string, { connector: Connector }> }).conns.get(
    'atlassian',
  )!.connector = connector;
}

function makeService(ctx: UseCaseContext, store: SyncStore): SyncService {
  const settings = { getConnection: () => null, getGoogle: () => null } as never;
  const service = new SyncService(
    () => ctx,
    () => store,
    settings,
    {} as never,
    () => {},
  );
  withConnector(service);
  return service;
}

test('the first tick moves flat mirrors under their provider, links and all', async () => {
  const files = new Map([
    ['tickets/PAY-142.md', TICKET],
    ['wikipages/release-checklist.md', PAGE],
    ['decisions/2026-07-01-ship-sso.md', DECISION],
  ]);
  const { ctx, commits } = fakeWorkspace(files);
  // The page has no row: a vault copied between machines has mirrors and no
  // sync database, and its own `provider` field is what places it.
  const rows = [
    row('PAY-142', 'ticket', 'tickets/PAY-142.md'),
    row('GONE-9', 'ticket', 'tickets/GONE-9.md'),
  ];
  const store = fakeStore(rows);

  await makeService(ctx, store).tick();

  assert.equal(files.has('tickets/PAY-142.md'), false);
  assert.equal(files.get('tickets/jira/PAY-142.md'), TICKET, 'moved byte for byte');
  assert.equal(files.has('wikipages/release-checklist.md'), false);
  assert.equal(files.get('wikipages/confluence/release-checklist.md'), PAGE);

  assert.equal(rows[0]!.notePath, 'tickets/jira/PAY-142.md');
  // A bound path with no file is a mirror the PM deleted; never recreate it.
  assert.equal(rows[1]!.notePath, 'tickets/GONE-9.md');
  assert.equal(files.has('tickets/GONE-9.md'), false);

  const decision = files.get('decisions/2026-07-01-ship-sso.md')!;
  assert.match(decision, /\[\[tickets\/jira\/PAY-142\]\]/);
  assert.match(decision, /\[\[wikipages\/confluence\/release-checklist\|the checklist\]\]/);
  assert.match(decision, /\[\[PAY-142\]\]/, 'a bare key names no folder — PD-11 owns those');

  assert.equal(commits.length, 1);
  assert.equal(commits[0]!.message, 'sync: migrate mirror paths');
  assert.deepEqual(
    [...commits[0]!.paths].sort(),
    [
      'decisions/2026-07-01-ship-sso.md',
      'tickets/PAY-142.md',
      'tickets/jira/PAY-142.md',
      'wikipages/confluence/release-checklist.md',
      'wikipages/release-checklist.md',
    ].sort(),
  );
});

test('a second tick has nothing to do', async () => {
  const files = new Map([
    ['tickets/PAY-142.md', TICKET],
    ['decisions/2026-07-01-ship-sso.md', DECISION],
  ]);
  const { ctx, commits } = fakeWorkspace(files);
  const store = fakeStore([row('PAY-142', 'ticket', 'tickets/PAY-142.md')]);
  const service = makeService(ctx, store);

  await service.tick();
  const after = new Map(files);
  await service.tick();

  assert.equal(commits.length, 1, 'the flag is what stops the second pass');
  assert.deepEqual([...files], [...after]);
});

test('a crash between the write and the delete resumes', async () => {
  // Both copies on disk, the row still bound to the old one: what a quit halfway
  // through the move leaves behind.
  const files = new Map([
    ['tickets/PAY-142.md', TICKET],
    ['tickets/jira/PAY-142.md', TICKET],
  ]);
  const { ctx } = fakeWorkspace(files);
  const rows = [row('PAY-142', 'ticket', 'tickets/PAY-142.md')];

  await makeService(ctx, fakeStore(rows)).tick();

  assert.equal(files.has('tickets/PAY-142.md'), false);
  assert.equal(files.get('tickets/jira/PAY-142.md'), TICKET);
  assert.equal(rows[0]!.notePath, 'tickets/jira/PAY-142.md');
});
