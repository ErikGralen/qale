import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { googleCalendarConnector } from '@qale/connectors';
import type { Connector, ExternalContainer } from '@qale/connectors';
import { ANCHOR, daysBetween } from '@qale/domain/demo';
import {
  createFakeGoogleCalendar,
  type FakeGoogleCalendar,
} from '../src/main/demo/fake-google-calendar.js';

/**
 * The fake is only worth anything if the REAL connector is happy with it, so
 * every test here drives `googleCalendarConnector.create(auth, { fetchImpl })`
 * — the same call SyncService makes — and never the fake's router directly,
 * except where a raw request is the point (the token endpoint, a foreign host).
 */

const ROOT = join(import.meta.dirname, '..', '..', '..');
const FIXTURE = join(ROOT, 'demo', 'google-fixture.json');
const CALENDAR: ExternalContainer = {
  kind: 'calendar',
  id: 'demo@rota.example',
  name: 'Demo user',
};

/** The anchored day the demo's yesterday-Steering is written against. */
const STEERING = '2026-07-16';
/** Noon on the anchor day, so a pull's ±30/+60 window covers the whole cast. */
const AT_ANCHOR = Date.parse(`${ANCHOR}T12:00:00Z`);

function fake(dateOffsetDays = 0): FakeGoogleCalendar {
  const dir = mkdtempSync(join(tmpdir(), 'qale-fake-google-'));
  return createFakeGoogleCalendar({
    fixturePath: FIXTURE,
    statePath: join(dir, 'demo', 'google.json'),
    dateOffsetDays,
    now: () => AT_ANCHOR,
  });
}

function connectorFor(f: FakeGoogleCalendar): Connector {
  return googleCalendarConnector.create(
    { getAccessToken: () => Promise.resolve('demo-access-token') },
    { fetchImpl: f.fetchImpl },
  );
}

test('the probe passes and reports the demo account', async () => {
  const verify = await connectorFor(fake()).verifyAuth();
  assert.equal(verify.ok, true);
  assert.equal(verify.health, 'ok');
  assert.equal(verify.identity?.email, 'demo@rota.example');
});

test('a request to another host is a 404, not a live call', async () => {
  const f = fake();
  const foreign = await f.fetchImpl('https://www.googleapis.com/drive/v3/files');
  assert.equal(foreign.status, 404);
  const unknown = await f.fetchImpl('https://www.googleapis.com/calendar/v3/nothing-here');
  assert.equal(unknown.status, 404);
});

test('the token endpoint hands back an access token, so no OAuth is needed', async () => {
  const res = await fake().fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: 'grant_type=refresh_token',
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  assert.ok(body.access_token);
  assert.ok((body.expires_in ?? 0) > 0);
});

test('listContainers returns the one primary calendar', async () => {
  const containers = await connectorFor(fake()).listContainers();
  assert.deepEqual(
    containers.map((c) => [c.kind, c.id]),
    [['calendar', 'demo@rota.example']],
  );
});

test('a full pull returns the week, attendees and the Steering series', async () => {
  const pulled = await connectorFor(fake()).pullChanges(CALENDAR, null, { now: AT_ANCHOR });
  const titles = pulled.changes.map((c) => c.title);
  assert.deepEqual(titles, [
    'Steering',
    '1:1 Rebecca',
    'Café Nord QBR prep',
    "Bruno's CS sync",
    'Steering',
    'Fjord Sports call',
    'Steering',
  ]);
  const steering = pulled.changes[0];
  assert.equal(steering?.kind, 'event');
  if (steering?.kind !== 'event') return;
  assert.equal(steering.start.slice(0, 10), STEERING);
  assert.equal(steering.event_status, 'confirmed');
  assert.equal(steering.recurring_event_id, 'qale-demo-steering');
  // The PM is stamped `self`, everyone else is a participant to resolve.
  assert.deepEqual(
    steering.attendees.map((a) => [a.email, a.self === true]),
    [
      ['demo@rota.example', true],
      ['asa.lindgren@rota.example', false],
      ['rebecca.holm@rota.example', false],
      ['marcus.ek@rota.example', false],
    ],
  );
  assert.ok(pulled.highWaterMark, 'the pull mints a sync token');
});

test('events.list honours the window: a pull from far away sees nothing', async () => {
  const farFuture = AT_ANCHOR + 400 * 86_400_000;
  const pulled = await connectorFor(fake()).pullChanges(CALENDAR, null, { now: farFuture });
  assert.deepEqual(pulled.changes, []);
});

test('an incremental pull with a fresh sync token returns nothing', async () => {
  const connector = connectorFor(fake());
  const first = await connector.pullChanges(CALENDAR, null, { now: AT_ANCHOR });
  const second = await connector.pullChanges(CALENDAR, first.highWaterMark, { now: AT_ANCHOR });
  assert.deepEqual(second.changes, []);
});

test('an unusable sync token is a 410, and the connector re-lists', async () => {
  const f = fake();
  const raw = await f.fetchImpl(
    'https://www.googleapis.com/calendar/v3/calendars/demo%40rota.example/events?syncToken=rubbish',
  );
  assert.equal(raw.status, 410);
  // v2|<anchorMs>|<token> is the mark format; a token the fake refuses costs
  // one windowed re-list rather than an error.
  const pulled = await connectorFor(f).pullChanges(CALENDAR, `v2|${AT_ANCHOR}|rubbish`, {
    now: AT_ANCHOR,
  });
  assert.equal(pulled.changes.length, 7);
});

test('the shift moves the cast: the anchored Steering lands yesterday', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const offset = daysBetween(ANCHOR, today);
  const pulled = await connectorFor(fake(offset)).pullChanges(CALENDAR, null, { now: Date.now() });
  const steering = pulled.changes.find((c) => c.title === 'Steering');
  assert.ok(steering && steering.kind === 'event');
  if (!steering || steering.kind !== 'event') return;
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  assert.equal(steering.start.slice(0, 10), yesterday);
  // The wall clock survives the slide, whatever the season did to the offset.
  assert.equal(steering.start.slice(11, 16), '10:00');
});

test('an RSVP lands on the event and persists', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qale-fake-google-'));
  const statePath = join(dir, 'demo', 'google.json');
  const f = createFakeGoogleCalendar({
    fixturePath: FIXTURE,
    statePath,
    dateOffsetDays: 0,
    now: () => AT_ANCHOR,
  });
  const result = await connectorFor(f).execute({
    provider: 'google-calendar',
    action: 'respond_to_event',
    eventId: 'qale-demo-1-1-rebecca',
    attendeeEmail: 'demo@rota.example',
    responseStatus: 'declined',
    body: 'Cannot make it.',
    rationale: 'The PM asked to decline.',
  });
  assert.equal(result.externalId, 'qale-demo-1-1-rebecca');

  const saved = JSON.parse(readFileSync(statePath, 'utf8')) as {
    events: { id: string; attendees: { email: string; responseStatus?: string }[] }[];
  };
  const event = saved.events.find((e) => e.id === 'qale-demo-1-1-rebecca');
  assert.equal(
    event?.attendees.find((a) => a.email === 'demo@rota.example')?.responseStatus,
    'declined',
  );
  // The other guest is never dropped by an RSVP.
  assert.ok(event?.attendees.some((a) => a.email === 'rebecca.holm@rota.example'));

  // A relaunch reads the saved state, not the fixture.
  const relaunched = createFakeGoogleCalendar({
    fixturePath: FIXTURE,
    statePath,
    dateOffsetDays: 0,
    now: () => AT_ANCHOR,
  });
  const pulled = await connectorFor(relaunched).pullChanges(CALENDAR, null, { now: AT_ANCHOR });
  const rebecca = pulled.changes.find((c) => c.title === '1:1 Rebecca');
  assert.ok(rebecca && rebecca.kind === 'event');
  if (!rebecca || rebecca.kind !== 'event') return;
  assert.equal(rebecca.attendees.find((a) => a.self)?.response, 'declined');
});

test('a created event turns up in the next pull', async () => {
  const f = fake();
  const connector = connectorFor(f);
  const created = await connector.execute({
    provider: 'google-calendar',
    action: 'create_event',
    title: 'H2 order follow-up',
    start: `${ANCHOR}T15:00:00+02:00`,
    end: `${ANCHOR}T15:30:00+02:00`,
    attendees: ['rebecca.holm@rota.example'],
    body: 'Fifteen minutes on the re-estimate.',
    rationale: 'The PM approved the card.',
  });
  assert.ok(created.externalId);
  assert.ok(created.url.includes(created.externalId));
  const pulled = await connector.pullChanges(CALENDAR, null, { now: AT_ANCHOR });
  assert.ok(pulled.changes.some((c) => c.title === 'H2 order follow-up'));
});

test('reset puts the fixture back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qale-fake-google-'));
  const f = createFakeGoogleCalendar({
    fixturePath: FIXTURE,
    statePath: join(dir, 'demo', 'google.json'),
    dateOffsetDays: 0,
    now: () => AT_ANCHOR,
  });
  const connector = connectorFor(f);
  await connector.execute({
    provider: 'google-calendar',
    action: 'create_event',
    title: 'Gone after reset',
    start: `${ANCHOR}T16:00:00+02:00`,
    body: 'Something the last demo made.',
    rationale: 'The PM approved the card.',
  });
  f.reset();
  const pulled = await connectorFor(f).pullChanges(CALENDAR, null, { now: AT_ANCHOR });
  assert.equal(pulled.changes.length, 7);
  assert.ok(!pulled.changes.some((c) => c.title === 'Gone after reset'));
});

test('the generated fixture is valid JSON with the cast in it', () => {
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    anchor: string;
    calendars: { id: string; primary?: boolean }[];
    events: { summary: string; start: { dateTime: string } }[];
  };
  assert.equal(fixture.anchor, ANCHOR);
  assert.equal(fixture.calendars.filter((c) => c.primary).length, 1);
  assert.equal(fixture.events.length, 7);
  assert.equal(fixture.events.filter((e) => e.summary === 'Steering').length, 3);
  assert.ok(
    fixture.events.every((e) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(e.start.dateTime),
    ),
  );
});
