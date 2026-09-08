import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IndexedNote, UseCaseContext } from '@qale/application';
import { createProposeTools } from '../src/tools.js';

/**
 * `propose_todo` against the ledger (docs/fewer-approvals.md FA-8).
 *
 * A todo lands without a card now, so the pending queue is empty by the time a
 * second spawn lane looks and `duplicatePending` sees nothing. Two lanes over
 * two transcripts of one meeting wrote "Send Nordkap the pricing" and "Pricing
 * to Nordkap" as two commitments. What this file covers: a title that says the
 * same thing is refused, one that only reads alike becomes a question, the PM's
 * answer gets through, and one lane sees the other before either has landed.
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

/** One open todo, as the index hands it over. */
function indexedTodo(path: string, title: string, lifecycle = 'open'): IndexedNote {
  return {
    path,
    slug: path.replace(/\.md$/, ''),
    type: 'todo',
    layer: 'authored',
    title,
    summary: title,
    lifecycle,
    hasBody: false,
    mtime: 0,
    frontmatter: { type: 'todo', title, commitment: lifecycle, sources: [] },
    links: [],
  } as unknown as IndexedNote;
}

/** A workspace with a ledger and nothing waiting on the PM. */
function ledgerCtx(todos: IndexedNote[]): UseCaseContext & { filed: Record<string, unknown>[] } {
  const filed: Record<string, unknown>[] = [];
  const rows = new Map<string, Record<string, unknown>>();
  return {
    index: {
      resolve: (t: string) =>
        t === 'meetings/2026-09-08-nordkap-qbr' ? 'meetings/2026-09-08-nordkap-qbr.md' : null,
      get: () => null,
      reindex: () => {},
      listByType: (type: string) => (type === 'todo' ? todos : []),
    },
    clock: { now: () => '2026-09-08T09:00:00.000Z' },
    vault: {
      exists: async () => false,
      writeNote: async (p: string, frontmatter: Record<string, unknown>, body: string) => ({
        path: p,
        slug: p.replace(/\.md$/, ''),
        type: frontmatter['type'],
        frontmatter,
        body,
      }),
    },
    git: { commitPaths: async () => {}, history: async () => [] },
    proposals: {
      create: (input: Record<string, unknown>) => {
        const rec = { ...input, id: `p${filed.length + 1}`, status: 'pending' };
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
    filed,
  } as unknown as UseCaseContext & { filed: Record<string, unknown>[] };
}

const todoTool = (ctx: UseCaseContext) =>
  createProposeTools(ctx, 'session-1').find((t) => t.name === 'propose_todo')!;

const SOURCES = ['[[meetings/2026-09-08-nordkap-qbr]]'];

const PRICING = 'todos/2026-09-01-send-nordkap-the-pricing.md';

test('a todo that says what an open one says is refused, with the link to it', async () => {
  const ctx = ledgerCtx([indexedTodo(PRICING, 'Send Nordkap the pricing')]);
  const said = await out(todoTool(ctx), {
    title: 'Pricing to Nordkap',
    rationale: 'Erik said he would.',
    sources: SOURCES,
  });

  assert.match(said, /^Not proposed\. This to-do already exists: /);
  assert.match(
    said,
    /\[\[todos\/2026-09-01-send-nordkap-the-pricing\|Send Nordkap the pricing\]\]/,
  );
  assert.match(said, /Update it instead of adding one\./);
  assert.equal(ctx.filed.length, 0);
});

test('a todo that only reads alike writes nothing and comes back as a question', async () => {
  const ctx = ledgerCtx([
    indexedTodo('todos/2026-09-01-q3-roadmap.md', 'Send Nordkap the Q3 roadmap'),
  ]);
  const said = await out(todoTool(ctx), {
    title: 'Send Nordkap the Q4 roadmap',
    rationale: 'Åsa promised the Q4 one too.',
    sources: SOURCES,
  });

  assert.match(said, /^Not proposed\. A to-do that may be the same exists: /);
  assert.match(said, /ask_user/);
  assert.match(said, /not_the_same_as "todos\/2026-09-01-q3-roadmap\.md"/);
  assert.equal(ctx.filed.length, 0);
});

test('the PM says they are different, and the todo lands', async () => {
  const ctx = ledgerCtx([
    indexedTodo('todos/2026-09-01-q3-roadmap.md', 'Send Nordkap the Q3 roadmap'),
  ]);
  const said = await out(todoTool(ctx), {
    title: 'Send Nordkap the Q4 roadmap',
    rationale: 'Åsa promised the Q4 one too.',
    sources: SOURCES,
    asked: true,
    not_the_same_as: 'todos/2026-09-01-q3-roadmap.md',
  });

  assert.match(said, /^Applied: Created Send Nordkap the Q4 roadmap\./);
  assert.equal(ctx.filed.length, 1);
});

test('not_the_same_as needs the ask behind it', async () => {
  const ctx = ledgerCtx([
    indexedTodo('todos/2026-09-01-q3-roadmap.md', 'Send Nordkap the Q3 roadmap'),
  ]);
  const said = await out(todoTool(ctx), {
    title: 'Send Nordkap the Q4 roadmap',
    rationale: 'Åsa promised the Q4 one too.',
    sources: SOURCES,
    not_the_same_as: 'todos/2026-09-01-q3-roadmap.md',
  });

  assert.match(said, /^Not proposed\. A to-do that may be the same exists: /);
  assert.equal(ctx.filed.length, 0);
});

test('a todo the PM already closed does not block a new one', async () => {
  const ctx = ledgerCtx([indexedTodo(PRICING, 'Send Nordkap the pricing', 'done')]);
  const said = await out(todoTool(ctx), {
    title: 'Pricing to Nordkap',
    rationale: 'They asked again.',
    sources: SOURCES,
  });

  assert.match(said, /^Applied: Created Pricing to Nordkap\./);
  assert.equal(ctx.filed.length, 1);
});

test('the second lane sees the first one before the index does', async () => {
  // Nothing on the ledger, and nothing indexed after the first write either:
  // the guard in the tool layer is the only thing that can catch this.
  const ctx = ledgerCtx([]);
  const tool = todoTool(ctx);

  const first = await out(tool, {
    title: 'Send Nordkap the pricing',
    rationale: 'Erik said he would.',
    sources: SOURCES,
  });
  assert.match(first, /^Applied: Created Send Nordkap the pricing\./);

  const second = await out(tool, {
    title: 'Pricing to Nordkap',
    rationale: 'Heard on the second recording.',
    sources: SOURCES,
  });
  assert.match(second, /^Not proposed\. This to-do already exists: /);
  assert.equal(ctx.filed.length, 1);
});

test('the guard is per workspace, so another vault is unaffected', async () => {
  const one = ledgerCtx([]);
  await out(todoTool(one), {
    title: 'Send Nordkap the pricing',
    rationale: 'Erik said he would.',
    sources: SOURCES,
  });

  const other = ledgerCtx([]);
  const said = await out(todoTool(other), {
    title: 'Send Nordkap the pricing',
    rationale: 'Erik said he would.',
    sources: SOURCES,
  });
  assert.match(said, /^Applied: Created Send Nordkap the pricing\./);
});
