import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UseCaseContext } from '@qale/application';
import { askedHolds } from '../src/asked.js';
import { createDraftTools, createProposeTools } from '../src/tools.js';

/**
 * `asked` is the runtime's answer, not the model's (docs/fewer-approvals.md
 * FA-5).
 *
 * The flag says "the PM asked for this in the conversation", and the write
 * policy lets a write carrying it rewrite the PM's own prose without a card.
 * Nothing checked it, so a run nobody was watching could set it on every call.
 * What is tested here is that the runtime's facts win: a session with a PM in
 * it keeps the flag, a run with nobody in it loses it whatever the call says,
 * and an answered question is as good as a message.
 *
 * A send is not in this: the draft tools set no flag at all, and the last test
 * holds that line.
 */

const run = (tool: { execute: (...a: never[]) => unknown }, params: unknown) =>
  (
    tool.execute as unknown as (
      id: string,
      p: unknown,
      s?: AbortSignal,
    ) => Promise<{ content: { text: string }[] }>
  )('call-1', params, undefined);

const out = async (tool: unknown, params: unknown) =>
  (await run(tool as { execute: (...a: never[]) => unknown }, params)).content[0]!.text;

const DOC = 'notes/rollout-runbook.md';
const BODY = '# Rollout runbook\n\nEntra goes first, then the pilot.\n';

/**
 * A workspace holding one document of the PM's. A patch into it is the write
 * the flag actually decides: with `asked` it lands, without it the PM sees a
 * card (`rewritesUserText` in the application package).
 */
function docCtx(filed: Record<string, unknown>[]): UseCaseContext {
  const note = { path: DOC, slug: DOC.replace(/\.md$/, ''), type: 'note', frontmatter: {}, body: BODY };
  const rows = new Map<string, Record<string, unknown>>();
  return {
    vault: {
      readNote: async (p: string) => (p === DOC ? note : null),
      exists: async (p: string) => p === DOC,
      writeBody: async (p: string, next: string) => ({ ...note, path: p, body: next }),
    },
    index: {
      resolve: (t: string) => (t === note.slug || t === DOC ? DOC : null),
      get: () => null,
      all: () => [],
      reindex: () => {},
    },
    git: { commitPaths: async () => {}, history: async () => [] },
    clock: { now: () => '2026-09-08T09:00:00.000Z' },
    proposals: {
      create: (input: Record<string, unknown>) => {
        const rec = { ...input, id: `p${filed.length + 1}`, status: 'pending', evidence: [] };
        filed.push(input);
        rows.set(rec.id, rec);
        return rec;
      },
      list: () => [],
      get: (id: string) => rows.get(id) ?? null,
      setStatus: (id: string, status: string) => {
        const rec = rows.get(id);
        if (rec) rows.set(id, { ...rec, status });
      },
    },
  } as unknown as UseCaseContext;
}

const updateTool = (
  ctx: UseCaseContext,
  facts?: { pmTurn: boolean; askAnswered: boolean },
) =>
  createProposeTools(ctx, 'session-1', undefined, undefined, facts ? () => facts : undefined).find(
    (t) => t.name === 'propose_update',
  )!;

const PATCH = {
  path: DOC,
  patch: [{ search: 'Entra goes first', replace: 'The pilot goes first' }],
  rationale: 'You said to swap the order.',
  // Cited, so what the flag decides here is the card and nothing else. The
  // last test covers the other half: with nobody asking it cannot stand in for
  // sources either.
  sources: ['[[notes/rollout-runbook]]'],
  asked: true,
};

test('the flag holds when the PM wrote into this session', async () => {
  const filed: Record<string, unknown>[] = [];
  const said = await out(updateTool(docCtx(filed), { pmTurn: true, askAnswered: false }), PATCH);

  assert.equal(filed[0]!['asked'], true);
  // Their own instruction, so it lands rather than asking them to confirm it.
  assert.match(said, /^Applied: Updated /);
});

test('a run nobody was in loses the flag, whatever the call says', async () => {
  const filed: Record<string, unknown>[] = [];
  const said = await out(updateTool(docCtx(filed), { pmTurn: false, askAnswered: false }), PATCH);

  assert.equal(filed[0]!['asked'], false, 'the model declared it; the runtime cleared it');
  assert.match(said, /Awaiting review/);
  // And the model is told, so it does not report the card as a landed write.
  assert.match(said, /Nobody asked for this in this run/);
  assert.match(said, /This waits for the PM/);
});

test('an answered question is as good as a message', async () => {
  const filed: Record<string, unknown>[] = [];
  const said = await out(updateTool(docCtx(filed), { pmTurn: false, askAnswered: true }), PATCH);

  assert.equal(filed[0]!['asked'], true);
  assert.match(said, /^Applied: Updated /);
});

test('a card that never claimed the flag reads as it always did', async () => {
  const filed: Record<string, unknown>[] = [];
  const said = await out(updateTool(docCtx(filed), { pmTurn: false, askAnswered: false }), {
    ...PATCH,
    asked: undefined,
    inference: true,
  });

  assert.equal(filed[0]!['asked'], false);
  assert.match(said, /Awaiting review/);
  assert.doesNotMatch(said, /Nobody asked/, 'nothing was cleared, so there is nothing to say');
});

test('with nobody asking, the flag cannot stand in for sources either', async () => {
  const filed: Record<string, unknown>[] = [];
  const said = await out(updateTool(docCtx(filed), { pmTurn: false, askAnswered: false }), {
    path: DOC,
    append: 'The pilot goes first.',
    rationale: 'Worked out from the runbook.',
    asked: true,
  });

  assert.match(said, /^Rejected:/);
  assert.match(said, /no sources/);
  assert.match(said, /Nobody asked for this in this run/);
  assert.equal(filed.length, 0);
});

/**
 * The runtime is the only caller with these facts. Everything else (a test, a
 * call with no run behind it) leaves the declared flag as it was, which is what
 * keeps this ticket out of the other tool tests.
 */
test('askedHolds needs a fact to clear a flag', () => {
  assert.equal(askedHolds({ pmTurn: true, askAnswered: false }, true), true);
  assert.equal(askedHolds({ pmTurn: false, askAnswered: true }, true), true);
  assert.equal(askedHolds({ pmTurn: false, askAnswered: false }, true), false);
  assert.equal(askedHolds({ pmTurn: true, askAnswered: true }, false), false);
  assert.equal(askedHolds({ pmTurn: true, askAnswered: true }, undefined), false);
  assert.equal(askedHolds(undefined, true), true);
  assert.equal(askedHolds(undefined, false), false);
});

const CONTAINERS = [{ id: 'PAY', name: 'Payments', kind: 'ticket' as const, provider: 'jira' }];

function ticketCtx(filed: Record<string, unknown>[]): UseCaseContext {
  return {
    vault: { readNote: async () => null },
    index: {
      resolve: (t: string) => (t === 'meetings/nordkap' ? 'meetings/nordkap.md' : null),
      listByType: () => [],
    },
    proposals: {
      create: (input: Record<string, unknown>) => {
        filed.push(input);
        return { id: `p${filed.length}` };
      },
      list: () => [],
    },
  } as unknown as UseCaseContext;
}

/**
 * The constraint above every ticket in the doc: a send waits for the PM, and no
 * flag reaches it. The draft tools take no `asked` parameter, so a caller that
 * passes one is passing a field nothing reads.
 */
test('a draft never carries the flag, even when the caller sends one', async () => {
  const filed: Record<string, unknown>[] = [];
  const tool = createDraftTools(ticketCtx(filed), 'session-1', undefined, undefined, () =>
    CONTAINERS,
  ).find((t) => t.name === 'draft_ticket')!;

  const said = await out(tool, {
    container: 'PAY',
    title: 'SCIM group mapping drops on rename',
    body: 'Source: the Nordkap check-in, 2026-07-14',
    sources: ['meetings/nordkap'],
    rationale: 'Agreed in the check-in.',
    asked: true,
  });

  assert.match(said, /Awaiting approval/);
  assert.equal(filed.length, 1);
  assert.notEqual(filed[0]!['asked'], true);
  assert.equal(filed[0]!['kind'], 'outbound');
});
