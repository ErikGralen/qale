/**
 * How a folder browse page orders its rows, and what the State column means.
 *
 * It is here rather than in the page because none of it needs a screen: a
 * comparator over note refs, and the one table that says which colour a
 * workflow state wears. That makes the flight order testable, which matters,
 * because "Blocked before Done" is a fact about a board and not about the
 * alphabet.
 */
import type { NoteRefDTO, StateCategory } from '@qale/ipc';
import { refDate } from './contexts';
import { byName, type ListSortDir } from './list-sort';

/** The columns a folder page can sort by. A shelf has Name and Date; a mirror
 *  has Name, State and Updated. No page has all four. */
export type FolderSortKey = 'name' | 'date' | 'state' | 'updated';

export interface FolderSort {
  key: FolderSortKey;
  dir: ListSortDir;
}

export const SHELF_KEYS: readonly FolderSortKey[] = ['name', 'date'];
export const MIRROR_KEYS: readonly FolderSortKey[] = ['name', 'state', 'updated'];

/**
 * The tones the ticket board colours its columns with (see `TicketBoard`).
 * One fact wears one colour whether it is a card or a row, so a scan of the
 * list and a scan of the board answer "what is blocked" the same way.
 */
export const STATE_TONE: Record<StateCategory, string> = {
  open: 'text-muted-foreground',
  in_progress: 'text-brand',
  blocked: 'text-warning',
  done: 'text-success',
};

/** Flight order, the board's own left to right. Sorting by State follows this
 *  and never the alphabet. A row whose state maps to no category ranks past
 *  `done`. */
export const FLIGHT: readonly StateCategory[] = ['open', 'in_progress', 'blocked', 'done'];

export function stateRank(n: NoteRefDTO): number {
  const i = FLIGHT.indexOf(n.stateCategory as StateCategory);
  return i === -1 ? FLIGHT.length : i;
}

/** When the mirror last changed upstream, or when the copy last did: the same
 *  value the board prints. `remoteUpdated` is ISO text and `mtime` is a number,
 *  so both become one number before anything compares them. */
export function updatedMs(n: NoteRefDTO): number {
  if (n.remoteUpdated) {
    const t = Date.parse(n.remoteUpdated);
    if (!Number.isNaN(t)) return t;
  }
  return n.mtime;
}

/** The rows in the order the rail asks for. The name breaks every tie, so the
 *  same list renders the same way twice. */
export function sortNotes(rows: NoteRefDTO[], sort: FolderSort): NoteRefDTO[] {
  const flip = sort.dir === 'asc' ? 1 : -1;
  const compare = (a: NoteRefDTO, b: NoteRefDTO): number => {
    if (sort.key === 'name') return byName(a.title, b.title);
    if (sort.key === 'state') return stateRank(a) - stateRank(b);
    if (sort.key === 'updated') return updatedMs(a) - updatedMs(b);
    return refDate(a).getTime() - refDate(b).getTime();
  };
  return [...rows].sort((a, b) => flip * compare(a, b) || byName(a.title, b.title));
}
