import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontmatter,
  computeFreshness,
  computeHealth,
  parseDuration,
  daysBetween,
  checkFrontmatterMutation,
  buildChain,
  checkSupersede,
  chainHead,
  refToSlug,
  zTruthDelta,
  truthDeltaSize,
  type DecisionNode,
  type Frontmatter,
} from '../src/index.js';

test('parseFrontmatter validates + applies defaults + preserves unknown keys', () => {
  const r = parseFrontmatter({ type: 'insight', summary: 'x', evidence: ['[[meetings/a]]'], custom_x: 42 });
  assert.equal(r.ok, true);
  const fm = r.data as Record<string, unknown>;
  assert.equal(fm['confidence'], 'med'); // default applied
  assert.equal(fm['custom_x'], 42); // unknown key preserved (OKF-tolerant)
});

test('insight requires evidence', () => {
  const r = parseFrontmatter({ type: 'insight', summary: 'x', evidence: [] });
  assert.equal(r.ok, false);
});

test('parseDuration + daysBetween', () => {
  assert.equal(parseDuration('90d'), 90);
  assert.equal(parseDuration('2w'), 14);
  assert.equal(parseDuration('3m'), 90);
  assert.equal(parseDuration('1y'), 365);
  assert.equal(parseDuration('nonsense'), null);
  assert.equal(daysBetween('2026-01-01', '2026-01-11'), 10);
});

test('computeFreshness: untracked, unverified, fresh, stale', () => {
  const now = '2026-07-14T00:00:00Z';
  // meetings do not decay
  assert.equal(computeFreshness({ type: 'meeting', summary: 'm' } as Frontmatter, now).tracked, false);
  // insight never verified → unverified
  const unv = computeFreshness({ type: 'insight', summary: 'i', evidence: ['[[x]]'] } as Frontmatter, now);
  assert.equal(unv.unverified, true);
  assert.equal(unv.stale, false);
  // fresh: verified 10 days ago, 90d clock
  const fresh = computeFreshness(
    { type: 'insight', summary: 'i', evidence: ['[[x]]'], last_verified: '2026-07-04' } as Frontmatter,
    now,
  );
  assert.equal(fresh.stale, false);
  // stale: verified 200 days ago, 90d clock
  const stale = computeFreshness(
    { type: 'insight', summary: 'i', evidence: ['[[x]]'], last_verified: '2025-12-01' } as Frontmatter,
    now,
  );
  assert.equal(stale.stale, true);
  // fresh_for override extends the window
  const overridden = computeFreshness(
    { type: 'insight', summary: 'i', evidence: ['[[x]]'], last_verified: '2025-12-01', fresh_for: '2y' } as Frontmatter,
    now,
  );
  assert.equal(overridden.stale, false);
});

test('computeHealth ignores superseded + untracked, scores fresh share', () => {
  const now = '2026-07-14T00:00:00Z';
  const notes: Frontmatter[] = [
    { type: 'insight', summary: 'a', evidence: ['[[x]]'], last_verified: '2026-07-10' } as Frontmatter, // fresh
    { type: 'insight', summary: 'b', evidence: ['[[x]]'], last_verified: '2025-01-01' } as Frontmatter, // stale
    { type: 'meeting', summary: 'c' } as Frontmatter, // untracked → ignored
    { type: 'decision', summary: 'd', status: 'superseded', last_verified: '2020-01-01' } as Frontmatter, // dead → ignored
  ];
  const h = computeHealth(notes, now);
  assert.equal(h.total, 2);
  assert.equal(h.fresh, 1);
  assert.equal(h.stale, 1);
  assert.equal(h.score, 0.5);
});

test('checkFrontmatterMutation: decision body-frozen fields immutable, status mutable', () => {
  const prev = { type: 'decision', summary: 's', status: 'active', date: '2026-01-01', sources: ['[[m]]'] } as Frontmatter;
  const okChange = { ...prev, status: 'superseded', superseded_by: '[[decisions/new]]' } as Frontmatter;
  assert.equal(checkFrontmatterMutation('decision', prev, okChange).allowed, true);
  const badChange = { ...prev, summary: 'edited!' } as Frontmatter;
  assert.equal(checkFrontmatterMutation('decision', prev, badChange).allowed, false);
});

test('decision supersedes-chain: build, head, cycle guard', () => {
  const nodes: Record<string, DecisionNode> = {
    'decisions/d1': { slug: 'decisions/d1', frontmatter: { type: 'decision', summary: 'd1', status: 'superseded', superseded_by: '[[decisions/d2]]', sources: [] } as never },
    'decisions/d2': { slug: 'decisions/d2', frontmatter: { type: 'decision', summary: 'd2', status: 'active', supersedes: '[[decisions/d1]]', sources: [] } as never },
  };
  const resolve = (slug: string): DecisionNode | null => nodes[slug] ?? null;

  const { chain, cycle } = buildChain('decisions/d2', resolve);
  assert.equal(cycle, false);
  assert.deepEqual(chain.map((n) => n.slug), ['decisions/d1', 'decisions/d2']);
  assert.equal(chainHead('decisions/d1', resolve)?.slug, 'decisions/d2');

  // superseding an already-superseded decision is refused
  assert.equal(checkSupersede('decisions/d3', 'decisions/d1', resolve).allowed, false);
  // superseding the live head is allowed
  assert.equal(checkSupersede('decisions/d3', 'decisions/d2', resolve).allowed, true);
  // self-supersede refused
  assert.equal(checkSupersede('decisions/d2', 'decisions/d2', resolve).allowed, false);
});

test('refToSlug normalizes wikilinks', () => {
  assert.equal(refToSlug('[[decisions/d1]]'), 'decisions/d1');
  assert.equal(refToSlug('decisions/d1.md'), 'decisions/d1');
  assert.equal(refToSlug('[[decisions/d1|Alias]]'), 'decisions/d1');
  assert.equal(refToSlug(undefined), null);
});

test('truth delta parses + counts items', () => {
  const parsed = zTruthDelta.parse({
    meeting: '[[meetings/acme]]',
    decisions: [{ statement: 'Adopt WorkOS', evidence: ['[[meetings/acme]]'] }],
    insights: [{ statement: 'Acme needs SCIM', evidence: ['[[meetings/acme]]'], confidence: 'high' }],
    actions: [{ statement: 'File ENG ticket', owner: 'Sam' }],
  });
  assert.equal(truthDeltaSize(parsed), 3);
  assert.equal(parsed.decisions[0]!.inference ?? false, false);
});
