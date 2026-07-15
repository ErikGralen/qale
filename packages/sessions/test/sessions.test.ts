import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSkill,
  buildSystemPrompt,
  SessionHarness,
  buildSessionReceipt,
  AFTER_MEETING_SKILL,
  ASK_SKILL,
} from '../src/index.js';

test('parseSkill reads frontmatter + When/Read/Produce/Then', () => {
  const c = parseSkill(AFTER_MEETING_SKILL, 'after-meeting');
  assert.equal(c.name, 'after-meeting');
  assert.equal(c.tier, 'suggest');
  assert.deepEqual(c.checkpoints, ['digest', 'outline', 'draft']);
  assert.equal(c.gateOutput, true);
  assert.ok(c.when && /transcript is dropped/i.test(c.when));
  assert.ok(c.produce && /truth delta/i.test(c.produce));
  assert.ok(c.guardrails.completionBar && /cites/i.test(c.guardrails.completionBar));
  assert.equal(c.guardrails.stoppingConditions.length, 1);
  assert.equal(c.guardrails.redFlags.length, 2);
});

test('ask skill is observe-tier with no checkpoints', () => {
  const c = parseSkill(ASK_SKILL, 'ask');
  assert.equal(c.tier, 'observe');
  assert.equal(c.checkpoints.length, 0);
  assert.equal(c.gateOutput, false);
});

test('buildSystemPrompt composes preamble + sections + guardrails', () => {
  const c = parseSkill(AFTER_MEETING_SKILL, 'after-meeting');
  const p = buildSystemPrompt('PREAMBLE', c);
  assert.ok(p.startsWith('PREAMBLE'));
  assert.ok(p.includes('## When'));
  assert.ok(p.includes('## Produce'));
  assert.ok(p.includes('digest → outline → draft'));
  assert.ok(p.includes('Completion bar:'));
  assert.ok(p.includes('advance_checkpoint'));
});

test('harness gate: locked until a checkpoint is advanced', () => {
  const c = parseSkill(AFTER_MEETING_SKILL, 'after-meeting');
  const h = new SessionHarness('sess-1', c, '2026-07-15T09:00:00Z');
  assert.equal(h.canPropose(), false); // gated skill, no checkpoint yet
  h.advanceCheckpoint('digest');
  assert.equal(h.canPropose(), true);
  assert.equal(h.reachedCheckpoint, 'digest');
  // monotonic: advancing to a later checkpoint moves forward, not back
  h.advanceCheckpoint('draft');
  assert.equal(h.reachedCheckpoint, 'draft');
  h.advanceCheckpoint('digest');
  assert.equal(h.reachedCheckpoint, 'draft');
});

test('un-gated skill can always propose', () => {
  const c = parseSkill(ASK_SKILL, 'ask');
  const h = new SessionHarness('s', c, '2026-07-15T09:00:00Z');
  assert.equal(h.canPropose(), true);
});

test('receipt records reads, writes and turns', () => {
  const c = parseSkill(AFTER_MEETING_SKILL, 'after-meeting');
  const h = new SessionHarness('abcd1234ef', c, '2026-07-15T09:00:00Z');
  h.beginTurn('Run After-Meeting on meetings/acme.md', '2026-07-15T09:00:00Z');
  h.recordRead('meetings/acme.md');
  h.recordRead('customers/acme-co.md');
  h.advanceCheckpoint('outline');
  h.recordWrite('decisions/adopt-x.md', 'p_1', 'decision');
  const r = buildSessionReceipt(h, '2026-07-15T09:05:00Z');
  assert.ok(r.path.startsWith('sessions/2026-07-15-'));
  assert.equal(r.frontmatter.type, 'session');
  assert.equal(r.frontmatter.session_type, 'after-meeting');
  assert.deepEqual(r.frontmatter.reads, ['[[meetings/acme]]', '[[customers/acme-co]]']);
  assert.deepEqual(r.frontmatter.writes, ['[[decisions/adopt-x]]']);
  assert.ok(r.body.includes('Reached checkpoint: **outline**'));
  assert.ok(r.body.includes('decision: [[decisions/adopt-x]] (p_1)'));
});
