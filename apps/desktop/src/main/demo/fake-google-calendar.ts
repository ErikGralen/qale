/**
 * The fake Google Calendar (docs/demo-mode.md): a `FetchLike` that answers the
 * endpoints the Google connector and the OAuth service use, from an in-memory
 * store seeded by a fixture. Nothing leaves the process, and the demo build
 * needs no OAuth client and no browser round-trip.
 *
 * The store is the Rota week: `demo/google-fixture.json` is generated from
 * scripts/lib/google-cast.ts, the same cast `pnpm seed-google-calendar` pushes
 * to a live account, so the attendee addresses already match the person notes
 * in `vault-dev/` and sync links them. Dates in the fixture are anchored on
 * 2026-07-17 and slid by `dateOffsetDays` at load, the same slide Reset gives
 * the vault: yesterday's Steering stays yesterday's.
 *
 * Writes (create an event, patch one, RSVP) mutate the store and persist to
 * `statePath`, so a relaunch keeps them until Reset.
 *
 * Two things are faked beyond the calendar API itself: the token endpoint,
 * which hands back a fake access token so `GoogleOAuthService` never reaches
 * Google, and the revoke endpoint, so Disconnect stays quiet.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FetchLike } from '@qale/connectors';

export interface FakeGoogleCalendarOptions {
  /** The generated fixture (`demo/google-fixture.json`), anchored dates. */
  fixturePath: string;
  /** Where mutations persist between launches (`<userData>/demo/google.json`). */
  statePath: string;
  /** Days to slide fixture dates by at load (today − anchor). */
  dateOffsetDays: number;
  /** Overrides the fixture's account, for a demo run under another name. */
  self?: Partial<FakeGoogleSelf>;
  /** Clock, for tests. Writes stamp `updated` with it. */
  now?: () => number;
}

export interface FakeGoogleCalendar {
  fetchImpl: FetchLike;
  /** The primary calendar's id, which is also the account address. */
  primaryCalendarId(): string;
  /** Back to the fixture, mutations forgotten. */
  reset(): void;
}

// ---------------------------------------------------------------------------
// The fixture, which is also the store: a write mutates it and it is written
// back to statePath as is.
// ---------------------------------------------------------------------------

export interface FakeGoogleSelf {
  email: string;
  displayName: string;
}

export interface FakeCalendar {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
  timeZone?: string;
}

export interface FakeEventTime {
  /** RFC3339 with an offset, for a timed event. */
  dateTime?: string;
  /** `YYYY-MM-DD`, for an all-day one. */
  date?: string;
  timeZone?: string;
}

export interface FakeAttendee {
  email: string;
  displayName?: string;
  organizer?: boolean;
  self?: boolean;
  resource?: boolean;
  responseStatus?: string;
}

export interface FakeEvent {
  id: string;
  status: string;
  htmlLink?: string;
  created?: string;
  updated: string;
  summary?: string;
  description?: string;
  organizer?: { email: string; displayName?: string };
  creator?: { email: string; displayName?: string };
  start?: FakeEventTime;
  end?: FakeEventTime;
  recurringEventId?: string;
  originalStartTime?: FakeEventTime;
  attendees?: FakeAttendee[];
  eventType?: string;
  extendedProperties?: { private?: Record<string, string> };
}

export interface GoogleFixture {
  /** The date every date in the fixture is written against. */
  anchor: string;
  timeZone: string;
  self: FakeGoogleSelf;
  calendars: FakeCalendar[];
  events: FakeEvent[];
}

const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** The access token every refresh hands back. It is never checked. */
const ACCESS_TOKEN = 'demo-access-token';

/** `<PREFIX><ms>`: a sync token is the instant it was minted, so an
 *  incremental pull is "everything written since". Anything else reads as an
 *  expired token and costs the connector one windowed re-list. */
const SYNC_TOKEN_PREFIX = 'qale-demo-sync-';

// ---------------------------------------------------------------------------
// The date slide
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function shiftIsoDate(iso: string, days: number): string {
  const parts = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * The UTC offset a zone is on at one instant, in minutes. There is a second
 * copy of this in `scripts/lib/google-cast.ts`, which this file cannot import.
 * Both answer the same question: a meeting written at 10:00 Stockholm has to
 * stay 10:00 Stockholm when it slides from July into November, so the offset is
 * computed for the day the meeting lands on rather than carried with it.
 */
function zoneOffsetMinutes(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const at = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    at('year'),
    at('month') - 1,
    at('day'),
    at('hour'),
    at('minute'),
    at('second'),
  );
  return Math.round((asUtc - utcMs) / 60_000);
}

/** Local wall clock ("2026-07-16T10:00:00") in a zone → RFC3339 with offset. */
function withZoneOffset(local: string, timeZone: string): string {
  const guess = Date.parse(`${local}Z`);
  const first = zoneOffsetMinutes(timeZone, guess);
  const offset = zoneOffsetMinutes(timeZone, guess - first * 60_000);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Slide one event time by whole days, keeping the wall clock it was written
 *  at. The offset is recomputed, because the day it lands on may be on the
 *  other side of a daylight-saving change. */
function slideTime(
  time: FakeEventTime | undefined,
  days: number,
  zone: string,
): FakeEventTime | undefined {
  if (!time) return time;
  if (time.date) return { ...time, date: shiftIsoDate(time.date, days) };
  if (!time.dateTime) return time;
  const local = time.dateTime.slice(0, 19);
  const date = shiftIsoDate(local.slice(0, 10), days);
  const timeZone = time.timeZone ?? zone;
  return { ...time, dateTime: withZoneOffset(`${date}${local.slice(10)}`, timeZone), timeZone };
}

/** `created` and `updated` are UTC stamps: only the date part moves. */
function slideStamp(stamp: string | undefined, days: number): string | undefined {
  if (!stamp || !DATE_RE.test(stamp)) return stamp;
  return shiftIsoDate(stamp.slice(0, 10), days) + stamp.slice(10);
}

function slideEvent(event: FakeEvent, days: number, zone: string): FakeEvent {
  if (days === 0) return event;
  return {
    ...event,
    ...(event.created ? { created: slideStamp(event.created, days)! } : {}),
    updated: slideStamp(event.updated, days) ?? event.updated,
    start: slideTime(event.start, days, zone),
    end: slideTime(event.end, days, zone),
    ...(event.originalStartTime
      ? { originalStartTime: slideTime(event.originalStartTime, days, zone) }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Responses, in Google's shapes
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function apiError(status: number, reason: string, message: string): Response {
  return json(
    { error: { code: status, message, errors: [{ domain: 'global', reason, message }] } },
    status,
  );
}

function notFound(what: string): Response {
  return apiError(404, 'notFound', `${what} not found`);
}

// ---------------------------------------------------------------------------

function loadStore(path: string, dateOffsetDays: number, fromFixture: boolean): GoogleFixture {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as GoogleFixture;
  // A saved state was slid when it was seeded; sliding it again would move
  // every date twice.
  if (!fromFixture || dateOffsetDays === 0) return raw;
  return {
    ...raw,
    events: raw.events.map((e) => slideEvent(e, dateOffsetDays, raw.timeZone)),
  };
}

export function createFakeGoogleCalendar(opts: FakeGoogleCalendarOptions): FakeGoogleCalendar {
  const now = opts.now ?? Date.now;
  let store = seed();

  function seed(): GoogleFixture {
    const fromState = existsSync(opts.statePath);
    const loaded = loadStore(
      fromState ? opts.statePath : opts.fixturePath,
      opts.dateOffsetDays,
      !fromState,
    );
    if (opts.self) loaded.self = { ...loaded.self, ...opts.self };
    return loaded;
  }

  function persist(): void {
    mkdirSync(dirname(opts.statePath), { recursive: true });
    writeFileSync(opts.statePath, `${JSON.stringify(store, null, 2)}\n`);
  }

  function stamp(): string {
    return new Date(now()).toISOString();
  }

  function primary(): FakeCalendar {
    return store.calendars.find((c) => c.primary) ?? store.calendars[0]!;
  }

  /** Every calendar id answers, so a demo that follows the account address and
   *  one that follows "primary" behave the same. */
  function calendar(id: string): FakeCalendar | undefined {
    if (id === 'primary') return primary();
    return store.calendars.find((c) => c.id.toLowerCase() === id.toLowerCase());
  }

  function event(id: string): FakeEvent | undefined {
    return store.events.find((e) => e.id === id);
  }

  // -- reads ----------------------------------------------------------------

  /** `self` is output-only in Google's API: it is stamped per reader, not
   *  stored. Same here, so a write can hand back attendees it never saw one on. */
  function eventJson(e: FakeEvent): FakeEvent {
    const mine = (email: string | undefined): boolean =>
      (email ?? '').trim().toLowerCase() === store.self.email.toLowerCase();
    return {
      ...e,
      ...(e.organizer
        ? { organizer: { ...e.organizer, ...(mine(e.organizer.email) ? { self: true } : {}) } }
        : {}),
      ...(e.attendees
        ? {
            attendees: e.attendees.map((a) => ({
              ...a,
              ...(mine(a.email) ? { self: true } : {}),
            })),
          }
        : {}),
    };
  }

  function startMs(e: FakeEvent): number {
    const value = e.start?.dateTime ?? e.start?.date;
    return value ? Date.parse(value) : Number.NaN;
  }

  function endMs(e: FakeEvent): number {
    const value = e.end?.dateTime ?? e.end?.date;
    return value ? Date.parse(value) : startMs(e);
  }

  /** Google's window rule: `timeMin` bounds the end, `timeMax` bounds the
   *  start, so an event that straddles either edge still comes back. */
  function inWindow(e: FakeEvent, timeMin: string | null, timeMax: string | null): boolean {
    const start = startMs(e);
    const end = endMs(e);
    if (Number.isNaN(start)) return true;
    if (timeMin && !Number.isNaN(Date.parse(timeMin)) && end < Date.parse(timeMin)) return false;
    if (timeMax && !Number.isNaN(Date.parse(timeMax)) && start > Date.parse(timeMax)) return false;
    return true;
  }

  function listEvents(params: URLSearchParams): Response {
    const token = params.get('syncToken');
    let matched: FakeEvent[];
    if (token !== null) {
      if (
        !token.startsWith(SYNC_TOKEN_PREFIX) ||
        !Number.isFinite(Number(token.slice(SYNC_TOKEN_PREFIX.length)))
      ) {
        return apiError(
          410,
          'fullSyncRequired',
          'Sync token is no longer valid, a full sync is required.',
        );
      }
      const since = Number(token.slice(SYNC_TOKEN_PREFIX.length));
      matched = store.events.filter((e) => Date.parse(e.updated) > since);
    } else {
      matched = store.events.filter((e) =>
        inWindow(e, params.get('timeMin'), params.get('timeMax')),
      );
    }
    matched = [...matched].sort((a, b) => startMs(a) - startMs(b));

    const max = Math.max(1, Number(params.get('maxResults') ?? 250));
    const from = Number(params.get('pageToken') ?? 0);
    const slice = matched.slice(from, from + max);
    const last = from + slice.length >= matched.length;
    return json({
      kind: 'calendar#events',
      summary: primary().summary,
      timeZone: store.timeZone,
      items: slice.map(eventJson),
      // Google mints the next sync token on the LAST page only.
      ...(last
        ? { nextSyncToken: `${SYNC_TOKEN_PREFIX}${now()}` }
        : { nextPageToken: String(from + slice.length) }),
    });
  }

  // -- writes ---------------------------------------------------------------

  function nextEventId(): string {
    const used = store.events.filter((e) => /^qale-demo-new-\d+$/.test(e.id)).length;
    return `qale-demo-new-${used + 1}`;
  }

  /** An attendee list as it arrives on a write: `self` and `organizer` are ours
   *  to decide, so they are dropped and stamped again on the way out. */
  function attendeesFrom(raw: unknown): FakeAttendee[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const out: FakeAttendee[] = [];
    for (const entry of raw) {
      const a = entry as FakeAttendee;
      if (!a?.email) continue;
      const { self: _self, ...rest } = a;
      out.push({ ...rest, responseStatus: a.responseStatus ?? 'needsAction' });
    }
    return out;
  }

  function timeFrom(raw: unknown): FakeEventTime | undefined {
    const t = raw as FakeEventTime | undefined;
    if (!t || (!t.dateTime && !t.date)) return undefined;
    return { ...t, ...(t.dateTime && !t.timeZone ? { timeZone: store.timeZone } : {}) };
  }

  function insertEvent(body: Record<string, unknown>): Response {
    const start = timeFrom(body['start']);
    if (!start) return apiError(400, 'required', 'Missing start time.');
    const created: FakeEvent = {
      id: nextEventId(),
      status: 'confirmed',
      created: stamp(),
      updated: stamp(),
      summary: String(body['summary'] ?? ''),
      description: String(body['description'] ?? ''),
      organizer: { ...store.self },
      creator: { ...store.self },
      start,
      end: timeFrom(body['end']) ?? start,
      attendees: attendeesFrom(body['attendees']) ?? [
        {
          email: store.self.email,
          displayName: store.self.displayName,
          organizer: true,
          responseStatus: 'accepted',
        },
      ],
      eventType: 'default',
      extendedProperties: { private: { qaleDemo: 'rota' } },
    };
    created.htmlLink = `https://www.google.com/calendar/event?eid=${created.id}`;
    store.events.push(created);
    persist();
    return json(eventJson(created));
  }

  function patchEvent(target: FakeEvent, body: Record<string, unknown>): Response {
    if (typeof body['summary'] === 'string') target.summary = body['summary'];
    if (typeof body['description'] === 'string') target.description = body['description'];
    const start = timeFrom(body['start']);
    if (start) target.start = start;
    const end = timeFrom(body['end']);
    if (end) target.end = end;
    const attendees = attendeesFrom(body['attendees']);
    if (attendees) target.attendees = attendees;
    if (typeof body['status'] === 'string') target.status = body['status'];
    target.updated = stamp();
    persist();
    return json(eventJson(target));
  }

  // -- the router -----------------------------------------------------------

  async function route(url: string, init?: RequestInit): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase();

    // OAuth. The demo has no client and no browser flow: a refresh is answered
    // here with a token nothing ever checks.
    if (url.startsWith(TOKEN_ENDPOINT)) {
      return json({
        access_token: ACCESS_TOKEN,
        expires_in: 3600,
        token_type: 'Bearer',
        scope:
          'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events',
      });
    }
    if (url.startsWith(REVOKE_ENDPOINT)) return json({});

    if (!url.startsWith(API)) return notFound('host');
    const [pathname, search] = url.slice(API.length).split('?');
    const params = new URLSearchParams(search ?? '');
    const body = parseBody(init?.body);

    if (pathname === '/users/me/calendarList') {
      return json({ kind: 'calendar#calendarList', items: store.calendars });
    }
    const oneCalendar = /^\/users\/me\/calendarList\/([^/]+)$/.exec(pathname ?? '');
    if (oneCalendar?.[1]) {
      const found = calendar(decodeURIComponent(oneCalendar[1]));
      return found ? json(found) : notFound('calendar');
    }

    const events = /^\/calendars\/([^/]+)\/events$/.exec(pathname ?? '');
    if (events?.[1]) {
      if (!calendar(decodeURIComponent(events[1]))) return notFound('calendar');
      if (method === 'GET') return listEvents(params);
      if (method === 'POST') return insertEvent(body);
    }

    const oneEvent = /^\/calendars\/([^/]+)\/events\/([^/]+)$/.exec(pathname ?? '');
    if (oneEvent?.[1] && oneEvent[2]) {
      if (!calendar(decodeURIComponent(oneEvent[1]))) return notFound('calendar');
      const target = event(decodeURIComponent(oneEvent[2]));
      if (!target) return notFound('event');
      if (method === 'GET') return json(eventJson(target));
      if (method === 'PATCH' || method === 'PUT') return patchEvent(target, body);
      if (method === 'DELETE') {
        target.status = 'cancelled';
        target.updated = stamp();
        persist();
        return new Response(null, { status: 204 });
      }
    }

    return notFound(`${method} ${pathname}`);
  }

  return {
    fetchImpl: (url, init) => route(url, init),
    primaryCalendarId(): string {
      return primary().id;
    },
    reset(): void {
      rmSync(opts.statePath, { force: true });
      store = seed();
    },
  };
}

/** Request bodies arrive as the JSON string the client wrote. */
function parseBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'string' || !body) return {};
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
