import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Connector, FullItem, WikipageChange } from '@qale/connectors';
import type { Note } from '@qale/domain';
import type { SyncItemRow, SyncStore } from '@qale/vault';
import type { UseCaseContext } from '@qale/application';
import { SyncService } from '../src/main/services/sync-service.js';

/**
 * The mirror writer picks a path from the page title, so two spaces with the
 * same title used to land on one file and the second page overwrote the first
 * every tick (docs/provider-decoupling.md PD-2).
 */

/** An in-memory vault: only the four calls writeMirror makes. */
function fakeVault(): { notes: Map<string, Note>; port: UseCaseContext['vault'] } {
  const notes = new Map<string, Note>();
  const port = {
    readNote: async (relPath: string) => notes.get(relPath) ?? null,
    writeNote: async (relPath: string, frontmatter: unknown, body: string) => {
      const note = {
        path: relPath,
        slug: relPath.replace(/\.md$/, ''),
        type: 'wikipage',
        layer: 'mirror',
        frontmatter,
        body,
        mtime: 0,
      } as unknown as Note;
      notes.set(relPath, note);
      return note;
    },
    exists: async (relPath: string) => notes.has(relPath),
  } as unknown as UseCaseContext['vault'];
  return { notes, port };
}

/** A store that remembers note paths and nothing else. */
function fakeStore(): SyncStore {
  const rows = new Map<string, SyncItemRow>();
  return {
    itemByExternalId: (_provider: string, externalId: string) => rows.get(externalId) ?? null,
    setNotePath: (_provider: string, externalId: string, notePath: string) => {
      const row = rows.get(externalId);
      rows.set(externalId, { ...(row ?? ({} as SyncItemRow)), externalId, notePath });
    },
  } as unknown as SyncStore;
}

function pageChange(externalId: string, container: string): WikipageChange {
  return {
    kind: 'wikipage',
    external_id: externalId,
    container,
    title: 'Release checklist',
    version: 1,
    remote_updated: '2026-07-17T09:00:00.000Z',
    url: `https://tavla.atlassian.net/wiki/${externalId}`,
  };
}

function fakeConnector(): Connector {
  return {
    id: 'atlassian',
    providers: { ticket: 'jira', wikipage: 'confluence' },
    fetchFull: async (_kind, externalId): Promise<FullItem> => ({
      kind: 'wikipage',
      external_id: externalId,
      title: 'Release checklist',
      url: `https://tavla.atlassian.net/wiki/${externalId}`,
      bodyMarkdown: `Body of ${externalId}`,
      version: 1,
      remote_updated: '2026-07-17T09:00:00.000Z',
    }),
  } as unknown as Connector;
}

function makeService(vault: UseCaseContext['vault']): {
  service: SyncService;
  ctx: UseCaseContext;
  store: SyncStore;
} {
  const ctx = { vault, index: { reindex: () => {} } } as unknown as UseCaseContext;
  const store = fakeStore();
  const service = new SyncService(
    () => ctx,
    () => store,
    {} as never,
    {} as never,
    () => {},
  );
  // writeMirror reads the bound connector; the test supplies one instead of
  // credentials so nothing touches the network.
  (service as unknown as { conns: Map<string, { connector: Connector }> }).conns.get(
    'atlassian',
  )!.connector = fakeConnector();
  return { service, ctx, store };
}

/** writeMirror is private on purpose: it is the only mirror writer. */
function writeMirror(
  service: SyncService,
  ctx: UseCaseContext,
  store: SyncStore,
  change: WikipageChange,
): Promise<string | null> {
  return (
    service as unknown as {
      writeMirror: (
        c: UseCaseContext,
        s: SyncStore,
        connectionId: string,
        ch: WikipageChange,
        now: number,
      ) => Promise<string | null>;
    }
  ).writeMirror(ctx, store, 'atlassian', change, Date.parse('2026-07-17T09:00:00.000Z'));
}

test('two pages with one title land as two files', async () => {
  const { notes, port } = fakeVault();
  const { service, ctx, store } = makeService(port);

  const first = await writeMirror(service, ctx, store, pageChange('11111', 'ENG'));
  const second = await writeMirror(service, ctx, store, pageChange('22222', 'OPS'));

  assert.equal(first, 'wikipages/confluence/release-checklist.md');
  assert.equal(second, 'wikipages/confluence/release-checklist-2.md');
  assert.equal(notes.size, 2);
  assert.equal(notes.get(first!)!.frontmatter['external_id'], '11111');
  assert.equal(notes.get(second!)!.frontmatter['external_id'], '22222');
  assert.equal(notes.get(second!)!.frontmatter['provider'], 'confluence');
});

test('re-syncing the same page keeps its own file', async () => {
  const { notes, port } = fakeVault();
  const { service, ctx, store } = makeService(port);

  await writeMirror(service, ctx, store, pageChange('11111', 'ENG'));
  await writeMirror(service, ctx, store, pageChange('22222', 'OPS'));

  // Same version and timestamp: both are unchanged, so neither writes again.
  assert.equal(await writeMirror(service, ctx, store, pageChange('11111', 'ENG')), null);
  assert.equal(await writeMirror(service, ctx, store, pageChange('22222', 'OPS')), null);

  const moved = { ...pageChange('22222', 'OPS'), version: 2 };
  assert.equal(
    await writeMirror(service, ctx, store, moved),
    'wikipages/confluence/release-checklist-2.md',
  );
  assert.equal(notes.size, 2);
});
