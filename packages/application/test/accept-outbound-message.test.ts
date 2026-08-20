import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeNote, type Frontmatter } from '@qale/domain';
import { acceptProposal } from '../src/index.js';
import type { ProposalRecord, UseCaseContext } from '../src/ports.js';

// A 'message' outbound card saves its draft into the spawning note. When there
// is nowhere to save it (no linkBackPath, or the note is gone), the accept must
// FAIL and leave the card pending — never silently discard the draft.

interface Stored {
  frontmatter: Frontmatter;
  body: string;
}

function fakeContext(files: Record<string, Stored>) {
  const store = new Map(Object.entries(files));
  const proposals = new Map<string, ProposalRecord>();
  const statuses: Record<string, string> = {};
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
      writeBody: async (p: string, body: string) => {
        const s = store.get(p)!;
        store.set(p, { ...s, body });
        return note(p, { ...s, body });
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
    clock: { now: () => '2026-07-22T00:00:00.000Z' },
    proposals: {
      create: (input, created) => {
        const rec = {
          ...input,
          id: 'p1',
          status: 'pending',
          created,
          resolved: null,
        } as ProposalRecord;
        proposals.set(rec.id, rec);
        return rec;
      },
      get: (id: string) => proposals.get(id) ?? null,
      list: () => [...proposals.values()],
      setStatus: (id: string, status) => {
        statuses[id] = status;
      },
      pendingCount: () => 0,
    } as never,
  };
  return { ctx, store, statuses };
}

function messageCard(ctx: UseCaseContext, payload: Record<string, unknown>): ProposalRecord {
  return ctx.proposals.create(
    {
      kind: 'outbound',
      sessionId: 's1',
      skill: 'outbound',
      targetPath: (payload['linkBackPath'] as string | undefined) ?? null,
      baseHash: null,
      payload: { provider: 'message', action: 'send_message', rationale: 'draft', ...payload },
      rationale: 'draft',
      evidence: [],
      inference: false,
    },
    1,
  );
}

test('an accepted message draft lands in the link-back note', async () => {
  const { ctx, store, statuses } = fakeContext({
    'customers/nordkap.md': {
      frontmatter: { type: 'note', summary: 'Nordkap', sources: [] } as Frontmatter,
      body: 'Nordkap notes\n',
    },
  });
  const rec = messageCard(ctx, {
    body: 'Hello Nordkap',
    audience: 'CS',
    linkBackPath: 'customers/nordkap.md',
  });

  const result = await acceptProposal(ctx, rec.id);
  assert.equal(result.ok, true);
  assert.equal(statuses[rec.id], 'accepted');
  assert.match(store.get('customers/nordkap.md')!.body, /Hello Nordkap/);
});

test('a message draft with no link-back path refuses instead of silently accepting', async () => {
  const { ctx, statuses } = fakeContext({});
  const rec = messageCard(ctx, { body: 'Hello team' });

  const result = await acceptProposal(ctx, rec.id);
  assert.equal(result.ok, false);
  assert.match(result.error!, /link-back/);
  assert.equal(statuses[rec.id], undefined, 'the card must stay pending');
});

test('a message draft whose link-back note is gone refuses instead of dropping the draft', async () => {
  const { ctx, statuses } = fakeContext({});
  const rec = messageCard(ctx, { body: 'Hello team', linkBackPath: 'customers/gone.md' });

  const result = await acceptProposal(ctx, rec.id);
  assert.equal(result.ok, false);
  assert.match(result.error!, /no longer exists/);
  assert.equal(statuses[rec.id], undefined, 'the card must stay pending');
});
