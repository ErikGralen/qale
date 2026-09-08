import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROVED_REASON,
  makeNote,
  type ActivityRecord,
  type CreateActivityInput,
  type Frontmatter,
} from '@qale/domain';
import { approveProposal, createProposal, fileProposal } from '../src/index.js';
import type { CreateProposalInput, ProposalRecord, UseCaseContext } from '../src/ports.js';

// A card the PM approved leaves the same Activity row a silent write leaves
// (docs/receipt-redesign.md RC-4), so the chat and Activity can put it back
// through the one revert path. Only the reason differs: "You approved it."
// A send records nothing, because nothing that has left the machine comes back.

interface Stored {
  frontmatter: Frontmatter;
  body: string;
}

function fakeContext(files: Record<string, Stored> = {}) {
  const store = new Map(Object.entries(files));
  const rows = new Map<string, ProposalRecord>();
  const activity: ActivityRecord[] = [];
  const sent: unknown[] = [];
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
      get: (p: string) => {
        const s = store.get(p);
        if (!s) return null;
        return {
          path: p,
          slug: p.replace(/\.md$/, ''),
          type: s.frontmatter['type'],
          frontmatter: s.frontmatter,
        };
      },
      all: () => [],
      listByType: () => [],
      search: () => [],
      backlinks: () => [],
      resolve: (slug: string) => (store.has(`${slug}.md`) ? `${slug}.md` : null),
      count: () => 0,
      clear: () => {},
    },
    git: {
      available: async () => true,
      isRepo: async () => true,
      init: async () => {},
      ensureIgnored: async () => {},
      commitPaths: async () => {},
      history: async () => [{ hash: 'c0ffee', date: '2026-09-08', message: 'x', author: 'q' }],
      fileAt: async () => null,
    },
    outbound: {
      execute: async (payload: unknown) => {
        sent.push(payload);
        return { externalId: 'PAY-171', url: 'https://example.invalid/PAY-171' };
      },
    },
    clock: { now: () => '2026-09-08T09:00:00.000Z' },
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
      setEditedPayload: () => {},
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
  return { ctx, store, rows, activity, sent };
}

const base = {
  sessionId: 's1',
  skill: 'meeting-prep',
  targetPath: null,
  baseHash: null,
  rationale: 'Because.',
  evidence: [],
  inference: false,
};

const NORDKAP = {
  'customers/nordkap.md': {
    frontmatter: {
      type: 'customer',
      title: 'Nordkap',
      summary: 'Nordkap',
      relationship: 'active',
    } as unknown as Frontmatter,
    body: 'The old line.',
  },
};

test('an approved note card leaves one row, with the commit and the way back', async () => {
  const { ctx, store, activity } = fakeContext();
  const path = 'documents/rollout-runbook.md';
  const rec = createProposal(ctx, {
    ...base,
    kind: 'note',
    targetPath: path,
    payload: {
      path,
      frontmatter: { type: 'note', title: 'Rollout runbook', summary: 'Rollout runbook' },
      body: 'Entra first.',
      rationale: 'Because.',
    },
  });

  const result = await approveProposal(ctx, rec.id);

  assert.equal(result.ok, true);
  assert.ok(store.has(path));
  assert.equal(activity.length, 1);
  const row = activity[0]!;
  assert.equal(result.activityId, row.id);
  assert.equal(row.reason, APPROVED_REASON);
  assert.equal(row.action, 'created');
  // The same line a silent write leaves: only the reason says who decided.
  assert.equal(row.line, 'I created Rollout runbook.');
  assert.equal(row.path, path);
  assert.equal(row.proposalId, rec.id);
  assert.equal(row.sessionId, 's1');
  assert.equal(row.skill, 'meeting-prep');
  assert.deepEqual(row.revert, { commit: 'c0ffee', undo: 'delete' });
});

test('an approved update card puts the file back to what it read before', async () => {
  const { ctx, store, activity } = fakeContext(NORDKAP);
  const path = 'customers/nordkap.md';
  const rec = createProposal(ctx, {
    ...base,
    kind: 'update',
    targetPath: path,
    payload: {
      path,
      patch: [{ search: 'The old line.', replace: 'The new line.' }],
      rationale: 'Because.',
    },
  });

  const result = await approveProposal(ctx, rec.id);

  assert.equal(result.ok, true);
  assert.equal(store.get(path)!.body, 'The new line.');
  assert.equal(activity.length, 1);
  assert.equal(activity[0]!.action, 'updated');
  assert.equal(activity[0]!.reason, APPROVED_REASON);
  assert.deepEqual(activity[0]!.revert, { commit: 'c0ffee', undo: 'restore' });
});

test('an approved decision card leaves a row that names the decision', async () => {
  const { ctx, activity } = fakeContext();
  const path = 'decisions/2026-09-08-adopt-workos.md';
  const rec = createProposal(ctx, {
    ...base,
    kind: 'decision',
    targetPath: path,
    payload: {
      path,
      frontmatter: { type: 'decision', summary: 'Adopt WorkOS', sources: [] },
      body: 'We adopt WorkOS for SSO.',
      rationale: 'Because.',
    },
  });

  const result = await approveProposal(ctx, rec.id);

  assert.equal(result.ok, true);
  assert.equal(activity.length, 1);
  assert.equal(activity[0]!.line, 'I recorded a decision: Adopt WorkOS.');
  assert.equal(activity[0]!.reason, APPROVED_REASON);
  assert.equal(result.activityId, activity[0]!.id);
});

test('an approved delete card leaves a row whose undo is a restore', async () => {
  const { ctx, store, activity } = fakeContext(NORDKAP);
  const path = 'customers/nordkap.md';
  const rec = createProposal(ctx, {
    ...base,
    kind: 'delete',
    targetPath: path,
    payload: { path, rationale: 'It says nothing.' },
  });

  const result = await approveProposal(ctx, rec.id);

  assert.equal(result.ok, true);
  assert.equal(store.has(path), false, 'the page is gone');
  assert.equal(activity.length, 1);
  assert.equal(activity[0]!.action, 'deleted');
  assert.equal(activity[0]!.path, path);
  assert.equal(activity[0]!.reason, APPROVED_REASON);
  // The file existed, so putting it back means its previous contents.
  assert.deepEqual(activity[0]!.revert, { commit: 'c0ffee', undo: 'restore' });
});

test('an approved send leaves no row, because nothing sent can be put back', async () => {
  const { ctx, activity, sent } = fakeContext();
  const rec = createProposal(ctx, {
    ...base,
    kind: 'outbound',
    targetPath: null,
    payload: {
      provider: 'jira',
      action: 'comment_ticket',
      targetId: 'PAY-142',
      body: 'Confirmed for the July release.',
      rationale: 'Because.',
    },
  });

  const result = await approveProposal(ctx, rec.id);

  assert.equal(result.ok, true);
  assert.equal(sent.length, 1, 'the send went out');
  assert.equal(activity.length, 0);
  assert.equal(result.activityId, undefined);
});

test('a card that could not be applied leaves no row', async () => {
  const { ctx, activity } = fakeContext(NORDKAP);
  const path = 'customers/nordkap.md';
  const rec = createProposal(ctx, {
    ...base,
    kind: 'note',
    targetPath: path,
    payload: {
      path,
      frontmatter: { type: 'note', title: 'Nordkap', summary: 'Nordkap' },
      body: 'A second one.',
      rationale: 'Because.',
    },
  });

  const result = await approveProposal(ctx, rec.id);

  assert.equal(result.ok, false);
  assert.equal(activity.length, 0);
  assert.equal(result.activityId, undefined);
});

test('a silent write still records exactly one row, in the policy words', async () => {
  const { ctx, activity } = fakeContext();
  const filed = await fileProposal(ctx, {
    ...base,
    kind: 'note',
    targetPath: 'research/acme-wants-scim.md',
    payload: {
      path: 'research/acme-wants-scim.md',
      frontmatter: { type: 'note', title: 'Acme wants SCIM', summary: 'Acme wants SCIM' },
      body: 'They asked twice.',
      rationale: 'Because.',
    },
  });

  assert.equal(filed.disposition, 'silent');
  assert.equal(activity.length, 1);
  assert.equal(activity[0]!.id, filed.activityId);
  assert.notEqual(activity[0]!.reason, APPROVED_REASON);
});
