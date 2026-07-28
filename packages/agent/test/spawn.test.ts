import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpawnTool, planSpawn, SPAWN_MAX_CHILDREN, type SpawnChild, type SpawnPlan } from '../src/spawn.js';

const plan = (work: Parameters<typeof planSpawn>[0]): SpawnPlan => {
  const r = planSpawn(work);
  if ('error' in r) throw new Error(r.error);
  return r.plan;
};
const err = (work: Parameters<typeof planSpawn>[0]): string => {
  const r = planSpawn(work);
  if (!('error' in r)) throw new Error('expected a rejection');
  return r.error;
};

const run = (tool: { execute: unknown }, params: unknown) =>
  (tool.execute as (id: string, p: unknown, s?: AbortSignal) => Promise<{ content: { text: string }[] }>)(
    'call-1',
    params,
    undefined,
  );

test('an "over" entry is a template: one child per target, {target} in the path', () => {
  const p = plan([
    { prompt: 'What pain does this account describe?', over: ['sources/2026-06-12-nordkap.md', 'sources/a.md'], write_to: 'per-item/{target}.md' },
  ]);
  assert.equal(p.total, 2);
  assert.equal(p.entries.length, 1);
  assert.equal(p.entries[0]!.count, 2);
  assert.deepEqual(
    p.entries[0]!.children.map((c) => c.writeTo),
    ['per-item/nordkap.md', 'per-item/a.md'],
  );
  assert.deepEqual(p.entries[0]!.children[0]!.read, ['sources/2026-06-12-nordkap.md']);
});

test('the axis of variation can be the PROMPT, not the material — three lenses, one document', () => {
  const doc = ['sources/nordkap-qbr.md'];
  const p = plan([
    { prompt: 'Read this for pricing signals.', read: doc, write_to: 'pricing-read.md' },
    { prompt: 'Sweep this for commitments anyone made.', read: doc, write_to: 'commitment-sweep.md' },
    { prompt: 'What contradicts what we believe?', read: doc, write_to: 'contradictions.md' },
  ]);
  assert.equal(p.total, 3);
  assert.equal(p.entries.length, 3, 'each lens is its own line on the card, not one "3 targets" row');
  assert.ok(p.entries.every((e) => e.count === 1));
});

test('a mixed batch — a per-item sweep AND two standalone reads — is one call', () => {
  const p = plan([
    { prompt: 'One pass per insight.', over: ['insights/a.md', 'insights/b.md', 'insights/c.md'], write_to: 'per-item/{target}.md' },
    { prompt: 'Pricing read of the QBR.', read: ['sources/qbr.md'], write_to: 'pricing.md' },
    { prompt: 'Commitment sweep of the QBR.', read: ['sources/qbr.md'], write_to: 'commitments.md' },
  ]);
  assert.equal(p.total, 5);
  assert.deepEqual(
    p.entries.map((e) => e.count),
    [3, 1, 1],
  );
});

test('a template without {target} is refused — every child would overwrite one file', () => {
  assert.match(err([{ prompt: 'x', over: ['a.md', 'b.md'], write_to: 'out.md' }]), /\{target\}/);
});

test('two children may not share an output path', () => {
  assert.match(
    err([
      { prompt: 'a', read: ['x.md'], write_to: 'out.md' },
      { prompt: 'b', read: ['y.md'], write_to: 'out.md' },
    ]),
    /two children would write out\.md/,
  );
});

test('{target} cannot template its way out of the session folder', () => {
  const p = plan([{ prompt: 'x', over: ['../../../etc/passwd'], write_to: 'per-item/{target}.md' }]);
  assert.equal(p.entries[0]!.children[0]!.writeTo, 'per-item/passwd.md');
  assert.ok(!p.entries[0]!.children[0]!.writeTo.includes('..'));
  assert.match(err([{ prompt: 'x', read: ['a.md'], write_to: '../escape.md' }]), /inside your session folder/);
});

test('an empty batch, an empty template and a runaway are all refused', () => {
  assert.match(err([]), /at least one entry/);
  assert.match(err([{ prompt: 'x', over: [], write_to: 'out-{target}.md' }]), /expanded to no work/);
  const many = Array.from({ length: SPAWN_MAX_CHILDREN + 1 }, (_, i) => `sources/${i}.md`);
  assert.match(err([{ prompt: 'x', over: many, write_to: 'per-item/{target}.md' }]), /the ceiling is/);
});

test('nothing runs until the PM approves — a cancel spends nothing and says so', async () => {
  const started: SpawnChild[] = [];
  const tool = createSpawnTool({
    readBrief: async () => 'we believe SCIM is deferred',
    requestApproval: async () => ({ approved: false }),
    runChild: async (child) => {
      started.push(child);
      return 'done';
    },
  });
  const out = await run(tool, { work: [{ prompt: 'x', over: ['a.md', 'b.md'], write_to: 'per-item/{target}.md' }] });
  assert.equal(started.length, 0, 'not one child ran');
  assert.match(out.content[0]!.text, /did not approve/);
});

test('an approved batch runs every child, and a failure is reported rather than hidden', async () => {
  const seen: { brief: string | null; modelId?: string; label: string }[] = [];
  let approvedPlan: SpawnPlan | null = null;
  const tool = createSpawnTool({
    readBrief: async () => 'the brief',
    requestApproval: async (p) => {
      approvedPlan = p;
      return { approved: true, modelId: 'claude-sonnet-5' };
    },
    runChild: async (child, opts) => {
      seen.push({ brief: opts.brief, modelId: opts.modelId, label: child.label });
      if (child.label === 'b') throw new Error('model refused');
      return `summary for ${child.label}`;
    },
    concurrency: 2,
  });
  const out = await run(tool, { work: [{ prompt: 'x', over: ['a.md', 'b.md', 'c.md'], write_to: 'per-item/{target}.md' }] });

  assert.equal(seen.length, 3);
  assert.ok(seen.every((s) => s.brief === 'the brief'), 'every child reads the brief');
  assert.ok(seen.every((s) => s.modelId === 'claude-sonnet-5'), 'the card picks the model');
  assert.equal((approvedPlan as SpawnPlan | null)?.total, 3);

  const text = out.content[0]!.text;
  assert.match(text, /2 of 3 children finished/);
  assert.match(text, /per-item\/a\.md/);
  assert.match(text, /1 did not finish/, 'a silent failure would make the parent report a count that is a lie');
  assert.match(text, /model refused/);
});

test('concurrency is capped — the batch runs in waves, not all at once', async () => {
  let inFlight = 0;
  let peak = 0;
  const tool = createSpawnTool({
    readBrief: async () => null,
    requestApproval: async () => ({ approved: true }),
    runChild: async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return 'ok';
    },
    concurrency: 2,
  });
  await run(tool, {
    work: [{ prompt: 'x', over: ['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'f.md'], write_to: 'p/{target}.md' }],
  });
  assert.equal(peak, 2);
});
