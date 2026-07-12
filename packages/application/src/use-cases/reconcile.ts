import type { IndexPort, VaultPort } from '../ports.js';

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
    if (!fsByPath.has(record.path)) {
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
    const note = await vault.readNote(file.path);
    if (note) {
      index.reindex(note);
      indexed++;
    }
  }
  return { indexed };
}
