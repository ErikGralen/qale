import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeNote,
  type ActivityRecord,
  type CreateActivityInput,
  type Frontmatter,
} from '@qale/domain';
import { fileProposal } from '../src/index.js';
import type { CreateProposalInput, ProposalRecord, UseCaseContext } from '../src/ports.js';

// Filing a write: the policy decides, one place, and a silent one lands on the
// spot with an Activity row behind it (docs/easier-tickets.md E-3, E-9).

interface Stored {
  frontmatter: Frontmatter;
  body: string;
}

function fakeContext(files: Record<string, Stored> = {}) {
  const store = new Map(Object.entries(files));
  const rows = new Map<string, ProposalRecord>();
  const activity: ActivityRecord[] = [];
  const committed: string[] = [];
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
      resolve: (slug: string) => (store.has(`${slug}.md`) ? `${slug}.md` : null),
      count: () => 0,
      clear: () => {},
    },
    git: {
      available: async () => true,
      isRepo: async () => true,
      init: async () => {},
      ensureIgnored: async () => {},
      commitPaths: async (paths: string[]) => void committed.push(...paths),
      history: async () => [{ hash: 'c0ffee', date: '2026-09-02', message: 'x', author: 'q' }],
      fileAt: async () => null,
    },
    clock: { now: () => '2026-09-02T09:00:00.000Z' },
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
      markReverted: () => {},
    },
  } as unknown as UseCaseContext;
  return { ctx, store, rows, activity, committed };
}

const base = {
  sessionId: 's1',
  targetPath: null,
  baseHash: null,
  rationale: 'Because.',
  evidence: [],
  inference: false,
};

test('a new note lands on the spot and leaves one Activity row', async () => {
  const { ctx, store, rows, activity } = fakeContext();
  const filed = await fileProposal(ctx, {
    ...base,
    kind: 'note',
    targetPath: 'insights/acme-wants-scim.md',
    payload: {
      path: 'insights/acme-wants-scim.md',
      frontmatter: { type: 'note', title: 'Acme wants SCIM', summary: 'Acme wants SCIM' },
      body: 'They asked twice.',
      rationale: 'Because.',
    },
  });

  assert.equal(filed.disposition, 'silent');
  assert.equal(filed.path, 'insights/acme-wants-scim.md');
  assert.ok(store.has('insights/acme-wants-scim.md'));
  assert.equal(rows.get(filed.rec.id)!.status, 'accepted');
  assert.equal(activity.length, 1);
  assert.equal(activity[0]!.line, 'I created Acme wants SCIM.');
  assert.equal(activity[0]!.action, 'created');
  assert.equal(activity[0]!.path, 'insights/acme-wants-scim.md');
  assert.equal(activity[0]!.proposalId, filed.rec.id);
  // Enough to put it back: the commit it landed in, and what undoing it means.
  assert.deepEqual(activity[0]!.revert, { commit: 'c0ffee', undo: 'delete' });
});

test('a todo waits, and writes nothing', async () => {
  const { ctx, store, rows, activity } = fakeContext();
  const filed = await fileProposal(
    ctx,
    {
      ...base,
      kind: 'note',
      targetPath: 'todos/2026-09-02-send-the-dates.md',
      asked: true,
      payload: {
        path: 'todos/2026-09-02-send-the-dates.md',
        frontmatter: {
          type: 'todo',
          title: 'Send the dates',
          summary: 'Send the dates',
          commitment: 'open',
        },
        body: '',
        rationale: 'Because.',
      },
    },
    { noteType: 'todo' },
  );

  assert.equal(filed.disposition, 'ask');
  assert.equal(store.size, 0);
  assert.equal(rows.get(filed.rec.id)!.status, 'pending');
  assert.equal(activity.length, 0);
});

test('an append lands, a patch waits', async () => {
  const files = {
    'meetings/2026-09-01-standup.md': {
      frontmatter: {
        type: 'meeting',
        title: 'Standup',
        summary: 'Standup',
        date: '2026-09-01',
      } as unknown as Frontmatter,
      body: 'The old line.',
    },
  };

  const appended = fakeContext(files);
  const one = await fileProposal(
    appended.ctx,
    {
      ...base,
      kind: 'update',
      targetPath: 'meetings/2026-09-01-standup.md',
      payload: {
        path: 'meetings/2026-09-01-standup.md',
        append: '## Summary\n\nIt went fine.',
        rationale: 'Because.',
      },
    },
    { noteType: 'meeting', appendOnly: true },
  );
  assert.equal(one.disposition, 'silent');
  assert.match(appended.store.get('meetings/2026-09-01-standup.md')!.body, /It went fine\./);
  assert.equal(appended.activity[0]!.action, 'updated');
  assert.deepEqual(appended.activity[0]!.revert, { commit: 'c0ffee', undo: 'restore' });

  const patched = fakeContext(files);
  const two = await fileProposal(
    patched.ctx,
    {
      ...base,
      kind: 'update',
      targetPath: 'meetings/2026-09-01-standup.md',
      payload: {
        path: 'meetings/2026-09-01-standup.md',
        patch: [{ search: 'The old line.', replace: 'The new line.' }],
        rationale: 'Because.',
      },
    },
    { noteType: 'meeting' },
  );
  assert.equal(two.disposition, 'grouped');
  assert.equal(patched.store.get('meetings/2026-09-01-standup.md')!.body, 'The old line.');
  assert.equal(patched.activity.length, 0);
});

test('a rule the PM stated lands, and the row quotes the rule', async () => {
  const { ctx, store, activity } = fakeContext({
    'skills/house-rules/SKILL.md': {
      frontmatter: {
        type: 'skill',
        title: 'House rules',
        summary: 'How Qale works.',
      } as unknown as Frontmatter,
      body: '# House rules\n\n## Your rules\n',
    },
  });
  const filed = await fileProposal(
    ctx,
    {
      ...base,
      kind: 'update',
      targetPath: 'skills/house-rules/SKILL.md',
      asked: true,
      payload: {
        path: 'skills/house-rules/SKILL.md',
        append: '\n- Create a person note for anyone a source names.',
        rationale: 'You asked for this in chat.',
      },
    },
    { noteType: 'skill', appendOnly: true },
  );

  assert.equal(filed.disposition, 'silent');
  assert.match(store.get('skills/house-rules/SKILL.md')!.body, /Create a person note/);
  assert.equal(activity[0]!.action, 'remembered');
  assert.equal(
    activity[0]!.line,
    'I remembered a rule: Create a person note for anyone a source names.',
  );
});

test('a write that cannot land stays in the queue and says why', async () => {
  const { ctx, rows, activity } = fakeContext({
    'insights/acme-wants-scim.md': {
      frontmatter: {
        type: 'note',
        title: 'Acme wants SCIM',
        summary: 'x',
      } as unknown as Frontmatter,
      body: 'Already here.',
    },
  });
  const filed = await fileProposal(ctx, {
    ...base,
    kind: 'note',
    targetPath: 'insights/acme-wants-scim.md',
    payload: {
      path: 'insights/acme-wants-scim.md',
      frontmatter: { type: 'note', title: 'Acme wants SCIM', summary: 'x' },
      body: 'A second one.',
      rationale: 'Because.',
    },
  });

  assert.equal(filed.disposition, 'ask');
  assert.match(filed.error!, /already exists/);
  assert.equal(rows.get(filed.rec.id)!.status, 'pending');
  assert.equal(activity.length, 0);
});

test('a workspace with no Activity log still applies the write', async () => {
  const { ctx, store } = fakeContext();
  (ctx as { activity?: unknown }).activity = undefined;
  const filed = await fileProposal(ctx, {
    ...base,
    kind: 'note',
    targetPath: 'understanding/product.md',
    payload: {
      path: 'understanding/product.md',
      frontmatter: { type: 'note', title: 'Product', summary: 'What the product is' },
      body: 'x',
      rationale: 'Because.',
    },
  });
  assert.equal(filed.disposition, 'silent');
  assert.equal(filed.activityId, undefined);
  assert.ok(store.has('understanding/product.md'));
});
