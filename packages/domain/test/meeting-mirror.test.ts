import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MEETING_SYNC_FIELDS,
  eventDateParts,
  eventParticipants,
  eventQualifies,
  hasOtherAttendee,
  meetingPathForEvent,
  parseFrontmatter,
  planMeetingMirror,
  type SyncedCalendarEvent,
} from '../src/index.js';

/**
 * Area A contract tests for the calendar → meeting mirror (docs/
 * google-calendar-integration.md): the ownership split (machine owns scheduling
 * truth, PM owns meaning), the qualifying heuristic, and the cancellation rule
 * (a note is never machine-deleted; cancellation is a state it carries).
 */

const EVENT: SyncedCalendarEvent = {
  external_id: 'evt-nordkap-1',
  title: 'Nordkap check-in',
  start: '2026-07-30T14:00:00+02:00',
  end: '2026-07-30T15:00:00+02:00',
  allDay: false,
  event_status: 'confirmed',
  attendees: [
    { email: 'erik@tavla.example', name: 'Erik', self: true, response: 'accepted' },
    { email: 'sara.lindqvist@nordkap.example', name: 'Sara Lindqvist', response: 'accepted' },
    { email: 'room-oslo@resource.calendar.google.com', name: 'Oslo', resource: true },
  ],
  recurring_event_id: 'rec-nordkap',
  remote_updated: '2026-07-27T09:00:00Z',
  url: 'https://calendar.google.com/event?eid=abc',
};

const PLAN_INPUT = {
  calendar: 'primary',
  provider: 'google-calendar',
  seriesSlug: 'nordkap-checkin',
} as const;

test('qualifying: everything on the calendar earns a note except declined and cancelled', () => {
  assert.equal(eventQualifies(EVENT), true);
  // Solo block (only self + a room) and a bare focus block both get notes now:
  // hiding them made a real calendar look half-synced.
  assert.equal(
    eventQualifies({ ...EVENT, attendees: EVENT.attendees.filter((a) => a.self || a.resource) }),
    true,
  );
  assert.equal(eventQualifies({ ...EVENT, attendees: [] }), true);
  // Declined by the PM.
  assert.equal(
    eventQualifies({
      ...EVENT,
      attendees: EVENT.attendees.map((a) => (a.self ? { ...a, response: 'declined' as const } : a)),
    }),
    false,
  );
  assert.equal(eventQualifies({ ...EVENT, event_status: 'cancelled' }), false);
});

test('hasOtherAttendee: the meeting/block line the prep sweep gates on', () => {
  assert.equal(hasOtherAttendee(EVENT), true);
  // Self plus a room is still just you.
  assert.equal(
    hasOtherAttendee({ ...EVENT, attendees: EVENT.attendees.filter((a) => a.self || a.resource) }),
    false,
  );
  assert.equal(hasOtherAttendee({ ...EVENT, attendees: [] }), false);
});

test('participants: humans minus self minus rooms, names preferred, emails kept as fallback', () => {
  assert.deepEqual(eventParticipants(EVENT), ['Sara Lindqvist']);
  const bare = {
    ...EVENT,
    attendees: [...EVENT.attendees, { email: 'consultant@ext.example' }],
  };
  assert.deepEqual(eventParticipants(bare), ['Sara Lindqvist', 'consultant@ext.example']);
});

test('date parts: timed events get local date/time/duration; all-day gets date only', () => {
  const parts = eventDateParts(EVENT);
  assert.equal(parts.date.length, 10);
  assert.match(parts.time ?? '', /^\d{2}:\d{2}$/);
  assert.equal(parts.duration_minutes, 60);
  assert.deepEqual(
    eventDateParts({ ...EVENT, allDay: true, start: '2026-08-01', end: '2026-08-02' }),
    {
      date: '2026-08-01',
    },
  );
});

test('create: qualifying event yields a valid meeting frontmatter with the sync fields', () => {
  const plan = planMeetingMirror({ ...PLAN_INPUT, event: EVENT, existing: null });
  assert.equal(plan.action, 'create');
  if (plan.action !== 'create') return;
  const parsed = parseFrontmatter(plan.frontmatter);
  assert.equal(parsed.ok, true, parsed.error);
  const fm = parsed.data as Record<string, unknown>;
  assert.equal(fm['type'], 'meeting');
  assert.equal(fm['provider'], 'google-calendar');
  assert.equal(fm['external_id'], 'evt-nordkap-1');
  assert.equal(fm['calendar'], 'primary');
  assert.equal(fm['series'], 'nordkap-checkin');
  assert.equal(fm['event_status'], 'confirmed');
  assert.deepEqual(fm['participants'], ['Sara Lindqvist']);
  assert.equal(fm['summary'], 'Nordkap check-in');
  assert.match(meetingPathForEvent(EVENT), /^meetings\/\d{4}-\d{2}-\d{2}-nordkap-check-in\.md$/);
});

test('participants override: the engine can pass resolved [[people/…]] links (job 4)', () => {
  const plan = planMeetingMirror({
    ...PLAN_INPUT,
    event: EVENT,
    participants: ['[[people/sara-lindqvist]]'],
    existing: null,
  });
  assert.equal(plan.action, 'create');
  if (plan.action !== 'create') return;
  assert.deepEqual(plan.frontmatter['participants'], ['[[people/sara-lindqvist]]']);
});

test('participants override: a newly-resolved link patches an existing note in place', () => {
  const existing = planMeetingMirror({ ...PLAN_INPUT, event: EVENT, existing: null });
  if (existing.action !== 'create') return assert.fail('expected create');
  // Next tick, a person note now carries the email → the label becomes a link.
  const plan = planMeetingMirror({
    ...PLAN_INPUT,
    event: EVENT,
    participants: ['[[people/sara-lindqvist]]'],
    existing: { frontmatter: existing.frontmatter, body: '' },
  });
  assert.equal(plan.action, 'patch');
  if (plan.action !== 'patch') return;
  assert.deepEqual(plan.frontmatter['participants'], ['[[people/sara-lindqvist]]']);
});

test('create: a solo block materializes, a declined one never does', () => {
  const solo = { ...EVENT, attendees: [] };
  const created = planMeetingMirror({ ...PLAN_INPUT, event: solo, existing: null });
  assert.equal(created.action, 'create');
  if (created.action !== 'create') return;
  // Nobody to list — the field is absent rather than empty.
  assert.equal(created.frontmatter['participants'], undefined);

  const declined = {
    ...EVENT,
    attendees: EVENT.attendees.map((a) => (a.self ? { ...a, response: 'declined' as const } : a)),
  };
  assert.deepEqual(planMeetingMirror({ ...PLAN_INPUT, event: declined, existing: null }), {
    action: 'skip',
  });
});

test('patch: reschedule updates machine fields only — PM summary/title/body survive', () => {
  const created = planMeetingMirror({ ...PLAN_INPUT, event: EVENT, existing: null });
  assert.equal(created.action, 'create');
  if (created.action !== 'create') return;
  // The PM sharpened the title and wrote notes.
  const pmFm = { ...created.frontmatter, title: 'Nordkap — SSO escalation', summary: 'SSO focus' };
  const moved = {
    ...EVENT,
    start: '2026-07-31T10:00:00+02:00',
    end: '2026-07-31T10:30:00+02:00',
    remote_updated: '2026-07-28T08:00:00Z',
  };
  const plan = planMeetingMirror({
    ...PLAN_INPUT,
    event: moved,
    existing: { frontmatter: pmFm, body: '## Prep\n- raise SCIM timeline' },
  });
  assert.equal(plan.action, 'patch');
  if (plan.action !== 'patch') return;
  assert.equal(plan.frontmatter['title'], 'Nordkap — SSO escalation'); // untouched
  assert.equal(plan.frontmatter['summary'], 'SSO focus'); // untouched
  assert.equal(plan.frontmatter['duration_minutes'], 30);
  assert.equal(plan.frontmatter['remote_updated'], '2026-07-28T08:00:00Z');
  // Every changed key is a machine-owned one.
  for (const key of Object.keys(plan.frontmatter)) {
    if (JSON.stringify(plan.frontmatter[key]) === JSON.stringify(pmFm[key as keyof typeof pmFm]))
      continue;
    assert.ok(
      (MEETING_SYNC_FIELDS as readonly string[]).includes(key),
      `patched non-machine field: ${key}`,
    );
  }
});

test('patch: unchanged event is a skip — no churny writes, no freshness resets', () => {
  const created = planMeetingMirror({ ...PLAN_INPUT, event: EVENT, existing: null });
  if (created.action !== 'create') return assert.fail('expected create');
  const plan = planMeetingMirror({
    ...PLAN_INPUT,
    event: EVENT,
    existing: { frontmatter: created.frontmatter, body: '' },
  });
  assert.deepEqual(plan, { action: 'skip' });
});

test('cancellation marks the note cancelled, empty body or not', () => {
  const created = planMeetingMirror({ ...PLAN_INPUT, event: EVENT, existing: null });
  if (created.action !== 'create') return assert.fail('expected create');
  const cancelled = { ...EVENT, event_status: 'cancelled' as const };

  const untouched = planMeetingMirror({
    ...PLAN_INPUT,
    event: cancelled,
    existing: { frontmatter: created.frontmatter, body: '  \n' },
  });
  assert.equal(untouched.action, 'patch');
  if (untouched.action !== 'patch') return;
  assert.equal(untouched.frontmatter['event_status'], 'cancelled');

  const written = planMeetingMirror({
    ...PLAN_INPUT,
    event: cancelled,
    existing: { frontmatter: created.frontmatter, body: 'Decision drafted here.' },
  });
  assert.equal(written.action, 'patch');
  if (written.action !== 'patch') return;
  assert.equal(written.frontmatter['event_status'], 'cancelled');
});

test('a cancelled note stays cancelled until the event itself comes back', () => {
  const created = planMeetingMirror({ ...PLAN_INPUT, event: EVENT, existing: null });
  if (created.action !== 'create') return assert.fail('expected create');
  const cancelledFm = { ...created.frontmatter, event_status: 'cancelled' };

  // The same cancelled stub arriving again changes nothing.
  const again = planMeetingMirror({
    ...PLAN_INPUT,
    event: { ...EVENT, event_status: 'cancelled' },
    existing: { frontmatter: cancelledFm, body: 'Notes from before.' },
  });
  assert.deepEqual(again, { action: 'skip' });

  // Un-cancelled upstream: the machine field is authoritative again.
  const back = planMeetingMirror({
    ...PLAN_INPUT,
    event: EVENT,
    existing: { frontmatter: cancelledFm, body: 'Notes from before.' },
  });
  assert.equal(back.action, 'patch');
  if (back.action !== 'patch') return;
  assert.equal(back.frontmatter['event_status'], 'confirmed');
});

test('declined after creation is treated like cancellation', () => {
  const created = planMeetingMirror({ ...PLAN_INPUT, event: EVENT, existing: null });
  if (created.action !== 'create') return assert.fail('expected create');
  const declined = {
    ...EVENT,
    attendees: EVENT.attendees.map((a) => (a.self ? { ...a, response: 'declined' as const } : a)),
  };
  const plan = planMeetingMirror({
    ...PLAN_INPUT,
    event: declined,
    existing: { frontmatter: created.frontmatter, body: '' },
  });
  assert.equal(plan.action, 'patch');
  if (plan.action !== 'patch') return;
  assert.equal(plan.frontmatter['event_status'], 'cancelled');
});

test('never-demote: an event that stops qualifying still patches, never deletes', () => {
  const created = planMeetingMirror({ ...PLAN_INPUT, event: EVENT, existing: null });
  if (created.action !== 'create') return assert.fail('expected create');
  // Everyone else dropped off, event still confirmed.
  const emptied = {
    ...EVENT,
    attendees: EVENT.attendees.filter((a) => a.self),
    remote_updated: '2026-07-29T07:00:00Z',
  };
  const plan = planMeetingMirror({
    ...PLAN_INPUT,
    event: emptied,
    existing: { frontmatter: created.frontmatter, body: '' },
  });
  assert.equal(plan.action, 'patch');
});
