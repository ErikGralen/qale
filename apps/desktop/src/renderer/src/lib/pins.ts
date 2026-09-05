/**
 * What a rail place holds under it.
 *
 * Documents hold what you write, and a row under a place is a pinned item of
 * that place and nothing else (docs/sidebar-ia.md, SB-1). One pin set backs the
 * lists; these selectors split it.
 *
 * Memory holds nothing under it any more: it is a footer row, and no memory
 * page pins. A mirror pins under the system it was copied from, never under
 * Memory (docs/memory-placement.md). A meeting never lands in a list either,
 * because Calendar is its home. A todo, a skill, an agent and a session are the
 * same story, and `isPinnable` already keeps every one of them out of the set.
 *
 * Documents read the PATH, not the type: the understanding notes carry
 * `type: note` and sit in `understanding/`, and they are not the user's
 * documents. Folder index files are navigation, so they never show as a row.
 */
import { isFolderIndex } from '@qale/domain';
import type { NoteRefDTO, VaultTreeDTO } from '@qale/ipc';
import { isDocument } from './documents';
import { byRecent } from './note-status';

/** Every pinned note in the tree, whatever place it belongs to. */
function pinned(tree: VaultTreeDTO | null, favorites: string[]): NoteRefDTO[] {
  if (!tree) return [];
  const wanted = new Set(favorites);
  const rows: NoteRefDTO[] = [];
  for (const group of tree.groups) {
    for (const note of group.notes) {
      if (wanted.has(note.path) && !isFolderIndex(note.path)) rows.push(note);
    }
  }
  return rows;
}

/** The pinned documents, most recent first. */
export function documentPins(tree: VaultTreeDTO | null, favorites: string[]): NoteRefDTO[] {
  return pinned(tree, favorites)
    .filter((n) => isDocument(n.path))
    .sort(byRecent);
}

/**
 * The pinned mirrors under one system's folder, most recent first. `dir` is
 * that folder, `tickets/jira` or `wikipages/confluence`
 * (docs/memory-placement.md).
 *
 * The path decides, the way it does for documents. A flat mirror
 * (`tickets/PAY-142.md`) names no system, so no row holds it until the sync
 * engine's one-time move files it under one.
 */
export function mirrorPins(
  tree: VaultTreeDTO | null,
  favorites: string[],
  dir: string,
): NoteRefDTO[] {
  return pinned(tree, favorites)
    .filter((n) => n.path.startsWith(`${dir}/`))
    .sort(byRecent);
}
