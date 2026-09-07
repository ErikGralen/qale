import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UseCaseContext } from '@qale/application';
import { createProposeTools } from '../src/tools.js';
import { placementError } from '../src/placement.js';

/**
 * The agent creates no folders (docs/memory-types.md, MT-6). A note goes to
 * the folder its type owns, one level deep, and the check sits in the tool that
 * writes, so a session is refused in words it can act on rather than leaving a
 * folder nobody made.
 */

test('a two-segment path is refused, and the refusal names the folder', () => {
  const said = placementError('research/competitors/acme.md', 'research');
  assert.ok(said);
  assert.match(said, /^Rejected: a research page lives in research\/, one level deep/);
  assert.match(said, /research\/<name>\.md/);
});

test('a path in the wrong folder for its type is refused', () => {
  assert.match(placementError('insights/competitors.md', 'research')!, /lives in research\//);
  assert.match(placementError('research/nordkap.md', 'customer')!, /lives in customers\//);
  assert.match(placementError('notes/scim.md', 'insight')!, /an insight page lives in insights\//);
});

test('a page one level deep in its own folder is fine', () => {
  assert.equal(placementError('research/competitors.md', 'research'), null);
  assert.equal(placementError('insights/nordkap-needs-scim.md', 'insight'), null);
  assert.equal(placementError('notes/spec-pricing.md', 'note'), null);
});

test('a bare filename and an unknown type still have to sit one level deep', () => {
  assert.match(placementError('competitors.md', undefined)!, /one level deep/);
  assert.match(placementError('a/b/c.md', undefined)!, /one level deep/);
  assert.match(placementError('research/', 'research')!, /research\/<name>\.md/);
  assert.equal(placementError('research/competitors.md', undefined), null);
});

test("a document may go into a folder the PM made, never into one they didn't", () => {
  const theirs = (dir: string) => dir === 'notes/specs';
  assert.equal(placementError('notes/specs/checkout.md', 'note', theirs), null);
  const said = placementError('notes/drafts/checkout.md', 'note', theirs);
  assert.match(said!, /a folder the PM already made/);
  assert.match(said!, /Qale makes no folders/);
  // Without a way to ask, only the top of notes/ is open.
  assert.match(placementError('notes/specs/checkout.md', 'note')!, /Rejected/);
});

/** Enough of a workspace for propose_note and propose_update to reach the placement check. */
function world(files: Record<string, { type: string; body: string }>) {
  const rows: unknown[] = [];
  const paths = Object.keys(files);
  const ctx = {
    index: {
      resolve: (slug: string) => (files[`${slug}.md`] ? `${slug}.md` : files[slug] ? slug : null),
      get: () => null,
      all: () => paths.map((path) => ({ path })),
    },
    clock: { now: () => '2026-09-06T09:00:00.000Z' },
    vault: {
      exists: async (path: string) => path in files,
      readNote: async (path: string) => {
        const f = files[path];
        return f ? { path, type: f.type, frontmatter: { type: f.type }, body: f.body } : null;
      },
    },
    proposals: {
      create: (input: Record<string, unknown>) => {
        const row = { id: `p${rows.length + 1}`, status: 'pending', ...input };
        rows.push(row);
        return row;
      },
      list: () => [],
      get: () => null,
      pendingCount: () => rows.length,
    },
  };
  return ctx as unknown as UseCaseContext;
}

const run = async (tool: unknown, params: unknown): Promise<string> => {
  const t = tool as {
    execute: (id: string, p: unknown, s?: AbortSignal) => Promise<{ content: { text: string }[] }>;
  };
  return (await t.execute('call-1', params, undefined)).content[0]!.text;
};

const tool = (ctx: UseCaseContext, name: string) =>
  createProposeTools(ctx, 's1').find((t) => t.name === name)!;

const RESEARCH = {
  frontmatter: { type: 'research', title: 'Competitors', summary: 'Who else sells this.' },
  body: 'Three of them.',
  rationale: 'Asked for a scan.',
  inference: true,
};

test('propose_note refuses a subfolder before anything is filed', async () => {
  const ctx = world({});
  const said = await run(tool(ctx, 'propose_note'), {
    ...RESEARCH,
    path: 'research/competitors/acme.md',
  });
  assert.match(said, /^Rejected: a research page lives in research\//);
  assert.equal(ctx.proposals.pendingCount(), 0, 'nothing was filed');
});

test('propose_note refuses the wrong folder for the type', async () => {
  const ctx = world({});
  const said = await run(tool(ctx, 'propose_note'), { ...RESEARCH, path: 'notes/competitors.md' });
  assert.match(said, /lives in research\//);
  assert.equal(ctx.proposals.pendingCount(), 0);
});

test('propose_note takes research/competitors.md for a research page', async () => {
  const ctx = world({});
  const said = await run(tool(ctx, 'propose_note'), { ...RESEARCH, path: 'research/competitors.md' });
  assert.doesNotMatch(said, /^Rejected/);
});

test('propose_update reads the type off the target and applies the same rule', async () => {
  const ctx = world({
    'research/competitors.md': { type: 'research', body: 'Three of them.' },
    'notes/specs/checkout.md': { type: 'note', body: 'The checkout spec.' },
  });
  const update = tool(ctx, 'propose_update');
  const fine = await run(update, {
    path: 'research/competitors.md',
    append: 'A fourth.',
    rationale: 'One more turned up.',
    inference: true,
  });
  assert.doesNotMatch(fine, /^Rejected/);
  // A document in a folder the PM made is theirs to have updated.
  const theirs = await run(update, {
    path: 'notes/specs/checkout.md',
    append: 'One more requirement.',
    rationale: 'They asked.',
    asked: true,
  });
  assert.doesNotMatch(theirs, /^Rejected/);
});
