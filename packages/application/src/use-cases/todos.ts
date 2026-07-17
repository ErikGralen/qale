import {
  TODO_STATUSES,
  dirForType,
  fileSlug,
  isOverdueTodo,
  type Frontmatter,
  type Note,
  type TodoFrontmatter,
  type TodoStatus,
} from '@pm/domain';
import type { IndexedNote, UseCaseContext } from '../ports.js';

/**
 * Todos — the commitment ledger. One file per commitment, like decisions and
 * insights: it gets provenance (sources cite the meeting where it was said),
 * backlinks, git history, and the approval pipeline for free. Manual capture
 * writes directly (a capture is a user action); agent-extracted todos arrive
 * as note-proposal cards and only exist once approved.
 */

export interface CaptureTodoInput {
  title: string;
  /** Due date "YYYY-MM-DD". */
  due?: string;
  /** External commitment: who owes it — "[[people/…]]" ref or plain name. */
  owner?: string;
  /** Where the commitment comes from — a note ref like "[[meetings/…]]". */
  source?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function freePath(ctx: UseCaseContext, desired: string): Promise<string> {
  let path = desired;
  let n = 2;
  while (await ctx.vault.exists(path)) {
    path = desired.replace(/(\.[a-z0-9]+)$/i, `-${n}$1`);
    n++;
  }
  return path;
}

/** Quick-add a todo → todos/…md. */
export async function captureTodo(ctx: UseCaseContext, input: CaptureTodoInput): Promise<Note> {
  const title = input.title.trim();
  if (!title) throw new Error('todo needs a title');
  if (input.due && !DATE_RE.test(input.due)) throw new Error(`invalid due date: ${input.due}`);
  const date = ctx.clock.now().slice(0, 10);
  const summary = title.slice(0, 200);
  const path = await freePath(ctx, `${dirForType('todo')}/${fileSlug(summary, date)}.md`);
  const frontmatter: TodoFrontmatter = {
    type: 'todo',
    summary,
    // Explicit title — the slug-derived fallback would lose case and punctuation.
    title: summary,
    status: 'open',
    sources: input.source ? [input.source] : [],
    ...(input.due ? { due: input.due } : {}),
    ...(input.owner?.trim() ? { owner: input.owner.trim() } : {}),
  };
  const note = await ctx.vault.writeNote(path, frontmatter, '');
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `todo: ${summary}`);
  return note;
}

/** Flip a todo open/done/dropped — stamps `resolved` on close, clears on reopen. */
export async function setTodoStatus(
  ctx: UseCaseContext,
  path: string,
  status: TodoStatus,
): Promise<Note> {
  if (!TODO_STATUSES.includes(status)) throw new Error(`invalid todo status: ${status}`);
  const existing = await ctx.vault.readNote(path);
  if (!existing || existing.type !== 'todo') throw new Error(`not a todo: ${path}`);
  const frontmatter = { ...existing.frontmatter, status } as Record<string, unknown>;
  if (status === 'open') delete frontmatter['resolved'];
  else frontmatter['resolved'] = ctx.clock.now().slice(0, 10);
  const note = await ctx.vault.writeNote(path, frontmatter as Frontmatter, existing.body);
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `todo: ${note.slug} → ${status}`);
  return note;
}

export interface OverdueTodos {
  /** The PO's own open todos past their due date. */
  own: IndexedNote[];
  /** External commitments past due — worth a nudge, not a work session. */
  waiting: IndexedNote[];
}

/** Open todos past due, split mine/theirs — feeds the librarian ping sweep. */
export function getOverdueTodos(ctx: UseCaseContext, today: string): OverdueTodos {
  const own: IndexedNote[] = [];
  const waiting: IndexedNote[] = [];
  for (const n of ctx.index.listByType('todo')) {
    const fm = n.frontmatter;
    const shape = {
      status: typeof fm['status'] === 'string' ? fm['status'] : 'open',
      due: typeof fm['due'] === 'string' ? fm['due'] : null,
      owner: typeof fm['owner'] === 'string' ? fm['owner'] : null,
    };
    if (!isOverdueTodo(shape, today)) continue;
    (shape.owner ? waiting : own).push(n);
  }
  const due = (n: IndexedNote): string => String(n.frontmatter['due'] ?? '');
  own.sort((a, b) => due(a).localeCompare(due(b)));
  waiting.sort((a, b) => due(a).localeCompare(due(b)));
  return { own, waiting };
}
