import { isIndexableNote } from '@qale/domain';
import type { IndexPort, VaultPort } from '../ports.js';

/**
 * Files that are not concept notes: orientation (`index.md`/`log.md`), the
 * material sitting beside a skill's `SKILL.md`, and a session's own working
 * files. None is indexed, so none can surface as a note in a listing, a search
 * or the prompt's skill index — a skill's own reference table is read by path
 * when its instructions ask, and never before, and `input.md` in a session
 * folder is a note to the agent about what just arrived, not a note in the
 * workspace.
 *
 * Exported because both doors into the index have to agree on it: this
 * reconcile, and the watcher batch the desktop app drains.
 */
export const notIndexable = (path: string): boolean => !isIndexableNote(path);

/**
 * Startup reconciliation — a three-way diff between the filesystem and the index
 * (PLAN §3.5): add new files, re-index changed ones (by mtime), and delete
 * ghosts (indexed files no longer on disk). This is what makes external Obsidian
 * edits and deletions show up.
 */
export async function reconcileIndex(
  vault: VaultPort,
  index: IndexPort,
): Promise<{ indexed: number; removed: number }> {
  const fsList = await vault.list();
  const fsByPath = new Map(fsList.map((f) => [f.path, f]));
  const indexed = index.all();
  const indexedByPath = new Map(indexed.map((r) => [r.path, r]));

  let changed = 0;
  for (const file of fsList) {
    if (notIndexable(file.path)) continue;
    const existing = indexedByPath.get(file.path);
    if (existing && existing.mtime >= file.mtime) continue;
    const note = await vault.readNote(file.path);
    if (note) {
      index.reindex(note);
      changed++;
    }
  }

  let removed = 0;
  for (const record of indexed) {
    // Drop ghosts AND anything an older index still holds that is not content —
    // a reserved file, or a sibling indexed before skills became folders.
    if (!fsByPath.has(record.path) || notIndexable(record.path)) {
      index.removeByPath(record.path);
      removed++;
    }
  }

  return { indexed: changed, removed };
}

/** Full rebuild: drop everything and rescan (PLAN §3.5 "Rebuild index"). */
export async function rebuildIndex(
  vault: VaultPort,
  index: IndexPort,
): Promise<{ indexed: number }> {
  index.clear();
  const fsList = await vault.list();
  let indexed = 0;
  for (const file of fsList) {
    if (notIndexable(file.path)) continue;
    const note = await vault.readNote(file.path);
    if (note) {
      index.reindex(note);
      indexed++;
    }
  }
  return { indexed };
}
