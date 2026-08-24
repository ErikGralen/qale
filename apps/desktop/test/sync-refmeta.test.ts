import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Connector } from '@qale/connectors';
import type { SyncItemRow, SyncStore } from '@qale/vault';
import type { UseCaseContext } from '@qale/application';
import { SyncService } from '../src/main/services/sync-service.js';

/**
 * A bare "[[PAY-142]]" is a lookup, not an address (docs/provider-decoupling.md
 * PD-11). One tracker holding the key resolves; two make the reference
 * ambiguous, and the harvest refuses to track a bare key either could own.
 */

interface FakeNote {
  path: string;
  slug: string;
  type: string;
  title: string;
  mtime: number;
  frontmatter: Record<string, unknown>;
  links: { target: string }[];
}

function ticketNote(provider: string, key: string): FakeNote {
  return {
    path: `tickets/${provider}/${key}.md`,
    slug: `tickets/${provider}/${key}`,
    type: 'ticket',
    title: `${key} · Ship the importer`,
    mtime: Date.parse('2026-08-20T09:00:00.000Z'),
    frontmatter: {
      type: 'ticket',
      provider,
      external_id: key,
      container: 'ENG',
      state: 'In Progress',
      state_category: 'in_progress',
      remote_updated: '2026-08-20T09:00:00.000Z',
      url: `https://${provider}.example/${key}`,
    },
    links: [],
  };
}

function linkingNote(targets: string[]): FakeNote {
  return {
    path: 'notes/importer.md',
    slug: 'notes/importer',
    type: 'note',
    title: 'Importer',
    mtime: 0,
    frontmatter: { type: 'note' },
    links: targets.map((target) => ({ target })),
  };
}

function fakeCtx(notes: FakeNote[]): UseCaseContext {
  return {
    index: {
      all: () => notes,
      get: (path: string) => notes.find((n) => n.path === path) ?? null,
      listByType: (type: string) => notes.filter((n) => n.type === type),
    },
  } as unknown as UseCaseContext;
}

function fakeStore(): SyncStore {
  return {
    itemsByExternalId: (): SyncItemRow[] => [],
    itemsByKind: (): SyncItemRow[] => [],
    listContainers: () => [],
  } as unknown as SyncStore;
}

/** Two key-holding trackers, unless told one cannot pull by key. */
function makeService(
  notes: FakeNote[],
  opts: { linearHoldsKeys?: boolean } = {},
): SyncService {
  const registry = [
    { id: 'atlassian', label: 'Jira + Confluence' },
    { id: 'linear', label: 'Linear' },
  ] as never;
  const service = new SyncService(
    () => fakeCtx(notes),
    () => fakeStore(),
    {} as never,
    {} as never,
    () => {},
    registry,
  );
  const conns = (service as unknown as { conns: Map<string, { connector: Connector | null }> })
    .conns;
  conns.get('atlassian')!.connector = {
    id: 'atlassian',
    providers: { ticket: 'jira', wikipage: 'confluence' },
    pullByKeys: async () => [],
  } as unknown as Connector;
  conns.get('linear')!.connector = {
    id: 'linear',
    providers: { ticket: 'linear' },
    ...(opts.linearHoldsKeys === false ? {} : { pullByKeys: async () => [] }),
  } as unknown as Connector;
  return service;
}

test('one tracker holding the key resolves the bare reference', () => {
  const service = makeService([ticketNote('jira', 'PAY-142')]);
  const meta = service.refMeta('PAY-142');
  assert.ok(meta);
  assert.equal(meta.notePath, 'tickets/jira/PAY-142.md');
  assert.equal(meta.externalId, 'PAY-142');
  assert.equal(meta.ambiguousProviders, undefined);
});

test('two trackers holding the key make the bare reference ambiguous', () => {
  const service = makeService([ticketNote('jira', 'PAY-142'), ticketNote('linear', 'PAY-142')]);
  const meta = service.refMeta('PAY-142');
  assert.ok(meta);
  assert.deepEqual(meta.ambiguousProviders, ['jira', 'linear']);
  assert.equal(meta.notePath, null);
});

test('a reference that names its tracker resolves through the ambiguity', () => {
  const service = makeService([ticketNote('jira', 'PAY-142'), ticketNote('linear', 'PAY-142')]);
  const meta = service.refMeta('tickets/jira/PAY-142');
  assert.ok(meta);
  assert.equal(meta.notePath, 'tickets/jira/PAY-142.md');
  assert.equal(meta.ambiguousProviders, undefined);
});

test('a key no mirror holds resolves to nothing', () => {
  const service = makeService([]);
  assert.equal(service.refMeta('COVID-19'), null);
  assert.equal(service.refMeta('PAY-999'), null);
});

interface HarvestInternals {
  deepTargets: (ctx: UseCaseContext) => unknown;
  harvestKeysFor: (connectionId: string, deep: unknown) => Set<string>;
}

test('a bare key is not tracked while two connections hold keys', () => {
  const notes = [linkingNote(['PAY-142', 'tickets/jira/PAY-9'])];
  const service = makeService(notes) as unknown as HarvestInternals;
  const deep = service.deepTargets(fakeCtx(notes));
  // The named link harvests to its tracker; the bare key goes to neither.
  assert.deepEqual([...service.harvestKeysFor('atlassian', deep)].sort(), ['PAY-9']);
  assert.deepEqual([...service.harvestKeysFor('linear', deep)], []);
});

test('a bare key harvests when exactly one connection holds keys', () => {
  const notes = [linkingNote(['PAY-142'])];
  const service = makeService(notes, { linearHoldsKeys: false }) as unknown as HarvestInternals;
  const deep = service.deepTargets(fakeCtx(notes));
  assert.deepEqual([...service.harvestKeysFor('atlassian', deep)], ['PAY-142']);
});
