import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeNote, type Frontmatter } from '@pm/domain';
import { acceptProposal, contentHash, previewProposal } from '../src/index.js';
import type { ProposalRecord, UseCaseContext } from '../src/ports.js';

// An update card can carry `frontmatter` — a shallow merge over the note's
// current properties. It's the only card path that edits metadata (a todo's
// `due`/`status`), so a reschedule/close applies without touching the body, and
// a metadata-only card is never reported as an unanchored patch.

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
      sessionType: 'commitment-check',
      targetPath: payload['path'] as string,
      baseHash: contentHash(body),
      payload,
      rationale: 'handle',
      evidence: [],
      inference: false,
    },
    1,
  );
}

const todo = (over: Partial<Record<string, unknown>> = {}): Stored => ({
  frontmatter: {
    type: 'todo',
    summary: 'Send Nordkap the SSO rollout dates',
    title: 'Send Nordkap the SSO rollout dates',
    status: 'open',
    sources: [],
    due: '2026-07-10',
    ...over,
  } as Frontmatter,
  body: '> I\'ll get those dates over\n',
});

test('a frontmatter-only update reschedules the due date without touching the body', async () => {
  const { ctx, store, statuses } = fakeContext({ 'todos/nordkap-sso.md': todo() });
  const body = store.get('todos/nordkap-sso.md')!.body;
  const rec = updateCard(ctx, body, {
    path: 'todos/nordkap-sso.md',
    frontmatter: { due: '2026-08-01' },
    rationale: 'waiting on the eng ticket to land first',
  });

  const result = await acceptProposal(ctx, rec.id);
  assert.equal(result.ok, true);
  assert.equal(statuses[rec.id], 'accepted');
  const after = store.get('todos/nordkap-sso.md')!;
  assert.equal((after.frontmatter as Record<string, unknown>)['due'], '2026-08-01');
  assert.equal((after.frontmatter as Record<string, unknown>)['status'], 'open');
  assert.equal(after.body, body, 'body must be untouched by a metadata-only edit');
});

test('a frontmatter-only update closes the todo (status + resolved)', async () => {
  const { ctx, store } = fakeContext({ 'todos/nordkap-sso.md': todo() });
  const body = store.get('todos/nordkap-sso.md')!.body;
  const rec = updateCard(ctx, body, {
    path: 'todos/nordkap-sso.md',
    frontmatter: { status: 'done', resolved: '2026-07-22' },
    rationale: 'the dates went out in the Friday recap',
  });

  const result = await acceptProposal(ctx, rec.id);
  assert.equal(result.ok, true);
  const after = store.get('todos/nordkap-sso.md')!.frontmatter as Record<string, unknown>;
  assert.equal(after['status'], 'done');
  assert.equal(after['resolved'], '2026-07-22');
});

test('an update carries both a body patch and a frontmatter change', async () => {
  const { ctx, store } = fakeContext({ 'todos/nordkap-sso.md': todo() });
  const body = store.get('todos/nordkap-sso.md')!.body;
  const rec = updateCard(ctx, body, {
    path: 'todos/nordkap-sso.md',
    patch: [{ search: "I'll get those dates over", replace: 'Plan: pull dates from ENG-214, send Monday' }],
    frontmatter: { due: '2026-07-27' },
    rationale: 'plan + a realistic date',
  });

  const result = await acceptProposal(ctx, rec.id);
  assert.equal(result.ok, true);
  const after = store.get('todos/nordkap-sso.md')!;
  assert.match(after.body, /Plan: pull dates from ENG-214/);
  assert.equal((after.frontmatter as Record<string, unknown>)['due'], '2026-07-27');
});

test('a body-only update goes through writeBody — coerced frontmatter never round-trips', async () => {
  const { ctx, store } = fakeContext({ 'todos/nordkap-sso.md': todo() });
  const body = store.get('todos/nordkap-sso.md')!.body;
  let wroteNote = false;
  const origWriteNote = ctx.vault.writeNote;
  ctx.vault.writeNote = async (p, fm, b) => {
    wroteNote = true;
    return origWriteNote(p, fm, b);
  };
  const rec = updateCard(ctx, body, {
    path: 'todos/nordkap-sso.md',
    patch: [{ search: "I'll get those dates over", replace: 'Dates sent Monday' }],
    rationale: 'body only',
  });

  const result = await acceptProposal(ctx, rec.id);
  assert.equal(result.ok, true);
  assert.equal(wroteNote, false, 'a body-only card must use writeBody, not writeNote');
  assert.match(store.get('todos/nordkap-sso.md')!.body, /Dates sent Monday/);
});

test('preview reports the frontmatter change and is never unanchored for a metadata-only card', async () => {
  const { ctx, store } = fakeContext({ 'todos/nordkap-sso.md': todo() });
  const body = store.get('todos/nordkap-sso.md')!.body;
  const rec = updateCard(ctx, body, {
    path: 'todos/nordkap-sso.md',
    frontmatter: { due: '2026-08-01', status: 'open' },
    rationale: 'reschedule',
  });

  const preview = await previewProposal(ctx, rec.id);
  assert.ok(preview);
  assert.equal(preview!.stale, false);
  assert.equal(preview!.staleReason, undefined);
  // `status` is unchanged (open → open) so it drops out; only `due` is reported.
  assert.deepEqual(preview!.frontmatterChanges, [{ key: 'due', before: '2026-07-10', after: '2026-08-01' }]);
});
