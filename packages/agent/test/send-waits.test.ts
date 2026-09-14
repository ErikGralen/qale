import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UseCaseContext } from '@qale/application';
import { SHARED_PREAMBLE, UNATTENDED_RULES } from '../src/prompts.js';
import { CALENDAR_TOOL_NAMES, DRAFT_TOOL_NAMES, createDraftTools } from '../src/tools.js';

/**
 * The one rule fewer approvals does not move (docs/fewer-approvals.md, the
 * constraint above the tickets): the agent never sends anything to Jira,
 * Confluence, a calendar or mail on its own.
 *
 * FA-6 turned most writes into writes that land, which makes the prompts the
 * only place the model reads that a send is different. So every string it can
 * read on the way to a send says so, in the same words. A tool whose
 * description loses that sentence is how the rule gets read as advice.
 */

/** Enough of a context for the draft tools to be built; nothing here is called. */
function emptyCtx(): UseCaseContext {
  return {
    vault: { readNote: async () => null },
    index: { resolve: () => null, listByType: () => [] },
    proposals: { create: () => ({ id: 'p1' }), list: () => [] },
  } as unknown as UseCaseContext;
}

test('every draft tool says the send waits for the PM', () => {
  const tools = createDraftTools(emptyCtx(), 'session-1');
  const outbound = [...DRAFT_TOOL_NAMES, ...CALENDAR_TOOL_NAMES];

  // Every tool this factory returns is one that can reach outside the
  // workspace, so the list below has to cover all of them.
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    [...outbound].sort(),
    'a draft tool exists that neither gate names, so nothing checks what it says',
  );

  for (const name of outbound) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `${name} is not among the draft tools`);
    assert.match(
      tool.description,
      /This waits for the PM\. Nothing is sent until they approve it\./,
      `${name} no longer says the send waits for the PM`,
    );
  }
});

test('the shared preamble says a send waits, whatever else lands', () => {
  assert.match(SHARED_PREAMBLE, /Decide, ask, or wait/);
  assert.match(SHARED_PREAMBLE, /it leaves the workspace \(Jira, Confluence, a calendar, mail\)/);
  assert.match(SHARED_PREAMBLE, /Anything sent waits every time, whatever else is\s+true/);
  // The rule it replaced decided by folder, and made a todo and a meeting page
  // wait. Nothing may bring it back.
  assert.doesNotMatch(SHARED_PREAMBLE, /Two spheres/);
});

test('the preamble says a new document waits, asked or not', () => {
  assert.match(SHARED_PREAMBLE, /it makes a new page in notes\//);
  assert.match(SHARED_PREAMBLE, /A new document waits\s+even when they asked for it/);
  // The agent takes its own notes in the memory, so Documents never fills with
  // pages the PM did not ask for.
  assert.match(SHARED_PREAMBLE, /you take your own notes in the memory\s+folder/);
});

test('the preamble carries the conflict question, its shape and its cost', () => {
  assert.match(SHARED_PREAMBLE, /ask\s+one question before you write/);
  assert.match(SHARED_PREAMBLE, /the two answers as options/);
  // The worked example, so the shape is read as a shape and not as a rule.
  assert.match(SHARED_PREAMBLE, /Is Åsa the\s+owner now\?/);
  assert.match(SHARED_PREAMBLE, /set "asked"/);
  assert.match(SHARED_PREAMBLE, /Never ask whether you may write/);
  assert.match(SHARED_PREAMBLE, /Read, ask, write, in that order/);
  assert.match(SHARED_PREAMBLE, /Pick the cheapest one that cannot be wrong/);
});

test('an assumed write waits, and the unattended rules say so where the label is set', () => {
  assert.match(UNATTENDED_RULES, /"Assumed:"/);
  assert.match(UNATTENDED_RULES, /A write whose rationale\s+starts "Assumed:" waits for the PM/);
});
