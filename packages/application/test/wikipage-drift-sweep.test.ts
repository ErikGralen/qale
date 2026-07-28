import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLibrarianSweep } from '../src/index.js';
import { fakeDriftWorld, inote } from './drift-helpers.js';

/**
 * The sweep's contract inside the librarian maintenance pass: one redline card
 * per finding, no dupes across ticks, no LLM spend on unchanged pairs, a
 * dismissal that stays dismissed until the decision or page changes, shared
 * prepared-fix caps, and silence when no model is configured. This is the
 * Tavla defer-scim-to-q3 vs "Enterprise Onboarding" scenario end-to-end with
 * a scripted model.
 */

const PAGE_BODY = [
  '## Provisioning',
  '',
  'SCIM provisioning ships in Q2 alongside the SSO rollout, so group mapping is automatic from day one.',
].join('\n');

const DECISION_BODY =
  'One auth migration at a time. SSO ships first; SCIM scoping starts August, delivery September.';

const FIX_VERDICT = JSON.stringify({
  contradicts: true,
  confidence: 'high',
  passage: 'SCIM provisioning ships in Q2 alongside the SSO rollout, so group mapping is automatic from day one.',
  replacement: 'SCIM provisioning is deferred to Q3 (delivery September); group mapping stays manual for now.',
  grounded: true,
  explanation: 'The page promises SCIM in Q2; the decision defers it to Q3.',
});

const PING_VERDICT = JSON.stringify({
  contradicts: true,
  confidence: 'medium',
  passage: null,
  replacement: null,
  grounded: true,
  explanation: 'The page loosely assumes Q2 provisioning.',
});

function tavlaWorld(reply: string | ((i: { system: string; prompt: string }) => string) | null) {
  const page = inote({
    path: 'wikipages/enterprise-onboarding.md',
    type: 'wikipage',
    title: 'Enterprise Onboarding',
    frontmatter: {
      provider: 'confluence',
      external_id: '910231',
      container: 'Product',
      version: 12,
      remote_updated: '2026-07-11T16:20:00Z',
      url: 'https://tavla.atlassian.net/wiki/x',
      status: 'active',
    },
  });
  const hub = inote({
    path: 'themes/enterprise-onboarding.md',
    type: 'theme',
    links: ['decisions/2026-04-15-defer-scim-to-q3', 'wikipages/enterprise-onboarding'],
  });
  const decision = inote({
    path: 'decisions/2026-04-15-defer-scim-to-q3.md',
    type: 'decision',
    title: 'Defer SCIM to Q3',
    mtime: 500,
    frontmatter: { status: 'active', date: '2026-04-15', theme: '[[themes/enterprise-onboarding]]' },
    links: ['themes/enterprise-onboarding'],
  });
  return fakeDriftWorld({
    notes: [page, hub, decision],
    bodies: {
      'wikipages/enterprise-onboarding.md': PAGE_BODY,
      'decisions/2026-04-15-defer-scim-to-q3.md': DECISION_BODY,
      'themes/enterprise-onboarding.md': 'hub body',
    },
    completions: reply,
  });
}

test('one contradiction → one redline card; the next tick judges nothing and files nothing', async () => {
  const world = tavlaWorld(FIX_VERDICT);

  const first = await runLibrarianSweep(world.ctx);
  assert.equal(first.fixes, 1);
  assert.equal(world.llmCalls.length, 1);
  assert.equal(world.proposals.length, 1);

  const card = world.proposals[0]!;
  assert.equal(card.kind, 'outbound');
  assert.equal(card.sessionId, 'librarian');
  assert.equal(card.targetPath, 'wikipages/enterprise-onboarding.md');
  const payload = card.payload as Record<string, unknown>;
  assert.equal(payload['action'], 'update_page');
  assert.equal(payload['pageId'], '910231');
  assert.match(String(payload['body']), /deferred to Q3/);
  assert.deepEqual(
    card.evidence.map((e) => e.ref),
    ['[[decisions/2026-04-15-defer-scim-to-q3]]', '[[wikipages/enterprise-onboarding]]'],
  );
  assert.equal(card.inference, false);

  // Tick 2 + 3: idempotent — the ledger and the pending card both hold it back.
  await runLibrarianSweep(world.ctx);
  await runLibrarianSweep(world.ctx);
  assert.equal(world.llmCalls.length, 1);
  assert.equal(world.proposals.length, 1);
});

test('a rejected card stays quiet until the page actually changes', async () => {
  const world = tavlaWorld(FIX_VERDICT);
  await runLibrarianSweep(world.ctx);
  world.ctx.proposals.setStatus('p1', 'rejected', Date.parse('2026-07-22T10:00:00Z'));

  // Same revision → the check ledger blocks even re-judging.
  await runLibrarianSweep(world.ctx);
  assert.equal(world.llmCalls.length, 1);
  assert.equal(world.proposals.length, 1);

  // Page re-syncs (version bump) inside the quiet week → still quiet.
  world.reindex(
    inote({
      path: 'wikipages/enterprise-onboarding.md',
      type: 'wikipage',
      title: 'Enterprise Onboarding',
      frontmatter: {
        provider: 'confluence',
        external_id: '910231',
        container: 'Product',
        version: 13,
        remote_updated: '2026-07-22T09:30:00Z',
        url: 'https://tavla.atlassian.net/wiki/x',
        status: 'new',
      },
    }),
  );
  world.setNow('2026-07-23T09:00:00.000Z');
  await runLibrarianSweep(world.ctx);
  assert.equal(world.llmCalls.length, 1);

  // Past the week AND changed → judged fresh, new card.
  world.setNow('2026-07-30T09:00:00.000Z');
  await runLibrarianSweep(world.ctx);
  assert.equal(world.llmCalls.length, 2);
  assert.equal(world.proposals.filter((p) => p.status === 'pending').length, 1);
});

test('diffuse verdict → judgment-call ping; dismissed stays dismissed at that revision', async () => {
  const world = tavlaWorld(PING_VERDICT);
  const first = await runLibrarianSweep(world.ctx);
  assert.equal(first.fixes, 0);
  assert.equal(world.proposals.length, 0);
  assert.equal(world.pings.length, 1);

  const ping = world.pings[0]!;
  assert.equal(ping.key, 'page-drift:wikipages/enterprise-onboarding:decisions/2026-04-15-defer-scim-to-q3');
  assert.match(ping.title, /may contradict/);
  assert.equal(ping.targetPath, 'wikipages/enterprise-onboarding.md');
  assert.match(ping.seedPrompt, /\[\[wikipages\/enterprise-onboarding\]\]/);

  // Dismiss; unchanged pair → silence forever after, not just a week.
  world.ctx.pings!.setStatus(ping.id, 'dismissed', Date.parse('2026-07-22T10:00:00Z'));
  world.setNow('2026-09-01T09:00:00.000Z');
  await runLibrarianSweep(world.ctx);
  assert.equal(world.llmCalls.length, 1);
  assert.equal(world.pings.length, 1);
});

test('no completions port → the deterministic half runs, the LLM half quietly does not', async () => {
  const world = tavlaWorld(null);
  const result = await runLibrarianSweep(world.ctx);
  assert.equal(result.fixes, 0);
  assert.equal(world.proposals.length, 0);
  assert.equal(world.pings.length, 0);
  assert.equal(world.checks.size, 0); // nothing recorded — judged when a key shows up
});

test('a full prepared-fix queue defers judgment instead of spending it', async () => {
  const world = tavlaWorld(FIX_VERDICT);
  // Fill the shared budget with pending librarian fixes (cap is 8).
  for (let i = 0; i < 8; i++) {
    world.ctx.proposals.create(
      {
        kind: 'update',
        sessionId: 'librarian',
        sessionType: 'librarian',
        targetPath: `notes/n${i}.md`,
        baseHash: null,
        payload: { path: `notes/n${i}.md`, patch: [{ search: 'a', replace: 'b' }], rationale: 'x' },
        rationale: 'x',
        evidence: [],
        inference: false,
      },
      Date.parse('2026-07-22T08:00:00Z'),
    );
  }
  await runLibrarianSweep(world.ctx);
  assert.equal(world.llmCalls.length, 0); // no judgment we cannot file
  assert.equal(world.checks.size, 0); // and nothing recorded — retried when the queue clears

  for (const p of [...world.proposals]) {
    if (p.kind === 'update') world.ctx.proposals.setStatus(p.id, 'accepted', Date.parse('2026-07-22T08:30:00Z'));
  }
  await runLibrarianSweep(world.ctx);
  assert.equal(world.llmCalls.length, 1);
  assert.equal(world.proposals.filter((p) => p.kind === 'outbound').length, 1);
});

test('one page never carries two redlines — a second contradicting decision waits its turn', async () => {
  const world = tavlaWorld(FIX_VERDICT);
  // A second active decision in the same hub orbit.
  const audit = inote({
    path: 'decisions/2026-05-19-commit-audit-log-june.md',
    type: 'decision',
    title: 'Commit Audit Log June',
    frontmatter: { status: 'active', theme: '[[themes/enterprise-onboarding]]' },
  });
  world.ctx.index.all().push(audit);

  await runLibrarianSweep(world.ctx);
  // Both pairs exist, the model would happily "fix" both — but a page gets one
  // pending rewrite at a time, and the second pair is not judged or recorded.
  assert.equal(world.proposals.filter((p) => p.kind === 'outbound').length, 1);
  assert.equal(world.llmCalls.length, 1);
  assert.equal(world.checks.size, 1);

  await runLibrarianSweep(world.ctx);
  assert.equal(world.proposals.filter((p) => p.kind === 'outbound').length, 1);
});

test('a model transport error leaves no trace and the next tick retries', async () => {
  let calls = 0;
  const world = tavlaWorld(() => {
    calls++;
    if (calls === 1) throw new Error('529 overloaded');
    return FIX_VERDICT;
  });
  await runLibrarianSweep(world.ctx);
  assert.equal(world.proposals.length, 0);
  assert.equal(world.checks.size, 0);

  await runLibrarianSweep(world.ctx);
  assert.equal(world.proposals.length, 1);
  assert.equal(world.checks.size, 1);
});

test('an unparseable verdict is recorded, not retried every five minutes', async () => {
  const world = tavlaWorld('I could not decide, sorry.');
  await runLibrarianSweep(world.ctx);
  assert.equal(world.llmCalls.length, 1);
  assert.equal(world.proposals.length, 0);
  assert.equal(world.pings.length, 0);
  assert.equal(world.checks.size, 1);

  await runLibrarianSweep(world.ctx);
  assert.equal(world.llmCalls.length, 1); // same revision → no second spend
});
