import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeNote, parseFrontmatter, type Note } from '@pm/domain';
import { SqliteIndex } from '../src/sqlite-index.js';

async function openIndex(): Promise<SqliteIndex> {
  const dir = await mkdtemp(join(tmpdir(), 'pm-index-'));
  return new SqliteIndex(join(dir, 'index.db'));
}

// better-sqlite3 in this workspace is rebuilt for Electron's ABI; skip under a
// plain-node runner that can't load it rather than failing the whole suite.
const skip = await (async () => {
  try {
    (await openIndex()).close();
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ERR_DLOPEN_FAILED' && 'better-sqlite3 built for a different ABI';
  }
})();

function note(path: string, fm: Record<string, unknown>, body = ''): Note {
  const r = parseFrontmatter(fm);
  assert.ok(r.ok, `fixture frontmatter invalid for ${path}`);
  return makeNote({ path, frontmatter: r.data, body, mtime: 1 });
}

test('meeting transcript frontmatter ref is indexed as a link', { skip }, async () => {
  const index = await openIndex();
  const transcript = note('sources/2026-07-21-checkin-transcript.md', {
    type: 'source',
    summary: 'transcript',
  });
  const meeting = note('meetings/2026-07-21-checkin.md', {
    type: 'meeting',
    summary: 'checkin',
    date: '2026-07-21',
    transcript: '[[sources/2026-07-21-checkin-transcript]]',
  });
  index.reindex(transcript);
  index.reindex(meeting);

  const indexed = index.get(meeting.path);
  assert.ok(indexed);
  assert.ok(indexed.links.some((l) => l.target === 'sources/2026-07-21-checkin-transcript'));
  assert.equal(index.backlinks(transcript.slug).length, 1);
  index.close();
});

test('resolve: exact slug wins, unique basename resolves, ambiguous basename stays unresolved', { skip }, async () => {
  const index = await openIndex();
  index.reindex(note('people/tom-devlin.md', { type: 'person', summary: 'p' }));
  assert.equal(index.resolve('tom-devlin'), 'people/tom-devlin.md');

  index.reindex(note('meetings/tom-devlin.md', { type: 'meeting', summary: 'm', date: '2026-07-21' }));
  assert.equal(index.resolve('people/tom-devlin'), 'people/tom-devlin.md');
  assert.equal(index.resolve('tom-devlin'), null);
  assert.equal(index.resolve('nobody-here'), null);
  index.close();
});

test('URL refs in frontmatter are not indexed as links', { skip }, async () => {
  const index = await openIndex();
  const insight = note('insights/sso-demand.md', {
    type: 'insight',
    summary: 'SSO demand',
    evidence: ['[[meetings/2026-07-21-checkin]]', 'https://example.com/gong/call/123'],
  });
  index.reindex(insight);

  const indexed = index.get(insight.path);
  assert.ok(indexed);
  assert.deepEqual(
    indexed.links.map((l) => l.target),
    ['meetings/2026-07-21-checkin'],
  );
  index.close();
});

test('typed edges: body types, frontmatter keys, and synced ticket relations', { skip }, async () => {
  const index = await openIndex();
  const epic = note('tickets/PAY-142.md', {
    type: 'ticket',
    summary: 'epic',
    provider: 'jira',
    external_id: 'PAY-142',
    container: 'PAY',
    state: 'Blocked',
    state_category: 'blocked',
    remote_updated: '2026-07-16T15:40:00Z',
    url: 'https://x.atlassian.net/browse/PAY-142',
  });
  const child = note('tickets/PAY-161.md', {
    type: 'ticket',
    summary: 'child',
    provider: 'jira',
    external_id: 'PAY-161',
    container: 'PAY',
    state: 'In Progress',
    state_category: 'in_progress',
    parent: 'PAY-142',
    links: [{ type: 'blocks', key: 'PAY-142' }],
    remote_updated: '2026-07-16T11:20:00Z',
    url: 'https://x.atlassian.net/browse/PAY-161',
  });
  const runbook = note(
    'notes/runbook.md',
    { type: 'note', summary: 'runbook' },
    'Gated on [[blocked-by::PAY-142|the epic]] and mentions [[PAY-142]] plainly.\n',
  );
  index.reindex(epic);
  index.reindex(child);
  index.reindex(runbook);

  const childLinks = index.get(child.path)!.links;
  assert.deepEqual(
    childLinks.map((l) => ({ target: l.target, type: l.type, origin: l.origin })),
    [
      { target: 'PAY-142', type: 'part-of', origin: 'synced' },
      { target: 'PAY-142', type: 'blocks', origin: 'synced' },
    ],
  );

  // The epic's inbound edges: one typed row per relationship, plus the plain
  // mention as its own untyped row from the same source note.
  const rows = index.backlinks(epic.slug);
  const fromRunbook = rows.filter((r) => r.fromPath === runbook.path);
  assert.deepEqual(
    fromRunbook.map((r) => ({ type: r.type, reversed: r.reversed })).sort((a, b) => String(a.type).localeCompare(String(b.type))),
    [
      { type: 'blocks', reversed: true },
      { type: undefined, reversed: undefined },
    ].sort((a, b) => String(a.type).localeCompare(String(b.type))),
  );
  assert.ok(rows.some((r) => r.fromPath === child.path && r.type === 'part-of' && r.origin === 'synced'));
  index.close();
});
