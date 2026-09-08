import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARRIVAL_AGENT_NAME } from '@qale/sessions';
import { thinkingLevelFor } from '../src/runtime.js';

/**
 * Which runs think at `low` (docs/agent-speed.md AS-2). One run does: the
 * arrival, reading a source the PM dropped and walked away from. Every other
 * run keeps `medium`, and that includes the other unattended ones. The flags
 * cannot tell a drop from the first look, so the test is the skill.
 */

test('a dropped source read while the PM is away thinks at low', () => {
  assert.equal(thinkingLevelFor({ skill: ARRIVAL_AGENT_NAME, unattended: true }), 'low');
});

test('the PM writing into that arrival session gets medium back', () => {
  // A person's own message carries no flag (handlers `agent:run`).
  assert.equal(thinkingLevelFor({ skill: ARRIVAL_AGENT_NAME }), 'medium');
});

test('the other unattended runs keep medium', () => {
  // The first look: same flags as a drop, a different skill (handlers.ts:357).
  assert.equal(thinkingLevelFor({ skill: 'tell-qale', unattended: true }), 'medium');
  // The librarian tick: unattended, not scheduled (handlers.ts:465).
  assert.equal(thinkingLevelFor({ skill: 'librarian', unattended: true }), 'medium');
  // The meeting sweep: scheduled (handlers.ts:1146).
  assert.equal(thinkingLevelFor({ skill: 'meeting-prep', scheduled: true }), 'medium');
});

test('a chat thinks at medium', () => {
  assert.equal(thinkingLevelFor({}), 'medium');
  assert.equal(thinkingLevelFor({ skill: 'librarian' }), 'medium');
});

test('the level is never off', () => {
  // `off` sends `thinking: {type: "disabled"}` against a history that still
  // carries signed thinking blocks. Two values, and both are adaptive.
  for (const input of [
    {},
    { skill: ARRIVAL_AGENT_NAME, unattended: true },
    { skill: ARRIVAL_AGENT_NAME, scheduled: true },
  ]) {
    assert.ok(['low', 'medium'].includes(thinkingLevelFor(input)));
  }
});
