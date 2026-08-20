import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicatePending } from '../src/use-cases/proposals.js';
import type { CreateProposalInput, ProposalRecord, UseCaseContext } from '../src/ports.js';

/**
 * The half of the duplicate check that lives outside the pure function: reading
 * a card's title back out of a stored payload.
 *
 * The domain side is exercised in `@qale/domain`'s duplicate.test.ts. What can
 * only break here is the shape — a todo keeps its title in
 * `payload.frontmatter.title`, an update has no title at all and is identified
 * by its rationale — so a change to either payload silently turns the check
 * into a no-op that still passes every test on the other side.
 */

function worldWith(pending: Partial<ProposalRecord>[]): UseCaseContext {
  const rows = pending.map((p, i) => ({
    id: `p${i + 1}`,
    kind: 'note',
    sessionId: 's1',
    skill: null,
    targetPath: null,
    baseHash: null,
    payload: {},
    rationale: '',
    evidence: [],
    inference: false,
    status: 'pending',
    created: 0,
    resolved: null,
    ...p,
  })) as ProposalRecord[];
  return {
    proposals: {
      create: (_input: CreateProposalInput) => rows[0]!,
      list: (status?: string) => rows.filter((r) => !status || r.status === status),
      get: (id: string) => rows.find((r) => r.id === id) ?? null,
      setStatus: () => {},
      pendingCount: () => rows.filter((r) => r.status === 'pending').length,
    },
  } as unknown as UseCaseContext;
}

/** A todo card exactly as `propose_todo` stores one. */
const todoCard = (title: string, path: string): Partial<ProposalRecord> => ({
  kind: 'note',
  targetPath: path,
  payload: {
    path,
    frontmatter: { type: 'todo', summary: title, title, commitment: 'open', sources: [] },
    body: '',
    rationale: 'heard on the call',
  },
  rationale: 'heard on the call',
});

test('a pending todo is found by the title inside its payload', () => {
  const ctx = worldWith([todoCard('Get back to Jonas on pricing', 'todos/2026-08-04-get-back.md')]);
  const hit = duplicatePending(ctx, {
    kind: 'note',
    targetPath: 'todos/2026-08-05-get-back.md',
    noteType: 'todo',
    title: 'Get back to Jonas about pricing',
  });
  assert.equal(hit?.id, 'p1', 'the same commitment proposed a day later, at a different path');
});

test('a resolved card is not consulted — discarding one is not a standing veto', () => {
  const ctx = worldWith([
    { ...todoCard('Get back to Jonas on pricing', 'todos/a.md'), status: 'rejected' },
  ]);
  assert.equal(
    duplicatePending(ctx, {
      kind: 'note',
      targetPath: 'todos/b.md',
      noteType: 'todo',
      title: 'Get back to Jonas on pricing',
    }),
    null,
  );
});

test('an update is identified by its rationale, having no title of its own', () => {
  const ctx = worldWith([
    {
      kind: 'update',
      targetPath: 'customers/nordkap.md',
      payload: {
        path: 'customers/nordkap.md',
        patch: [{ search: 'x', replace: 'y' }],
        rationale: 'record the SSO rollout dates they were given',
      },
      rationale: 'record the SSO rollout dates they were given',
    },
  ]);
  assert.ok(
    duplicatePending(ctx, {
      kind: 'update',
      targetPath: 'customers/nordkap.md',
      title: 'record the SSO rollout dates they were given',
    }),
  );
  assert.equal(
    duplicatePending(ctx, {
      kind: 'update',
      targetPath: 'customers/nordkap.md',
      title: 'answer their open question about billing exports',
    }),
    null,
  );
});

test('an empty queue never matches', () => {
  assert.equal(
    duplicatePending(worldWith([]), {
      kind: 'note',
      targetPath: 'todos/a.md',
      noteType: 'todo',
      title: 'Anything',
    }),
    null,
  );
});
