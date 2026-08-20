/**
 * When a calendar card lands, in the words a person uses: "Mon 10 Aug",
 * "14:00–14:30", "30 min".
 *
 * Read off the literal RFC3339 string rather than through a Date, because the
 * offset in the payload IS the intended local time — parsing it would re-render
 * the hour in the app's zone and show a time nobody approved. The one thing that
 * needs a real instant is "has this already gone by", and that is built from the
 * same literal fields so the two can never disagree.
 *
 * Kept in the domain because the head of the card and the effect line both say
 * it, and a calendar card that reads two different times in two places is worse
 * than one that says nothing.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?)?/;

export interface EventStamp {
  year: number;
  month: number;
  day: number;
  /** Absent for a bare date — an all-day event. */
  hour?: number;
  minute?: number;
  /** The written offset, when the string carries one. */
  zone?: string;
}

/** The literal fields of an RFC3339 stamp, or undefined when it isn't one. */
export function parseEventStamp(iso: string | undefined): EventStamp | undefined {
  const m = STAMP_RE.exec((iso ?? '').trim());
  if (!m) return undefined;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!month || month > 12 || !day || day > 31) return undefined;
  return m[4] !== undefined
    ? { year, month, day, hour: Number(m[4]), minute: Number(m[5]), zone: m[6] }
    : { year, month, day };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** "4 Aug" / "4 Aug, 15:00" — the short form the effect sentence uses. */
export function formatStamp(s: EventStamp): string {
  const month = MONTHS[s.month - 1]!;
  return s.hour === undefined
    ? `${s.day} ${month}`
    : `${s.day} ${month}, ${pad(s.hour)}:${pad(s.minute ?? 0)}`;
}

/** The clock in the payload's own zone — never re-rendered in the app's. */
const clock = (s: EventStamp): string => `${pad(s.hour ?? 0)}:${pad(s.minute ?? 0)}`;

/** Weekday from the literal date. UTC arithmetic, so no zone can shift the day. */
function weekday(s: EventStamp): string {
  return WEEKDAYS[new Date(Date.UTC(s.year, s.month - 1, s.day)).getUTCDay()]!;
}

/** Minutes between two literal stamps, ignoring the offsets (a drafted event
 *  writes both ends in one zone). Undefined when either end has no clock. */
function spanMinutes(a: EventStamp, b: EventStamp): number | undefined {
  if (a.hour === undefined || b.hour === undefined) return undefined;
  const at = Date.UTC(a.year, a.month - 1, a.day, a.hour, a.minute ?? 0);
  const bt = Date.UTC(b.year, b.month - 1, b.day, b.hour, b.minute ?? 0);
  const minutes = Math.round((bt - at) / 60_000);
  return minutes > 0 ? minutes : undefined;
}

/** "45 min", "1 hour", "1 hour 30 min", "2 days 3 hours" — at most two parts. */
export function formatLength(minutes: number): string {
  const parts: string[] = [];
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (mins && parts.length < 2) parts.push(`${mins} min`);
  return parts.slice(0, 2).join(' ');
}

/** The instant a start falls on, for the past check only. An all-day event is
 *  past once its day is over, not at midnight. */
function instantOf(s: EventStamp, iso: string): number {
  if (s.hour === undefined) return new Date(s.year, s.month - 1, s.day, 23, 59).getTime();
  // A written offset means the instant is unambiguous; without one the stamp is
  // local wall-clock time, which is exactly how a Date built from parts reads.
  if (s.zone) {
    const parsed = Date.parse(iso.trim());
    if (!Number.isNaN(parsed)) return parsed;
  }
  return new Date(s.year, s.month - 1, s.day, s.hour, s.minute ?? 0).getTime();
}

export interface EventWhen {
  /** "Mon 10 Aug", with the year when it isn't the current one. */
  day: string;
  /** "14:00–14:30", or the start alone when the end is unknown or on another
   *  day. Absent for an all-day event. */
  time?: string;
  /** "30 min" — absent when nothing in the payload says how long it runs. */
  length?: string;
  /** The length is the connector's 30-minute default, not the draft's own. */
  assumedLength: boolean;
  /** A bare date: no clock time at all. */
  allDay: boolean;
  /** The start has already gone by. The classic drafting miss, so it is said. */
  past: boolean;
}

/**
 * The one-line answer to "when is this?", or undefined when the payload has no
 * readable start (an RSVP, or a rescheduling card that only renames). A missing
 * fact always shortens the line; nothing here is guessed.
 */
export function describeEventWhen(
  start: string | undefined,
  end: string | undefined,
  now: number = Date.now(),
): EventWhen | undefined {
  const s = parseEventStamp(start);
  if (!s) return undefined;
  const e = parseEventStamp(end);
  const allDay = s.hour === undefined;

  const thisYear = new Date(now).getFullYear();
  const day = `${weekday(s)} ${s.day} ${MONTHS[s.month - 1]}${s.year === thisYear ? '' : ` ${s.year}`}`;

  const sameDay = !!e && e.year === s.year && e.month === s.month && e.day === s.day;
  const span = e ? spanMinutes(s, e) : undefined;

  // No end on a timed event is not "unknown": the connector creates 30 minutes.
  // Say so, and mark it as the default rather than as something anyone drafted.
  // An end that IS written but unreadable gets no length at all — the connector
  // will send it as written, so 30 minutes would be a made-up number.
  const assumedLength = !allDay && !end?.trim();
  const minutes = assumedLength ? 30 : span;

  return {
    day,
    time: allDay
      ? undefined
      : sameDay && span !== undefined
        ? `${clock(s)}–${clock(e!)}`
        : clock(s),
    length: allDay ? undefined : minutes !== undefined ? formatLength(minutes) : undefined,
    assumedLength,
    allDay,
    past: instantOf(s, start!) < now,
  };
}

/** An RSVP as the PO says it, not as the API spells it. */
export function rsvpAnswer(status: string | undefined): string {
  return status === 'declined' ? 'no' : status === 'tentative' ? 'maybe' : 'yes';
}
