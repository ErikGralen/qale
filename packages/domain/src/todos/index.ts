import type { TodoStatus } from '../notes/frontmatter.js';

/**
 * Todo lanes — how the commitment ledger reads at a glance. Buckets are pure
 * functions of (status, due, owner) against "today" so the UI, the librarian
 * sweep and tests all agree on what "overdue" means:
 * - external commitments (owner set) live in `waiting`, whatever their date —
 *   they are watched, not worked;
 * - the PO's own open todos split by due date; undated ones park in `someday`;
 * - closed todos (done/dropped) fall to `closed` and stay on the ledger.
 */
export type TodoLane = 'overdue' | 'today' | 'upcoming' | 'someday' | 'waiting' | 'closed';

export interface TodoShape {
  status?: TodoStatus | string;
  due?: string | null;
  owner?: string | null;
}

/** External = someone else committed; the PO tracks it but doesn't work it. */
export function isExternalTodo(todo: TodoShape): boolean {
  return typeof todo.owner === 'string' && todo.owner.trim().length > 0;
}

export function todoLane(todo: TodoShape, today: string): TodoLane {
  const status = todo.status ?? 'open';
  if (status !== 'open') return 'closed';
  if (isExternalTodo(todo)) return 'waiting';
  if (!todo.due) return 'someday';
  if (todo.due < today) return 'overdue';
  if (todo.due === today) return 'today';
  return 'upcoming';
}

/** An open commitment past its date — the PO's own or one being waited on. */
export function isOverdueTodo(todo: TodoShape, today: string): boolean {
  return (todo.status ?? 'open') === 'open' && !!todo.due && todo.due < today;
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
