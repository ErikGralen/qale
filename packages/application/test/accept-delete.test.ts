import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeNote, type Frontmatter } from '@qale/domain';
import { acceptProposal, previewProposal } from '../src/index.js';
import type { ProposalRecord, UseCaseContext } from '../src/ports.js';

/**
 * Approving a deletion. The card carries a path and a reason, so the two things
 * worth pinning are what the PO is shown before they decide (the page as it
 * reads now, going) and what is left afterwards (nothing, and no path handed
 * back for the rail to pin).
 */

interface Stored {
  frontmatter: Frontmatter;
  body: string;
}

function fakeContext(files: Record<string, Stored>) {
  const store = new Map(Object.entries(files));
  const proposals = new Map<string, ProposalRecord>();
  const statuses: Record<string, string> = {};
  const commits: string[][] = [];
  const unindexed: string[] = [];
  const note = (path: string, s: Stored) =>
    makeNote({ path, frontmatter: s.frontmatter, body: s.body, mtime: 1 });
  const ctx: UseCaseContext = {
    vault: {
      root: () => '/fake',
      ensureScaffold: async () => {},
      readNote: async (p: string) => {
        const s = store.get(p);
        return s ? note(p, s) : null;
      },
      readRaw: async () => null,
      writeNote: async (p: string, frontmatter: Frontmatter, body: string) => {
        store.set(p, { frontmatter, body });
        return note(p, { frontmatter, body });
      },
      writeBody: async () => {
        throw new Error('a delete writes nothing');
      },
      writeRaw: async () => {},
      writeBinary: async () => {},
      remove: async (p: string) => void store.delete(p),
      exists: async (p: string) => store.has(p),
      list: async () => [],
      contain: () => null,
    },
    index: {
      reindex: () => {},
      removeByPath: (p: string) => void unindexed.push(p),
      get: () => null,
      all: () => [],
      listByType: () => [],
      search: () => [],
      backlinks: () => [],
      resolve: () => null,
      count: () => 0,
      clear: () => {},
    },
    git: {
      available: async () => false,
      isRepo: async () => false,
      init: async () => {},
      commitPaths: async (paths: string[]) => void commits.push(paths),
      history: async () => [],
      fileAt: async () => null,
    },
    clock: { now: () => '2026-09-01T00:00:00.000Z' },
    proposals: {
      create: (input, created) => {
        const rec = { ...input, id: 'p1', status: 'pending', created, resolved: null };
        proposals.set(rec.id, rec as ProposalRecord);
        return rec as ProposalRecord;
      },
      get: (id: string) => proposals.get(id) ?? null,
      list: () => [...proposals.values()],
      setStatus: (id: string, status) => {
        statuses[id] = status;
      },
      pendingCount: () => 0,
    } as never,
  };
  return { ctx, store, statuses, commits, unindexed };
}

function deleteCard(ctx: UseCaseContext, path: string): ProposalRecord {
  return ctx.proposals.create(
    {
      kind: 'delete',
      sessionId: 's1',
      skill: 'librarian',
      targetPath: path,
      baseHash: null,
      payload: { path, rationale: 'The file is empty.' },
      rationale: 'The file is empty.',
      evidence: [],
      inference: true,
    },
    1,
  );
}

const empty = { type: 'note', summary: 'Untitled', sources: [] } as Frontmatter;

test('approving a deletion removes the file, drops it from the index and commits', async () => {
  const { ctx, store, statuses, commits, unindexed } = fakeContext({
    'notes/untitled.md': { frontmatter: empty, body: '' },
  });
  const rec = deleteCard(ctx, 'notes/untitled.md');

  const result = await acceptProposal(ctx, rec.id);

  assert.equal(result.ok, true);
  assert.equal(statuses[rec.id], 'accepted');
  assert.equal(store.has('notes/untitled.md'), false);
  assert.deepEqual(unindexed, ['notes/untitled.md']);
  assert.deepEqual(commits, [['notes/untitled.md']]);
  // No path back: that field pins what the PO approved to the rail, and there is
  // nothing left to pin.
  assert.equal(result.path, undefined);
});

test('the preview shows the page going, so nothing is approved unseen', async () => {
  const { ctx } = fakeContext({
    'notes/scratch.md': { frontmatter: empty, body: 'sara called re sso\n' },
  });
  const rec = deleteCard(ctx, 'notes/scratch.md');

  const preview = await previewProposal(ctx, rec.id);

  assert.equal(preview?.before, 'sara called re sso\n');
  assert.equal(preview?.after, '');
  assert.equal(preview?.stale, false);
});

test('a page somebody already deleted by hand goes stale rather than failing loudly', async () => {
  const { ctx, statuses } = fakeContext({ 'notes/untitled.md': { frontmatter: empty, body: '' } });
  const rec = deleteCard(ctx, 'notes/gone.md');

  const result = await acceptProposal(ctx, rec.id);

  assert.equal(result.ok, false);
  assert.equal(result.stale, true);
  assert.equal(result.staleReason, 'missing');
  assert.equal(statuses[rec.id], 'stale');
});
