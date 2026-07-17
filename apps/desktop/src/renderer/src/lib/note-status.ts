import type { NoteRefDTO } from '@pm/ipc';
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

/** A meeting's start as a timestamp — its day plus clock time when both are set. */
export function meetingStart(n: NoteRefDTO): number {
  if (n.date) {
    const iso = n.time && !n.date.includes('T') ? `${n.date}T${n.time}` : n.date;
    const t = Date.parse(iso);
    if (!Number.isNaN(t)) return t;
  }
  return n.mtime;
}

/**
 * Upcoming is derived, never a status: the meeting's start is later than now.
 * A today-dated meeting without a clock time parses to midnight — already past,
 * which is right: that's the shape of a just-dropped transcript, not a plan.
 */
export function isUpcomingMeeting(n: NoteRefDTO): boolean {
  if (!n.date) return false;
  return meetingStart(n) > Date.now();
}

/** A meeting that happened and still awaits its After-Meeting review. */
export function needsReview(n: NoteRefDTO): boolean {
  return (n.status === 'new' || n.status === 'stale') && !isUpcomingMeeting(n);
}

/** A dumped source nobody has processed yet. */
export function isUnprocessedSource(n: NoteRefDTO): boolean {
  return n.status === 'new' || n.status === 'stale';
}

/** The meeting's time summary: clock time when it's today, else how long ago. */
export function meetingMeta(n: NoteRefDTO): string {
  const ts = meetingStart(n);
  const today = new Date(ts).toDateString() === new Date().toDateString();
  if (isUpcomingMeeting(n)) {
    if (today) return n.time ? `today ${n.time}` : 'today';
    const days = Math.ceil((ts - Date.now()) / 86_400_000);
    return days === 1 ? 'tomorrow' : `in ${days}d`;
  }
  return today && n.time ? `today ${n.time}` : timeAgo(ts);
}
