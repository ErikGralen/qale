import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASK_SKILL, LIBRARIAN_AGENT, parseRunnable, SessionHarness } from '@qale/sessions';
import { AgentRuntime, type CodebaseRequestInfo } from '../src/runtime.js';
import { CODEBASE_MODELS } from '../src/codebase-models.js';
import type { CodebaseAsk, CodebaseDecision } from '../src/codebase.js';

/**
 * The approval card, end to end inside the runtime (CC-7). `ask_codebase` parks
 * on it and a run costs real minutes on somebody else's machine, so the four
 * things asserted here are the four ways that promise can be settled: the PM
 * answers it, the PM stops the run, the tab reopens and has to be handed the
 * card back, or a clock started the run and there is nobody to ask at all.
 *
 * The card itself is driven through the private method the tool calls, the way
 * session-naming.test.ts drives the naming pass: `private` is a compile-time
 * word, and the alternative is a whole live session just to reach one promise.
 */

/** The private surface these tests drive. */
interface Innards {
  askTheCodebase(sessionId: string, ask: CodebaseAsk): Promise<CodebaseDecision>;
  sessions: Map<string, unknown>;
  streamToSession: Map<string, string>;
}

const ASK: CodebaseAsk = {
  question: 'Does the importer de-duplicate rows before writing?',
  repo: { name: 'checkout', dir: '/code/checkout' },
  modelId: 'sonnet',
  why: 'One question about one file, so the cheap model is enough.',
};

interface Pushed {
  sessionId: string;
  request: CodebaseRequestInfo | null;
}

/** A configured runtime with one session in it, and every push it makes. */
function runtimeFor(opts: { skill?: [string, string]; unattended?: boolean } = {}) {
  const runtime = new AgentRuntime();
  runtime.configure({
    vaultDir: mkdtempSync(join(tmpdir(), 'qale-vault-')),
    userDataDir: mkdtempSync(join(tmpdir(), 'qale-userdata-')),
    modelId: 'claude-test',
    apiKey: null,
  });

  const pushes: Pushed[] = [];
  runtime.onCodebaseRequest = (sessionId, request) => void pushes.push({ sessionId, request });

  // What the turn is, which is all `askTheCodebase` reads off the session.
  const turn = {
    scheduled: false,
    unattended: !!opts.unattended,
    ended: false,
    asked: false,
    blocked: false,
  };
  const [file, name] = opts.skill ?? [ASK_SKILL, 'ask'];
  const state = {
    turn,
    harness: new SessionHarness('s1', parseRunnable(file, name), '2026-08-23T09:00:00Z'),
    session: { abort: async () => {} },
    bridge: null,
  };
  const inner = runtime as unknown as Innards;
  // Set after configure: reconfiguring disposes every live session.
  inner.sessions.set('s1', state);
  return { runtime, inner, pushes, turn };
}

test('the card carries the decision, and the question waits on it', async () => {
  const { runtime, inner, pushes, turn } = runtimeFor();
  const decided = inner.askTheCodebase('s1', ASK);

  const card = pushes[0]?.request;
  assert.ok(card, 'the card was never raised');
  assert.equal(pushes[0]!.sessionId, 's1');
  assert.equal(card.question, ASK.question, 'exactly what will be asked, not a summary of it');
  assert.equal(card.repo, 'checkout');
  assert.equal(card.suggestedModelId, 'sonnet');
  assert.equal(card.why, ASK.why);
  assert.equal(card.resume, false);
  assert.equal(card.offered, false, 'the PM started this, so the question is owed');
  // The aliases the `claude` tool takes, never the workspace's own models.
  assert.deepEqual(
    card.models.map((m) => m.id),
    CODEBASE_MODELS.map((m) => m.id),
  );
  assert.equal(turn.asked, true, 'a spend the PM had to approve is attention already spent');

  // A tab reopened while the question waited redraws the card from here, not
  // from the push it missed.
  assert.equal(runtime.pendingCodebase('s1')?.id, card.id);
  assert.equal(runtime.pendingCodebase('s2'), null);

  runtime.resolveCodebase(card.id, { approved: true, modelId: 'opus' });
  assert.deepEqual(await decided, { approved: true, modelId: 'opus' });
  assert.equal(pushes.at(-1)?.request, null, 'the card is cleared');
  assert.equal(runtime.pendingCodebase('s1'), null);

  // Answering a settled card is a no-op rather than a second run.
  runtime.resolveCodebase(card.id, { approved: true, modelId: 'fable' });
  assert.equal(pushes.length, 2);
});

test('a resumed run offers no picker, so the decision carries no model', async () => {
  const { runtime, inner, pushes } = runtimeFor();
  const decided = inner.askTheCodebase('s1', { ...ASK, resumeSessionId: 'cc-42' });

  const card = pushes[0]!.request!;
  assert.equal(card.resume, true, 'the renderer draws a fixed label off this');
  assert.equal(card.suggestedModelId, 'sonnet', 'the model the session already runs on');

  // A model sent with a resume is dropped rather than passed on. The card draws
  // no picker, so one arriving here is a renderer bug, and the string it holds
  // would end up as a `--model` flag on a session that cannot change models.
  runtime.resolveCodebase(card.id, { approved: true, modelId: 'opus' });
  const decision = await decided;
  assert.equal(decision.approved, true);
  assert.equal(decision.modelId, undefined, 'nobody was asked, so nothing is answered');
});

test('a model that is not in the catalogue never reaches the run', async () => {
  const { runtime, inner, pushes } = runtimeFor();
  const decided = inner.askTheCodebase('s1', ASK);
  runtime.resolveCodebase(pushes[0]!.request!.id, { approved: true, modelId: '--dangerous' });
  // Dropped, not refused: the run falls back to the model the session suggested
  // and the PM read on the card, which is the only other model in play.
  assert.deepEqual(await decided, { approved: true });
});

test('a "not now" carries nothing but the no', async () => {
  const { runtime, inner, pushes } = runtimeFor();
  const decided = inner.askTheCodebase('s1', ASK);
  runtime.resolveCodebase(pushes[0]!.request!.id, { approved: false, modelId: 'opus' });
  assert.deepEqual(await decided, { approved: false });
});

test('Stop settles a card nobody else will', async () => {
  const { runtime, inner, pushes } = runtimeFor();
  inner.streamToSession.set('stream-1', 's1');
  const decided = inner.askTheCodebase('s1', ASK);

  await runtime.abort('stream-1');
  assert.deepEqual(await decided, { approved: false }, 'stopping is a no, not a hang');
  assert.equal(pushes.at(-1)?.request, null);
  assert.equal(runtime.pendingCodebase('s1'), null);
});

test('a run a clock started is refused instead of parked', async () => {
  const { runtime, inner, pushes, turn } = runtimeFor();
  turn.scheduled = true;

  const decision = await inner.askTheCodebase('s1', ASK);
  assert.deepEqual(decision, { approved: false, unattended: true });
  assert.deepEqual(pushes, [], 'no card, because nobody is at the screen to answer it');
  assert.equal(runtime.pendingCodebase('s1'), null);
  assert.equal(turn.blocked, true, 'the run stopped on a decision only a person can make');
  assert.equal(turn.asked, false);
});

test('a tidy pass nobody asked for asks quietly', async () => {
  const { pushes, inner } = runtimeFor({ skill: [LIBRARIAN_AGENT, 'librarian'], unattended: true });
  void inner.askTheCodebase('s1', ASK);
  assert.equal(
    pushes[0]!.request!.offered,
    true,
    'the spend still needs approving, but it may wait as long as the PM likes',
  );
});
