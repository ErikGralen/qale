import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CalendarAuthError, googleCalendarConnector } from '../src/index.js';
import { makeFetch, type Route } from './fetch-fixture.js';

/**
 * Google Calendar connector against recorded fixtures — no live account. The
 * stub token supplier stands in for the OAuth service; the fake fetch records
 * requests so tests assert the syncToken protocol on the wire (windowed initial
 * pull → token incremental → 410 re-list), not just the mapping.
 */

const AUTH = { getAccessToken: async () => 'ya29.test-token' };
const API = 'https://www.googleapis.com/calendar/v3';
const NOW = Date.parse('2026-07-27T12:00:00Z');
const PRIMARY = { kind: 'calendar', id: 'erik@tavla.example', name: 'erik@tavla.example' } as const;

const EVENT = {
  id: 'evt-nordkap-1',
  status: 'confirmed',
  summary: 'Nordkap check-in',
  start: { dateTime: '2026-07-30T14:00:00+02:00' },
  end: { dateTime: '2026-07-30T15:00:00+02:00' },
  attendees: [
    { email: 'erik@tavla.example', self: true, responseStatus: 'accepted' },
    { email: 'sara.lindqvist@nordkap.example', displayName: 'Sara Lindqvist', responseStatus: 'accepted' },
    { email: 'room-oslo@resource.calendar.google.com', displayName: 'Oslo', resource: true, responseStatus: 'accepted' },
  ],
  recurringEventId: 'rec-nordkap',
  updated: '2026-07-27T09:00:00.000Z',
  htmlLink: 'https://www.google.com/calendar/event?eid=abc',
};

test('verifyAuth: primary calendar probe returns the account email as identity', async () => {
  const { fetchImpl, calls } = makeFetch([
    {
      url: `${API}/users/me/calendarList/primary`,
      json: { id: 'erik@tavla.example', summary: 'erik@tavla.example' },
    },
  ]);
  const c = googleCalendarConnector.create(AUTH, { fetchImpl });
  const r = await c.verifyAuth();
  assert.equal(r.ok, true);
  assert.equal(r.health, 'ok');
  assert.equal(r.identity?.email, 'erik@tavla.example');
  assert.ok(calls[0]!.url.includes('Bearer') === false); // token travels in the header, not the URL
});

test('verifyAuth: 401 → auth-expired; network failure → unreachable (never conflated)', async () => {
  const expired = googleCalendarConnector.create(AUTH, {
    fetchImpl: makeFetch([{ url: `${API}/users/me/calendarList/primary`, status: 401 }]).fetchImpl,
  });
  assert.equal((await expired.verifyAuth()).health, 'auth-expired');

  const revoked = googleCalendarConnector.create(
    { getAccessToken: async () => { throw new CalendarAuthError(); } },
    { fetchImpl: makeFetch([]).fetchImpl },
  );
  assert.equal((await revoked.verifyAuth()).health, 'auth-expired');

  const offline = googleCalendarConnector.create(AUTH, {
    fetchImpl: makeFetch([{ url: `${API}/users/me/calendarList/primary`, throws: true }]).fetchImpl,
  });
  assert.equal((await offline.verifyAuth()).health, 'unreachable');
});

test('listContainers: calendarList pages concatenate, primary sorts first', async () => {
  const { fetchImpl } = makeFetch([
    {
      url: `${API}/users/me/calendarList`,
      seq: [
        {
          json: {
            items: [{ id: 'team-cal-id-123', summary: 'Tavla Team' }],
            nextPageToken: 'p2',
          },
        },
        { json: { items: [{ id: 'erik@tavla.example', summary: 'erik@tavla.example', primary: true }] } },
      ],
    },
  ]);
  const c = googleCalendarConnector.create(AUTH, { fetchImpl });
  assert.deepEqual(await c.listContainers(), [
    { kind: 'calendar', id: 'erik@tavla.example', name: 'erik@tavla.example' },
    { kind: 'calendar', id: 'team-cal-id-123', name: 'Tavla Team' },
  ]);
});

test('initial pull: windowed (timeMin/timeMax, singleEvents), maps events, keeps nextSyncToken as the mark', async () => {
  const { fetchImpl, calls } = makeFetch([
    {
      url: `${API}/calendars/erik%40tavla.example/events`,
      json: {
        items: [
          EVENT,
          { id: 'evt-lunch', status: 'confirmed', summary: 'Lunch hold', start: { dateTime: '2026-07-28T12:00:00+02:00' }, end: { dateTime: '2026-07-28T13:00:00+02:00' }, updated: '2026-07-20T10:00:00.000Z', htmlLink: 'https://cal/l' },
          { id: 'evt-wl', eventType: 'workingLocation', status: 'confirmed', summary: 'Office', start: { date: '2026-07-28' }, updated: '2026-07-20T10:00:00.000Z' },
        ],
        nextSyncToken: 'sync-token-1',
      },
    },
  ]);
  const c = googleCalendarConnector.create(AUTH, { fetchImpl });
  const r = await c.pullChanges(PRIMARY, null, { now: NOW });

  const url = new URL(calls[0]!.url);
  assert.equal(url.searchParams.get('singleEvents'), 'true');
  assert.equal(url.searchParams.get('timeMin'), '2026-07-20T12:00:00.000Z'); // 7 days back
  assert.equal(url.searchParams.get('timeMax'), '2026-09-25T12:00:00.000Z'); // 60 days forward
  assert.equal(url.searchParams.get('syncToken'), null);

  assert.equal(r.highWaterMark, 'sync-token-1');
  // workingLocation noise filtered; the hold and the meeting both index shallow.
  assert.equal(r.changes.length, 2);
  const meeting = r.changes.find((ch) => ch.external_id === 'evt-nordkap-1');
  assert.ok(meeting && meeting.kind === 'event');
  assert.equal(meeting.title, 'Nordkap check-in');
  assert.equal(meeting.event_status, 'confirmed');
  assert.equal(meeting.allDay, false);
  assert.equal(meeting.recurring_event_id, 'rec-nordkap');
  assert.deepEqual(meeting.attendees[1], {
    email: 'sara.lindqvist@nordkap.example',
    name: 'Sara Lindqvist',
    response: 'accepted',
  });
  assert.deepEqual(meeting.attendees[2], {
    email: 'room-oslo@resource.calendar.google.com',
    name: 'Oslo',
    resource: true,
    response: 'accepted',
  });
});

test('incremental pull: syncToken on the wire, cancellation stubs map with empty fallbacks', async () => {
  const { fetchImpl, calls } = makeFetch([
    {
      url: `${API}/calendars/erik%40tavla.example/events`,
      json: {
        items: [{ id: 'evt-nordkap-1', status: 'cancelled', recurringEventId: 'rec-nordkap', originalStartTime: { dateTime: '2026-07-30T14:00:00+02:00' } }],
        nextSyncToken: 'sync-token-2',
      },
    },
  ]);
  const c = googleCalendarConnector.create(AUTH, { fetchImpl });
  const r = await c.pullChanges(PRIMARY, 'sync-token-1', { now: NOW });

  const url = new URL(calls[0]!.url);
  assert.equal(url.searchParams.get('syncToken'), 'sync-token-1');
  assert.equal(url.searchParams.get('timeMin'), null); // bounds live in the token

  assert.equal(r.highWaterMark, 'sync-token-2');
  assert.equal(r.changes.length, 1);
  const stub = r.changes[0]!;
  assert.ok(stub.kind === 'event');
  assert.equal(stub.event_status, 'cancelled');
  assert.equal(stub.title, ''); // stub — the engine merges over the row it holds
  assert.equal(stub.start, '2026-07-30T14:00:00+02:00');
});

test('410 GONE: expired sync token silently re-lists the window', async () => {
  const { fetchImpl, calls } = makeFetch([
    {
      url: `${API}/calendars/erik%40tavla.example/events`,
      seq: [
        { status: 410, json: { error: { code: 410 } } },
        { json: { items: [EVENT], nextSyncToken: 'sync-token-3' } },
      ],
    },
  ]);
  const c = googleCalendarConnector.create(AUTH, { fetchImpl });
  const r = await c.pullChanges(PRIMARY, 'sync-token-stale', { now: NOW });

  assert.equal(calls.length, 2);
  const second = new URL(calls[1]!.url);
  assert.equal(second.searchParams.get('syncToken'), null);
  assert.ok(second.searchParams.get('timeMin'));
  assert.equal(r.highWaterMark, 'sync-token-3');
  assert.equal(r.changes.length, 1);
});

test('pagination: pageToken loop concatenates and the final page yields the token', async () => {
  const { fetchImpl, calls } = makeFetch([
    {
      url: `${API}/calendars/erik%40tavla.example/events`,
      seq: [
        { json: { items: [EVENT], nextPageToken: 'page-2' } },
        { json: { items: [{ ...EVENT, id: 'evt-2' }], nextSyncToken: 'sync-token-4' } },
      ],
    },
  ]);
  const c = googleCalendarConnector.create(AUTH, { fetchImpl });
  const r = await c.pullChanges(PRIMARY, null, { now: NOW });
  assert.equal(new URL(calls[1]!.url).searchParams.get('pageToken'), 'page-2');
  assert.equal(r.changes.length, 2);
  assert.equal(r.highWaterMark, 'sync-token-4');
});

test('execute rejects a payload that fails validation (missing title/start)', async () => {
  const c = googleCalendarConnector.create(AUTH, { fetchImpl: makeFetch([]).fetchImpl });
  await assert.rejects(
    () => c.execute({ provider: 'google-calendar', system: 'google-calendar', action: 'create_event', body: 'x', rationale: 'r' }),
    /invalid google-calendar payload/,
  );
});

test('execute create_event: POSTs summary/start, defaults end to +30 min, returns id + link', async () => {
  const { fetchImpl, calls } = makeFetch([
    {
      url: `${API}/calendars/primary/events`,
      method: 'POST',
      json: { id: 'evt-new', htmlLink: 'https://cal.google/evt-new' },
    },
  ]);
  const c = googleCalendarConnector.create(AUTH, { fetchImpl });
  const out = await c.execute({
    provider: 'google-calendar',
    system: 'google-calendar',
    action: 'create_event',
    title: 'Follow-up with Sara',
    start: '2026-08-04T15:00:00+02:00',
    attendees: ['sara.lindqvist@nordkap.example'],
    body: 'Walk the SCIM timeline.\n\nSource: nordkap-checkin, 2026-07-30',
    rationale: 'the meeting named a follow-up',
  });
  assert.deepEqual(out, { externalId: 'evt-new', url: 'https://cal.google/evt-new' });
  const body = calls[0]!.body as { summary: string; start: { dateTime: string }; end: { dateTime: string }; attendees: { email: string }[] };
  assert.equal(calls[0]!.method, 'POST');
  assert.equal(body.summary, 'Follow-up with Sara');
  assert.equal(body.start.dateTime, '2026-08-04T15:00:00+02:00');
  assert.equal(body.end.dateTime, '2026-08-04T13:30:00.000Z'); // +30 min, normalized to Z
  assert.deepEqual(body.attendees, [{ email: 'sara.lindqvist@nordkap.example' }]);
  // Guests are on the event but Google mails nobody. Qale owns the outbound side.
  assert.ok(calls[0]!.url.includes('sendUpdates=none'), calls[0]!.url);
});

test('execute update_event: PATCHes only the changed fields', async () => {
  const { fetchImpl, calls } = makeFetch([
    {
      url: `${API}/calendars/primary/events/evt-nordkap-1`,
      method: 'PATCH',
      json: { id: 'evt-nordkap-1', htmlLink: 'https://cal.google/evt' },
    },
  ]);
  const c = googleCalendarConnector.create(AUTH, { fetchImpl });
  await c.execute({
    provider: 'google-calendar',
    system: 'google-calendar',
    action: 'update_event',
    eventId: 'evt-nordkap-1',
    start: '2026-07-30T16:00:00+02:00',
    body: 'Pushed an hour later.',
    rationale: 'Sara asked to move it',
  });
  const body = calls[0]!.body as { start: { dateTime: string }; summary?: string };
  assert.equal(calls[0]!.method, 'PATCH');
  assert.equal(body.start.dateTime, '2026-07-30T16:00:00+02:00');
  assert.equal(body.summary, undefined); // untouched fields are omitted from the patch
});

test('execute respond_to_event: reads the event, flips only the self attendee, keeps the rest', async () => {
  const { fetchImpl, calls } = makeFetch([
    { url: `${API}/calendars/primary/events/evt-nordkap-1`, method: 'GET', json: EVENT },
    { url: `${API}/calendars/primary/events/evt-nordkap-1`, method: 'PATCH', json: { id: 'evt-nordkap-1', htmlLink: 'https://cal.google/evt' } },
  ]);
  const c = googleCalendarConnector.create(AUTH, { fetchImpl });
  await c.execute({
    provider: 'google-calendar',
    system: 'google-calendar',
    action: 'respond_to_event',
    eventId: 'evt-nordkap-1',
    attendeeEmail: 'erik@tavla.example',
    responseStatus: 'tentative',
    body: 'Might run late.',
    rationale: 'PO wants to mark tentative',
  });
  assert.equal(calls[0]!.method, 'GET');
  const patch = calls[1]!.body as { attendees: { email: string; responseStatus: string }[] };
  assert.equal(calls[1]!.method, 'PATCH');
  const erik = patch.attendees.find((a) => a.email === 'erik@tavla.example');
  const sara = patch.attendees.find((a) => a.email === 'sara.lindqvist@nordkap.example');
  assert.equal(erik?.responseStatus, 'tentative'); // flipped
  assert.equal(sara?.responseStatus, 'accepted'); // untouched
  assert.ok(calls[1]!.url.includes('sendUpdates=none'), calls[1]!.url); // no RSVP mail either
});
