import type { Note } from '@qale/domain';
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
 * event or ticket the note mirrors, whether the material has been read).
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
