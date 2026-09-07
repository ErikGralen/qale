import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeNote, type Frontmatter } from '@qale/domain';
import { acceptProposal } from '../src/index.js';
import type { ProposalRecord, UseCaseContext } from '../src/ports.js';

/**
 * The edit the PM makes before approving is kept (docs/learning-how-you-work.md
 * ticket 7).
 *
 * What lands is what they approved, as it always was. What is new is that the
 * change survives the approval: the draft stays in `payload`, their version goes
 * beside it, and the session reads the pair next turn. A card kept as drafted
 * stores nothing, so "changed" never means "opened".
 */

function fakeContext() {
  const store = new Map<string, { frontmatter: Frontmatter; body: string }>();
  const proposals = new Map<string, ProposalRecord>();
  const edits: Record<string, unknown> = {};
  const note = (path: string, s: { frontmatter: Frontmatter; body: string }) =>
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
      writeBody: async () => note('x.md', { frontmatter: {} as Frontmatter, body: '' }),
      writeRaw: async () => {},
      writeBinary: async () => {},
      remove: async (p: string) => void store.delete(p),
      exists: async (p: string) => store.has(p),
      list: async () => [],
      contain: () => null,
    },
    index: {
      reindex: () => {},
      removeByPath: () => {},
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
      commitPaths: async () => {},
      history: async () => [],
      fileAt: async () => null,
    },
    clock: { now: () => '2026-09-07T00:00:00.000Z' },
    proposals: {
      create: (input, created) => {
        const rec = {
          ...input,
          id: `p${proposals.size + 1}`,
          status: 'pending',
          created,
          resolved: null,
        } as ProposalRecord;
        proposals.set(rec.id, rec);
        return rec;
      },
      get: (id: string) => proposals.get(id) ?? null,
      list: () => [...proposals.values()],
      setStatus: (id: string, status: string) => {
        const rec = proposals.get(id);
        if (rec) Object.assign(rec, { status });
      },
      setEditedPayload: (id: string, payload: unknown) => {
        edits[id] = payload;
      },
      pendingCount: () => 0,
    } as never,
  };
  return { ctx, store, edits };
}

function noteCard(ctx: UseCaseContext, title: string): ProposalRecord {
  return ctx.proposals.create(
    {
      kind: 'note',
      sessionId: 's1',
      skill: 'arrival',
      targetPath: 'notes/swaps.md',
      baseHash: null,
      payload: {
        path: 'notes/swaps.md',
        frontmatter: { type: 'note', title, summary: 'swaps' },
        body: 'A manager cannot see a swap request today.',
        rationale: 'from the steering meeting',
      },
      rationale: 'from the steering meeting',
      evidence: [],
      inference: false,
    },
    1,
  );
}

test('their version lands, and is kept beside the one that was drafted', async () => {
  const { ctx, store, edits } = fakeContext();
  const rec = noteCard(ctx, 'Swap request notifications');
  const theirs = {
    ...(rec.payload as Record<string, unknown>),
    body: 'Staff never hear that a swap was asked for.',
  };

  const result = await acceptProposal(ctx, rec.id, theirs);

  assert.equal(result.ok, true);
  assert.equal(store.get('notes/swaps.md')?.body, 'Staff never hear that a swap was asked for.');
  assert.deepEqual(edits[rec.id], theirs);
  // The draft is still there to compare their version against.
  assert.equal(
    (rec.payload as { body: string }).body,
    'A manager cannot see a swap request today.',
  );
});

test('a card kept as drafted keeps no edit', async () => {
  const { ctx, edits } = fakeContext();
  const rec = noteCard(ctx, 'Swap request notifications');

  assert.equal((await acceptProposal(ctx, rec.id)).ok, true);
  assert.deepEqual(edits, {});
});

test('an approval that could not be applied stores nothing', async () => {
  const { ctx, edits } = fakeContext();
  const rec = noteCard(ctx, 'Swap request notifications');

  // A note card writes a NEW note, so a second one over the same path refuses.
  assert.equal((await acceptProposal(ctx, rec.id)).ok, true);
  const again = noteCard(ctx, 'Swap request notifications');
  const result = await acceptProposal(ctx, again.id, {
    ...(again.payload as Record<string, unknown>),
    body: 'theirs',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(edits[again.id], undefined);
});
