import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRunnable,
  SessionHarness,
  ARRIVAL_SKILL,
  ASK_SKILL,
  LIBRARIAN_AGENT,
  WEEKLY_UPDATE_SKILL,
  SYNTHESIS_SKILL,
} from '@qale/sessions';
import { toolNamesFor, type AgentConnection } from '../src/runtime.js';
import { CODEBASE_TOOL_NAME } from '../src/codebase.js';
import {
  CALENDAR_TOOL_NAMES,
  DRAFT_TEXT_TOOL_NAME,
  DRAFT_TOOL_NAMES,
  GET_VOICE_TOOL_NAME,
  TRACK_TOOL_NAMES,
} from '../src/tools.js';

/**
 * The permission boundary itself: which capability becomes which tool.
 *
 * It is the one function in the system where a `can:` line turns into something
 * the model can call, and until now nothing asserted it. That made every line of
 * it a comment somebody had to trust. These tests are here so that moving a tool
 * across the line is a decision with a failing test under it, rather than an
 * edit that looks like tidying.
 */

const harness = (skill: string, name: string, invoked?: [string, string]) => {
  const h = new SessionHarness('s1', parseRunnable(skill, name), '2026-08-22T09:00:00Z');
  if (invoked) h.invokeSkill(parseRunnable(invoked[0], invoked[1]));
  return h;
};

/** The plain session: `chat`, nothing invoked, nothing connected. */
const openSession = () => harness(ASK_SKILL, 'ask');

/** Nothing connected: no reads, nothing to track. */
const NONE: AgentConnection[] = [];

/** One live connection that reads and can watch an item, the shape Atlassian
 *  has today. The tool names are the connection's, not this package's. */
const READS = ['jira_search', 'jira_get_issue'];
const TRACKER: AgentConnection = {
  connectionId: 'atlassian',
  providerId: 'atlassian',
  readTools: READS.map((name) => ({
    name,
    label: name,
    description: name,
    parameters: { type: 'object' } as AgentConnection['readTools'][number]['parameters'],
    execute: async () => ({ text: '' }),
  })),
  canTrack: true,
  fingerprint: 'f1',
};

/** A connection that reads and nothing more: the reads still appear, the
 *  sync-state tools do not. */
const READ_ONLY: AgentConnection = { ...TRACKER, canTrack: false };

/** A file that claims nothing: no `can:` line at all. */
const BARE = `---
title: Bare
summary: Claims nothing.
---

Answer the question.
`;

test('an open session drafts outbound once something is connected', () => {
  // `chat` grants draft-outbound, the same one capability every drafting skill
  // earns. A Jira comment or a Confluence page also needs a connector, so those
  // wait on the connector floor. draft-calendar is its own, separate capability
  // and chat never earns it.
  assert.equal(openSession().outbound, true, 'chat may draft');

  const disconnected = toolNamesFor(openSession(), NONE, false, false, false);
  for (const t of [...DRAFT_TOOL_NAMES, ...CALENDAR_TOOL_NAMES]) {
    assert.ok(!disconnected.includes(t), `${t} offered with nothing connected`);
  }

  const connected = toolNamesFor(openSession(), NONE, false, true, false);
  for (const t of DRAFT_TOOL_NAMES) {
    assert.ok(connected.includes(t), `${t} missing from an open session once connected`);
  }
  for (const t of CALENDAR_TOOL_NAMES) {
    assert.ok(!connected.includes(t), `${t} leaked into an open session with no draft-calendar`);
  }
});

test('writing text into the chat is on everywhere, capability or not', () => {
  // `draft_text` draws a panel in the conversation and files nothing;
  // `get_voice` reads a file the workspace already holds. A file that claims
  // nothing still gets both, with nothing connected. This is the bug the
  // capability caused: the base chat was told to draft text with a tool it had
  // never been handed.
  const bare = harness(BARE, 'bare');
  assert.equal(bare.outbound, false, 'this file claims no capability');
  assert.equal(bare.draftCalendar, false);

  const names = toolNamesFor(bare, NONE, false, false, false);
  for (const t of [DRAFT_TEXT_TOOL_NAME, GET_VOICE_TOOL_NAME]) {
    assert.ok(names.includes(t), `${t} missing from a session that claims nothing`);
  }
  for (const t of [...DRAFT_TOOL_NAMES, ...CALENDAR_TOOL_NAMES]) {
    assert.ok(!names.includes(t), `${t} leaked into a session that claims nothing`);
  }
});

test('the outbound tools need the capability AND a connector, both', () => {
  const earned = harness(WEEKLY_UPDATE_SKILL, 'weekly-update');
  assert.equal(earned.outbound, true);

  const withConnector = toolNamesFor(earned, NONE, false, true, false);
  for (const t of DRAFT_TOOL_NAMES) assert.ok(withConnector.includes(t), `${t} missing`);

  // Nothing connected: the capability alone buys nothing, because these could
  // only produce cards that fail on approval.
  const without = toolNamesFor(earned, NONE, false, false, false);
  for (const t of DRAFT_TOOL_NAMES)
    assert.ok(!without.includes(t), `${t} offered with nothing connected`);
  // Writing text into the chat rides under both gates and survives either one
  // being shut: it reaches nothing outside the conversation.
  assert.ok(without.includes(DRAFT_TEXT_TOOL_NAME), 'draft_text lost with nothing connected');
});

test('drafting outbound does not buy the calendar', () => {
  // weekly-update writes a Jira comment and never books a meeting. It used to
  // carry all three calendar tools anyway, which is what this split ends.
  const earned = harness(WEEKLY_UPDATE_SKILL, 'weekly-update');
  const names = toolNamesFor(earned, NONE, false, true, false);
  for (const t of DRAFT_TOOL_NAMES) assert.ok(names.includes(t), `${t} missing`);
  for (const t of CALENDAR_TOOL_NAMES)
    assert.ok(!names.includes(t), `${t} leaked into a session with no draft-calendar`);
  assert.deepEqual(
    CALENDAR_TOOL_NAMES.filter((t) => DRAFT_TOOL_NAMES.includes(t)),
    [],
    'one list per gate: a tool in both would be granted by a capability nobody asked for',
  );
});

test('the file that books meetings gets the calendar tools, connector and all', () => {
  const arrival = harness(ARRIVAL_SKILL, 'arrival');
  assert.equal(arrival.draftCalendar, true);
  const names = toolNamesFor(arrival, NONE, false, true, false);
  for (const t of CALENDAR_TOOL_NAMES) assert.ok(names.includes(t), `${t} missing from arrival`);
  // Same connector floor as the rest of outbound: the capability alone buys
  // nothing, because these cards would fail on approval.
  const without = toolNamesFor(arrival, NONE, false, false, false);
  for (const t of CALENDAR_TOOL_NAMES)
    assert.ok(!without.includes(t), `${t} offered with nothing connected`);
});

test('reading Jira rides on the connection, changing what syncs is earned', () => {
  const open = openSession();
  assert.equal(open.trackExternal, false);
  const names = toolNamesFor(open, [TRACKER], false, true, false);
  // "What is the status of PAY-142?" is an ordinary question, and a plain chat
  // opens on a skill that declares nothing, so the reads can never be earned.
  for (const t of READS) assert.ok(names.includes(t), `${t} missing from a chat`);
  for (const t of TRACK_TOOL_NAMES)
    assert.ok(!names.includes(t), `${t} leaked into a session with no track-external`);
  assert.deepEqual(
    TRACK_TOOL_NAMES.filter((t) => READS.includes(t)),
    [],
  );

  const librarian = harness(LIBRARIAN_AGENT, 'librarian');
  assert.equal(librarian.trackExternal, true);
  const earned = toolNamesFor(librarian, [TRACKER], false, true, false);
  for (const t of TRACK_TOOL_NAMES)
    assert.ok(earned.includes(t), `${t} missing from the librarian`);
  // And the connection is still the floor under both halves.
  const offline = toolNamesFor(librarian, NONE, false, true, false);
  for (const t of [...READS, ...TRACK_TOOL_NAMES])
    assert.ok(!offline.includes(t), `${t} offered with no connection`);
});

test('the reads follow the connections, the sync tools follow what can track', () => {
  // A connection that only reads still hands its reads to a plain chat, and the
  // librarian earns nothing extra from it: watching one item is the connector's
  // capability, not the skill's.
  const librarian = harness(LIBRARIAN_AGENT, 'librarian');
  assert.equal(librarian.trackExternal, true);
  const names = toolNamesFor(librarian, [READ_ONLY], false, true, false);
  for (const t of READS) assert.ok(names.includes(t), `${t} missing with a read-only connection`);
  for (const t of TRACK_TOOL_NAMES)
    assert.ok(!names.includes(t), `${t} offered by a connection that cannot track`);

  // Two connections both put their reads on the table.
  const second: AgentConnection = {
    ...READ_ONLY,
    connectionId: 'linear',
    providerId: 'linear',
    readTools: [{ ...READ_ONLY.readTools[0]!, name: 'linear_search' }],
  };
  const both = toolNamesFor(librarian, [READ_ONLY, second], false, true, false);
  for (const t of [...READS, 'linear_search'])
    assert.ok(both.includes(t), `${t} missing with two connections`);
});

test('asking the code needs the setup and nothing else', () => {
  // No `can:` line buys it and none is needed: it writes nothing anywhere, and
  // every run goes past the PM on a card. A plain chat gets it as soon as the
  // PM points Qale at a repo, which is the whole point of the feature.
  const open = openSession();
  assert.ok(!toolNamesFor(open, NONE, false, true, false).includes(CODEBASE_TOOL_NAME));
  assert.ok(toolNamesFor(open, NONE, false, false, true).includes(CODEBASE_TOOL_NAME));

  const bare = harness(BARE, 'bare');
  assert.ok(
    toolNamesFor(bare, NONE, false, false, true).includes(CODEBASE_TOOL_NAME),
    'a file that claims nothing still gets it',
  );
});

test('a skill arriving mid-session still adds what it grants', () => {
  const h = harness(ASK_SKILL, 'ask', [SYNTHESIS_SKILL, 'synthesis']);
  const names = toolNamesFor(h, NONE, true, true, false);
  for (const t of DRAFT_TOOL_NAMES) assert.ok(names.includes(t), `${t} missing after arrival`);
  assert.ok(names.includes('spawn'), 'working files bring fan-out');
});
