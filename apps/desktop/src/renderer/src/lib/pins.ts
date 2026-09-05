/**
 * What the two rail places hold under them.
 *
 * Documents hold what you write, Memory holds what Qale knows, and a row under
 * a place is a pinned item of that place and nothing else (docs/sidebar-ia.md,
 * SB-1). One pin set backs both lists; these selectors split it.
 *
 * A meeting never lands in either list. Calendar is its home. A todo, a skill,
 * an agent and a session are the same story, and `isPinnable` already keeps
 * them out of the set.
 *
 * Documents read the PATH, not the type: the understanding notes carry
 * `type: note` and sit in `understanding/`, and they are not the user's
 * documents. Folder index files are navigation, so they never show as a row.
 */
import { isFolderIndex } from '@qale/domain';
import type { NoteRefDTO, VaultTreeDTO } from '@qale/ipc';
import { isDocument } from './documents';
import { surfaceForType } from './nav';
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
 * The pinned memory pages, most recent first: a source, decision, insight,
 * theme, customer, person, ticket or wikipage. The list comes from
 * `surfaceForType`, so the rail and the Memory page can never disagree about
 * which types live there.
 */
export function memoryPins(tree: VaultTreeDTO | null, favorites: string[]): NoteRefDTO[] {
  return pinned(tree, favorites)
    .filter((n) => surfaceForType(n.type) === 'memory')
    .sort(byRecent);
}
