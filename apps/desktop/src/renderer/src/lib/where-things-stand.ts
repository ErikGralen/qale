import type { NoteRefDTO, VaultTreeDTO } from '@qale/ipc';
import type { AttentionTarget } from './attention';
import { contentNotes } from './contexts';
import { localDateStr } from './dates';
import { dueLabel } from './due-date';
import { isUpcomingMeeting, meetingStart } from './note-status';
import { timeAgo } from './session-meta';

/**
 * "Where things stand": the strip Home shows when nothing is waiting on the PO
 * (docs/closing-beat.md).
 *
 * The waiting list going empty used to blank the middle of the page, so the one
 * moment the PO is free read as the app having nothing to say. This says where
 * the work stands instead: the next meeting, who owes them something, and the
 * theme that moved last.
 *
 * Every line is a fact the tree already holds, and no line is ever an ask. If a
 * sentence names something the PO should do, it belongs in the attention list
 * (lib/attention.ts), not here. The strip carries no count and never feeds a
 * badge: it renders only while `homeRows` is empty, so the two never collide.
 */

/** Which of the three facts a line is. The order here is the reading order. */
export type StandKind =
  /** The next meeting, however far ahead. */
  | 'meeting'
  /** Commitments somebody else owes. The PO's own count leaves these out. */
  | 'waiting'
  /** The theme that moved last, while the motion is still recent. */
  | 'theme';

export interface StandLine {
  id: string;
  kind: StandKind;
  /** The fact, in the PO's words. */
  label: string;
  /** The short when, on the right of the row. */
  meta: string;
  /** Where the line opens. Home maps this with the same switch the rows use. */
  target: AttentionTarget;
}

/** Past this, a theme's last edit is history rather than orientation. */
const THEME_FRESH_MS = 14 * 86_400_000;

/** Inside a week a weekday names the day; past it the day needs its date. */
const WEEK_MS = 7 * 86_400_000;

/** Real notes of one type. A folder's index file is furniture, not work. */
function notesOfType(tree: VaultTreeDTO | null, type: NoteRefDTO['type']): NoteRefDTO[] {
  return contentNotes(tree).filter((n) => n.type === type);
}

/** "Thursday 14:00", "8 Sep 09:30": the day a person would say, plus the clock
 *  when the meeting carries one. */
function meetingWhen(n: NoteRefDTO, now: number): string {
  const start = meetingStart(n);
  const day =
    start - now < WEEK_MS
      ? new Date(start).toLocaleDateString(undefined, { weekday: 'long' })
      : new Date(start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return n.time ? `${day} ${n.time}` : day;
}

/** The person a waiting-on todo names. The owner is stored as `[[people/…]]`
 *  or as a bare name, and the PO should never read either form raw. */
function ownerName(owner: string): string {
  const bare = owner.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0]!.trim();
  const leaf = bare.split('/').pop() ?? bare;
  // A slug is the fallback, so it reads as a name: "daniel-berg" → "Daniel Berg".
  return leaf.includes(' ')
    ? leaf
    : leaf
        .split('-')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

/** Dated commitments first, soonest first; undated ones last. */
function byDue(a: NoteRefDTO, b: NoteRefDTO): number {
  if (!a.due && !b.due) return 0;
  if (!a.due) return 1;
  if (!b.due) return -1;
  return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
}

/**
 * The strip, top to bottom. A line with nothing behind it does not render, and
 * all three empty gives an empty list, which Home draws as nothing at all.
 */
export function whereThingsStand(tree: VaultTreeDTO | null, now: number = Date.now()): StandLine[] {
  const lines: StandLine[] = [];

  // 1. The next meeting, however far ahead. A cancelled meeting never happens,
  //    so it is never next.
  const next = notesOfType(tree, 'meeting')
    .filter((n) => n.eventStatus !== 'cancelled' && isUpcomingMeeting(n, now))
    .sort((a, b) => meetingStart(a) - meetingStart(b))[0];
  if (next) {
    lines.push({
      id: `stand:meeting:${next.path}`,
      kind: 'meeting',
      label: next.title,
      meta: meetingWhen(next, now),
      target: { open: 'doc', path: next.path },
    });
  }

  // 2. What other people owe. These are deliberately outside the PO's own due
  //    count (attention.ts), because they are somebody else's move, which is
  //    exactly why the free moment is when they are worth knowing about.
  const waiting = notesOfType(tree, 'todo')
    .filter((n) => (n.lifecycle ?? 'open') === 'open' && !!n.owner)
    .sort(byDue);
  const soonest = waiting[0];
  if (soonest) {
    const people = new Set(waiting.map((n) => ownerName(n.owner!)));
    const name = ownerName(soonest.owner!);
    // One person is named outright: "Waiting on 1 person, next: Daniel" says the
    // same thing twice and counts to one.
    const label =
      people.size === 1 ? `Waiting on ${name}` : `Waiting on ${people.size} people, next: ${name}`;
    lines.push({
      id: 'stand:waiting',
      kind: 'waiting',
      label,
      meta: soonest.due ? `due ${dueLabel(soonest.due, localDateStr(new Date(now)))}` : 'no date',
      target: { open: 'todos' },
    });
  }

  // 3. The theme that moved last. Older than a fortnight it is history: knowing
  //    a theme changed in May orients nobody, so the line stays off the page.
  const theme = notesOfType(tree, 'theme').sort((a, b) => b.mtime - a.mtime)[0];
  if (theme && now - theme.mtime <= THEME_FRESH_MS) {
    lines.push({
      id: `stand:theme:${theme.path}`,
      kind: 'theme',
      label: theme.title,
      meta: `updated ${timeAgo(theme.mtime, now)}`,
      target: { open: 'doc', path: theme.path },
    });
  }

  return lines;
}
