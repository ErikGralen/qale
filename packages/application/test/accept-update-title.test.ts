import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeNote, type Frontmatter } from '@pm/domain';
import { acceptProposal, contentHash } from '../src/index.js';
import type { ProposalRecord, UseCaseContext } from '../src/ports.js';

// An update card may carry a `title` (Process-Note names a rough dump). Accepting
// applies the body patch, then retitles via rename semantics: the display title
// lands in frontmatter, and the FILE only moves while nothing links to it.

interface Stored {
  frontmatter: Frontmatter;
  body: string;
}

function fakeContext(files: Record<string, Stored>, opts?: { backlinked?: boolean }) {
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
      backlinks: () => (opts?.backlinked ? [{ fromPath: 'x.md' }] : []),
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
        const rec = { ...input, id: 'p1', status: 'pending', created, resolved: null } as ProposalRecord;
        proposals.set(rec.id, rec);
        return rec;
      },
      get: (id: string) => proposals.get(id) ?? null,
      list: () => [...proposals.values()],
      setStatus: (id: string, status) => {
        statuses[id] = status;
      },
      pendingCount: () => 0,
      stats: () => ({ total: 0, accepted: 0, rejected: 0, pending: 0, stale: 0, approvalRate: null, medianMsToResolve: null }),
    } as never,
  };
  return { ctx, store, statuses };
}

function updateCard(ctx: UseCaseContext, body: string, payload: Record<string, unknown>): ProposalRecord {
  return ctx.proposals.create(
    {
      kind: 'update',
      sessionId: 's1',
      sessionType: 'process-note',
      targetPath: payload['path'] as string,
      baseHash: contentHash(body),
      payload,
      rationale: 'tidy',
      evidence: [],
      inference: true,
    },
    1,
  );
}

test('accepting an update with a title patches the body and retitles the note', async () => {
  const body = 'sara called re sso\n';
  const { ctx, store, statuses } = fakeContext({
    'notes/2026-07-17-friday-scratch.md': {
      frontmatter: { type: 'note', summary: 'scratch', sources: [] } as Frontmatter,
      body,
    },
  });
  const rec = updateCard(ctx, body, {
    path: 'notes/2026-07-17-friday-scratch.md',
    patch: [{ search: 'sara called re sso', replace: '[[people/sara-lindqvist]] called about SSO' }],
    rationale: 'tidy',
    title: 'Nordkap SSO rollout notes',
  });

  const result = await acceptProposal(ctx, rec.id);
  assert.equal(result.ok, true);
  assert.equal(statuses[rec.id], 'accepted');

  // Nothing links here yet, so the rename moved the file (date prefix kept).
  assert.equal(store.has('notes/2026-07-17-friday-scratch.md'), false);
  const moved = store.get('notes/2026-07-17-nordkap-sso-rollout-notes.md');
  assert.ok(moved, `expected renamed file, have: ${[...store.keys()].join(', ')}`);
  assert.equal((moved.frontmatter as Record<string, unknown>)['title'], 'Nordkap SSO rollout notes');
  assert.match(moved.body, /\[\[people\/sara-lindqvist\]\] called about SSO/);
});

test('a cited note keeps its path — only the display title changes', async () => {
  const body = 'raw line\n';
  const { ctx, store } = fakeContext(
    {
      'notes/2026-07-17-friday-scratch.md': {
        frontmatter: { type: 'note', summary: 'scratch', sources: [] } as Frontmatter,
        body,
      },
    },
    { backlinked: true },
  );
  const rec = updateCard(ctx, body, {
    path: 'notes/2026-07-17-friday-scratch.md',
    patch: [{ search: 'raw line', replace: 'tidy line' }],
    rationale: 'tidy',
    title: 'Friday notes',
  });

  const result = await acceptProposal(ctx, rec.id);
  assert.equal(result.ok, true);
  const same = store.get('notes/2026-07-17-friday-scratch.md');
  assert.ok(same, 'cited slug must stay put');
  assert.equal((same.frontmatter as Record<string, unknown>)['title'], 'Friday notes');
  assert.match(same.body, /tidy line/);
});

test('an update without a title leaves the title alone', async () => {
  const body = 'raw line\n';
  const { ctx, store } = fakeContext({
    'notes/scratch.md': {
      frontmatter: { type: 'note', title: 'Kept', summary: 'scratch', sources: [] } as Frontmatter,
      body,
    },
  });
  const rec = updateCard(ctx, body, {
    path: 'notes/scratch.md',
    patch: [{ search: 'raw line', replace: 'tidy line' }],
    rationale: 'tidy',
  });

  const result = await acceptProposal(ctx, rec.id);
  assert.equal(result.ok, true);
  const same = store.get('notes/scratch.md')!;
  assert.equal((same.frontmatter as Record<string, unknown>)['title'], 'Kept');
});
