import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BacklinkDTO, NoteRefDTO, ProposalDTO, VaultTreeDTO } from '@qale/ipc';
import {
  calendarSections,
  durationText,
  meetingOutcome,
  meetingStanding,
  promiseState,
} from '../src/renderer/src/lib/meeting-read.js';
import { buildAttention, homeRows } from '../src/renderer/src/lib/attention.js';

/** Local-clock instants: the calendar reads the PO's day, not UTC. */
const at = (day: number, hour: number, minute = 0): number =>
  new Date(2026, 6, day, hour, minute).getTime();

const NOW = at(28, 9, 30);

function meeting(slug: string, extra: Partial<NoteRefDTO> = {}): NoteRefDTO {
  return {
    path: `meetings/${slug}.md`,
    slug: `meetings/${slug}`,
    type: 'meeting',
    title: slug,
    summary: '',
    mtime: NOW,
    ...extra,
  };
}

function note(type: NoteRefDTO['type'], slug: string, extra: Partial<NoteRefDTO> = {}): NoteRefDTO {
  return {
    path: `${type}s/${slug}.md`,
    slug: `${type}s/${slug}`,
    type,
    title: slug,
    summary: '',
    mtime: NOW,
    ...extra,
  };
}

const link = (from: NoteRefDTO, type?: string): BacklinkDTO => ({
  from,
  ...(type ? { type } : {}),
});

// ---------------------------------------------------------------------------
// Where a meeting stands
// ---------------------------------------------------------------------------

test('standing: a cancelled meeting says so and never asks to be read', () => {
  const n = meeting('offsite', { date: '2026-07-27', lifecycle: 'new', eventStatus: 'cancelled' });
  assert.deepEqual(meetingStanding(n, NOW), { text: 'Cancelled', tone: 'muted' });
});

test('standing: a meeting in progress is the loud one', () => {
  const n = meeting('checkin', { date: '2026-07-28', time: '09:00', durationMin: 60 });
  assert.deepEqual(meetingStanding(n, NOW), { text: 'Happening now', tone: 'brand' });
});

test('standing: an upcoming meeting says nothing at all', () => {
  const n = meeting('qbr', { date: '2026-07-29', time: '14:00' });
  assert.equal(meetingStanding(n, NOW), null);
});

test('standing: an empty meeting is asked about, never flagged', () => {
  // Both rules match this note. The amber word would blame the PO for a page
  // the calendar sync made, so the quiet one wins.
  const n = meeting('sync', {
    date: '2026-07-27',
    lifecycle: 'new',
    synced: true,
    captured: false,
  });
  assert.deepEqual(meetingStanding(n, NOW), { text: 'Nothing in it yet', tone: 'muted' });
});

test('standing: a meeting that happened and was never filed flies the flag', () => {
  const n = meeting('nordkap', { date: '2026-07-27', lifecycle: 'new', captured: true });
  assert.deepEqual(meetingStanding(n, NOW), { text: 'Not filed yet', tone: 'warning' });
});

test('standing: only the meeting’s own lifecycle may say "Filed"', () => {
  const filed = meeting('done', { date: '2026-07-27', lifecycle: 'processed' });
  assert.deepEqual(meetingStanding(filed, NOW), { text: 'Filed', tone: 'muted' });
  // No lifecycle is not a claim: the page says nothing rather than guess.
  assert.equal(meetingStanding(meeting('quiet', { date: '2026-07-27' }), NOW), null);
});

// ---------------------------------------------------------------------------
// What is coming and what happened
// ---------------------------------------------------------------------------

test('sections: coming runs forwards, happened runs backwards', () => {
  const notes = [
    meeting('last-week', { date: '2026-07-21', time: '10:00' }),
    meeting('next-week', { date: '2026-08-04', time: '10:00' }),
    meeting('yesterday', { date: '2026-07-27', time: '10:00' }),
    meeting('tomorrow', { date: '2026-07-29', time: '10:00' }),
  ];
  const { coming, happened } = calendarSections(notes, NOW);
  assert.deepEqual(
    coming.map((n) => n.title),
    ['tomorrow', 'next-week'],
  );
  assert.deepEqual(
    happened.map((n) => n.title),
    ['yesterday', 'last-week'],
  );
});

test('sections: a meeting in progress is still coming, not behind you', () => {
  const live = meeting('now', { date: '2026-07-28', time: '09:00', durationMin: 60 });
  assert.deepEqual(calendarSections([live], NOW).coming, [live]);
});

// ---------------------------------------------------------------------------
// What came out of it
// ---------------------------------------------------------------------------

test('outcome: inbound links group by what they are', () => {
  const out = meetingOutcome([
    link(note('decision', 'adopt-workos'), 'sources'),
    link(note('todo', 'send-memo'), 'sources'),
    link(note('insight', 'sso-is-pass-fail'), 'evidence'),
    link(note('customer', 'nordkap')),
  ]);
  assert.deepEqual(
    out.decided.map((n) => n.title),
    ['adopt-workos'],
  );
  assert.deepEqual(
    out.promised.map((n) => n.title),
    ['send-memo'],
  );
  assert.deepEqual(
    out.learned.map((n) => n.title),
    ['sso-is-pass-fail'],
  );
  assert.deepEqual(
    out.linked.map((n) => n.title),
    ['nordkap'],
  );
});

test('outcome: a run that read the page is the run’s business, not the meeting’s', () => {
  const out = meetingOutcome([
    link(note('session', 'arrival-receipt'), 'reads'),
    link(note('session', 'arrival-receipt-2'), 'writes'),
    link(note('session', 'loose-receipt')),
  ]);
  assert.deepEqual(out, { decided: [], promised: [], learned: [], linked: [] });
});

test('outcome: one row per note, and open promises come first', () => {
  const done = note('todo', 'shipped', { lifecycle: 'done' });
  const open = note('todo', 'owed', { lifecycle: 'open' });
  const out = meetingOutcome([
    link(done, 'sources'),
    link(open, 'sources'),
    // The same todo, mentioned in prose as well as cited in frontmatter.
    link(open),
  ]);
  assert.deepEqual(
    out.promised.map((n) => n.title),
    ['owed', 'shipped'],
  );
});

test('promise state names who it waits on', () => {
  assert.equal(promiseState(note('todo', 'a', { lifecycle: 'open' })), 'still open');
  assert.equal(
    promiseState(note('todo', 'b', { lifecycle: 'open', owner: '[[people/sara]]' })),
    'waiting on them',
  );
  assert.equal(promiseState(note('todo', 'c', { lifecycle: 'done' })), 'done');
  assert.equal(promiseState(note('todo', 'd', { lifecycle: 'dropped' })), 'dropped');
});

test('duration reads as a person would say it', () => {
  assert.equal(durationText(30), '30 min');
  assert.equal(durationText(60), '1 hour');
  assert.equal(durationText(90), '1 hour 30 min');
  assert.equal(durationText(120), '2 hours');
  assert.equal(durationText(undefined), null);
  assert.equal(durationText(0), null);
});

// ---------------------------------------------------------------------------
// The door Home offers
// ---------------------------------------------------------------------------

test('home: the review backlog opens the Calendar, not the meetings folder', () => {
  const tree: VaultTreeDTO = {
    groups: [
      {
        type: 'meeting',
        notes: [
          meeting('a', { date: '2026-07-26', lifecycle: 'new' }),
          meeting('b', { date: '2026-07-27', lifecycle: 'new' }),
        ],
      },
    ] as VaultTreeDTO['groups'],
  };
  const items = buildAttention(
    {
      proposals: [] as ProposalDTO[],
      sessions: [],
      askRequests: {},
      tree,
      captureNudge: { dismissed: [], mutedSeries: [] },
    },
    NOW,
  );
  const door = homeRows(items, 4, NOW).find((r) => r.id === 'reviews');
  assert.ok(door, 'the two unfiled meetings collapse behind one door');
  assert.deepEqual(door.target, { open: 'calendar' });
  assert.equal(door.meta, 'Calendar');
});
