import type { TodoCommitment } from '../notes/lifecycle.js';

/**
 * Todo lanes — how the commitment ledger reads at a glance. Buckets are pure
 * functions of (commitment, due, owner) against "today" so the UI, the librarian
 * sweep and tests all agree on what "overdue" means:
 * - external commitments (owner set) live in `waiting`, whatever their date —
 *   they are watched, not worked;
 * - the PO's own open todos split by due date; undated ones park in `someday`;
 * - closed todos (done/dropped) fall to `closed` and stay on the ledger.
 */
export type TodoLane = 'overdue' | 'today' | 'upcoming' | 'someday' | 'waiting' | 'closed';

export interface TodoShape {
  commitment?: TodoCommitment | string;
  due?: string | null;
  owner?: string | null;
}

/** External = someone else committed; the PO tracks it but doesn't work it. */
export function isExternalTodo(todo: TodoShape): boolean {
  return typeof todo.owner === 'string' && todo.owner.trim().length > 0;
}

export function todoLane(todo: TodoShape, today: string): TodoLane {
  const commitment = todo.commitment ?? 'open';
  if (commitment !== 'open') return 'closed';
  if (isExternalTodo(todo)) return 'waiting';
  if (!todo.due) return 'someday';
  if (todo.due < today) return 'overdue';
  if (todo.due === today) return 'today';
  return 'upcoming';
}

/** An open commitment past its date — the PO's own or one being waited on. */
export function isOverdueTodo(todo: TodoShape, today: string): boolean {
  return (todo.commitment ?? 'open') === 'open' && !!todo.due && todo.due < today;
}

/**
 * The day a todo was written down, read off its file name — every writer stamps
 * the date there (`todos/2026-08-28-email-asa.md`). It is not the day the
 * promise was made: a commitment cited from a meeting was promised on the
 * meeting's date, and that is the date to show when there is a source. A file
 * somebody renamed by hand loses the stamp, so this returns null instead of
 * guessing.
 */
export function todoAddedOn(pathOrSlug: string): string | null {
  const name = pathOrSlug.split('/').pop() ?? pathOrSlug;
  const m = /^(\d{4})-(\d{2})-(\d{2})-/.exec(name);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * Sort comparator within a lane: dated before undated, earlier due first,
 * ties broken by the caller (usually recency).
 */
export function byDue(a: TodoShape, b: TodoShape): number {
  if (a.due && b.due) return a.due.localeCompare(b.due);
  if (a.due) return -1;
  if (b.due) return 1;
  return 0;
}
