import {
  TODO_COMMITMENTS,
  dirForType,
  fileSlug,
  type Frontmatter,
  type Note,
  type TodoCommitment,
  type TodoFrontmatter,
} from '@qale/domain';
import type { UseCaseContext } from '../ports.js';

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

/** Flip a todo open/done/dropped — stamps `resolved` on close, clears on reopen. */
export async function setTodoStatus(
  ctx: UseCaseContext,
  path: string,
  commitment: TodoCommitment,
): Promise<Note> {
  if (!TODO_COMMITMENTS.includes(commitment)) {
    throw new Error(`invalid todo commitment: ${commitment}`);
  }
  const existing = await ctx.vault.readNote(path);
  if (!existing || existing.type !== 'todo') throw new Error(`not a todo: ${path}`);
  const frontmatter = { ...existing.frontmatter, commitment } as Record<string, unknown>;
  if (commitment === 'open') delete frontmatter['resolved'];
  else frontmatter['resolved'] = ctx.clock.now().slice(0, 10);
  const note = await ctx.vault.writeNote(path, frontmatter as Frontmatter, existing.body);
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `todo: ${note.slug} → ${commitment}`);
  return note;
}
