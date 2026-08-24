import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptProposal } from '../src/index.js';
import type { ProposalRecord, UseCaseContext } from '../src/ports.js';

/**
 * An outbound card approved with nothing connected. The card stays pending and
 * the error says what to do about it, in provider-neutral words: the outbound
 * port serves every connector now, so naming Atlassian would send half the
 * users to the wrong Settings row (docs/provider-decoupling.md PD-5).
 */

const CARD = {
  id: 'p1',
  kind: 'outbound',
  status: 'pending',
  payload: {
    provider: 'jira',
    action: 'comment_ticket',
    targetId: 'PAY-142',
    body: 'Confirmed for the July release.',
    rationale: 'The PM said so in the QBR.',
  },
} as unknown as ProposalRecord;

function fakeContext(): UseCaseContext {
  const statuses: Record<string, string> = {};
  return {
    proposals: {
      get: (id: string) => (id === CARD.id ? CARD : null),
      setStatus: (id: string, status: string) => void (statuses[id] = status),
    },
  } as unknown as UseCaseContext;
}

test('an outbound card with nothing connected says so without naming a provider', async () => {
  const result = await acceptProposal(fakeContext(), CARD.id);

  assert.equal(result.ok, false);
  assert.equal(result.error, 'no outbound connection is configured (connect one in Settings)');
});
