import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AskRequestDTO, NoteRefDTO, ProposalDTO, VaultTreeDTO } from '@pm/ipc';
import {
  buildAttention,
  countOf,
  homeRows,
  waitingOnYou,
  type AttentionInput,
  type AttentionSession,
} from '../src/renderer/src/lib/attention.js';

/** Local-clock instants — the list buckets by the PO's day, not by UTC. */
const at = (day: number, hour: number, minute = 0): number =>
  new Date(2026, 6, day, hour, minute).getTime();

const NOW = at(28, 9);

function note(type: NoteRefDTO['type'], slug: string, extra: Partial<NoteRefDTO> = {}): NoteRefDTO {
  return {
    path: `${type}s/${slug}.md`,
    slug,
    type,
    title: slug,
    summary: '',
    mtime: NOW,
    ...extra,
  };
}

function tree(...notes: NoteRefDTO[]): VaultTreeDTO {
  const groups = new Map<string, NoteRefDTO[]>();
  for (const n of notes) groups.set(n.type, [...(groups.get(n.type) ?? []), n]);
  return {
    groups: [...groups].map(([type, ns]) => ({
      type: type as NoteRefDTO['type'],
      notes: ns,
    })) as VaultTreeDTO['groups'],
  };
}

function session(id: string, extra: Partial<AttentionSession> = {}): AttentionSession {
  return {
    id,
    title: id,
    updated: NOW,
    running: false,
    unread: false,
    pendingCards: 0,
    lifecycle: 'active',
    ...extra,
  };
}

function card(id: string, extra: Partial<ProposalDTO> = {}): ProposalDTO {
  return {
    id,
    kind: 'note',
    sessionId: 'session-1',
    skill: null,
    targetPath: null,
    payload: {} as ProposalDTO['payload'],
    rationale: id,
    evidence: [],
    inference: false,
    status: 'pending',
    created: NOW,
    ...extra,
  };
}

const ask = (sessionId: string): AskRequestDTO => ({ id: `ask-${sessionId}`, sessionId, questions: [] });

function input(over: Partial<AttentionInput> = {}): AttentionInput {
  return { proposals: [], sessions: [], askRequests: {}, pings: [], tree: null, ...over };
}

const ids = (items: readonly { id: string }[]): string[] => items.map((i) => i.id);

test('attention: an empty workspace waits on nothing', () => {
  assert.deepEqual(buildAttention(input(), NOW), []);
});

test('attention: the ranking runs question → card → answer → clock → librarian', () => {
  const items = buildAttention(
    input({
      askRequests: { 'session-2': ask('session-2') },
      proposals: [card('p1')],
      sessions: [session('session-1'), session('session-2', { running: true }), session('session-3', { unread: true })],
      pings: [
        {
          id: 'ping-1',
          title: 'Two notes look like the same thing',
          body: '',
          evidence: [],
          skill: 'librarian',
          seedPrompt: '',
          targetPath: null,
          payload: null,
          status: 'pending',
          created: NOW,
        },
      ],
      tree: tree(
        note('meeting', 'nordkap', { date: '2026-07-28', time: '14:00', lifecycle: 'new' }),
        note('meeting', 'kranelund', { date: '2026-07-27', lifecycle: 'new' }),
        note('todo', 'send-the-summary', { lifecycle: 'open', due: '2026-07-26' }),
      ),
    }),
    NOW,
  );
  assert.deepEqual(ids(items), [
    'question:session-2',
    'card:p1',
    'result:session-3',
    'meeting:meetings/nordkap.md',
    'review:meetings/kranelund.md',
    'todo:todos/send-the-summary.md',
    'ping:ping-1',
  ]);
});

test('attention: the badge counts questions, cards and unread answers, never the librarian', () => {
  const items = buildAttention(
    input({
      askRequests: { 'session-1': ask('session-1') },
      proposals: [card('p1'), card('p2')],
      sessions: [session('session-1', { running: true }), session('session-2', { unread: true })],
      tree: tree(note('meeting', 'kranelund', { date: '2026-07-27', lifecycle: 'new' })),
      pings: [],
    }),
    NOW,
  );
  // Four waiting: one question, two cards, one unread answer. The unfiled
  // meeting is in the list but deliberately outside the Inbox badge.
  assert.equal(waitingOnYou(items).length, 4);
  assert.equal(countOf(items, 'review'), 1);
});

test('attention: a resolved card and a shelved session leave the list', () => {
  const items = buildAttention(
    input({
      proposals: [card('p1', { status: 'accepted' }), card('p2', { status: 'rejected' })],
      sessions: [
        session('session-1', { unread: true, lifecycle: 'done' }),
        session('session-2', { unread: true, lifecycle: 'dismissed' }),
      ],
    }),
    NOW,
  );
  assert.deepEqual(items, []);
});

test('attention: a running session, or one with cards of its own, is not an unread answer', () => {
  const items = buildAttention(
    input({
      sessions: [
        session('session-1', { unread: true, running: true }),
        session('session-2', { unread: true, pendingCards: 2 }),
      ],
    }),
    NOW,
  );
  assert.equal(countOf(items, 'result'), 0);
});

test('attention: a cancelled meeting never asks to be reviewed (ticket 11)', () => {
  const items = buildAttention(
    input({
      tree: tree(
        note('meeting', 'called-off', {
          date: '2026-07-27',
          lifecycle: 'new',
          eventStatus: 'cancelled',
        }),
        note('meeting', 'happened', { date: '2026-07-27', lifecycle: 'new' }),
      ),
    }),
    NOW,
  );
  assert.deepEqual(ids(items), ['review:meetings/happened.md']);
});

test('attention: only the next meeting, and only while it is within the day', () => {
  const items = buildAttention(
    input({
      tree: tree(
        note('meeting', 'soon', { date: '2026-07-28', time: '11:00' }),
        note('meeting', 'later-today', { date: '2026-07-28', time: '16:00' }),
        note('meeting', 'next-week', { date: '2026-08-04', time: '10:00' }),
      ),
    }),
    NOW,
  );
  assert.deepEqual(ids(items), ['meeting:meetings/soon.md']);
});

test("attention: commitments are the PO's own, due today or slipped", () => {
  const items = buildAttention(
    input({
      tree: tree(
        note('todo', 'overdue', { lifecycle: 'open', due: '2026-07-20' }),
        note('todo', 'today', { lifecycle: 'open', due: '2026-07-28' }),
        note('todo', 'later', { lifecycle: 'open', due: '2026-08-10' }),
        note('todo', 'theirs', { lifecycle: 'open', due: '2026-07-20', owner: 'Sara' }),
        note('todo', 'done', { lifecycle: 'done', due: '2026-07-20' }),
      ),
    }),
    NOW,
  );
  // Most overdue first, and no waiting-on item: that one is somebody else's move.
  assert.deepEqual(ids(items), ['todo:todos/overdue.md', 'todo:todos/today.md']);
  assert.equal(countOf(items, 'todo'), 2);
});

test('home: cards, reviews and commitments each collapse behind one door', () => {
  const items = buildAttention(
    input({
      proposals: [card('p1'), card('p2'), card('p3')],
      tree: tree(
        note('meeting', 'a', { date: '2026-07-26', lifecycle: 'new' }),
        note('meeting', 'b', { date: '2026-07-27', lifecycle: 'new' }),
        note('todo', 'overdue', { lifecycle: 'open', due: '2026-07-20' }),
        note('todo', 'today', { lifecycle: 'open', due: '2026-07-28' }),
      ),
    }),
    NOW,
  );
  const rows = homeRows(items, 4, NOW);
  assert.deepEqual(
    rows.map((r) => [r.label, r.meta, r.count]),
    [
      ['3 cards waiting for your approval', 'Inbox', 3],
      ['2 meetings still to review', 'meetings', 2],
      ['2 commitments due', '1 overdue', 2],
    ],
  );
  // The door's count is the list's own count, never a second sum.
  assert.equal(rows[0]!.count, countOf(items, 'card'));
});

test('home: a single unfiled meeting is named, not counted', () => {
  const items = buildAttention(
    input({ tree: tree(note('meeting', 'nordkap', { date: '2026-07-27', lifecycle: 'new' })) }),
    NOW,
  );
  const rows = homeRows(items, 4, NOW);
  assert.deepEqual(ids(rows), ['review:meetings/nordkap.md']);
  assert.equal(rows[0]!.label, 'Review nordkap');
});

test('home: the next meeting counts down once it is nearly on top of you', () => {
  const items = buildAttention(
    input({ tree: tree(note('meeting', 'nordkap', { date: '2026-07-28', time: '09:20' })) }),
    NOW,
  );
  assert.equal(homeRows(items, 4, NOW)[0]!.meta, 'in 20m');
  // Further out it reads as its own clock time instead.
  assert.equal(homeRows(items, 4, at(28, 7))[0]!.meta, '09:20');
});

test('home: suggestions stay in the Inbox, and the list is capped', () => {
  const items = buildAttention(
    input({
      askRequests: { 'session-1': ask('session-1') },
      sessions: [session('session-1', { running: true })],
      pings: [
        {
          id: 'ping-1',
          title: 'Tidy-up',
          body: '',
          evidence: [],
          skill: 'librarian',
          seedPrompt: '',
          targetPath: null,
          payload: null,
          status: 'pending',
          created: NOW,
        },
      ],
    }),
    NOW,
  );
  assert.equal(countOf(items, 'ping'), 1);
  assert.deepEqual(ids(homeRows(items, 4, NOW)), ['question:session-1']);
  assert.equal(homeRows(items, 0, NOW).length, 0);
});
