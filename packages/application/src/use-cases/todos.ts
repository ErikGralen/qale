import {
  TODO_COMMITMENTS,
  bareRef,
  dirForType,
  droppedInferredTodoLine,
  fileSlug,
  isInferredTodo,
  titleForRef,
  withoutInferenceMark,
  type Frontmatter,
  type Note,
  type TodoCommitment,
  type TodoFrontmatter,
  type TodoShape,
} from '@qale/domain';
import type { UseCaseContext } from '../ports.js';
import { deleteNote } from './notes.js';
import { recordActivityRow } from './proposals.js';

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
    commitment: 'open',
    sources: input.source ? [input.source] : [],
    ...(input.due ? { due: input.due } : {}),
    ...(input.owner?.trim() ? { owner: input.owner.trim() } : {}),
  };
  const note = await ctx.vault.writeNote(path, frontmatter, '');
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `todo: ${summary}`);
  return note;
}

/**
 * Move a todo's due date — the snooze on the ledger row. `null` clears the date
 * and drops it to Someday. The commitment itself is untouched: pushing a date
 * is not closing a promise, and the file keeps its provenance either way.
 */
export async function setTodoDue(
  ctx: UseCaseContext,
  path: string,
  due: string | null,
): Promise<Note> {
  if (due !== null && !DATE_RE.test(due)) throw new Error(`invalid due date: ${due}`);
  const existing = await ctx.vault.readNote(path);
  if (!existing || existing.type !== 'todo') throw new Error(`not a todo: ${path}`);
  // Dating it is the PM taking the commitment on, so the "Qale heard this" mark
  // has done its job and comes off (FA-7).
  const frontmatter = withoutInferenceMark({ ...existing.frontmatter } as Record<string, unknown>);
  if (due === null) delete frontmatter['due'];
  else frontmatter['due'] = due;
  const note = await ctx.vault.writeNote(path, frontmatter as Frontmatter, existing.body);
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `todo: ${note.slug} due ${due ?? 'cleared'}`);
  return note;
}

/**
 * Flip a todo open/done/dropped — stamps `resolved` on close, clears on reopen.
 *
 * Null comes back when the todo is gone: dropping one Qale had only heard
 * deletes the file (docs/fewer-approvals.md FA-7). See {@link dropInferredTodo}.
 */
export async function setTodoStatus(
  ctx: UseCaseContext,
  path: string,
  commitment: TodoCommitment,
): Promise<Note | null> {
  if (!TODO_COMMITMENTS.includes(commitment)) {
    throw new Error(`invalid todo commitment: ${commitment}`);
  }
  const existing = await ctx.vault.readNote(path);
  if (!existing || existing.type !== 'todo') throw new Error(`not a todo: ${path}`);
  if (commitment === 'dropped' && isInferredTodo(existing.frontmatter as TodoShape)) {
    const removed = await dropInferredTodo(ctx, existing);
    if (removed) return null;
  }
  // Closing or reopening one is the PM's own hand on it, so the mark goes (FA-7).
  const frontmatter = withoutInferenceMark({
    ...existing.frontmatter,
    commitment,
  } as Record<string, unknown>);
  if (commitment === 'open') delete frontmatter['resolved'];
  else frontmatter['resolved'] = ctx.clock.now().slice(0, 10);
  const note = await ctx.vault.writeNote(path, frontmatter as Frontmatter, existing.body);
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `todo: ${note.slug} → ${commitment}`);
  return note;
}

/**
 * Drop a todo Qale only heard: delete the file instead of closing it.
 *
 * The ledger must not remember a promise the PM says was never made. A `dropped`
 * row would do exactly that: it stays in Done, it shows up in a count, and the
 * next session reads it as a commitment somebody walked away from.
 *
 * The file still goes back. The Activity row carries the delete commit, so "Put
 * it back" restores the note the same way it does for any other write, and the
 * row's own sentence is the record of what was removed and why.
 *
 * Refuses one case, and then the drop closes the todo the ordinary way: a todo
 * another note links to. Deleting it would break that link, which is the same
 * reason a delete card checks backlinks.
 */
async function dropInferredTodo(ctx: UseCaseContext, todo: Note): Promise<boolean> {
  if (ctx.index.backlinks(todo.slug).length > 0) return false;
  const fm = todo.frontmatter as Record<string, unknown>;
  const title = (typeof fm['title'] === 'string' && fm['title'].trim()) || todo.slug;
  await deleteNote(ctx, todo.path);
  await recordActivityRow(
    ctx,
    {
      proposalId: null,
      action: 'deleted',
      line: droppedInferredTodoLine({ title, source: sourceTitle(ctx, fm) }),
      reason: 'you said it was not a commitment',
      path: todo.path,
      sessionId: null,
      skill: null,
    },
    'restore',
  );
  return true;
}

/** What the note a todo cites is called, for the row that says where Qale heard
 *  it. Null when it cites nothing, or nothing the workspace still holds. */
function sourceTitle(ctx: UseCaseContext, frontmatter: Record<string, unknown>): string | null {
  const sources = frontmatter['sources'];
  const first = Array.isArray(sources) ? sources[0] : undefined;
  if (typeof first !== 'string' || !first.trim()) return null;
  const resolved = ctx.index.resolve(bareRef(first));
  return (resolved && ctx.index.get(resolved)?.title) || titleForRef(first) || null;
}
