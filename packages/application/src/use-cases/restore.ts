import { titleFromSlug, type Note } from '@qale/domain';
import type { UseCaseContext } from '../ports.js';
import { saveAuthoredNote } from './notes.js';

/** Leading YAML frontmatter block (optional BOM, CRLF tolerant). */
const FRONTMATTER_RE = /^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** What the restored version is called in the history list. */
export const RESTORE_LABEL = 'restored an earlier version';

export interface RestoreNoteVersionInput {
  path: string;
  /** The version to bring back, as listed by `getNoteHistory`. */
  hash: string;
}

/**
 * Put a note back to how it read at an earlier version.
 *
 * Written FORWARD, as an ordinary save: the earlier text becomes the newest
 * version and everything in between stays in the record. A rewind would make
 * the history lie about what happened, and would leave the restore itself as
 * the one write with no way back.
 *
 * Body only, on purpose. The history view shows prose, so prose is what the
 * person is choosing; the properties underneath carry live state the old
 * version knows nothing about (whether a commitment is closed, which calendar
 * event or ticket the note mirrors, whether the source has been read).
 * Dragging those backwards would quietly re-open finished work and re-point
 * live links, none of it visible in what was previewed. `writeBody` keeps the
 * current block byte for byte.
 */
export async function restoreNoteVersion(
  ctx: UseCaseContext,
  input: RestoreNoteVersionInput,
): Promise<Note> {
  const raw = await ctx.git.fileAt(input.path, input.hash);
  // Null covers both "no history on this machine" and "the note did not exist
  // at that version" — either way there is nothing to put back, and the write
  // must not proceed with an empty body.
  if (raw === null) throw new Error('that version is no longer available');
  const body = raw.replace(FRONTMATTER_RE, '').replace(/^\s+/, '');
  // Deliberately the same use-case the editor saves through, so the search
  // index, the file watcher and any open tab see the ordinary write it is.
  return saveAuthoredNote(ctx, input.path, body, RESTORE_LABEL);
}

/** What the label on a reverted change says in the history list. */
export const REVERT_LABEL = 'undo';

export interface RevertChangeInput {
  path: string;
  /** The change to undo, by the commit hash the history list shows. */
  hash: string;
  /**
   * The Activity row this undo came from, when it came from one. Stamped only
   * after the files are back, so a row never says "put back" for a revert that
   * threw.
   */
  activityId?: string;
}

/** What the undo did. `removed` means that change had created the note. */
export type RevertOutcome = 'restored' | 'undeleted' | 'removed';

export interface RevertResult {
  /** The note the undo left behind, or the one it took away. */
  path: string;
  outcome: RevertOutcome;
}

/**
 * Undo one recorded change to one note (E-2).
 *
 * The whole file goes back, frontmatter and all, which is the difference from
 * {@link restoreNoteVersion} above. A person picking a version out of the
 * history list is choosing prose they can read. Undoing a change the agent
 * applied on its own is a different act: what it changed may be a tag, a link
 * or a lifecycle field that never showed on screen, and putting half of it back
 * would leave the note in a state nobody ever wrote. Nothing is invented here
 * either way. Every byte written back is a byte the workspace itself recorded.
 *
 * Written forward, like a restore: the undo is a new version on top and the
 * change it undid stays in the record, so the undo is itself undoable.
 *
 * Four cases, all one loop. A modified note goes back to its earlier text. A
 * deleted note comes back. A note the change created goes away. A renamed note
 * gets both sides put back, which is why the git layer answers with the paths
 * and not just a yes.
 */
export async function revertNoteChange(
  ctx: UseCaseContext,
  input: RevertChangeInput,
): Promise<RevertResult> {
  if (!ctx.vault.contain(input.path)) throw new Error('that note is not in this workspace');
  if (!ctx.git.pathsChangedWith) throw new Error('this workspace cannot undo changes');
  const touched = await ctx.git.pathsChangedWith(input.hash, input.path);
  // The refusal that matters: a hash from somewhere else reads back a perfectly
  // valid older file, and undoing with it would overwrite work nobody named.
  if (touched.length === 0) throw new Error('that change did not touch this note');

  let landed: string | null = null;
  let undeleted = false;
  for (const path of touched) {
    // `hash^` is the state before the change. A first commit has no parent, so
    // this reads as null and the note is taken away, which is right: that
    // commit is where the note began.
    const before = await ctx.git.fileAt(path, `${input.hash}^`);
    if (before === null) {
      if (!(await ctx.vault.exists(path))) continue;
      await ctx.vault.remove(path);
      ctx.index.removeByPath(path);
      continue;
    }
    const existed = await ctx.vault.exists(path);
    await ctx.vault.writeRaw(path, before);
    const note = await ctx.vault.readNote(path);
    if (note) ctx.index.reindex(note);
    landed = path;
    undeleted = !existed;
  }

  const path = landed ?? input.path;
  await ctx.git.commitPaths(touched, `${REVERT_LABEL}: ${titleFromSlug(path)}`);
  if (input.activityId && ctx.activity) {
    const at = Date.parse(ctx.clock.now());
    ctx.activity.markReverted(input.activityId, Number.isNaN(at) ? Date.now() : at);
  }
  return { path, outcome: landed === null ? 'removed' : undeleted ? 'undeleted' : 'restored' };
}
