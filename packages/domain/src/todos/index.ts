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
  /** Qale worked the commitment out from a source. See {@link isInferredTodo}. */
  inference?: boolean;
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
 * The mark on a todo Qale heard rather than was told (docs/fewer-approvals.md
 * FA-7).
 *
 * A todo lands without a card, so the ledger holds two kinds of promise: one the
 * PM made in the chat, and one Qale worked out of a transcript. The second can be
 * wrong, and the file says which it is until the PM answers by touching it.
 */
export function isInferredTodo(todo: TodoShape): boolean {
  return todo.inference === true;
}

/** What the mark reads as on a row. One string, so every surface says it once. */
export const INFERRED_TODO_MARK = 'Qale heard this';

/**
 * The same frontmatter with the mark taken off.
 *
 * The PM edited the todo, dated it, checked it or handed it to somebody, so the
 * question the mark asked is answered. Every write path the PM reaches goes
 * through this; the agent's own writes do not, so a proposal it applies leaves
 * the mark where it is.
 */
export function withoutInferenceMark<T extends Record<string, unknown>>(frontmatter: T): T {
  if (!('inference' in frontmatter)) return frontmatter;
  const next = { ...frontmatter };
  delete next['inference'];
  return next;
}

/**
 * The Activity row for a dropped todo that Qale had only heard.
 *
 * Dropping it deletes the file, so the row is the whole record of it, and it has
 * to say both halves: where Qale got it, and that the PM says it was never a
 * commitment. `source` is the title of the note the todo cited, when it cited
 * one the workspace still holds.
 */
export function droppedInferredTodoLine(input: { title: string; source?: string | null }): string {
  const where = input.source?.trim();
  return where
    ? `Removed ${input.title}. Qale had heard it in ${where} and you said it was not a commitment.`
    : `Removed ${input.title}. Qale had heard it and you said it was not a commitment.`;
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
