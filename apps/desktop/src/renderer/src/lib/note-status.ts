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

/** A meeting's start from the two fields that place it, or null if neither does.
 *  Bare dates are parsed as *local* midnight (Date.parse treats them as UTC,
 *  which would shift meetings across midnight — MeetingWeek parses local too). */
function parseStart(
  date: string | null | undefined,
  time: string | null | undefined,
): number | null {
  if (!date) return null;
  if (!date.includes('T')) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    const t = time ? /^(\d{1,2}):(\d{2})/.exec(time) : null;
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
  const parsed = Date.parse(date);
  return Number.isNaN(parsed) ? null : parsed;
}

/** A meeting's start as a timestamp — its day plus clock time when both are set.
 *  A note the calendar never dated falls back to its mtime. */
export function meetingStart(n: NoteRefDTO): number {
  return parseStart(n.date, n.time) ?? n.mtime;
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
function endOf(start: number, clock: boolean, durationMin?: number): number {
  if (!clock) return startOfDay(start) + DAY_MS;
  return start + (durationMin ?? DEFAULT_MEETING_MIN) * 60_000;
}

/** See {@link endOf}. */
export function meetingEnd(n: NoteRefDTO): number {
  return endOf(meetingStart(n), hasClock(n), n.durationMin);
}

/** When a meeting runs, as two timestamps. Null when it has no date to sit on. */
export interface MeetingWindow {
  start: number;
  end: number;
  /** Whether the entry carries a clock time at all. An all-day one does not. */
  clock: boolean;
}

/**
 * The window from the three fields that describe it.
 *
 * The lists read a `NoteRefDTO` and the note page reads frontmatter. The page
 * used to work out its own start with `Date.parse`, the UTC read the parser
 * above exists to avoid. One parser, so the page and the lists never disagree
 * about whether the meeting has begun.
 */
export function meetingWindow(
  date: string | null | undefined,
  time: string | null | undefined,
  durationMin?: number | null,
): MeetingWindow | null {
  const start = parseStart(date, time);
  if (start === null) return null;
  const clock = Boolean(time) || Boolean(date?.includes('T'));
  return { start, end: endOf(start, clock, durationMin ?? undefined), clock };
}

/** The same window off a note page's frontmatter, where the fields are `date`,
 *  `time` and `duration_minutes`. */
export function meetingWindowOf(frontmatter: Record<string, unknown>): MeetingWindow | null {
  const str = (key: string): string | null => {
    const value = frontmatter[key];
    return typeof value === 'string' ? value : null;
  };
  const minutes = frontmatter['duration_minutes'];
  return meetingWindow(str('date'), str('time'), typeof minutes === 'number' ? minutes : null);
}

/**
 * The rule itself: the meeting has started and it has not ended. Exported so
 * the note page states it once too, from its own frontmatter window.
 *
 * An all-day entry is never live. It runs from midnight to midnight, so an
 * offsite, a holiday or a block of leave would read as a call in progress for
 * the whole day and take the row from the 14:00 meeting under it.
 */
export function isLiveWindow(w: MeetingWindow, now: number = Date.now()): boolean {
  return w.clock && w.start <= now && w.end > now;
}

/**
 * The meeting is running right now. A meeting with no date is never live: its
 * start would fall back to mtime, and a note saved this morning would read as a
 * call in progress.
 *
 * Same `Array.filter` caveat as `isUpcomingMeeting`: pass a clock.
 */
export function isLiveMeeting(n: NoteRefDTO, now: number = Date.now()): boolean {
  const running = meetingWindow(n.date, n.time, n.durationMin);
  return running !== null && isLiveWindow(running, now);
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

/**
 * A meeting that has happened, holds content, and has not been read into
 * proposals yet.
 *
 * The content is a transcript or a body somebody typed. This used to need a
 * transcript, so a meeting the PO wrote up by hand had no door into a run and
 * the notes never became anything (docs/live-notes.md, LN-3).
 *
 * `processing` is the meeting's own value. Once the page is filed, by a run or
 * by hand, the door closes: the button and the "Mark as filed" item are the two
 * halves of one state and must agree.
 */
export function isUnreadMeeting(m: {
  /** The meeting is over, and it was not cancelled. */
  past: boolean;
  /** The meeting's `processing` frontmatter value, whatever shape it is in. */
  processing: unknown;
  /** How many transcripts the page links. */
  transcripts: number;
  /** The page's own body. */
  body: string;
}): boolean {
  if (!m.past || m.processing === 'processed') return false;
  return m.transcripts > 0 || m.body.trim().length > 0;
}

/**
 * Types that keep a first-class home of their own: todos have the Todos page,
 * skills and agents the Skills page, sessions their own rail section, meetings
 * the Calendar. Working in one never pins it — the rail would only say a second
 * time what those already say, and the row could not be reached from the
 * section that owns it.
 *
 * Calendar is a meeting's home, so a meeting never holds a rail row. Calendar
 * shows what is coming and Home shows today (docs/sidebar-ia.md, SB-1).
 */
const UNPINNABLE: ReadonlySet<string> = new Set([
  'todo',
  'skill',
  'agent',
  'session',
  'meeting',
]);

/** Whether the rail may hold this type at all. See {@link UNPINNABLE}. */
export function isPinnable(type: string): boolean {
  return !UNPINNABLE.has(type);
}

/**
 * Whether the system may put a note on the rail by itself. One thing qualifies:
 * a source the PO handed over that nobody has read yet. Handing a file to the app
 * is an act, and the row is the app answering it.
 *
 * Nothing else auto-pins. The rail holds what the PO made, approved, or wrote in,
 * and it loses a row only to their own hand (docs/autopinning.md). A rule that
 * reached for today's meetings or every open ticket added rows on the clock's say
 * so, and since nothing is ever removed for them, the rail filled with a calendar
 * instead of a working set.
 */
export function qualifiesForRail(n: NoteRefDTO): boolean {
  return n.type === 'source' && isUnprocessedSource(n);
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
