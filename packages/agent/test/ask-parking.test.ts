import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AskPort, AskRecord, CreateAskInput } from '@qale/application';
import {
  AskParking,
  askRequestId,
  askReplayPrompt,
  createAskTool,
  planAsk,
  type AskAnswer,
  type AskDecision,
  type AskPlan,
  type AskRequestDraft,
  type AskRequestInfo,
  type StoredAsk,
} from '../src/ask.js';

/**
 * A parked question has to survive a quit (QM ticket 9). Three things carry
 * that: the question is written down before the card is shown, an answer that
 * arrives after the turn died replays into the session instead of resolving a
 * promise nobody is holding, and a run a clock started refuses to ask at all.
 *
 * The store here is the real contract of `AskPort` over a Map, so "restart" is
 * literally a second {@link AskParking} over the same rows — which is exactly
 * what a relaunch is.
 */

/** The app.db store, in memory. Same semantics: a row exists iff unanswered. */
function fakeStore(): AskPort & { rows: Map<string, AskRecord> } {
  const rows = new Map<string, AskRecord>();
  return {
    rows,
    create(input: CreateAskInput, now: number): AskRecord {
      const record: AskRecord = {
        id: input.id,
        sessionId: input.sessionId,
        questions: JSON.parse(JSON.stringify(input.questions)),
        skill: input.skill ?? null,
        outbound: !!input.outbound,
        unattended: !!input.unattended,
        created: now,
      };
      rows.set(record.id, record);
      return record;
    },
    list: () => [...rows.values()].sort((a, b) => a.created - b.created),
    get: (id: string) => rows.get(id) ?? null,
    forSession: (sessionId: string) =>
      [...rows.values()].filter((r) => r.sessionId === sessionId).pop() ?? null,
    remove: (id: string) => void rows.delete(id),
  };
}

const plan = (): AskPlan => {
  const r = planAsk({
    questions: [
      {
        header: 'Whose framing',
        question: 'Two notes contradict each other on the renewal date. Which do I follow?',
        options: [
          { label: 'The meeting note', description: 'Written the day it was said' },
          { label: 'The Jira issue', description: 'Edited last week by someone else' },
        ],
      },
    ],
  });
  if ('error' in r) throw new Error(r.error);
  return r.plan;
};

const requestFor = (sessionId: string, p = plan()): AskRequestDraft => ({
  id: askRequestId(sessionId, p),
  sessionId,
  questions: p.questions,
});

interface Pushed {
  sessionId: string;
  request: AskRequestInfo | null;
}

const parking = (pushes: Pushed[]) =>
  new AskParking({ onChange: (sessionId, request) => void pushes.push({ sessionId, request }) });

const answer: AskAnswer[] = [{ selected: ['The meeting note'] }];

// --- the id --------------------------------------------------------------

test('the id comes from the session and the questions, so re-asking is one question', () => {
  const p = plan();
  assert.equal(askRequestId('s1', p), askRequestId('s1', p));
  // Same questions, different conversation: two questions, two cards.
  assert.notEqual(askRequestId('s1', p), askRequestId('s2', p));
  const other = planAsk({
    questions: [
      { header: 'Scope', question: 'How wide?', options: [{ label: 'A' }, { label: 'B' }] },
    ],
  });
  if ('error' in other) throw new Error(other.error);
  assert.notEqual(askRequestId('s1', p), askRequestId('s1', other.plan));
});

// --- surviving a quit ----------------------------------------------------

test('a question is written down before the card is shown', () => {
  const store = fakeStore();
  const pushes: Pushed[] = [];
  const request = requestFor('s1');
  void parking(pushes).park(store, request, { skill: 'synthesis', outbound: true });
  const row = store.get(request.id);
  assert.ok(row, 'the question is on disk, not only in the push');
  assert.equal(row!.sessionId, 's1');
  assert.equal(row!.skill, 'synthesis');
  assert.equal(row!.outbound, true);
  assert.equal(pushes.at(-1)?.request?.id, request.id);
});

test('a question asked before a quit is still there after the relaunch, and answering it replays', async () => {
  const store = fakeStore();
  const request = requestFor('s1');
  // The app run that asked. Nothing settles it — this is the laptop closing.
  void parking([]).park(store, request, { skill: 'synthesis' });

  // The relaunch: a fresh parking, holding no promises, over the same rows.
  const pushes: Pushed[] = [];
  const after = parking(pushes);
  const recovered = after.pendingFor(store, 's1');
  assert.ok(recovered, 'the question survived the process that asked it');
  assert.equal(recovered!.id, request.id);
  // Exactly what was validated, chipped header and all: the card is redrawn
  // from the row, never re-derived.
  assert.equal(recovered!.questions[0]!.header, 'Whose');
  assert.equal(recovered!.questions[0]!.options.length, 2);
  assert.deepEqual(
    after.all(store).map((r) => r.id),
    [request.id],
  );

  // Answering it now has no promise to resolve, so it resumes the session.
  const replayed: { asked: StoredAsk; decision: AskDecision }[] = [];
  await after.resolve(store, request.id, { answers: answer }, async (asked, decision) => {
    replayed.push({ asked, decision });
  });
  assert.equal(replayed.length, 1);
  assert.equal(replayed[0]!.asked.sessionId, 's1');
  // The skill it asked under comes back with it: the resumed turn works under
  // the same instructions rather than as a plain chat.
  assert.equal(replayed[0]!.asked.skill, 'synthesis');
  assert.deepEqual(replayed[0]!.decision.answers, answer);
  assert.equal(store.get(request.id), null, 'answered, so it is no longer waiting');
  assert.equal(after.pendingFor(store, 's1'), null);
});

test('the replayed prompt carries the answer and says the work above still stands', () => {
  const text = askReplayPrompt(plan(), answer);
  assert.match(text, /in an earlier run/i);
  assert.match(text, /still your own work/i);
  assert.match(text, /A: The meeting note/);
  // Skipped after a restart is still a skip, not a silent resume.
  assert.match(askReplayPrompt(plan(), null), /dismissed/i);
});

test('a question answered in the same run resolves the parked turn and never replays', async () => {
  const store = fakeStore();
  const pushes: Pushed[] = [];
  const live = parking(pushes);
  const request = requestFor('s1');
  const parked = live.park(store, request, {});
  let replays = 0;
  await live.resolve(store, request.id, { answers: answer }, async () => void replays++);
  assert.equal(replays, 0, 'the turn is alive — the answer goes back as a tool result');
  assert.deepEqual((await parked).answers, answer);
  assert.equal(store.get(request.id), null);
  assert.equal(pushes.at(-1)?.request, null, 'the card is cleared');
});

// --- answering twice -----------------------------------------------------

test('answering twice is harmless, live or after a restart', async () => {
  const store = fakeStore();
  const live = parking([]);
  const request = requestFor('s1');
  const parked = live.park(store, request, {});
  await live.resolve(store, request.id, { answers: answer });
  await live.resolve(store, request.id, { answers: [{ selected: ['The Jira issue'] }] });
  assert.deepEqual((await parked).answers, answer, 'the first answer stands');

  // Same again across a restart: the second answer starts no second turn.
  const other = requestFor('s2');
  void parking([]).park(store, other, {});
  const after = parking([]);
  let replays = 0;
  const replay = async () => void replays++;
  await after.resolve(store, other.id, { answers: answer }, replay);
  await after.resolve(store, other.id, { answers: answer }, replay);
  assert.equal(replays, 1);
});

test('a question that cannot be resumed comes back rather than vanishing', async () => {
  const store = fakeStore();
  const request = requestFor('s1');
  void parking([]).park(store, request, { skill: 'synthesis' });
  const pushes: Pushed[] = [];
  const after = parking(pushes);
  await after.resolve(store, request.id, { answers: answer }, async () => {
    throw new Error('no API key');
  });
  const back = after.pendingFor(store, 's1');
  assert.ok(back, 'an answer that landed nowhere must not take the question with it');
  assert.equal(back!.id, request.id);
  assert.equal(store.get(request.id)!.skill, 'synthesis');
  assert.equal(pushes.at(-1)?.request?.id, request.id);
});

test('stopping the run takes the written-down copy with it', () => {
  const store = fakeStore();
  const live = parking([]);
  const request = requestFor('s1');
  void live.park(store, request, {});
  live.cancel(store, 's1');
  assert.equal(store.get(request.id), null);
  assert.equal(live.pendingFor(store, 's1'), null);
  // And a row whose turn this process never held is dropped the same way.
  const orphan = requestFor('s2');
  void parking([]).park(store, orphan, {});
  parking([]).cancel(store, 's2');
  assert.equal(store.get(orphan.id), null);
});

test('with no store a question still parks, it just cannot outlive the turn', async () => {
  const pushes: Pushed[] = [];
  const live = parking(pushes);
  const request = requestFor('s1');
  const parked = live.park(undefined, request, {});
  assert.equal(live.pendingFor(undefined, 's1')?.id, request.id);
  await live.resolve(undefined, request.id, { answers: answer });
  assert.deepEqual((await parked).answers, answer);
});

// --- an unattended run ---------------------------------------------------

test('a scheduled run refuses to ask: no card, no row, no push', async () => {
  const store = fakeStore();
  const pushes: Pushed[] = [];
  const live = parking(pushes);
  const request = requestFor('s1');
  const decision = await live.park(store, request, { scheduled: true, skill: 'synthesis' });
  assert.equal(decision.unattended, true);
  assert.equal(decision.answers, null);
  assert.equal(store.rows.size, 0, 'nothing to recover later — nobody ever asked');
  assert.deepEqual(pushes, []);
  assert.equal(live.pendingFor(store, 's1'), null);
});

test('only a tidy pass nobody started asks quietly, and it still asks quietly tomorrow', async () => {
  const store = fakeStore();
  const pushes: Pushed[] = [];
  const live = parking(pushes);

  // The 5-minute tick's own run: offered, so no badge and no chasing.
  const swept = requestFor('s1');
  void live.park(store, swept, { unattended: true, skill: 'librarian' });
  assert.equal(pushes.at(-1)?.request?.offered, true);
  // And still offered after a relaunch, read back off the row rather than
  // guessed from the agent's name alone.
  assert.equal(parking([]).pendingFor(store, 's1')?.offered, true);

  // The same agent, opened by the PM from the Skills page: they are sitting
  // there waiting for the answer, so it is owed like any other question.
  const byHand = requestFor('s2');
  void live.park(store, byHand, { skill: 'librarian' });
  assert.equal(pushes.at(-1)?.request?.offered, false);

  // Arrival runs with nobody watching, but somebody handed it the material and
  // is coming back for it.
  const arriving = requestFor('s3');
  void live.park(store, arriving, { unattended: true, skill: 'arrival' });
  assert.equal(pushes.at(-1)?.request?.offered, false);
  assert.deepEqual(
    live.all(store).map((r) => r.offered),
    [true, false, false],
  );
});

test('a refused question tells the model to stop, not to decide for itself', async () => {
  const tool = createAskTool({ requestAnswer: async () => ({ answers: null, unattended: true }) });
  const out = await (
    tool.execute as (id: string, p: unknown) => Promise<{ content: { text: string }[] }>
  )('call-1', { questions: plan().questions });
  const said = out.content[0]!.text;
  assert.match(said, /Nobody is here to answer/i);
  assert.match(said, /Stop now/i);
  // A dismissal says "pick the most reasonable option yourself"; this is the
  // opposite instruction, and confusing the two is the whole risk here.
  assert.doesNotMatch(said, /Pick the most reasonable option yourself/i);
});
