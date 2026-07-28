import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSkill,
  buildSystemPrompt,
  bindingMatches,
  SessionHarness,
  buildSessionReceipt,
  AFTER_MEETING_SKILL,
  ASK_SKILL,
  CHAT_SKILL,
  SYNTHESIS_SKILL,
  PROCESS_NOTE_SKILL,
  DEFAULT_SKILL_BY_TYPE,
  isDynamicSkill,
  buildSkillBrief,
} from '../src/index.js';

test('parseSkill reads frontmatter + When/Read/Produce/Then', () => {
  const c = parseSkill(AFTER_MEETING_SKILL, 'after-meeting');
  assert.equal(c.name, 'after-meeting');
  assert.equal(c.tier, 'outbound');
  assert.deepEqual(c.checkpoints, ['digest', 'outline', 'draft']);
  assert.equal(c.gateOutput, true);
  assert.ok(c.when && /transcript is dropped/i.test(c.when));
  assert.ok(c.produce && /truth delta/i.test(c.produce));
  assert.ok(c.guardrails.completionBar && /cites/i.test(c.guardrails.completionBar));
  assert.equal(c.guardrails.stoppingConditions.length, 0);
  assert.equal(c.guardrails.redFlags.length, 3);
});

test('the LAST section of a skill body is captured (regression: \\Z is not a JS anchor)', () => {
  const raw = `---\ntype: skill\nsession_type: t\nsummary: s\n---\n## When\nDo it when X.\n\n## Then\nProduce Y.\n`;
  const c = parseSkill(raw, 't');
  assert.equal(c.when, 'Do it when X.');
  assert.equal(c.then, 'Produce Y.');
  // every shipped skill ends with ## Then — none may lose it
  for (const [type, skill] of Object.entries(DEFAULT_SKILL_BY_TYPE)) {
    const parsed = parseSkill(skill, type);
    if (/^##\s*Then/im.test(skill)) assert.ok(parsed.then, `${type} lost its ## Then section`);
  }
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

test('gate_output without checkpoints is ignored, flagged, and never locks', () => {
  const raw = `---\ntype: skill\nsession_type: t\nsummary: s\ngate_output: true\n---\n## When\nx\n`;
  const c = parseSkill(raw, 't');
  assert.equal(c.gateOutput, false);
  assert.ok(c.errors.some((e) => /gate_output needs checkpoints/.test(e)));
  const h = new SessionHarness('s', c, '2026-07-15T09:00:00Z');
  assert.equal(h.canPropose(), true);
});

test('no shipped default skill can gate-lock itself', () => {
  for (const [type, raw] of Object.entries(DEFAULT_SKILL_BY_TYPE)) {
    const c = parseSkill(raw, type);
    assert.deepEqual(c.errors, [], `${type} has frontmatter errors: ${c.errors.join('; ')}`);
    if (c.gateOutput) assert.ok(c.checkpoints.length > 0, `${type} gates without checkpoints`);
  }
});

test('unknown tier is flagged and falls back to suggest', () => {
  const c = parseSkill(`---\ntype: skill\ntier: outbund\nsummary: s\n---\n`, 't');
  assert.equal(c.tier, 'suggest');
  assert.ok(c.errors.some((e) => /unknown tier/.test(e)));
});

test('triggered binding without session_type is flagged', () => {
  const raw = `---\ntype: skill\nsummary: s\nbindings:\n  - mode: triggered\n    event: decision.superseded\n---\n`;
  const c = parseSkill(raw, 'skills/my-check');
  assert.ok(c.errors.some((e) => /requires an explicit session_type/.test(e)));
});

test('triggered binding on a non-session kind is flagged', () => {
  const raw = `---\ntype: skill\nskill_kind: voice\nsession_type: v\nsummary: s\nbindings:\n  - mode: triggered\n    event: decision.superseded\n---\n`;
  const c = parseSkill(raw, 'v');
  assert.ok(c.errors.some((e) => /never fires/.test(e)));
});

test('note.stale is no longer a known event', () => {
  const raw = `---\ntype: skill\nsession_type: t\nsummary: s\nbindings:\n  - mode: triggered\n    event: note.stale\n---\n`;
  const c = parseSkill(raw, 't');
  assert.equal(c.bindings.length, 0);
  assert.ok(c.errors.some((e) => /known event/.test(e)));
});

test('after-meeting binding fires only for the PO’s own transcripts', () => {
  const c = parseSkill(AFTER_MEETING_SKILL, 'after-meeting');
  const b = c.bindings[0]!;
  assert.equal(bindingMatches(b, 'capture.transcript', { origin: 'po', path: 'x' }), true);
  assert.equal(bindingMatches(b, 'capture.transcript', { origin: 'external', path: 'x' }), false);
});

test('intake binding fires for links and screenshots, not quick notes', () => {
  const c = parseSkill(DEFAULT_SKILL_BY_TYPE['intake']!, 'intake');
  const fires = (kind: string) => c.bindings.some((b) => bindingMatches(b, 'capture.ingested', { kind }));
  assert.equal(fires('link'), true);
  assert.equal(fires('screenshot'), true);
  assert.equal(fires('note'), false);
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

// --- Sessions v2 Part 3: skills arrive, they aren't a mode you're locked in ---

test('isDynamicSkill: guides always, others only with a dynamic binding', () => {
  assert.equal(isDynamicSkill(parseSkill(SYNTHESIS_SKILL, 'synthesis')), true);
  assert.equal(isDynamicSkill(parseSkill(PROCESS_NOTE_SKILL, 'process-note')), true);
  assert.equal(isDynamicSkill(parseSkill(AFTER_MEETING_SKILL, 'after-meeting')), false);
  const guide = `---\ntype: skill\nskill_kind: guide\nsummary: A checklist\n---\n\nCheck the thing.\n`;
  assert.equal(isDynamicSkill(parseSkill(guide, 'a-checklist')), true);
});

test('buildSkillBrief: a session skill arrives as rules in force, a guide as prose', () => {
  const brief = buildSkillBrief(parseSkill(SYNTHESIS_SKILL, 'synthesis'));
  assert.match(brief, /Skill now in force: synthesis/);
  assert.match(brief, /govern the rest of this conversation/);
  assert.match(brief, /## Produce/);
  const guide = `---\ntype: skill\nskill_kind: guide\nsummary: A checklist\n---\n\nCheck the thing.\n`;
  const g = buildSkillBrief(parseSkill(guide, 'a-checklist'));
  assert.match(g, /## Guide: A checklist/);
  assert.match(g, /Check the thing\./);
  assert.doesNotMatch(g, /in force/);
});

test('an arriving skill brings its tier, checkpoints and gate — and resets the counter', () => {
  const chat = parseSkill(CHAT_SKILL, 'chat');
  const h = new SessionHarness('s1', chat, '2026-07-28T09:00:00Z');
  assert.equal(h.tier, 'observe');
  assert.deepEqual(h.checkpoints, []);
  assert.equal(h.canPropose(), true, 'un-gated base skill proposes freely');

  h.invokeSkill(parseSkill(SYNTHESIS_SKILL, 'synthesis'));
  assert.equal(h.tier, 'outbound', 'arrival adds permissions');
  assert.deepEqual(h.checkpoints, ['gather', 'cluster', 'draft']);
  assert.equal(h.gateOutput, true);
  assert.equal(h.canPropose(), false, 'the arriving gate locks output');
  h.advanceCheckpoint('gather');
  assert.equal(h.canPropose(), true);
  assert.equal(h.activeSkillName, 'synthesis', 'cards are tagged with the skill that made them');
  assert.deepEqual(h.skillNames, ['chat', 'synthesis']);
});

test('a checkpoint recorded against the old plan cannot unlock a newly arrived gate', () => {
  const after = parseSkill(AFTER_MEETING_SKILL, 'after-meeting');
  const h = new SessionHarness('s2', after, '2026-07-28T09:00:00Z');
  h.advanceCheckpoint('digest');
  assert.equal(h.canPropose(), true);
  h.invokeSkill(parseSkill(SYNTHESIS_SKILL, 'synthesis'));
  assert.equal(h.canPropose(), false);
  assert.equal(h.reachedCheckpoint, null);
});

test('an observe-tier arrival never strips permissions the session already had', () => {
  const after = parseSkill(AFTER_MEETING_SKILL, 'after-meeting');
  const h = new SessionHarness('s3', after, '2026-07-28T09:00:00Z');
  h.invokeSkill(parseSkill(ASK_SKILL, 'ask'));
  assert.equal(h.tier, 'outbound');
});

test('the receipt records every skill that was in force, not just the opener', () => {
  const h = new SessionHarness('abcd1234ef', parseSkill(CHAT_SKILL, 'chat'), '2026-07-28T09:00:00Z');
  h.beginTurn('what do these nine interviews add up to?', '2026-07-28T09:00:00Z');
  h.invokeSkill(parseSkill(SYNTHESIS_SKILL, 'synthesis'));
  const r = buildSessionReceipt(h, '2026-07-28T09:30:00Z');
  assert.equal(r.frontmatter.session_type, 'chat');
  assert.deepEqual(r.frontmatter.skills, ['chat', 'synthesis']);
  assert.ok(r.body.includes('Skills: chat → synthesis'));
});
