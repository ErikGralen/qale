import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ConnectionContainerDTO,
  ConnectionDTO,
  NoteRefDTO,
  NoteType,
  VaultTreeDTO,
} from '@qale/ipc';
import { providerRows } from '../src/renderer/src/lib/providers.js';

const NOW = new Date(2026, 8, 5, 9).getTime();

function container(
  kind: ConnectionContainerDTO['kind'],
  provider?: string,
): ConnectionContainerDTO {
  return { id: `${kind}-1`, kind, name: kind, followed: true, lastSync: NOW, provider };
}

function connection(id: string, containers: ConnectionContainerDTO[]): ConnectionDTO {
  return {
    id,
    providerId: id,
    providerLabel: id,
    siteLabel: `${id}.example.com`,
    health: 'ok',
    lastSync: NOW,
    containers,
  };
}

function note(path: string, type: NoteType): NoteRefDTO {
  const slug = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
  return { path, slug, type, title: slug, summary: '', mtime: NOW };
}

/** One group per type, the shape `vault:tree` returns. */
function tree(notes: NoteRefDTO[]): VaultTreeDTO {
  const byType = new Map<NoteType, NoteRefDTO[]>();
  for (const n of notes) byType.set(n.type, [...(byType.get(n.type) ?? []), n]);
  return {
    groups: [...byType].map(([type, rows]) => ({
      dir: `${type}s`,
      type,
      layer: 'raw' as VaultTreeDTO['groups'][number]['layer'],
      notes: rows,
    })),
  };
}

/** One Atlassian connection is two systems on the rail, not one. */
const ATLASSIAN = connection('atlassian', [
  container('ticket', 'jira'),
  container('wikipage', 'confluence'),
]);

test('a connection puts its systems on the rail, one row each', () => {
  assert.deepEqual(providerRows([ATLASSIAN], null), [
    {
      providerId: 'confluence',
      label: 'Confluence',
      kind: 'wikipage',
      dir: 'wikipages/confluence',
    },
    { providerId: 'jira', label: 'Jira', kind: 'ticket', dir: 'tickets/jira' },
  ]);
});

test('mirrors left behind by a removed connection keep their row', () => {
  const rows = providerRows([], tree([note('tickets/jira/PAY-142.md', 'ticket')]));
  assert.deepEqual(rows, [
    { providerId: 'jira', label: 'Jira', kind: 'ticket', dir: 'tickets/jira' },
  ]);
});

test('a system with no connection and no mirrors has no row', () => {
  assert.deepEqual(providerRows([], null), []);
  assert.deepEqual(providerRows([], tree([note('notes/q3.md', 'note')])), []);
});

test('one row per system, however many times it is named', () => {
  const rows = providerRows(
    [ATLASSIAN, connection('second-site', [container('ticket', 'jira')])],
    tree([note('tickets/jira/PAY-142.md', 'ticket')]),
  );
  assert.deepEqual(
    rows.map((r) => r.dir),
    ['wikipages/confluence', 'tickets/jira'],
  );
});

test('a system nobody named before still gets a name', () => {
  const rows = providerRows([connection('linear', [container('ticket', 'linear')])], null);
  assert.deepEqual(
    rows.map((r) => r.label),
    ['Linear'],
  );
});

test('the rows read in name order', () => {
  const rows = providerRows(
    [
      connection('zeta', [container('ticket', 'zendesk')]),
      connection('a', [container('wikipage', 'notion')]),
      ATLASSIAN,
    ],
    null,
  );
  assert.deepEqual(
    rows.map((r) => r.label),
    ['Confluence', 'Jira', 'Notion', 'Zendesk'],
  );
});

test('a flat mirror names no system, so it puts up no row', () => {
  // Written before the provider folders existed (PD-10). The sync engine's
  // one-time move files it under a system, and the row appears then.
  assert.deepEqual(providerRows([], tree([note('tickets/PAY-142.md', 'ticket')])), []);
});

test('a calendar is not a mirror folder, so it never holds a row', () => {
  const rows = providerRows(
    [connection('google-calendar', [container('calendar', 'google-calendar')])],
    null,
  );
  assert.deepEqual(rows, []);
});

test('a container the connector mirrors nowhere puts up no row', () => {
  assert.deepEqual(providerRows([connection('atlassian', [container('ticket')])], null), []);
});
