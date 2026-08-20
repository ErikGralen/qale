import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listDeferrals, type UseCaseContext } from '@qale/application';
import { createDeferralTool } from '../src/deferrals.js';

/**
 * OW6 from the session's side: the tool a run calls when it decides to leave
 * something. It writes bookkeeping, not memory, so the only things worth
 * asserting here are that a real entry lands and that a refusal reads as one.
 */

const T0 = Date.parse('2026-08-05T09:00:00.000Z');

function ctxWith(paths: string[]): { ctx: UseCaseContext; rows: Map<string, string> } {
  const rows = new Map<string, string>();
  const ctx = {
    index: {
      get: (p: string) => (paths.includes(p) ? { path: p, type: 'note' } : null),
      resolve: (slug: string) => paths.find((p) => p === `${slug}.md`) ?? null,
      all: () => [],
    },
    checks: {
      get: (key: string) => rows.get(key) ?? null,
      set: (key: string, value: string) => void rows.set(key, value),
      list: (prefix: string) =>
        [...rows.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => ({ key, value })),
      remove: (key: string) => void rows.delete(key),
    },
  } as unknown as UseCaseContext;
  return { ctx, rows };
}

const run = (tool: { execute: (...a: never[]) => unknown }, params: unknown) =>
  (
    tool.execute as unknown as (
      id: string,
      p: unknown,
      s?: AbortSignal,
    ) => Promise<{ content: { text: string }[] }>
  )('call-1', params, undefined);

test('record_deferral leaves an entry a later run can read', async () => {
  const { ctx, rows } = ctxWith(['themes/pricing.md']);
  const tool = createDeferralTool(ctx, () => T0);

  const res = await run(tool as never, {
    note: 'themes/pricing',
    reason: 'Waiting on the Q3 interviews.',
  });
  assert.match(res.content[0]!.text, /Deferred themes\/pricing\.md/);

  assert.deepEqual([...rows.keys()], ['reason:deferred:themes/pricing.md']);
  const open = listDeferrals(ctx, T0);
  assert.equal(open.length, 1);
  assert.equal(open[0]!.reason, 'Waiting on the Q3 interviews.');
});

test('a deferral that anchors to nothing is refused, not stored loose', async () => {
  const { ctx, rows } = ctxWith(['themes/pricing.md']);
  const tool = createDeferralTool(ctx, () => T0);

  const res = await run(tool as never, { note: 'themes/onboarding', reason: 'later' });
  assert.match(res.content[0]!.text, /^Not recorded:/);
  assert.equal(rows.size, 0);
});
