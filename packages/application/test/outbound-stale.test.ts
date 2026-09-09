import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptProposal } from '../src/index.js';
import type { IndexedNote, ProposalRecord, UseCaseContext } from '../src/ports.js';

/**
 * The drafted-against-stale check reads a time, not a string.
 *
 * One moment has several ISO spellings, and the sync writes the provider's own
 * one. A mirror re-written as `…:00.000Z` over `…:00Z` moved nothing, so the
 * card it was drafted against still sends. A mirror that really moved still
 * refuses, and the refusal names the page the way the PM reads it.
 */

const MIRROR = {
  path: 'wikipages/confluence/roadmap-h2.md',
  title: 'Roadmap H2',
  frontmatter: {
    type: 'wikipage',
    provider: 'confluence',
    external_id: '4521985',
    version: 17,
    remote_updated: '2026-07-12T09:15:00.000Z',
  },
} as unknown as IndexedNote;

function card(snapshot: { remote_updated?: string; version?: number }): ProposalRecord {
  return {
    id: 'p1',
    kind: 'outbound',
    status: 'pending',
    payload: {
      provider: 'confluence',
      system: 'confluence',
      action: 'update_page',
      targetId: '4521985',
      body: 'Shift swaps move above payroll export.',
      rationale: 'The steering meeting decided it.',
      ...snapshot,
    },
  } as unknown as ProposalRecord;
}

function fakeContext(rec: ProposalRecord, mirror: IndexedNote = MIRROR): UseCaseContext {
  return {
    proposals: {
      get: (id: string) => (id === rec.id ? rec : null),
      setStatus: () => {},
      updatePayload: () => {},
    },
    index: { listByType: (type: string) => (type === 'wikipage' ? [mirror] : []) },
    outbound: {
      execute: async () => ({ externalId: '4521985', url: 'https://example.invalid/4521985' }),
    },
  } as unknown as UseCaseContext;
}

test('the same moment in another ISO spelling is not a change', async () => {
  const rec = card({ remote_updated: '2026-07-12T09:15:00Z', version: 17 });

  const result = await acceptProposal(fakeContext(rec), rec.id);

  assert.equal(result.ok, true);
  assert.equal(result.externalId, '4521985');
});

test('a page that really moved refuses, and the refusal names the page', async () => {
  const rec = card({ remote_updated: '2026-07-11T09:15:00Z', version: 17 });

  const result = await acceptProposal(fakeContext(rec), rec.id);

  assert.equal(result.ok, false);
  assert.equal(result.stale, true);
  assert.equal(
    result.error,
    'Roadmap H2 changed since this was drafted. Review the change, then approve again to send anyway',
  );
});

test('a new page version refuses, whatever the timestamp says', async () => {
  const rec = card({ remote_updated: '2026-07-12T09:15:00Z', version: 16 });

  const result = await acceptProposal(fakeContext(rec), rec.id);

  assert.equal(result.ok, false);
  assert.equal(result.stale, true);
});
