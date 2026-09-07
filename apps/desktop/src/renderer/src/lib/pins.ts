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
 * Documents read the PATH, not the type. Folder index files are navigation, so
 * they never show as a row.
 *
 * The pin set is a LIST, not a bag: its order is the order the rows read in,
 * and the PO sets it by dragging a row. A new pin goes on top. Every list here
 * keeps that order, so a row stays where it was put.
 */
import { isFolderIndex } from '@qale/domain';
import type { NoteRefDTO, VaultTreeDTO } from '@qale/ipc';
import { isDocument } from './documents';

/** Every pinned note in the tree, in the pin set's own order. */
function pinned(tree: VaultTreeDTO | null, favorites: string[]): NoteRefDTO[] {
  if (!tree) return [];
  const found = new Map<string, NoteRefDTO>();
  for (const group of tree.groups) {
    for (const note of group.notes) found.set(note.path, note);
  }
  const rows: NoteRefDTO[] = [];
  for (const path of favorites) {
    const note = found.get(path);
    // A pin the tree no longer holds, and a folder index, hold no row.
    if (note && !isFolderIndex(path)) rows.push(note);
  }
  return rows;
}

/** The pinned documents, in the order the PO put them in. */
export function documentPins(tree: VaultTreeDTO | null, favorites: string[]): NoteRefDTO[] {
  return pinned(tree, favorites).filter((n) => isDocument(n.path));
}

/**
 * The pinned mirrors under one system's folder, in the order the PO put them
 * in. `dir` is that folder, `tickets/jira` or `wikipages/confluence`
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
  return pinned(tree, favorites).filter((n) => n.path.startsWith(`${dir}/`));
}

/**
 * The pin set with `path` moved next to `target`. Both lists on the rail are
 * views of this one set, so putting a row above or below its neighbour here is
 * enough: the sublist follows.
 *
 * A path that is not pinned, or a target that is not, gives the set back
 * unchanged.
 */
export function movedPin(
  favorites: string[],
  path: string,
  target: string,
  place: 'before' | 'after',
): string[] {
  if (path === target) return favorites;
  if (!favorites.includes(path) || !favorites.includes(target)) return favorites;
  const rest = favorites.filter((p) => p !== path);
  const at = rest.indexOf(target);
  return [
    ...rest.slice(0, place === 'before' ? at : at + 1),
    path,
    ...rest.slice(place === 'before' ? at : at + 1),
  ];
}
