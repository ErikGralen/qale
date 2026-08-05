import type { NoteRefDTO } from '@qale/ipc';
import { timeAgo } from './session-meta';

/** When a note was last relevant: its frontmatter date, falling back to mtime. */
export function whenOf(n: NoteRefDTO): number {
  if (n.date) {
    const t = Date.parse(n.date);
    if (!Number.isNaN(t)) return t;
  }
  return n.mtime;
}

export const byRecent = (a: NoteRefDTO, b: NoteRefDTO): number => whenOf(b) - whenOf(a);

/** A meeting's start as a timestamp — its day plus clock time when both are set.
 *  Bare dates are parsed as *local* midnight (Date.parse treats them as UTC,
 *  which would shift meetings across midnight — MeetingWeek parses local too). */
export function meetingStart(n: NoteRefDTO): number {
  if (n.date) {
    if (!n.date.includes('T')) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(n.date);
      const t = n.time ? /^(\d{1,2}):(\d{2})/.exec(n.time) : null;
      if (m) {
        return new Date(
          Number(m[1]),
          Number(m[2]) - 1,
          Number(m[3]),
          t ? Number(t[1]) : 0,
          t ? Number(t[2]) : 0,
        ).getTime();
      }
    }
    const t = Date.parse(n.date);
    if (!Number.isNaN(t)) return t;
  }
  return n.mtime;
}

/**
 * Upcoming is derived, never part of the lifecycle: the meeting's start is later than now.
 * A today-dated meeting without a clock time parses to midnight — already past,
 * which is right: that's the shape of a just-dropped transcript, not a plan.
 *
 * `now` is injectable so a derivation can rank a whole list against one clock.
 * Never hand this straight to `Array.filter` — it would read the index as the
 * clock. Write `(n) => isUpcomingMeeting(n)`.
 */
export function isUpcomingMeeting(n: NoteRefDTO, now: number = Date.now()): boolean {
  if (!n.date) return false;
  return meetingStart(n) > now;
}

/** A meeting that happened and has not been read yet. A cancelled meeting
 *  never happened, so it never asks to be read.
 *  Same `Array.filter` caveat as `isUpcomingMeeting`. */
export function needsReview(n: NoteRefDTO, now: number = Date.now()): boolean {
  if (n.eventStatus === 'cancelled') return false;
  return (n.lifecycle === 'new' || n.lifecycle === 'stale') && !isUpcomingMeeting(n, now);
}

/** A dumped source nobody has processed yet. */
export function isUnprocessedSource(n: NoteRefDTO): boolean {
  return n.lifecycle === 'new' || n.lifecycle === 'stale';
}

const DAY_MS = 86_400_000;

/** Local midnight starting the day that contains `ts`. */
function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Whether the meeting carries a clock time at all (vs. a bare, all-day date). */
function hasClock(n: NoteRefDTO): boolean {
  return Boolean(n.time) || Boolean(n.date?.includes('T'));
}

/** How long a meeting runs when nothing says otherwise. */
const DEFAULT_MEETING_MIN = 60;

/**
 * When the meeting was over: its start plus its length. An all-day entry has no
 * clock to add minutes to, so it ends when its day does — otherwise a bare date
 * would read as "finished an hour after midnight" and anything waiting on the
 * end would fire in the small hours of the morning it happens.
 */
export function meetingEnd(n: NoteRefDTO): number {
  const start = meetingStart(n);
  if (!hasClock(n)) return startOfDay(start) + DAY_MS;
  return start + (n.durationMin ?? DEFAULT_MEETING_MIN) * 60_000;
}

/** The quiet hour after a meeting: still in the room, still walking back to the
 *  desk. Asking here would be nagging. */
export const CAPTURE_GRACE_MS = 3_600_000;
/** After this, a meeting nobody captured is a lost cause and the ask expires
 *  on its own instead of accumulating (docs/capture-nudge.md). */
export const CAPTURE_WINDOW_MS = 4 * DAY_MS;

/**
 * A meeting the app knows happened and that nobody put anything into: no
 * transcript, no typed line. Calendar-synced only — a mirror is the one note
 * that exists whether or not the PO ever meant to write one, so its emptiness
 * is the app's own doing and worth a word. A note somebody made by hand is
 * empty because they left it that way.
 *
 * Same `Array.filter` caveat as `isUpcomingMeeting`: pass a clock.
 */
export function needsCapture(n: NoteRefDTO, now: number = Date.now()): boolean {
  if (n.type !== 'meeting' || !n.synced || !n.date) return false;
  if (n.eventStatus === 'cancelled' || n.captured) return false;
  const since = now - meetingEnd(n);
  return since >= CAPTURE_GRACE_MS && since < CAPTURE_WINDOW_MS;
}

/** From this local hour on, tomorrow's first meetings join today's on the rail —
 *  by mid-afternoon "what's next" is tomorrow morning, not the rest of today. */
export const LOOKAHEAD_HOUR = 15;
/** How wide "the first meetings tomorrow" reaches: the earliest start, plus this. */
export const CLUSTER_MS = 2 * 60 * 60 * 1000;

/**
 * The meetings the rail should reach for *by the clock*: everything dated today,
 * plus — once it's `LOOKAHEAD_HOUR` — tomorrow's opening cluster (its earliest
 * timed meeting and anything starting within `CLUSTER_MS` of it, plus any all-day
 * entry). Deliberately narrow: a meeting three weeks out is calendar material, and
 * pinning it now would leave it sitting on the rail for three weeks — the rail
 * never auto-removes, so what it reaches for has to already be worth keeping.
 * Cancelled events are skipped; they need nothing from the PO. A day holding no
 * meetings at all opens the next day that does, whatever the hour — the narrow
 * horizon is there to stop the rail hoarding the calendar, not to leave it blank.
 *
 * Returns the qualifying paths, because "the first meetings tomorrow" is a fact
 * about the day's set, not about any one note.
 */
export function meetingRailHorizon(
  notes: readonly NoteRefDTO[],
  now: number = Date.now(),
): Set<string> {
  const today = startOfDay(now);
  const tomorrow = today + DAY_MS;
  const live = notes.filter((n) => n.type === 'meeting' && n.date && n.eventStatus !== 'cancelled');
  const paths = new Set<string>();
  for (const n of live) {
    const start = meetingStart(n);
    if (start >= today && start < tomorrow) paths.add(n.path);
  }
  if (paths.size > 0 && new Date(now).getHours() < LOOKAHEAD_HOUR) return paths;

  // Mid-afternoon, the rail turns to tomorrow's opening cluster. A day with no
  // meetings at all turns there too, whatever the hour, and keeps reaching until it
  // finds something: an empty Meetings section is worse than one row that is
  // genuinely the PO's next meeting. Self-limiting — every quiet day reaches for the
  // same cluster, and the auto-pinner adds each path only once.
  const ahead = live
    .filter((n) => meetingStart(n) >= tomorrow)
    .sort((a, b) => meetingStart(a) - meetingStart(b));
  // Which day to open: tomorrow, or — when today held nothing — the next day that
  // actually has meetings, however far out that is.
  const day = paths.size > 0 ? tomorrow : ahead.length ? startOfDay(meetingStart(ahead[0]!)) : null;
  if (day === null) return paths;
  const next = ahead.filter((n) => meetingStart(n) < day + DAY_MS);
  const earliest = next.filter(hasClock).reduce<number | null>((min, n) => {
    const start = meetingStart(n);
    return min === null || start < min ? start : min;
  }, null);
  for (const n of next)
    if (!hasClock(n) || (earliest !== null && meetingStart(n) <= earliest + CLUSTER_MS))
      paths.add(n.path);
  return paths;
}

/**
 * Whether the system should auto-pin a note onto the rail — the conservative,
 * time-sensitive slice of each working type. The auto-pinner only ever ADDS, and
 * only once per note, so this is "has it just become live?", not "is it relevant
 * forever". Decisions, plain notes, and the reference shelves (customers,
 * insights, people…) are deliberately excluded — those are pinned by hand.
 *
 * `meetingHorizon` comes from `meetingRailHorizon` over the same note set: which
 * meetings are near enough in time to belong on the rail *now*.
 */
export function qualifiesForRail(
  n: NoteRefDTO,
  openThemes: ReadonlySet<string>,
  meetingHorizon: ReadonlySet<string>,
): boolean {
  switch (n.type) {
    case 'meeting':
      return meetingHorizon.has(n.path) || needsReview(n);
    case 'ticket':
      return n.stateCategory != null && n.stateCategory !== 'done';
    case 'theme':
      return openThemes.has(n.path);
    case 'source':
      return isUnprocessedSource(n);
    default:
      return false;
  }
}

/** The meeting's time summary: clock time when it's today, else how long ago.
 *  Older than a week compacts to "Jul 17" — the locale's full numeric date is
 *  the loudest thing in a sidebar column and says no more than month + day. */
export function meetingMeta(n: NoteRefDTO): string {
  const ts = meetingStart(n);
  const then = new Date(ts);
  const now = new Date();
  const today = then.toDateString() === now.toDateString();
  if (isUpcomingMeeting(n)) {
    if (today) return n.time ? `today ${n.time}` : 'today';
    const days = Math.ceil((ts - Date.now()) / 86_400_000);
    return days === 1 ? 'tomorrow' : `in ${days}d`;
  }
  if (today) return n.time ? `today ${n.time}` : timeAgo(ts);
  if (Date.now() - ts < 7 * 86_400_000) return timeAgo(ts);
  return then.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(then.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}
