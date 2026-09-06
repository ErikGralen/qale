import type { BacklinkDTO, NoteRefDTO } from '@qale/ipc';
import { isLiveMeeting, isUpcomingMeeting, meetingStart, needsReview } from './note-status';

/**
 * How a meeting reads (E-12).
 *
 * A meeting page used to be a note page with meeting frontmatter, so the five
 * questions a person has about a meeting (when, who, what was decided, what
 * people promised, what is still open) were answered by scrolling a body and a
 * properties block. These derivations answer them from what the vault already
 * holds: the note's own dates for the first two, its inbound links for the rest.
 *
 * Nothing here counts, scores or nags. A meeting says what state it is in, and
 * the only amber word is the one the memory already uses for a meeting that
 * happened and was never filed.
 */

/** How loud a standing is allowed to be. Amber only means "not filed yet". */
export type MeetingTone = 'brand' | 'warning' | 'muted';

export interface MeetingStanding {
  /** The state, in the words the app uses everywhere else. */
  text: string;
  tone: MeetingTone;
}

/**
 * Where the meeting stands right now, or null when it has nothing to add.
 *
 * A past meeting only says "Filed" when its own `processing` says so. Silence
 * beats a guess: a meeting the app never gave a lifecycle to has not been read,
 * and claiming otherwise would be the app telling the PO their work is done.
 */
export function meetingStanding(n: NoteRefDTO, now: number = Date.now()): MeetingStanding | null {
  if (n.eventStatus === 'cancelled') return { text: 'Cancelled', tone: 'muted' };
  if (isLiveMeeting(n, now)) return { text: 'Happening now', tone: 'brand' };
  if (isUpcomingMeeting(n, now)) return null;
  // An empty meeting is asked about before it is flagged. There is nothing to
  // file, so the amber word would be the app blaming the PO for its own note.
  if (n.captured === false) return { text: 'Nothing in it yet', tone: 'muted' };
  if (needsReview(n, now)) return { text: 'Not filed yet', tone: 'warning' };
  if (n.lifecycle === 'processed') return { text: 'Filed', tone: 'muted' };
  return null;
}

/** The two halves of the calendar: what is coming, and what happened. */
export interface CalendarSections {
  /** Ahead of the PO, soonest first. A meeting in progress leads it. */
  coming: NoteRefDTO[];
  /** Behind them, most recent first. */
  happened: NoteRefDTO[];
}

/** Split a set of meetings by the clock. A cancelled meeting keeps its place:
 *  it is still what the week looked like, and it says so on its own row. */
export function calendarSections(
  meetings: readonly NoteRefDTO[],
  now: number = Date.now(),
): CalendarSections {
  const coming: NoteRefDTO[] = [];
  const happened: NoteRefDTO[] = [];
  for (const n of meetings) {
    if (isLiveMeeting(n, now) || isUpcomingMeeting(n, now)) coming.push(n);
    else happened.push(n);
  }
  coming.sort((a, b) => meetingStart(a) - meetingStart(b));
  happened.sort((a, b) => meetingStart(b) - meetingStart(a));
  return { coming, happened };
}

/** What came out of a meeting, by the kind of thing it is. */
export interface MeetingOutcome {
  /** Decisions that cite this meeting. */
  decided: NoteRefDTO[];
  /** Commitments that came out of it, still-open ones first. */
  promised: NoteRefDTO[];
  /** Insights holding it as evidence. */
  learned: NoteRefDTO[];
  /** Everything else that points here: a customer page, a research page, a note. */
  linked: NoteRefDTO[];
}

/** A session's `reads`/`writes` edges. A run that opened the page is the run's
 *  business, not the meeting's, so the panel never lists them. */
const SESSION_EDGES: ReadonlySet<string> = new Set(['reads', 'writes']);

/** A commitment nobody has closed. */
const isOpenTodo = (n: NoteRefDTO): boolean => (n.lifecycle ?? 'open') === 'open';

/**
 * Read the meeting's inbound links as its outcome. One row per note: a decision
 * that both cites the meeting and mentions it in prose arrives twice.
 */
export function meetingOutcome(backlinks: readonly BacklinkDTO[]): MeetingOutcome {
  const out: MeetingOutcome = { decided: [], promised: [], learned: [], linked: [] };
  const seen = new Set<string>();
  for (const b of backlinks) {
    if (b.type !== undefined && SESSION_EDGES.has(b.type)) continue;
    if (b.from.type === 'session') continue;
    if (seen.has(b.from.path)) continue;
    seen.add(b.from.path);
    if (b.from.type === 'decision') out.decided.push(b.from);
    else if (b.from.type === 'todo') out.promised.push(b.from);
    else if (b.from.type === 'insight') out.learned.push(b.from);
    else out.linked.push(b.from);
  }
  // Still open first: that is the half of the list the PO can still act on.
  out.promised.sort((a, b) => Number(isOpenTodo(b)) - Number(isOpenTodo(a)));
  return out;
}

/** What a commitment out of this meeting is waiting on, in a few words. */
export function promiseState(n: NoteRefDTO): string {
  const commitment = n.lifecycle ?? 'open';
  if (commitment === 'done') return 'done';
  if (commitment === 'dropped') return 'dropped';
  return n.owner ? 'waiting on them' : 'still open';
}

/** How long the meeting runs, as a person would say it. */
export function durationText(minutes: number | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourText = hours === 1 ? '1 hour' : `${hours} hours`;
  return rest ? `${hourText} ${rest} min` : hourText;
}
