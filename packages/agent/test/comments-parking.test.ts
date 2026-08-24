import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AskPort, AskRecord, CreateAskInput } from '@qale/application';
import { AskParking, type AskDecision, type AskRequestDraft, type StoredAsk } from '../src/ask.js';
import {
  commentRequestId,
  commentsReplayPrompt,
  createCommentsTool,
  planComments,
} from '../src/comments.js';
import type { CommentPlan } from '../src/slots.js';

/**
 * A round parks on the same machinery a question does, so what is worth testing
 * is that the round SURVIVES it: the payload the renderer needs is written down,
 * a relaunch redraws the document rather than an empty question card, and the
 * replay that reaches a resumed turn is the comments one.
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
        // Null is what the column holds for a question card, and it must not
        // come back out as a comment request with nothing in it.
        ...(input.comments == null ? {} : { comments: JSON.parse(JSON.stringify(input.comments)) }),
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

const round = ['```slot idea-1', 'Keep? Cut?', '```', '', '```slot idea-2', '```'].join('\n');

const plan = (): CommentPlan => {
  const r = planComments({ path: 'round-1.md' }, round);
  if ('error' in r) throw new Error(r.error);
  return r.plan;
};

const requestFor = (sessionId: string, p = plan()): AskRequestDraft => ({
  id: commentRequestId(sessionId, p),
  sessionId,
  questions: [],
  comments: p,
});

const parking = () => new AskParking({ onChange: () => undefined });

const sent: AskDecision = { answers: null, comments: { answers: { 'idea-1': 'Smaller' } } };

test('the round is written down before it is shown, payload and all', () => {
  const store = fakeStore();
  const request = requestFor('s1');
  void parking().park(store, request, { skill: 'iterate' });
  const row = store.get(request.id);
  assert.ok(row, 'the round is on disk, not only in the push');
  assert.deepEqual(row!.comments, plan());
  assert.deepEqual(row!.questions, []);
});

test('after a relaunch the card is still a round, not an empty question', () => {
  const store = fakeStore();
  const request = requestFor('s1');
  void parking().park(store, request, { skill: 'iterate' });

  const recovered = parking().pendingFor(store, 's1');
  assert.ok(recovered, 'the round survived the process that asked for comments');
  assert.equal(recovered!.id, request.id);
  assert.equal(recovered!.comments?.path, 'round-1.md');
  assert.deepEqual(
    recovered!.comments?.slots.map((s) => s.id),
    ['idea-1', 'idea-2'],
  );
  // A question card asked in the same workspace still redraws as one.
  assert.equal(parking().all(store)[0]!.comments?.path, 'round-1.md');
});

test('Send in the same run resolves the parked turn and the tool renders it', async () => {
  const store = fakeStore();
  const live = parking();
  const request = requestFor('s1');
  const parked = live.park(store, request, {});
  await live.resolve(store, request.id, sent);
  const decision = await parked;
  assert.deepEqual(decision.comments, sent.comments);
  assert.equal(store.get(request.id), null, 'sent, so it is no longer waiting');

  const tool = createCommentsTool({
    read: async () => round,
    requestComments: async () => decision,
  });
  const out = await (
    tool.execute as (id: string, p: unknown) => Promise<{ content: { text: string }[] }>
  )('call-1', { path: 'round-1.md' });
  assert.match(out.content[0]!.text, /idea-1: Smaller/);
  assert.match(out.content[0]!.text, /idea-2: \(skipped/);
});

test('a round sent after a quit replays into the session as comments', async () => {
  const store = fakeStore();
  const request = requestFor('s1');
  void parking().park(store, request, { skill: 'iterate' });

  const after = parking();
  const replayed: StoredAsk[] = [];
  await after.resolve(store, request.id, sent, async (asked) => void replayed.push(asked));
  assert.equal(replayed.length, 1);
  assert.equal(replayed[0]!.skill, 'iterate');
  const asked = replayed[0]!;
  assert.ok(asked.comments, 'the resumed turn has to know which round this was');
  const prompt = commentsReplayPrompt(asked.comments!, sent.comments ?? null);
  assert.match(prompt, /in an earlier run/i);
  assert.match(prompt, /The PM wrote in round-1\.md:/);
  assert.match(prompt, /idea-1: Smaller/);
});

test('sending twice is harmless, live or after a restart', async () => {
  const store = fakeStore();
  const live = parking();
  const request = requestFor('s1');
  const parked = live.park(store, request, {});
  await live.resolve(store, request.id, sent);
  await live.resolve(store, request.id, {
    answers: null,
    comments: { answers: { 'idea-1': 'Cut' } },
  });
  assert.deepEqual((await parked).comments, sent.comments, 'the first Send stands');

  const other = requestFor('s2');
  void parking().park(store, other, {});
  const after = parking();
  let replays = 0;
  const replay = async () => void replays++;
  await after.resolve(store, other.id, sent, replay);
  await after.resolve(store, other.id, sent, replay);
  assert.equal(replays, 1);
});

test('stopping the run closes the round with no comments', async () => {
  const store = fakeStore();
  const live = parking();
  const request = requestFor('s1');
  const parked = live.park(store, request, {});
  live.cancel(store, 's1');
  const decision = await parked;
  assert.equal(decision.comments, undefined, 'a cancelled round reads as a dismissal');
  assert.equal(store.get(request.id), null);
});

test('a scheduled run refuses the round: no card, no row', async () => {
  const store = fakeStore();
  const live = parking();
  const decision = await live.park(store, requestFor('s1'), { scheduled: true, skill: 'iterate' });
  assert.equal(decision.unattended, true);
  assert.equal(decision.comments, undefined);
  assert.equal(store.rows.size, 0, 'nothing to recover later, nobody was ever asked');
});
