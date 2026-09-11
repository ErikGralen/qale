/**
 * Bake the Bord calendar cast into `demo/google-fixture.json`, the seed the
 * demo build's fake Google Calendar serves (docs/demo-mode.md).
 *
 * Two sources, both git-tracked, both already the truth for something else:
 *  - scripts/lib/google-cast.ts — titles, times, durations, descriptions and
 *    attendee addresses. The same cast `pnpm seed-google-calendar` pushes to a
 *    live Google account.
 *  - vault-dev/people/ — each person note's `email` gives the address a display
 *    name, so the demo calendar shows "Rebecca Holm" and not an address, and
 *    participant resolution links the same note either way.
 *
 * Recurrence is expanded here rather than carried: the connector always asks
 * for `singleEvents=true`, so it never sees an RRULE. Two concrete Steering
 * instances cost nothing and keep the fake free of a recurrence engine.
 *
 * Dates stay anchored on 2026-07-17. Sliding them to the demo day is the fake's
 * job at load, so one fixture serves every demo day.
 *
 *   pnpm build-demo-google-fixture
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ANCHOR,
  CAST_MEETINGS,
  DEFAULT_TIMEZONE,
  DEMO_TAG,
  endTimeOf,
  shiftDate,
  withZoneOffset,
  type CastMeeting,
} from './lib/google-cast.ts';

const ROOT = join(import.meta.dirname, '..');
const PEOPLE = join(ROOT, 'vault-dev', 'people');
const OUT = join(ROOT, 'demo', 'google-fixture.json');

/** The demo's own account. The primary calendar's id IS the account email, so
 *  this one string is the account, the calendar and the organizer. */
const SELF = { email: 'demo@bord.example', displayName: 'Demo user' };

/** When the fixture says the events were written. Both are anchor-relative, so
 *  they slide with everything else and never read as "updated in the future". */
const CREATED = '2026-06-15T09:00:00.000Z';
const UPDATED = '2026-07-15T09:00:00.000Z';

interface EventTime {
  dateTime: string;
  timeZone: string;
}

interface Attendee {
  email: string;
  displayName?: string;
  organizer?: boolean;
  responseStatus: string;
}

interface FixtureEvent {
  id: string;
  status: string;
  htmlLink: string;
  created: string;
  updated: string;
  summary: string;
  description: string;
  organizer: { email: string; displayName: string };
  creator: { email: string; displayName: string };
  start: EventTime;
  end: EventTime;
  recurringEventId?: string;
  originalStartTime?: EventTime;
  attendees: Attendee[];
  eventType: string;
  extendedProperties: { private: Record<string, string> };
}

// ---------------------------------------------------------------------------
// Display names, from the vault
// ---------------------------------------------------------------------------

/** email → the person's name, as their note's `summary` opens ("Rebecca Holm:
 *  Tech lead on Bookings…"). An address with no note keeps its local part. */
function displayNames(): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of readdirSync(PEOPLE)) {
    if (!file.endsWith('.md')) continue;
    const text = readFileSync(join(PEOPLE, file), 'utf8');
    const frontmatter = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
    const email = /^email:\s*['"]?([^'"\n]+)['"]?\s*$/m.exec(frontmatter)?.[1]?.trim();
    if (!email) continue;
    const summary = /^summary:\s*['"]?(.+?)['"]?\s*$/m.exec(frontmatter)?.[1] ?? '';
    const name = summary.split(':')[0]?.trim();
    out.set(email.toLowerCase(), name || email);
  }
  return out;
}

function nameFor(names: Map<string, string>, email: string): string {
  const known = names.get(email.toLowerCase());
  if (known) return known;
  return (email.split('@')[0] ?? email)
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// The cast, expanded
// ---------------------------------------------------------------------------

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** How many instances an RRULE asks for, and how many weeks apart they are.
 *  Weekly is the only frequency the cast uses, with or without an INTERVAL;
 *  anything else would need a real expander. */
function weeklySeries(recurrence: string[] | undefined): { count: number; weeks: number } {
  if (!recurrence?.length) return { count: 1, weeks: 1 };
  const rule = recurrence.join(';');
  if (!/FREQ=WEEKLY/i.test(rule)) {
    throw new Error(`only FREQ=WEEKLY is expanded here, got "${rule}"`);
  }
  const count = /COUNT=(\d+)/i.exec(rule)?.[1];
  if (!count) throw new Error(`a recurring cast meeting needs a COUNT, got "${rule}"`);
  const interval = /INTERVAL=(\d+)/i.exec(rule)?.[1];
  return { count: Number(count), weeks: interval ? Number(interval) : 1 };
}

function eventsFor(m: CastMeeting, names: Map<string, string>): FixtureEvent[] {
  const master = `qale-demo-${slugify(m.title)}`;
  const { count, weeks } = weeklySeries(m.recurrence);
  const out: FixtureEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    const date = shiftDate(m.date, i * weeks * 7);
    const start = {
      dateTime: withZoneOffset(`${date}T${m.time}:00`, DEFAULT_TIMEZONE),
      timeZone: DEFAULT_TIMEZONE,
    };
    const end = {
      dateTime: withZoneOffset(`${date}T${endTimeOf(m.time, m.durationMin)}:00`, DEFAULT_TIMEZONE),
      timeZone: DEFAULT_TIMEZONE,
    };
    const id = count > 1 ? `${master}-${i + 1}` : master;
    out.push({
      id,
      status: 'confirmed',
      htmlLink: `https://www.google.com/calendar/event?eid=${id}`,
      created: CREATED,
      updated: UPDATED,
      summary: m.title,
      description: m.description,
      organizer: { ...SELF },
      creator: { ...SELF },
      start,
      end,
      ...(count > 1 ? { recurringEventId: master, originalStartTime: start } : {}),
      attendees: [
        {
          email: SELF.email,
          displayName: SELF.displayName,
          organizer: true,
          responseStatus: 'accepted',
        },
        ...m.attendees.map((email): Attendee => ({
          email,
          displayName: nameFor(names, email),
          responseStatus: 'accepted',
        })),
      ],
      eventType: 'default',
      extendedProperties: { private: { qaleDemo: DEMO_TAG } },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------

function main(): void {
  const names = displayNames();
  const events = CAST_MEETINGS.flatMap((m) => eventsFor(m, names)).sort((a, b) =>
    a.start.dateTime.localeCompare(b.start.dateTime),
  );
  const fixture = {
    anchor: ANCHOR,
    timeZone: DEFAULT_TIMEZONE,
    self: SELF,
    calendars: [
      {
        id: SELF.email,
        summary: SELF.displayName,
        primary: true,
        accessRole: 'owner',
        timeZone: DEFAULT_TIMEZONE,
      },
    ],
    events,
  };
  mkdirSync(join(ROOT, 'demo'), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(
    `Wrote ${OUT}: ${events.length} event(s) on ${fixture.calendars.length} calendar, anchored ${ANCHOR}.`,
  );
}

main();
