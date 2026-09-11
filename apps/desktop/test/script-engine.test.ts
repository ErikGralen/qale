import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHILD_PREAMBLE, MATCH_SYSTEM_PROMPT, namingSystemPrompt } from '@qale/agent';
import { buildKickoff } from '@qale/sessions';
import {
  DEFAULT_PAUSE,
  ScriptEngine,
  classify,
  firstUserText,
  normalise,
  skillInForce,
} from '../src/main/demo/script-engine.js';
import { loadScenarios, type Conversation, type Scenario } from '../src/main/demo/scenario.js';
import type { WireMessage } from '../src/main/demo/replay-recordings.js';

/**
 * The engine routes by trigger and index (docs/plan-demo-replay.md, section
 * 4.4). A typed opening is told apart by the skill in force and, where a
 * script lists them, a few words. These tests are about what binds, what does
 * not, and what a request past the script gets.
 */

const SYSTEM = 'You are the embedded agent inside "Qale".';
const FALLBACK = 'I only know the walkthrough.';

/** The system prompt after `/` picked a skill: the brief `state.invoke` appends. */
function under(skill: string, base = SYSTEM): string {
  return (
    `${base}\n\n## Skill now in force: ${skill} — What the skill is for.\n` +
    'These instructions govern the rest of this conversation.\n\nDo the thing.'
  );
}

function fixture(): Scenario {
  return JSON.parse(
    readFileSync(join(import.meta.dirname, 'fixtures', 'scenario-s1.json'), 'utf8'),
  ) as Scenario;
}

/** A second scenario with one typed conversation, for the search order. */
function second(): Scenario {
  return {
    version: 1,
    id: 's2',
    title: 'Who is waiting',
    do: 'Type the question.',
    conversations: [
      {
        id: 'ask',
        trigger: { kind: 'typed' },
        title: 'Who is waiting on no-show fees',
        turns: [{ text: 'Brasserie Lund and Nordic Steak.' }],
      },
      {
        id: 'child',
        trigger: { kind: 'child' },
        title: 'A child',
        turns: [{ tools: [{ name: 'write_result', input: { text: 'done' } }] }],
      },
    ],
  };
}

function engine(scenarios = [fixture(), second()]): ScriptEngine {
  const e = new ScriptEngine({ offsetDays: 12, fallbackText: FALLBACK });
  e.load(scenarios);
  return e;
}

function said(text: string): WireMessage {
  return { role: 'user', content: [{ type: 'text', text }] };
}

function answered(text: string): WireMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] };
}

function toolResult(text: string): WireMessage {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text }] }],
  };
}

const KICKOFF = buildKickoff({
  skill: 'arrival',
  instruction: '1 source just landed in your session folder, unfiled: brasserie-lund-review.vtt.',
});

test('a kickoff binds by skill name and turn 0 is served as text then tool_use', () => {
  const e = engine();
  const served = e.answer({ system: SYSTEM, messages: [said(KICKOFF)] });
  assert.equal(served.source, 'script');
  assert.equal(served.pauseMs, DEFAULT_PAUSE.firstTurn);
  assert.deepEqual(e.boundTo(KICKOFF), { scenarioId: 's1', conversationId: 'drop' });
  const { response } = served;
  assert.equal(response.stop_reason, 'tool_use');
  assert.equal(response.role, 'assistant');
  assert.equal(response.content.length, 1);
  const tool = response.content[0]!;
  assert.equal(tool.type, 'tool_use');
  assert.equal(tool.name, 'file_source');
  assert.match(String(tool.id), /^toolu_demo_[0-9a-f]{16}$/);
  // Templates are resolved for the demo day: the anchor plus twelve days.
  assert.deepEqual(tool.input, {
    path: 'sources/2026-07-29-brasserie-lund-review.md',
    from: 'brasserie-lund-review.vtt',
  });
});

test('the turn is the assistant count, and a scripted pause wins over the default', () => {
  const e = engine();
  const history = [said(KICKOFF), answered('x'), toolResult('Filed.')];
  const one = e.answer({ system: SYSTEM, messages: history });
  assert.equal(one.pauseMs, 700);
  assert.equal(one.response.stop_reason, 'tool_use');
  assert.equal(one.response.content[0]?.type, 'text');
  assert.equal(
    one.response.content[0]?.text,
    'Filed it as [[sources/2026-07-29-brasserie-lund-review]]. Sprint planning is on 2026-08-03.',
  );
  assert.equal(one.response.content[1]?.name, 'propose_todo');
  assert.deepEqual(one.response.content[1]?.input, {
    due: '2026-08-06',
    sources: ['[[meetings/2026-07-28-brasserie-lund-quarterly-review]]'],
    note: 'Decided on 2026-07-28, see decisions/2026-05-14-h2-order-no-show-fees-first.md',
  });
  const two = e.answer({
    system: SYSTEM,
    messages: [...history, answered('y'), toolResult('Proposed.')],
  });
  assert.equal(two.pauseMs, DEFAULT_PAUSE.withText);
  assert.equal(two.response.stop_reason, 'end_turn');
  assert.equal(
    two.response.content[0]?.text,
    'No-show fees has a date now: the end of October.\n\nRebecca writes the BOK-300 stories by 2026-08-08.',
  );
  // Two tool_use ids in one run are never the same.
  const ids = new Set([
    one.response.content[1]?.id,
    e.answer({ system: SYSTEM, messages: [said(KICKOFF)] }).response.content[0]?.id,
  ]);
  assert.equal(ids.size, 2);
});

test('two typed openings in one pinned scenario bind in file order', () => {
  const e = engine();
  e.pin('s1');
  const a = e.answer({ system: SYSTEM, messages: [said('BOK-412 is done. Who needs to know?')] });
  const b = e.answer({ system: SYSTEM, messages: [said('What did we tell Nordic Steak?')] });
  assert.equal(a.response.content[0]?.text, 'Three people need to know, and Jonas first.');
  assert.equal(b.response.content[0]?.text, 'Oskar was told "on the roadmap" in July.');
  assert.deepEqual(e.boundTo('BOK-412 is done. Who needs to know?'), {
    scenarioId: 's1',
    conversationId: 'who-to-tell',
  });
  // A third typed session has no conversation left, and binds nothing.
  const c = e.answer({ system: SYSTEM, messages: [said('And a third question?')] });
  assert.equal(c.source, 'off-script');
  assert.equal(c.response.content[0]?.text, fixture().offScript);
  assert.equal(e.boundTo('And a third question?'), undefined);
});

test('a typo in the typed text of turn 2 changes nothing', () => {
  const e = engine();
  const opening = said('BOK-412 is done. Who needs to know?');
  e.answer({ system: SYSTEM, messages: [opening] });
  // The second turn carries the card-state envelope on the typed message, the
  // way `withCardState` in packages/agent/src/card-state.ts writes it.
  const wrapped = [
    '<<<YOUR_CARDS id=ab12cd34>>>',
    'What you have written in this session, as it stands right now.',
    '- p_1 todo: pending',
    '<<<END_YOUR_CARDS id=ab12cd34>>>',
    'Aprove the frist one',
  ].join('\n');
  const past = e.answer({
    system: SYSTEM,
    messages: [opening, answered('Three people.'), said(wrapped)],
  });
  // The script has one turn, so turn 1 is off script, but the binding held:
  // the answer is the scenario's line, not the fallback, and no new binding
  // was made for the typo.
  assert.equal(past.source, 'off-script');
  assert.equal(past.response.content[0]?.text, fixture().offScript);
  assert.equal(e.boundTo('Aprove the frist one'), undefined);
  assert.equal(e.boundTo('BOK-412 is done. Who needs to know?')?.conversationId, 'who-to-tell');
  assert.equal(firstUserText([said(wrapped)]), 'Aprove the frist one');

  // Where the script has a turn, the typed words do not pick it: the turn
  // after the kickoff is the same whether a tool result or a typo follows.
  e.answer({ system: SYSTEM, messages: [said(KICKOFF)] });
  const afterTypo = e.answer({
    system: SYSTEM,
    messages: [said(KICKOFF), answered('x'), said(wrapped)],
  });
  const afterTool = e.answer({
    system: SYSTEM,
    messages: [said(KICKOFF), answered('x'), toolResult('Filed.')],
  });
  assert.equal(afterTypo.source, 'script');
  assert.equal(afterTypo.response.content[0]?.text, afterTool.response.content[0]?.text);
  assert.equal(afterTypo.response.content[1]?.name, 'propose_todo');
});

test('with nothing pinned the scenarios are searched in id order', () => {
  const e = engine([second(), fixture()]);
  assert.deepEqual(
    e.scenarios().map((s) => s.id),
    ['s1', 's2'],
  );
  assert.equal(e.pinned(), null);
  e.answer({ system: SYSTEM, messages: [said('first question')] });
  e.answer({ system: SYSTEM, messages: [said('second question')] });
  const third = e.answer({ system: SYSTEM, messages: [said('third question')] });
  assert.equal(e.boundTo('first question')?.scenarioId, 's1');
  assert.equal(e.boundTo('second question')?.scenarioId, 's1');
  assert.deepEqual(e.boundTo('third question'), { scenarioId: 's2', conversationId: 'ask' });
  assert.equal(third.response.content[0]?.text, 'Brasserie Lund and Nordic Steak.');
  // A child is told apart by its system prompt, and typed text never reaches a child.
  const child = e.answer({ system: `${CHILD_PREAMBLE}\nRules.`, messages: [said('Write the brief.')] });
  assert.equal(child.response.content[0]?.name, 'write_result');
  assert.deepEqual(classify('Write the brief.', CHILD_PREAMBLE), { kind: 'child' });
  assert.deepEqual(classify(KICKOFF, SYSTEM), { kind: 'skill', skill: 'arrival' });
  assert.deepEqual(classify('hello', SYSTEM), { kind: 'typed', skill: 'ask' });
});

test('a typed opening is classified by the last skill in force, or the base skill', () => {
  assert.equal(skillInForce(SYSTEM), 'ask');
  assert.equal(skillInForce(under('commitment-check')), 'commitment-check');
  // A second skill arriving later in the session is the one in force.
  assert.equal(skillInForce(under('iterate', under('commitment-check'))), 'iterate');
  assert.deepEqual(classify('Break this into stories.', under('iterate')), {
    kind: 'typed',
    skill: 'iterate',
  });
  // A kickoff is a kickoff whatever skill is in force.
  assert.deepEqual(classify(KICKOFF, under('iterate')), { kind: 'skill', skill: 'arrival' });
});

/** One scenario of typed conversations, each under its own skill. */
function typedUnderSkills(): Scenario {
  const typed = (id: string, skill: string, any?: string[]): Conversation => ({
    id,
    trigger: { kind: 'typed', skill, ...(any ? { any } : {}) },
    title: id,
    turns: [{ text: `bound to ${id}` }],
  });
  return {
    version: 1,
    id: 's9',
    title: 'Typed',
    do: 'Type things.',
    conversations: [
      typed('commitment', 'commitment-check'),
      typed('stories', 'iterate'),
      typed('plain', 'ask', ['BOK-412', 'who needs to know']),
    ],
  };
}

function textOf(e: ScriptEngine, first: string, system: string): string {
  return String(e.answer({ system, messages: [said(first)] }).response.content[0]?.text);
}

test('typed conversations bind by the skill in force, whatever was typed', () => {
  const e = engine([typedUnderSkills()]);
  // The words are the same three times; only the skill in force differs.
  const words = 'BOK-412 shipped and nobody was told. Who needs to know?';
  assert.equal(textOf(e, `${words} (iterate)`, under('iterate')), 'bound to stories');
  assert.equal(textOf(e, `${words} (commitment)`, under('commitment-check')), 'bound to commitment');
  assert.equal(textOf(e, `${words} (plain)`, SYSTEM), 'bound to plain');
  assert.deepEqual(e.boundTo(`${words} (iterate)`), { scenarioId: 's9', conversationId: 'stories' });
  // The same skill a second time has no free conversation left.
  assert.equal(
    e.answer({ system: under('iterate'), messages: [said('Another round?')] }).source,
    'off-script',
  );
});

test('`any` rejects a message with none of the words, case-insensitively', () => {
  const e = engine([typedUnderSkills()]);
  const off = e.answer({ system: SYSTEM, messages: [said('What is our ARR this quarter?')] });
  assert.equal(off.source, 'off-script');
  assert.equal(off.response.content[0]?.text, FALLBACK);
  assert.equal(e.boundTo('What is our ARR this quarter?'), undefined);
  assert.equal(textOf(e, 'bok-412 went out. WHO NEEDS TO KNOW?', SYSTEM), 'bound to plain');
});

test('a plain ask binds to the `ask` conversation and never to a skill’s', () => {
  const e = engine([typedUnderSkills()]);
  // A paste that reads like a commitment, typed with nothing picked.
  const pasted = 'Marcus here. Nordic Steak wants group bookings. Who needs to know?';
  assert.equal(textOf(e, pasted, SYSTEM), 'bound to plain');
  assert.equal(e.boundTo(pasted)?.conversationId, 'plain');
  // With `plain` taken, the same opening again binds nothing rather than
  // falling into the commitment-check conversation.
  const again = e.answer({ system: SYSTEM, messages: [said(`${pasted} Again.`)] });
  assert.equal(again.source, 'off-script');
  assert.equal(e.boundTo(`${pasted} Again.`), undefined);
});

/** The shipped scripts, read from the repo. */
function shipped(): Scenario[] {
  return loadScenarios(join(import.meta.dirname, '..', '..', '..', 'demo', 'scenarios'));
}

/** What the presenter's action sends for each shipped conversation, per the `do` lines. */
function openingOf(scenario: Scenario, c: Conversation): { first: string; system: string } {
  if (c.trigger.kind === 'skill') {
    const skill = c.trigger.skill ?? 'ask';
    const targets = skill === 'meeting-prep' ? ['meetings/2026-07-23-steering.md'] : undefined;
    return {
      first: buildKickoff({ skill, ...(targets ? { targets } : {}), instruction: '' }),
      system: SYSTEM,
    };
  }
  const skill = c.trigger.skill ?? 'ask';
  return {
    first: `${scenario.do} [${c.id}]`,
    system: skill === 'ask' ? SYSTEM : under(skill),
  };
}

test('every shipped scenario binds with no pin, in id order and backwards', () => {
  const all = shipped();
  assert.ok(all.length > 0, 'the repo ships scenarios');
  const ids = all.map((s) => s.id);
  const orders = [ids, [...ids].reverse()];
  for (const order of orders) {
    const e = engine(all);
    for (const id of order) {
      const scenario = all.find((s) => s.id === id)!;
      for (const c of scenario.conversations) {
        const { first, system } = openingOf(scenario, c);
        const served = e.answer({ system, messages: [said(first)] });
        assert.equal(served.source, 'script', `${order.join(',')}: ${id}/${c.id} was ${served.source}`);
        assert.deepEqual(
          e.boundTo(first),
          { scenarioId: id, conversationId: c.id },
          `${order.join(',')}: ${id}/${c.id} bound elsewhere`,
        );
      }
    }
    assert.equal(e.pinned(), null);
  }
});

test('a pinned scenario with no matching conversation is off script with its own line', () => {
  const e = engine();
  e.pin('s2');
  assert.equal(e.pinned(), 's2');
  const off = e.answer({ system: SYSTEM, messages: [said(KICKOFF)] });
  assert.equal(off.source, 'off-script');
  // s2 has no offScript, so the fallback answers.
  assert.equal(off.response.content[0]?.text, FALLBACK);
  assert.equal(off.response.stop_reason, 'end_turn');
  e.pin('nowhere');
  assert.equal(e.pinned(), 's2');
});

test('reset clears the pin and the bindings, and the scenarios stay', () => {
  const e = engine();
  e.pin('s1');
  e.answer({ system: SYSTEM, messages: [said('a question')] });
  e.reset();
  assert.equal(e.pinned(), null);
  assert.equal(e.boundTo('a question'), undefined);
  assert.equal(e.scenarios().length, 2);
  // The same opening binds again, to the first free conversation.
  e.answer({ system: SYSTEM, messages: [said('a question')] });
  assert.equal(e.boundTo('a question')?.conversationId, 'who-to-tell');
});

test('cheap calls are answered without binding, and read the bound titles', () => {
  const e = engine();
  const claim = e.answer({
    system: MATCH_SYSTEM_PROMPT,
    messages: [
      said('Claim: No-show fees live by the end of October.\n\nExcerpts:\n(none)'),
    ],
  });
  assert.equal(claim.source, 'cheap');
  assert.equal(claim.pauseMs, 0);
  assert.match(String(claim.response.content[0]?.text), /^CONFLICT \| customers/);
  assert.equal(
    e.boundTo('Claim: No-show fees live by the end of October.\n\nExcerpts:\n(none)'),
    undefined,
  );

  const typed = 'BOK-412 is done. Who needs to know?';
  e.answer({ system: SYSTEM, messages: [said(typed)] });
  const name = e.answer({
    system: namingSystemPrompt(),
    messages: [said(`First message:\n${typed}`)],
  });
  assert.equal(name.response.content[0]?.text, 'Who to tell about BOK-412');
  // An unbound first message gets its first six words.
  const unnamed = e.answer({
    system: namingSystemPrompt(),
    messages: [said('First message:\nWhat is our ARR this quarter, roughly?')],
  });
  assert.equal(unnamed.response.content[0]?.text, 'What is our ARR this quarter,');
});

test('the fingerprint takes out everything that moves between two runs', () => {
  const before =
    'session 3f0d9a1e-2b7c-4a55-9f31-7c2e5a1b8d40 wrote 2026-07-17 at 2026-07-17T09:30:00Z, 128456 bytes';
  const after =
    'session 5c1e8b2f-9a04-4d13-8e77-1b6a3c9f0e22 wrote 2026-09-05 at 2026-09-05T11:02:13.500Z, 99871 bytes';
  assert.equal(normalise(before), normalise(after));
  assert.equal(normalise('due 2026-07-25'), 'due <date>');
  assert.equal(normalise('page 3 of 12'), 'page 3 of 12');
});
