import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import type {
  Connector,
  ConnectorProvider,
  ExternalContainer,
  FullItem,
  PullResult,
  ShallowChange,
} from '@qale/connectors';
import type { Note } from '@qale/domain';
import type { SyncContainerRow, SyncItemRow, SyncStore, SyncTrackedRow } from '@qale/vault';
import type { UseCaseContext } from '@qale/application';
import { SyncService } from '../src/main/services/sync-service.js';

/**
 * The sync engine runs off the connector registry, not off a list of connectors
 * it knows by name (docs/provider-decoupling.md PD-4). A third provider must
 * sync with no edit to the sync service at all, so this test registers one that
 * does not exist and puts it through an ordinary tick.
 */

const LINEAR_TICKET = {
  kind: 'ticket',
  external_id: 'LIN-1',
  container: 'ENG',
  title: 'Ship the importer',
  state: 'In Progress',
  state_category: 'in_progress',
  remote_updated: '2026-08-20T09:00:00.000Z',
  url: 'https://linear.app/tavla/issue/LIN-1',
} as const satisfies ShallowChange;

/** The connector a hypothetical Linear package would ship. */
function fakeConnector(pulls: ExternalContainer[]): Connector {
  return {
    id: 'linear',
    providers: { ticket: 'linear' },
    listContainers: async (): Promise<ExternalContainer[]> => [
      { kind: 'ticket', id: 'ENG', name: 'Engineering' },
    ],
    pullChanges: async (container: ExternalContainer): Promise<PullResult> => {
      pulls.push(container);
      return { changes: [{ ...LINEAR_TICKET }], highWaterMark: LINEAR_TICKET.remote_updated };
    },
    pullByKeys: async (): Promise<ShallowChange[]> => [],
    fetchFull: async (): Promise<FullItem> => ({
      kind: 'ticket',
      external_id: LINEAR_TICKET.external_id,
      title: LINEAR_TICKET.title,
      url: LINEAR_TICKET.url,
      bodyMarkdown: 'The importer, shipped.',
      state: LINEAR_TICKET.state,
      state_category: 'in_progress',
      remote_updated: LINEAR_TICKET.remote_updated,
    }),
    verifyAuth: async () => ({ ok: true, health: 'ok' as const }),
  } as unknown as Connector;
}

function fakeProvider(pulls: ExternalContainer[]): ConnectorProvider<unknown> {
  return {
    id: 'linear',
    label: 'Linear',
    authSchema: z.object({ apiToken: z.string().min(1) }),
    authFields: [{ key: 'apiToken', label: 'API token', secret: true }],
    renewFieldKeys: ['apiToken'],
    create: () => fakeConnector(pulls),
  } as unknown as ConnectorProvider<unknown>;
}

/** Enough of the sync store for one tick: containers, rows, tracked items. */
function fakeStore(): SyncStore {
  const containers = new Map<string, SyncContainerRow>();
  const rows = new Map<string, SyncItemRow>();
  const tracked = new Map<string, SyncTrackedRow>();
  const meta = new Map<string, string>();
  return {
    getMeta: (key: string) => meta.get(key) ?? null,
    setMeta: (key: string, value: string) => void meta.set(key, value),
    listContainers: (provider?: string) =>
      [...containers.values()].filter((c) => !provider || c.provider === provider),
    followedContainers: (provider: string) =>
      [...containers.values()].filter((c) => c.provider === provider && c.followed),
    upsertContainer: (provider: string, kind: string, containerId: string, name: string) => {
      const key = `${provider}:${containerId}`;
      containers.set(key, {
        ...(containers.get(key) ?? { followed: true, highWater: null, lastSync: null }),
        provider,
        kind,
        containerId,
        name,
      } as SyncContainerRow);
    },
    setHighWater: () => {},
    upsertItem: (row: SyncItemRow) => rows.set(row.externalId, row),
    itemByExternalId: (_provider: string, externalId: string) => rows.get(externalId) ?? null,
    itemsByKind: (kind: string) => [...rows.values()].filter((r) => r.kind === kind),
    setNotePath: (_provider: string, externalId: string, notePath: string) => {
      const row = rows.get(externalId);
      if (row) rows.set(externalId, { ...row, notePath });
    },
    track: (provider: string, kind: string, externalId: string, source: string, addedAt: number) =>
      tracked.set(externalId, { provider, kind, externalId, source, addedAt } as SyncTrackedRow),
    listTracked: (provider: string) => [...tracked.values()].filter((t) => t.provider === provider),
    trackedSource: (_provider: string, externalId: string) =>
      tracked.get(externalId)?.source ?? null,
    countTrackedBySource: () => 0,
  } as unknown as SyncStore;
}

/** A vault with one note that links the ticket, which is what makes it deep. */
function fakeContext(notes: Map<string, Note>): UseCaseContext {
  const linking = {
    path: 'notes/plan.md',
    slug: 'notes/plan',
    type: 'note',
    title: 'Plan',
    links: [{ target: 'LIN-1' }],
    frontmatter: {},
    mtime: 0,
  };
  return {
    vault: {
      readNote: async (relPath: string) => notes.get(relPath) ?? null,
      writeNote: async (relPath: string, frontmatter: unknown, body: string) => {
        const note = { path: relPath, frontmatter, body, mtime: 0 } as unknown as Note;
        notes.set(relPath, note);
        return note;
      },
      exists: async (relPath: string) => notes.has(relPath),
    },
    index: { all: () => [linking], reindex: () => {} },
    git: { commitPaths: async () => {} },
  } as unknown as UseCaseContext;
}

test('a third registered provider syncs with no sync-service edit', async () => {
  const pulls: ExternalContainer[] = [];
  const notes = new Map<string, Note>();
  const ctx = fakeContext(notes);
  const store = fakeStore();
  const settings = {
    getConnection: (connectionId: string) =>
      connectionId === 'linear' ? { providerId: 'linear', fields: { apiToken: 'lin-1' } } : null,
    getGoogle: () => null,
  } as never;

  const service = new SyncService(
    () => ctx,
    () => store,
    settings,
    {} as never,
    () => {},
    [fakeProvider(pulls)],
  );
  await service.tick();

  assert.deepEqual(pulls, [{ kind: 'ticket', id: 'ENG', name: 'Engineering' }]);
  // The connection id, not a literal, is what the shallow row is filed under.
  assert.equal(store.itemByExternalId('linear', 'LIN-1')?.provider, 'linear');
  // And the mirror carries the connector's own provider string.
  const mirror = notes.get('tickets/linear/LIN-1.md');
  assert.equal(mirror?.frontmatter['provider'], 'linear');
  assert.equal(mirror?.frontmatter['state'], 'In Progress');
});
