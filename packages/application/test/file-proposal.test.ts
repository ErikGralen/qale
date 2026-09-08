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
// spot with an Activity row behind it (docs/easier-tickets.md E-3, E-9). Since
// docs/fewer-approvals.md FA-1 the answer comes from what the write does: a
// send, a delete, a rewrite of the PM's own prose and anything Qale assumed
// wait, and this is where the last two facts are worked out.

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
      latestLearned: () => [],
      forProposal: (id: string) => activity.find((r) => r.proposalId === id) ?? null,
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

test('a todo lands on the spot', async () => {
  const { ctx, store, rows, activity } = fakeContext();
  const filed = await fileProposal(
    ctx,
    {
      ...base,
      kind: 'note',
      targetPath: 'todos/2026-09-02-send-the-dates.md',
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

  assert.equal(filed.disposition, 'silent');
  assert.equal(filed.reason, 'Your list stays on your machine, for you to read.');
  assert.ok(store.has('todos/2026-09-02-send-the-dates.md'));
  assert.equal(rows.get(filed.rec.id)!.status, 'accepted');
  assert.equal(activity.length, 1);
});

test('a write in the memory lands, whether it adds or rewrites', async () => {
  const files = {
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

  const appended = fakeContext(files);
  const one = await fileProposal(
    appended.ctx,
    {
      ...base,
      kind: 'update',
      targetPath: 'customers/nordkap.md',
      payload: {
        path: 'customers/nordkap.md',
        append: '## Signals\n\nThey asked for SCIM twice.',
        rationale: 'Because.',
      },
    },
    { noteType: 'customer', appendOnly: true },
  );
  assert.equal(one.disposition, 'silent');
  assert.match(appended.store.get('customers/nordkap.md')!.body, /SCIM twice\./);
  assert.equal(appended.activity[0]!.action, 'updated');
  assert.deepEqual(appended.activity[0]!.revert, { commit: 'c0ffee', undo: 'restore' });

  const patched = fakeContext(files);
  const two = await fileProposal(
    patched.ctx,
    {
      ...base,
      kind: 'update',
      targetPath: 'customers/nordkap.md',
      payload: {
        path: 'customers/nordkap.md',
        patch: [{ search: 'The old line.', replace: 'The new line.' }],
        rationale: 'Because.',
      },
    },
    { noteType: 'customer' },
  );
  assert.equal(two.disposition, 'silent');
  assert.equal(patched.store.get('customers/nordkap.md')!.body, 'The new line.');
});

// What a write does to the PM's own text (docs/fewer-approvals.md FA-1). The
// meeting page below is the layout the app writes: `## Notes` is theirs, and
// the write-up under `## Summary` is Qale's.

const MEETING = {
  'meetings/2026-09-01-standup.md': {
    frontmatter: {
      type: 'meeting',
      title: 'Standup',
      summary: 'Standup',
      date: '2026-09-01',
    } as unknown as Frontmatter,
    body: '## Notes\n\nÅsa wants the dates by Friday.\n\n## Summary\n\nThe old line.\n',
  },
};

test('a write-up added to a meeting page lands', async () => {
  const { ctx, store, rows, activity } = fakeContext({
    'meetings/2026-09-01-standup.md': {
      ...MEETING['meetings/2026-09-01-standup.md'],
      body: '## Notes\n',
    },
  });
  const filed = await fileProposal(
    ctx,
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
  assert.equal(filed.disposition, 'silent');
  assert.match(store.get('meetings/2026-09-01-standup.md')!.body, /It went fine\./);
  assert.equal(rows.get(filed.rec.id)!.status, 'accepted');
  assert.equal(activity.length, 1);
});

test("a patch into the PM's notes on a meeting page waits", async () => {
  const { ctx, store, rows } = fakeContext(MEETING);
  const filed = await fileProposal(
    ctx,
    {
      ...base,
      kind: 'update',
      targetPath: 'meetings/2026-09-01-standup.md',
      payload: {
        path: 'meetings/2026-09-01-standup.md',
        patch: [
          { search: 'Åsa wants the dates by Friday.', replace: 'Åsa wants the dates by Monday.' },
        ],
        rationale: 'Because.',
      },
    },
    { noteType: 'meeting' },
  );
  assert.equal(filed.disposition, 'ask');
  assert.equal(filed.reason, 'This rewrites what you wrote, so you see it first.');
  assert.match(store.get('meetings/2026-09-01-standup.md')!.body, /by Friday\./);
  assert.equal(rows.get(filed.rec.id)!.status, 'pending');
});

test("a patch into the write-up on a meeting page lands, because it is Qale's", async () => {
  const { ctx, store } = fakeContext(MEETING);
  const filed = await fileProposal(
    ctx,
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
  assert.equal(filed.disposition, 'silent');
  assert.match(store.get('meetings/2026-09-01-standup.md')!.body, /The new line\./);
});

test('a patch into a document waits, whatever section it hits', async () => {
  const files = {
    'notes/rollout-runbook.md': {
      frontmatter: {
        type: 'note',
        title: 'Rollout runbook',
        summary: 'x',
      } as unknown as Frontmatter,
      body: '## Steps\n\nTurn Entra on first.\n',
    },
  };
  const patched = fakeContext(files);
  const filed = await fileProposal(
    patched.ctx,
    {
      ...base,
      kind: 'update',
      targetPath: 'notes/rollout-runbook.md',
      payload: {
        path: 'notes/rollout-runbook.md',
        patch: [{ search: 'Turn Entra on first.', replace: 'Turn Entra on last.' }],
        rationale: 'Because.',
      },
    },
    { noteType: 'note' },
  );
  assert.equal(filed.disposition, 'ask');
  assert.equal(filed.reason, 'This rewrites what you wrote, so you see it first.');
  assert.equal(
    patched.store.get('notes/rollout-runbook.md')!.body,
    '## Steps\n\nTurn Entra on first.\n',
  );

  // The same page, added to at the end, rewrites nothing they wrote.
  const appended = fakeContext(files);
  const two = await fileProposal(
    appended.ctx,
    {
      ...base,
      kind: 'update',
      targetPath: 'notes/rollout-runbook.md',
      payload: {
        path: 'notes/rollout-runbook.md',
        append: 'One line under Entra.',
        rationale: 'Because.',
      },
    },
    { noteType: 'note', appendOnly: true },
  );
  assert.equal(two.disposition, 'silent');
  assert.match(appended.store.get('notes/rollout-runbook.md')!.body, /One line under Entra\./);
});

test('a rewrite the PM asked for in the chat lands', async () => {
  const { ctx, store } = fakeContext({
    'notes/rollout-runbook.md': {
      frontmatter: {
        type: 'note',
        title: 'Rollout runbook',
        summary: 'x',
      } as unknown as Frontmatter,
      body: 'Turn Entra on first.\n',
    },
  });
  const filed = await fileProposal(
    ctx,
    {
      ...base,
      kind: 'update',
      targetPath: 'notes/rollout-runbook.md',
      asked: true,
      payload: {
        path: 'notes/rollout-runbook.md',
        patch: [{ search: 'Turn Entra on first.', replace: 'Turn Entra on last.' }],
        rationale: 'You asked for this in chat.',
      },
    },
    { noteType: 'note' },
  );
  assert.equal(filed.disposition, 'silent');
  assert.match(store.get('notes/rollout-runbook.md')!.body, /on last\./);
});

test('a write the run had to assume waits, wherever it points', async () => {
  const { ctx, store, rows } = fakeContext();
  const filed = await fileProposal(ctx, {
    ...base,
    kind: 'note',
    targetPath: 'research/pricing.md',
    rationale: 'Assumed: this transcript is the Nordkap check-in, not the Kranelund one.',
    payload: {
      path: 'research/pricing.md',
      frontmatter: { type: 'research', title: 'Pricing', summary: 'x' },
      body: 'x',
      rationale: 'Assumed: this transcript is the Nordkap check-in, not the Kranelund one.',
    },
  });
  assert.equal(filed.disposition, 'ask');
  assert.equal(filed.reason, 'Qale assumed something here, so it waits for you.');
  assert.equal(store.size, 0);
  assert.equal(rows.get(filed.rec.id)!.status, 'pending');
});

test('a send waits, and writes nothing', async () => {
  const { ctx, rows, activity } = fakeContext();
  const filed = await fileProposal(ctx, {
    ...base,
    kind: 'outbound',
    rationale: 'Because.',
    payload: {
      type: 'comment',
      provider: 'jira',
      target: 'PAY-142',
      body: 'The dates are confirmed.',
    },
  });
  assert.equal(filed.disposition, 'ask');
  assert.equal(filed.reason, 'Nothing sent to another system can be taken back.');
  assert.equal(rows.get(filed.rec.id)!.status, 'pending');
  assert.equal(activity.length, 0);
});

test('a decision lands on the spot, and supersedes the one it replaces', async () => {
  const { ctx, store, rows, activity } = fakeContext({
    'decisions/use-firebase-auth.md': {
      frontmatter: {
        type: 'decision',
        title: 'Use Firebase auth',
        summary: 'Use Firebase auth',
        standing: 'active',
        date: '2026-06-01',
      } as unknown as Frontmatter,
      body: 'It was the fastest way in.',
    },
  });
  const filed = await fileProposal(
    ctx,
    {
      ...base,
      kind: 'decision',
      targetPath: 'decisions/adopt-workos.md',
      payload: {
        path: 'decisions/adopt-workos.md',
        frontmatter: {
          type: 'decision',
          title: 'Adopt WorkOS',
          summary: 'Adopt WorkOS',
          standing: 'active',
          date: '2026-09-02',
        },
        body: 'Nordkap needs SCIM.',
        rationale: 'Because.',
        supersedes: 'decisions/use-firebase-auth',
      },
    },
    { noteType: 'decision' },
  );

  assert.equal(filed.disposition, 'silent');
  assert.equal(rows.get(filed.rec.id)!.status, 'accepted');
  assert.ok(store.has('decisions/adopt-workos.md'));
  // The old decision is never edited, only flipped and pointed forward.
  const old = store.get('decisions/use-firebase-auth.md')!;
  assert.equal(old.frontmatter['standing'], 'superseded');
  assert.equal(old.frontmatter['superseded_by'], '[[decisions/adopt-workos]]');
  assert.equal(old.body, 'It was the fastest way in.');
  assert.equal(
    store.get('decisions/adopt-workos.md')!.frontmatter['supersedes'],
    '[[decisions/use-firebase-auth]]',
  );
  assert.equal(activity.length, 1);
  assert.equal(activity[0]!.action, 'created');
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
    targetPath: 'research/product.md',
    payload: {
      path: 'research/product.md',
      frontmatter: { type: 'research', title: 'Product', summary: 'What the product is' },
      body: 'x',
      rationale: 'Because.',
    },
  });
  assert.equal(filed.disposition, 'silent');
  assert.equal(filed.activityId, undefined);
  assert.ok(store.has('research/product.md'));
});
