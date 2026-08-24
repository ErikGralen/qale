import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AskRequestDTO, NoteRefDTO, ProposalDTO, VaultTreeDTO } from '@qale/ipc';
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

/** `offered` is main's answer to "did a tidy pass nobody started ask this?" */
const ask = (sessionId: string, offered = false): AskRequestDTO => ({
  id: `ask-${sessionId}`,
  sessionId,
  questions: [],
  offered,
});

function input(over: Partial<AttentionInput> = {}): AttentionInput {
  return {
    proposals: [],
    sessions: [],
    askRequests: {},
    tree: null,
    captureNudge: null,
    ...over,
  };
}

/** A calendar mirror: the app knows it happened, whatever anyone wrote down. */
function synced(slug: string, extra: Partial<NoteRefDTO> = {}): NoteRefDTO {
  return note('meeting', slug, { synced: true, captured: false, durationMin: 60, ...extra });
}

const ids = (items: readonly { id: string }[]): string[] => items.map((i) => i.id);

test('attention: an empty workspace waits on nothing', () => {
  assert.deepEqual(buildAttention(input(), NOW), []);
});

test('attention: the ranking runs question → card → answer → clock', () => {
  const items = buildAttention(
    input({
      askRequests: { 'session-2': ask('session-2') },
      proposals: [card('p1')],
      sessions: [
        session('session-1'),
        session('session-2', { running: true }),
        session('session-3', { unread: true }),
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
  ]);
});

test('attention: the badge counts questions, cards and unread answers', () => {
  const items = buildAttention(
    input({
      askRequests: { 'session-1': ask('session-1') },
      proposals: [card('p1'), card('p2')],
      sessions: [session('session-1', { running: true }), session('session-2', { unread: true })],
      tree: tree(note('meeting', 'kranelund', { date: '2026-07-27', lifecycle: 'new' })),
    }),
    NOW,
  );
  // Four waiting: one question, two cards, one unread answer. The unfiled
  // meeting is in the list but deliberately outside the Inbox badge.
  assert.equal(waitingOnYou(items).length, 4);
  assert.equal(countOf(items, 'review'), 1);
});

test('attention: a question from a background tidy pass is offered, never owed', () => {
  const items = buildAttention(
    input({
      askRequests: {
        'session-1': ask('session-1'),
        'session-2': ask('session-2', true),
      },
      sessions: [session('session-1', { running: true }), session('session-2', { running: true })],
    }),
    NOW,
  );
  // Both are in the list — the Inbox shows the librarian's question too.
  assert.deepEqual(ids(items), ['question:session-1', 'question:session-2']);
  assert.equal(items.find((i) => i.id === 'question:session-1')!.quiet, false);
  assert.equal(items.find((i) => i.id === 'question:session-2')!.quiet, true);
  // But only the one the PO's own session is blocked on counts, and only that
  // one is worth a row on Home.
  assert.deepEqual(ids(waitingOnYou(items)), ['question:session-1']);
  assert.deepEqual(ids(homeRows(items, 4, NOW)), ['question:session-1']);
});

test('attention: a librarian session the PO started themselves is owed like any other', () => {
  // Same agent, both times. What differs is who started the run, which main
  // has already folded into `offered`. The list never re-derives it from the
  // agent's name, or a question the PO is sitting there waiting for would go
  // quiet under them.
  const items = buildAttention(
    input({
      askRequests: {
        'by-hand': ask('by-hand'),
        'by-the-clock': ask('by-the-clock', true),
      },
      sessions: [session('by-hand', { running: true }), session('by-the-clock', { running: true })],
    }),
    NOW,
  );
  assert.equal(items.find((i) => i.id === 'question:by-hand')!.quiet, false);
  assert.equal(items.find((i) => i.id === 'question:by-the-clock')!.quiet, true);
  assert.deepEqual(ids(waitingOnYou(items)), ['question:by-hand']);
  assert.deepEqual(ids(homeRows(items, 4, NOW)), ['question:by-hand']);
});

test('attention: a round to write in waits exactly as a question waits', () => {
  // A comment request parks the turn the same way ask_user does, so it ranks
  // first, counts toward the badge and reaches Home. All it says differently is
  // the word on the row (docs/brainstorm-skill.md).
  const round: AskRequestDTO = {
    ...ask('session-1'),
    comments: { path: 'round-1.md', slots: [{ id: 'idea-3', prompt: 'Keep? Cut?' }] },
  };
  const items = buildAttention(
    input({
      askRequests: { 'session-1': round },
      proposals: [card('p1')],
      sessions: [session('session-1', { running: true })],
    }),
    NOW,
  );
  assert.deepEqual(ids(items), ['question:session-1', 'card:p1']);
  assert.equal(items[0]!.meta, 'comments');
  assert.equal(items[0]!.quiet, false);
  assert.deepEqual(ids(waitingOnYou(items)), ['question:session-1', 'card:p1']);
  assert.equal(homeRows(items, 4, NOW)[0]!.id, 'question:session-1');
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

test('capture: a synced meeting with nothing in it asks, once the room has cleared', () => {
  const items = buildAttention(
    input({
      tree: tree(
        // Ended 20 minutes ago: still walking back to the desk.
        synced('just-ended', { date: '2026-07-28', time: '07:40' }),
        synced('yesterday', { date: '2026-07-27', time: '14:00' }),
        // Nothing to ask about: it holds something, it is off the calendar, it
        // was called off, or it is too old to be worth anyone's guilt.
        synced('filed', { date: '2026-07-27', time: '15:00', captured: true }),
        note('meeting', 'handwritten', { date: '2026-07-27', time: '15:00' }),
        synced('called-off', { date: '2026-07-27', time: '16:00', eventStatus: 'cancelled' }),
        synced('ancient', { date: '2026-07-20', time: '10:00' }),
      ),
    }),
    NOW,
  );
  assert.deepEqual(ids(items), ['capture:meetings/yesterday.md']);
  assert.equal(items[0]!.label, "Yesterday's yesterday has nothing in it yet");
  assert.deepEqual(items[0]!.target, {
    open: 'capture',
    path: 'meetings/yesterday.md',
    title: 'yesterday',
  });
});

test('capture: an all-day meeting is asked about the next day, not after midnight', () => {
  const allDay = tree(synced('offsite', { date: '2026-07-28' }));
  // Same day, mid-morning: the day it sits on is not over yet.
  assert.deepEqual(buildAttention(input({ tree: allDay }), NOW), []);
  assert.equal(countOf(buildAttention(input({ tree: allDay }), at(29, 9)), 'capture'), 1);
});

test('capture: a dismissed meeting, and a muted series, go quiet', () => {
  const notes = tree(
    synced('waved-off', { date: '2026-07-27', time: '09:00' }),
    synced('standup-1', { date: '2026-07-27', time: '10:00', series: 'daily-standup' }),
    synced('standup-2', { date: '2026-07-26', time: '10:00', series: 'daily-standup' }),
    synced('kranelund', { date: '2026-07-27', time: '11:00' }),
  );
  const items = buildAttention(
    input({
      tree: notes,
      captureNudge: { dismissed: ['meetings/waved-off.md'], mutedSeries: ['daily-standup'] },
    }),
    NOW,
  );
  assert.deepEqual(ids(items), ['capture:meetings/kranelund.md']);
});

test('home: empty meetings are named, and the name is a link to the meeting', () => {
  const one = buildAttention(
    input({ tree: tree(synced('nordkap', { date: '2026-07-27', time: '14:00' })) }),
    NOW,
  );
  const row = homeRows(one, 4, NOW)[0]!;
  assert.equal(row.label, "Yesterday's nordkap has nothing in it yet");
  // The row fills the meeting; the title inside it opens the meeting.
  assert.deepEqual(row.target, { open: 'capture', path: 'meetings/nordkap.md', title: 'nordkap' });
  assert.deepEqual(row.link, {
    before: "Yesterday's ",
    text: 'nordkap',
    after: ' has nothing in it yet',
    path: 'meetings/nordkap.md',
  });
  // The parts and the flat sentence are the same sentence.
  assert.equal(`${row.link!.before}${row.link!.text}${row.link!.after}`, row.label);

  const several = buildAttention(
    input({
      tree: tree(
        synced('a', { date: '2026-07-27', time: '09:00' }),
        synced('b', { date: '2026-07-27', time: '11:00' }),
        synced('c', { date: '2026-07-26', time: '11:00' }),
      ),
    }),
    NOW,
  );
  // Three stay named, newest first — a count pointing at the calendar would
  // send the PO hunting for which meetings it meant.
  assert.deepEqual(
    homeRows(several, 4, NOW).map((r) => [r.id, r.label, r.count]),
    [
      ['capture:meetings/b.md', "Yesterday's b has nothing in it yet", 1],
      ['capture:meetings/a.md', "Yesterday's a has nothing in it yet", 1],
      ['capture:meetings/c.md', "Sunday's c has nothing in it yet", 1],
    ],
  );
});

test('home: from the fourth on, empty meetings fold into one row that carries them', () => {
  const items = buildAttention(
    input({
      tree: tree(
        ...['a', 'b', 'c', 'd'].map((t, i) =>
          synced(t, { date: '2026-07-27', time: `0${i + 1}:00` }),
        ),
        note('todo', 'ship', { lifecycle: 'open', due: '2026-07-20' }),
      ),
    }),
    NOW,
  );
  const rows = homeRows(items, 4, NOW);
  assert.deepEqual(
    rows.map((r) => [r.id, r.label, r.count]),
    [
      ['captures', '4 meetings have nothing in them yet', 4],
      ['todos', '1 commitment due', 1],
    ],
  );
  // It unfolds where it stands rather than sending the PO anywhere.
  assert.deepEqual(rows[0]!.target, { open: 'expand' });
  // And it carries the named rows, each still fillable and still linked.
  const children = rows[0]!.children!;
  assert.equal(children.length, 4);
  assert.equal(children[0]!.label, "Yesterday's d has nothing in it yet");
  assert.deepEqual(children[0]!.target, { open: 'capture', path: 'meetings/d.md', title: 'd' });
  assert.equal(children[0]!.link!.path, 'meetings/d.md');
});

test('home: a flood of empty meetings cannot push commitments off the page', () => {
  const items = buildAttention(
    input({
      proposals: [card('p1')],
      tree: tree(
        ...['a', 'b', 'c'].map((t, i) => synced(t, { date: '2026-07-27', time: `0${i + 1}:00` })),
        note('todo', 'ship', { lifecycle: 'open', due: '2026-07-20' }),
      ),
    }),
    NOW,
  );
  // `max` counts entries, not lines: the named meetings are one entry, so the
  // commitments door still makes the page.
  const rows = homeRows(items, 2, NOW);
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['card', 'capture', 'capture', 'capture'],
  );
  assert.deepEqual(homeRows(items, 3, NOW).at(-1)!.id, 'todos');
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

test('home: the list is capped', () => {
  const items = buildAttention(
    input({
      askRequests: { 'session-1': ask('session-1') },
      sessions: [session('session-1', { running: true })],
    }),
    NOW,
  );
  assert.deepEqual(ids(homeRows(items, 4, NOW)), ['question:session-1']);
  assert.equal(homeRows(items, 0, NOW).length, 0);
});
