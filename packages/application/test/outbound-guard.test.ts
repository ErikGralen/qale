import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { CreateProposalInput, ProposalRecord, UseCaseContext } from '../src/ports.js';

/**
 * A send never lands, whatever the policy answers (docs/fewer-approvals.md, the
 * constraint above the tickets).
 *
 * The policy already grades a send as waiting, so the guard in `fileProposal`
 * only earns its place when the policy is wrong. That is what this file makes
 * happen: `writePolicy` is replaced with one that says every write lands, and
 * the send still waits. Its own file, because the stub has to be in place
 * before `fileProposal` is imported.
 */

const domain = await import('@qale/domain');

mock.module('@qale/domain', {
  namedExports: {
    ...domain,
    writePolicy: () => ({ disposition: 'silent', reason: 'A broken rule says this lands.' }),
  },
});

const { fileProposal } = await import('../src/index.js');

test('a send waits even when the policy says it lands', async () => {
  const rows = new Map<string, ProposalRecord>();
  let applied = 0;
  const ctx = {
    proposals: {
      create: (input: CreateProposalInput, now: number) => {
        const rec = {
          id: 'p_1',
          ...input,
          skill: input.skill ?? null,
          status: 'pending',
          created: now,
          resolved: null,
        } as unknown as ProposalRecord;
        rows.set(rec.id, rec);
        return rec;
      },
      get: (id: string) => rows.get(id) ?? null,
      list: () => [...rows.values()],
      setStatus: (id: string, status: string) => {
        applied++;
        const rec = rows.get(id);
        if (rec) rows.set(id, { ...rec, status });
      },
      updatePayload: () => {},
      pendingCount: () => rows.size,
    },
  } as unknown as UseCaseContext;

  const filed = await fileProposal(ctx, {
    kind: 'outbound',
    sessionId: 's1',
    targetPath: null,
    baseHash: null,
    payload: { type: 'comment', provider: 'jira', target: 'PAY-142', body: 'Confirmed.' },
    rationale: 'Because.',
    evidence: [],
    inference: false,
  });

  assert.equal(filed.disposition, 'ask');
  assert.equal(rows.get(filed.rec.id)!.status, 'pending');
  assert.equal(applied, 0);
  // The sentence stays the policy's own one for a send, never the broken rule's.
  assert.equal(filed.reason, 'Nothing sent to another system can be taken back.');
});
