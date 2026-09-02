import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NoteRefDTO } from '@qale/ipc';
import {
  isLiveMeeting,
  isUnreadMeeting,
  meetingEnd,
  meetingStart,
  meetingWindowOf,
} from '../src/renderer/src/lib/note-status.js';
import { readMeetingSeed } from '../src/renderer/src/lib/agent-nudges.js';

/** Local-clock instants. A meeting runs on the PO's clock, not on UTC. */
const at = (day: number, hour: number, minute = 0): number =>
  new Date(2026, 6, day, hour, minute).getTime();

/** An mtime far from every date under test, so a fallback is never a near miss. */
const MTIME = at(1, 3);

function meeting(extra: Partial<NoteRefDTO> = {}): NoteRefDTO {
  return {
    path: 'meetings/nordkap.md',
    slug: 'nordkap',
    type: 'meeting',
    title: 'Nordkap check-in',
    summary: '',
    mtime: MTIME,
    ...extra,
  };
}

test('live: a meeting is live from its start until its end', () => {
  const n = meeting({ date: '2026-07-28', time: '14:00', durationMin: 60 });
  assert.equal(isLiveMeeting(n, at(28, 13, 59)), false);
  // Exactly at the start it is live; exactly at the end it is not.
  assert.equal(isLiveMeeting(n, at(28, 14)), true);
  assert.equal(isLiveMeeting(n, at(28, 14, 30)), true);
  assert.equal(isLiveMeeting(n, at(28, 15)), false);
  assert.equal(isLiveMeeting(n, at(28, 16)), false);
});

test('live: a meeting with no length runs the default hour', () => {
  const n = meeting({ date: '2026-07-28', time: '09:00' });
  assert.equal(isLiveMeeting(n, at(28, 9, 59)), true);
  assert.equal(isLiveMeeting(n, at(28, 10)), false);
});

test('live: an all-day entry is never live', () => {
  // It runs midnight to midnight, so an offsite or a holiday would read as a
  // call in progress all day and take the row from the 14:00 meeting under it.
  const n = meeting({ date: '2026-07-28' });
  assert.equal(isLiveMeeting(n, at(28, 0)), false);
  assert.equal(isLiveMeeting(n, at(28, 11)), false);
  assert.equal(isLiveMeeting(n, at(28, 23, 59)), false);
  // The day still ends where it always did, which is what the capture ask reads.
  assert.equal(meetingEnd(n), at(29, 0));
});

test('live: a meeting with no date is never live', () => {
  // Its start falls back to mtime, so without this guard a note saved an hour
  // ago would read as a call in progress.
  assert.equal(isLiveMeeting(meeting(), MTIME), false);
  assert.equal(isLiveMeeting(meeting(), MTIME + 60_000), false);
  assert.equal(isLiveMeeting(meeting({ date: 'sometime' }), MTIME), false);
});

test('window: the start and the end are what they were before the refactor', () => {
  // A timed meeting: local midnight plus the clock, plus its length.
  const timed = meeting({ date: '2026-07-28', time: '14:00' });
  assert.equal(meetingStart(timed), at(28, 14));
  assert.equal(meetingEnd(timed), at(28, 15));

  // An explicit length wins over the default hour.
  const long = meeting({ date: '2026-07-28', time: '14:00', durationMin: 90 });
  assert.equal(meetingStart(long), at(28, 14));
  assert.equal(meetingEnd(long), at(28, 15, 30));

  // A bare date is LOCAL midnight, not UTC, and it ends when its day ends.
  const bare = meeting({ date: '2026-07-28' });
  assert.equal(meetingStart(bare), at(28, 0));
  assert.equal(meetingEnd(bare), at(29, 0));

  // A bare date ignores durationMin: there is no clock to add minutes to.
  const bareLong = meeting({ date: '2026-07-28', durationMin: 30 });
  assert.equal(meetingEnd(bareLong), at(29, 0));

  // An ISO stamp carries its own clock, so it counts as timed.
  const stamped = meeting({ date: new Date(at(28, 14)).toISOString() });
  assert.equal(meetingStart(stamped), at(28, 14));
  assert.equal(meetingEnd(stamped), at(28, 15));

  // No date, and no date the parser can read: mtime, and mtime's day.
  assert.equal(meetingStart(meeting()), MTIME);
  assert.equal(meetingEnd(meeting()), at(2, 0));
  assert.equal(meetingStart(meeting({ date: 'sometime' })), MTIME);
});

test('window: the note page reads the same window off frontmatter', () => {
  // The page used to parse its own start with Date.parse, which reads a bare
  // date as UTC and can shift the meeting across midnight.
  assert.deepEqual(meetingWindowOf({ date: '2026-07-28', time: '14:00', duration_minutes: 30 }), {
    start: at(28, 14),
    end: at(28, 14, 30),
    clock: true,
  });
  assert.deepEqual(meetingWindowOf({ date: '2026-07-28' }), {
    start: at(28, 0),
    end: at(29, 0),
    clock: false,
  });
  assert.equal(meetingWindowOf({}), null);
  // Frontmatter is whatever the file held, so a wrong type is not a window.
  assert.equal(meetingWindowOf({ date: 42 }), null);
  assert.deepEqual(
    meetingWindowOf({ date: '2026-07-28', time: '14:00', duration_minutes: 'long' }),
    {
      start: at(28, 14),
      end: at(28, 15),
      clock: true,
    },
  );
});

test('unread: a meeting somebody typed asks to be read, same as a recording', () => {
  const held = { past: true, processing: 'new' };
  assert.equal(isUnreadMeeting({ ...held, transcripts: 1, body: '' }), true);
  assert.equal(isUnreadMeeting({ ...held, transcripts: 0, body: '## Notes\nThey said no.' }), true);
  assert.equal(isUnreadMeeting({ ...held, transcripts: 1, body: 'both' }), true);
  // A seeded heading and nothing else is still an empty page.
  assert.equal(isUnreadMeeting({ ...held, transcripts: 0, body: '   \n\n' }), false);
});

test('unread: an upcoming or already filed meeting has nothing to read', () => {
  assert.equal(
    isUnreadMeeting({ past: false, processing: 'new', transcripts: 1, body: 'notes' }),
    false,
  );
  assert.equal(
    isUnreadMeeting({ past: true, processing: 'processed', transcripts: 1, body: 'notes' }),
    false,
  );
  // Frontmatter that says nothing about processing is not filed.
  assert.equal(
    isUnreadMeeting({ past: true, processing: undefined, transcripts: 1, body: '' }),
    true,
  );
});

test('seed: the run is told which contents the page holds', () => {
  const typed = readMeetingSeed('meetings/nordkap.md', { transcripts: 0, typed: true });
  assert.match(typed, /^Run the arrival skill on meetings\/nordkap\.md: /);
  assert.match(typed, /notes I typed myself, and no recording/);
  assert.match(typed, /the typed notes win/);
  // Nothing to say about processed transcripts when there are none.
  assert.doesNotMatch(typed, /already marked processed/);

  const recorded = readMeetingSeed('meetings/nordkap.md', { transcripts: 2, typed: false });
  assert.match(recorded, /It links transcripts\./);
  assert.match(recorded, /already marked processed/);
  assert.doesNotMatch(recorded, /typed/);

  const both = readMeetingSeed('meetings/nordkap.md', { transcripts: 1, typed: true });
  assert.match(both, /notes I typed myself, and it links transcripts/);
  assert.match(both, /the typed notes win/);
  assert.match(both, /already marked processed/);
});
