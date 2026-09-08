import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeNote,
  type ActivityRecord,
  type CreateActivityInput,
  type Frontmatter,
} from '@qale/domain';
import { applyAndRecord } from '../src/index.js';
import type { CreateProposalInput, ProposalRecord, UseCaseContext } from '../src/ports.js';

/**
 * RI-4: the MCP server's `log_decision` writes at once, because the caller on
 * the other end already ran its own approval. `applyAndRecord` is the use
 * case behind it — create, accept, record — with no write-policy ruling in
 * between, and a failed accept leaves nothing pending.
 */

interface Stored {
  frontmatter: Frontmatter;
  body: string;
}

function fakeContext(files: Record<string, Stored> = {}) {
  const store = new Map(Object.entries(files));
  const rows = new Map<string, ProposalRecord>();
  const activity: ActivityRecord[] = [];
  let seq = 0;
  const note = (path: string, s: Stored) =>
    makeNote({ path, frontmatter: s.frontmatter, body: s.body, mtime: 1 });

  const ctx = {
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
        const prev = store.get(p)!;
        store.set(p, { frontmatter: prev.frontmatter, body });
        return note(p, { frontmatter: prev.frontmatter, body });
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
      available: async () => true,
      isRepo: async () => true,
      init: async () => {},
      ensureIgnored: async () => {},
      commitPaths: async () => {},
      history: async () => [{ hash: 'c0ffee', date: '2026-09-05', message: 'x', author: 'q' }],
      fileAt: async () => null,
    },
    clock: { now: () => '2026-09-05T09:00:00.000Z' },
    proposals: {
      create: (input: CreateProposalInput, now: number) => {
        const rec: ProposalRecord = {
          id: `p_${++seq}`,
          kind: input.kind,
          sessionId: input.sessionId,
          skill: input.skill ?? null,
          targetPath: input.targetPath,
          baseHash: input.baseHash,
          payload: input.payload,
          rationale: input.rationale,
          evidence: input.evidence,
          inference: input.inference,
          asked: input.asked,
          status: 'pending',
          created: now,
          resolved: null,
        };
        rows.set(rec.id, rec);
        return rec;
      },
      list: (status?: string) => [...rows.values()].filter((r) => !status || r.status === status),
      get: (id: string) => rows.get(id) ?? null,
      setStatus: (id: string, status: string) => {
        const rec = rows.get(id);
        if (rec) rows.set(id, { ...rec, status });
      },
      updatePayload: () => {},
      pendingCount: () => [...rows.values()].filter((r) => r.status === 'pending').length,
    },
    activity: {
      record: (input: CreateActivityInput, now: number) => {
        const row: ActivityRecord = {
          ...input,
          id: `a_${activity.length + 1}`,
          at: now,
          reverted: null,
        };
        activity.push(row);
        return row;
      },
      list: () => [...activity].reverse(),
      get: (id: string) => activity.find((r) => r.id === id) ?? null,
      latestLearned: () => [],
      forProposal: (id: string) => activity.find((r) => r.proposalId === id) ?? null,
      markReverted: () => {},
    },
  } as unknown as UseCaseContext;
  return { ctx, store, rows, activity };
}

const decisionInput = (path: string): CreateProposalInput => ({
  kind: 'decision',
  sessionId: 'mcp',
  skill: 'mcp',
  targetPath: path,
  baseHash: null,
  payload: {
    path,
    frontmatter: { type: 'decision', summary: 'Adopt WorkOS', sources: [] },
    body: 'We adopt WorkOS for SSO.',
    rationale: 'Logged via MCP: Adopt WorkOS',
  },
  rationale: 'Logged via MCP: Adopt WorkOS',
  evidence: [],
  inference: true,
});

test('a decision writes at once and leaves one Activity row, no card left pending', async () => {
  const { ctx, store, rows, activity } = fakeContext();
  const path = 'decisions/2026-09-05-adopt-workos.md';
  const applied = await applyAndRecord(ctx, decisionInput(path), 'the MCP client approved it');

  assert.equal(applied.ok, true);
  assert.equal(applied.path, path);
  assert.ok(store.has(path), 'the decision file landed');
  assert.equal(rows.get(applied.rec.id)!.status, 'accepted');
  assert.equal(activity.length, 1);
  assert.equal(activity[0]!.reason, 'the MCP client approved it');
  assert.equal(activity[0]!.sessionId, 'mcp');
  assert.equal(activity[0]!.skill, 'mcp');
});

test('a decision that cannot land is rejected, not left pending, and the error comes back', async () => {
  const path = 'decisions/2026-09-05-adopt-workos.md';
  const { ctx, rows, activity } = fakeContext({
    [path]: { frontmatter: { type: 'decision' } as unknown as Frontmatter, body: 'Already here.' },
  });
  const applied = await applyAndRecord(ctx, decisionInput(path), 'the MCP client approved it');

  assert.equal(applied.ok, false);
  assert.match(applied.error ?? '', /already exists/);
  assert.equal(rows.get(applied.rec.id)!.status, 'rejected');
  assert.equal(activity.length, 0);
});
