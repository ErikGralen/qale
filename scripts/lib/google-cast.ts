/**
 * The Rota calendar cast: the week the demo opens on, in one place.
 * `scripts/seed-google-calendar.ts` pushes it to a live Google account, and
 * `scripts/build-demo-google-fixture.ts` bakes it into the offline fixture the
 * demo build's fake Google Calendar serves. Both must read the same source, or
 * the live demo and the offline demo drift apart.
 *
 * The file is plain data plus two pure helpers. It has no imports, so bare
 * `node scripts/*.ts` type stripping runs it as is.
 *
 * Dates are anchored on {@link ANCHOR} and slid by (today − anchor) at run
 * time: the seeder slides them as it writes, the fake slides them as it loads.
 * The 2026-07-16 steering is therefore always yesterday, and the rest of the
 * cast is always the week ahead.
 */

export const ANCHOR = '2026-07-17';

/** Where the cast lives. Wall-clock times below are local to this zone. */
export const DEFAULT_TIMEZONE = 'Europe/Stockholm';

/**
 * extendedProperties.private.qaleDemo: our own events, and only ours. The first
 * entry is what new events get stamped with; the rest are older scenarios the
 * seeder has written in the past, kept here so a reset still sweeps them up.
 */
export const DEMO_TAGS = ['rota', 'tavla'] as const;
export const DEMO_TAG = DEMO_TAGS[0];

export interface CastMeeting {
  title: string;
  /** ANCHOR-relative date (YYYY-MM-DD) of the (first) occurrence. */
  date: string;
  /** Local wall-clock start, "HH:MM". */
  time: string;
  durationMin: number;
  /** Invitee emails (the seeded account is the organizer, not listed here). */
  attendees: string[];
  description: string;
  /** RRULE bodies, e.g. "RRULE:FREQ=WEEKLY;COUNT=5" — omit for a one-off. */
  recurrence?: string[];
}

/**
 * The desired calendar state. Each meeting is anchored on ANCHOR. Attendee
 * emails match vault person notes so participant resolution links them.
 * `recurrence` (optional) uses the event's date as DTSTART; singleEvents
 * expansion on the app side gives every instance the same series.
 */
export const CAST_MEETINGS: CastMeeting[] = [
  {
    // The star. DTSTART is the Thursday before the anchor (2026-07-16, then
    // 07-23 and 07-30): the vault already ships the hand-authored 2026-07-09
    // instance, so a seeded one would be a near-duplicate. Past = vault,
    // yesterday + upcoming = calendar. The 07-16 instance is what the dropped
    // steering transcript matches against; before-meeting auto-prep reads 07-23.
    title: 'Steering',
    date: '2026-07-16',
    time: '10:00',
    durationMin: 45,
    attendees: ['asa.lindgren@rota.example', 'rebecca.holm@rota.example', 'marcus.ek@rota.example'],
    description:
      'Weekly steering. Standing items: H2 order, what we can promise customers, capacity.',
    recurrence: ['RRULE:FREQ=WEEKLY;COUNT=3'],
  },
  {
    // The upcoming Monday only. The 2026-07-13 instance, where the re-estimate
    // was asked for, is a hand-authored vault note already.
    title: '1:1 Rebecca',
    date: '2026-07-20',
    time: '09:30',
    durationMin: 30,
    attendees: ['rebecca.holm@rota.example'],
    description: 'Weekly 1:1 with the Scheduling tech lead. Estimates, on-call load, scope.',
  },
  {
    title: 'Café Nord QBR prep',
    date: '2026-07-21',
    time: '14:00',
    durationMin: 60,
    attendees: ['marcus.ek@rota.example', 'lena.strand@cafenord.example'],
    description:
      'Prep for the Café Nord quarterly business review: what we say about shift swaps and September.',
  },
  {
    title: "Bruno's CS sync",
    date: '2026-07-22',
    time: '11:00',
    durationMin: 30,
    attendees: ['ulrika.nystrom@rota.example', 'petra.alm@brunos.example'],
    description: "Monthly sync with Bruno's Burgers: open support themes and release timing.",
  },
  {
    title: 'Fjord Sports call',
    date: '2026-07-24',
    time: '13:00',
    durationMin: 30,
    attendees: ['oskar.lind@fjordsports.example', 'ulrika.nystrom@rota.example'],
    description: 'Fjord Sports: payroll export timeline against their Visma migration.',
  },
];

/** "10:00" + 45 → "10:45". Wall clock only; the zone never enters into it. */
export function endTimeOf(time: string, durationMin: number): string {
  const end = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + durationMin;
  return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}

/** How many whole days apart two `YYYY-MM-DD` dates are. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round(
    (Date.UTC(by ?? 0, (bm ?? 1) - 1, bd ?? 1) - Date.UTC(ay ?? 0, (am ?? 1) - 1, ad ?? 1)) /
      86_400_000,
  );
}

/** Slide one `YYYY-MM-DD` by whole days. */
export function shiftDate(iso: string, offset: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + offset);
  return dt.toISOString().slice(0, 10);
}

/**
 * The UTC offset a zone is on at one instant, in minutes.
 *
 * There is a second copy of this in
 * `apps/desktop/src/main/demo/fake-google-calendar.ts`, which cannot import
 * from `scripts/`. Both answer the same question: an event written at 10:00
 * Stockholm has to stay 10:00 Stockholm when it slides from July into November,
 * so the offset is computed for the day the event lands on, never carried.
 */
export function zoneOffsetMinutes(timeZone: string, utcMs: number): number {
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
export function withZoneOffset(local: string, timeZone: string): string {
  const guess = Date.parse(`${local}Z`);
  // Two passes: the first offset is read at the wrong instant on a DST day, the
  // second at the instant the first one corrects to.
  const first = zoneOffsetMinutes(timeZone, guess);
  const offset = zoneOffsetMinutes(timeZone, guess - first * 60_000);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
