/**
 * The folder model behind every file list in the app.
 *
 * It works over any directory in the vault: `notes/` for Documents, but also
 * `decisions/`, `tickets/jira/` or a Memory shelf. Every function that needs to
 * know which directory it is over takes it as `dir`, so nothing here is bound
 * to one screen. The `notes/` bindings live in lib/documents.ts.
 *
 * A folder is a persistent object. It exists when `<dir>/<folder>/index.md`
 * exists, or when a file is in it (see `moveNote` in
 * packages/application/src/use-cases/notes.ts). The old rule, "a folder exists
 * because a file is in it", is retired: "New folder" writes the index stub, and
 * an empty folder stays.
 *
 * The split these helpers keep: folder derivation ({@link folderKeys}) reads
 * EVERY path, including the folder index files, because the index file is what
 * makes an empty folder visible. Listing and counting read real files only:
 * an index file is navigation, so it never shows as a row and never counts.
 */
import { isFolderIndex } from '@qale/domain';
import { byName, type ListSort } from './list-sort';

/** `notes` and `notes/` mean the same directory. */
const withSlash = (dir: string) => (dir === '' || dir.endsWith('/') ? dir : `${dir}/`);

/**
 * The folder a file sits in, written relative to `dir`. "" is the top.
 *
 * A path that is already relative to `dir` answers the same way, so a caller
 * may hand over either form.
 */
export function folderOf(path: string, dir: string): string {
  const prefix = withSlash(dir);
  const rest = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  const cut = rest.lastIndexOf('/');
  return cut === -1 ? '' : rest.slice(0, cut);
}

export interface FileFolder {
  /** The path under `dir`, e.g. "specs" or "specs/2026". */
  key: string;
  /** The last segment, which is what the row shows. */
  name: string;
  /** How deep it sits, for the indent. 0 is a folder directly under `dir`. */
  depth: number;
}

/**
 * Every folder under `dir`, plus the folders on the way down to it, sorted so a
 * parent always comes straight before its children. Feed it every path, index
 * files included: an empty folder is only in here because its index file is.
 */
export function folderKeys(paths: string[], dir: string): FileFolder[] {
  const keys = new Set<string>();
  for (const path of paths) {
    const key = folderOf(path, dir);
    if (!key) continue;
    const parts = key.split('/');
    for (let i = 1; i <= parts.length; i++) keys.add(parts.slice(0, i).join('/'));
  }
  return [...keys]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => ({
      key,
      name: key.slice(key.lastIndexOf('/') + 1),
      depth: key.split('/').length - 1,
    }));
}

/** The folders sitting directly inside `key`. "" asks for the top level. */
export function childFolders(folders: FileFolder[], key: string): FileFolder[] {
  const depth = key === '' ? 0 : key.split('/').length;
  const prefix = key === '' ? '' : `${key}/`;
  return folders.filter((f) => f.depth === depth && f.key.startsWith(prefix));
}

/** The files sitting directly at `key`. Not the ones in its subfolders, and
 *  never a folder's own index file. */
export function docsAt<T extends { path: string }>(files: T[], dir: string, key: string): T[] {
  return files.filter((f) => !isFolderIndex(f.path) && folderOf(f.path, dir) === key);
}

/** How many files a folder holds, subfolders included. Index files never count:
 *  an empty folder counts 0, not 1. */
export function fileCount(paths: string[], dir: string, key: string): number {
  const prefix = `${withSlash(dir)}${key}/`;
  return paths.filter((p) => p.startsWith(prefix) && !isFolderIndex(p)).length;
}

/**
 * When each folder last changed, by the files inside it (subfolders included).
 * A folder has no modified time of its own, and the newest thing it holds is
 * what a person means by one. An empty folder answers 0, so it sorts oldest.
 */
export function folderMtimes(
  files: { path: string; mtime: number }[],
  dir: string,
): Map<string, number> {
  const times = new Map<string, number>();
  for (const f of files) {
    if (isFolderIndex(f.path)) continue;
    const key = folderOf(f.path, dir);
    if (!key) continue;
    const parts = key.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const k = parts.slice(0, i).join('/');
      if ((times.get(k) ?? 0) < f.mtime) times.set(k, f.mtime);
    }
  }
  return times;
}

/**
 * The folders in the order the tree shows them. Feed the result to
 * {@link visibleRows} only: it drops the parent-before-child order that
 * {@link folderKeys} promises, which "Move to" still needs.
 *
 * A folder has a name and a time, so `name` sorts by the name and every other
 * column sorts by the time.
 */
export function sortFolders(
  folders: FileFolder[],
  sort: ListSort,
  times: Map<string, number>,
): FileFolder[] {
  const flip = sort.dir === 'asc' ? 1 : -1;
  return [...folders].sort((a, b) =>
    sort.key === 'name'
      ? flip * byName(a.name, b.name)
      : flip * ((times.get(a.key) ?? 0) - (times.get(b.key) ?? 0)) || byName(a.name, b.name),
  );
}

/**
 * The folders open in place after one is clicked.
 *
 * It is an array, not a Set, because it lives on the tab's view body: that is
 * what makes it survive a tab switch and ride the tab's back and forward. A
 * key from a level the PM left is harmless, so it stays.
 */
export function toggleExpanded(expanded: readonly string[], key: string): string[] {
  return expanded.includes(key) ? expanded.filter((k) => k !== key) : [...expanded, key];
}

/** One line on a file list: a folder to open, or a file to read. */
export type FileListRow<T> =
  { kind: 'folder'; folder: FileFolder; depth: number } | { kind: 'doc'; note: T; depth: number };

/**
 * The rows the tree draws, top to bottom, at the level the PM is standing in.
 *
 * The order is the same at every level: the child folders first, then the
 * files. Folders stay on top however the list is sorted, the way the Finder
 * keeps them. An expanded folder puts its own rows straight under it, one step
 * deeper, by the same rule. `depth` is the indent, 0 at the level itself.
 *
 * Hand it both lists already sorted ({@link sortFolders}, `sortDocuments`).
 * This function only filters, so the order you give it is the order each level
 * shows.
 */
export function visibleRows<T extends { path: string }>(
  folders: FileFolder[],
  files: T[],
  dir: string,
  level: string,
  expanded: ReadonlySet<string>,
): FileListRow<T>[] {
  const rows: FileListRow<T>[] = [];
  const walk = (key: string, depth: number) => {
    for (const folder of childFolders(folders, key)) {
      rows.push({ kind: 'folder', folder, depth });
      if (expanded.has(folder.key)) walk(folder.key, depth + 1);
    }
    for (const file of docsAt(files, dir, key)) rows.push({ kind: 'doc', note: file, depth });
  };
  walk(level, 0);
  return rows;
}
