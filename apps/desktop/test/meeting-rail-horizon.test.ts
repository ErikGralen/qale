import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NoteRefDTO } from '@pm/ipc';
import { meetingRailHorizon } from '../src/renderer/src/lib/note-status.js';

/** Local-clock instants — the horizon buckets by the PO's day, not by UTC. */
const at = (day: number, hour: number, minute = 0): number =>
  new Date(2026, 6, day, hour, minute).getTime();

function mtg(
  slug: string,
  date: string,
  time?: string,
  extra: Partial<NoteRefDTO> = {},
): NoteRefDTO {
  return {
    path: `meetings/${slug}.md`,
    slug,
    type: 'meeting',
    title: slug,
    summary: '',
    mtime: at(28, 9),
    status: 'reviewed',
    date,
    ...(time ? { time } : {}),
    ...extra,
  };
}

const paths = (s: Set<string>): string[] => [...s].sort();

test('horizon: morning shows today only, however busy the week ahead is', () => {
  const notes = [
    mtg('standup', '2026-07-28', '09:00'),
    mtg('nordkap', '2026-07-28', '16:00'),
    mtg('tomorrow-early', '2026-07-29', '09:00'),
    mtg('next-week', '2026-08-04', '10:00'),
  ];
  assert.deepEqual(paths(meetingRailHorizon(notes, at(28, 8, 30))), [
    'meetings/nordkap.md',
    'meetings/standup.md',
  ]);
});

test("horizon: today's meetings stay in it after they have happened", () => {
  const notes = [mtg('standup', '2026-07-28', '09:00')];
  assert.deepEqual(paths(meetingRailHorizon(notes, at(28, 13))), ['meetings/standup.md']);
});

test("horizon: mid-afternoon adds tomorrow's opening cluster, not all of tomorrow", () => {
  const notes = [
    mtg('nordkap', '2026-07-28', '16:00'),
    mtg('kranelund', '2026-07-29', '09:00'),
    mtg('roadmap', '2026-07-29', '10:30'),
    mtg('retro', '2026-07-29', '14:00'),
    mtg('day-after', '2026-07-30', '09:00'),
  ];
  assert.deepEqual(paths(meetingRailHorizon(notes, at(28, 16, 20))), [
    'meetings/kranelund.md',
    'meetings/nordkap.md',
    'meetings/roadmap.md',
  ]);
});

test('horizon: the cluster anchors on tomorrow’s first timed start, all-day entries always join', () => {
  const notes = [
    mtg('offsite', '2026-07-29'), // bare date — all-day
    mtg('late-only', '2026-07-29', '15:00'),
    mtg('later-still', '2026-07-29', '17:30'),
  ];
  assert.deepEqual(paths(meetingRailHorizon(notes, at(28, 18))), [
    'meetings/late-only.md',
    'meetings/offsite.md',
  ]);
});

test('horizon: an ISO datetime counts as timed even without a time field', () => {
  const notes = [mtg('kranelund', '2026-07-29T09:00'), mtg('retro', '2026-07-29T14:00')];
  assert.deepEqual(paths(meetingRailHorizon(notes, at(28, 16))), ['meetings/kranelund.md']);
});

test('horizon: a day with no meetings opens the next day that has them, at any hour', () => {
  const notes = [
    mtg('past', '2026-07-25', '10:00'),
    mtg('nordkap', '2026-08-05', '10:00'),
    mtg('same-morning', '2026-08-05', '11:30'),
    mtg('same-afternoon', '2026-08-05', '15:00'),
    mtg('day-after', '2026-08-06', '09:00'),
  ];
  assert.deepEqual(paths(meetingRailHorizon(notes, at(28, 8))), [
    'meetings/nordkap.md',
    'meetings/same-morning.md',
  ]);
});

test('horizon: a busy today keeps the rail off a far-out calendar', () => {
  const notes = [mtg('standup', '2026-07-28', '09:00'), mtg('far', '2026-08-19', '10:00')];
  assert.deepEqual(paths(meetingRailHorizon(notes, at(28, 17))), ['meetings/standup.md']);
});

test('horizon: an empty calendar yields nothing', () => {
  assert.deepEqual(paths(meetingRailHorizon([mtg('past', '2026-07-25', '10:00')], at(28, 17))), []);
});

test('horizon: cancelled events and dateless notes are skipped', () => {
  const notes = [
    mtg('cancelled', '2026-07-28', '11:00', { eventStatus: 'cancelled' }),
    mtg('confirmed', '2026-07-28', '11:00', { eventStatus: 'confirmed' }),
    { ...mtg('dateless', '2026-07-28', '11:00'), date: undefined },
  ];
  assert.deepEqual(paths(meetingRailHorizon(notes, at(28, 10))), ['meetings/confirmed.md']);
});
