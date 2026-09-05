/**
 * The folder model behind the Documents screen.
 *
 * Documents live in `notes/`, and the folders under it are the user's own: the
 * one place in the app where the structure a person made means something. A
 * folder is a persistent object — it exists when `notes/<folder>/index.md`
 * exists or a document is in it (see `moveNote` in
 * packages/application/src/use-cases/notes.ts). The old rule, "a folder exists
 * because a file is in it", is retired: "New folder" writes the index stub, and
 * an empty folder stays.
 *
 * The split these helpers keep: folder derivation reads EVERY path under
 * `notes/`, including the folder index files, because the index file is what
 * makes an empty folder visible. Listing and counting read documents only —
 * an index file is navigation, and it never shows as a row and never counts.
 *
 * The screen reads the PATH, not the note type. The type `note` also covers the
 * understanding notes, which sit in `understanding/` because nobody asked for
 * them, and this is the one screen they must never appear on.
 */
import { isFolderIndex } from '@qale/domain';

/** Where the documents live. Everything on this screen is under it. */
export const DOCUMENTS_DIR = 'notes/';

/** Is this file one of the PM's documents? The folder says it. */
export function isDocument(path: string): boolean {
  return path.startsWith(DOCUMENTS_DIR);
}

/** The folder a document sits in, written relative to `notes/`. "" is the top. */
export function documentFolder(path: string): string {
  const rest = path.startsWith(DOCUMENTS_DIR) ? path.slice(DOCUMENTS_DIR.length) : path;
  const cut = rest.lastIndexOf('/');
  return cut === -1 ? '' : rest.slice(0, cut);
}

export interface DocumentFolder {
  /** The path under `notes/`, e.g. "specs" or "specs/2026". */
  key: string;
  /** The last segment — what the row shows. */
  name: string;
  /** How deep it sits, for the indent. 0 is a folder directly under `notes/`. */
  depth: number;
}

/**
 * Every folder under `notes/`, plus the folders on the way down to it, sorted
 * so a parent always comes straight before its children. Feed it every path,
 * index files included: an empty folder is only in here because its index
 * file is.
 */
export function documentFolders(paths: string[]): DocumentFolder[] {
  const keys = new Set<string>();
  for (const path of paths) {
    const key = documentFolder(path);
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
export function childFolders(folders: DocumentFolder[], key: string): DocumentFolder[] {
  const depth = key === '' ? 0 : key.split('/').length;
  const prefix = key === '' ? '' : `${key}/`;
  return folders.filter((f) => f.depth === depth && f.key.startsWith(prefix));
}

/** The documents sitting directly at `key` — not the ones in its subfolders,
 *  and never a folder's own index file. */
export function docsAt<T extends { path: string }>(notes: T[], key: string): T[] {
  return notes.filter((n) => !isFolderIndex(n.path) && documentFolder(n.path) === key);
}

/** How many documents a folder holds, subfolders included. Index files never
 *  count: an empty folder counts 0, not 1. */
export function docCount(paths: string[], key: string): number {
  const prefix = `${DOCUMENTS_DIR}${key}/`;
  return paths.filter((p) => p.startsWith(prefix) && !isFolderIndex(p)).length;
}

/**
 * How the list is ordered. Two keys, two directions, and the page remembers the
 * pick (see `qale.documents.sort` in DocumentsView).
 *
 * `modified` reads the file's own modified time and nothing else. The rest of
 * the app shows a frontmatter date when a note carries one (see `refDate`),
 * which is right for a meeting and wrong here: a column called Modified has to
 * say when the file changed.
 */
export type DocumentSortKey = 'name' | 'modified';
export type DocumentSortDir = 'asc' | 'desc';
export interface DocumentSort {
  key: DocumentSortKey;
  dir: DocumentSortDir;
}

/** Newest first: how a PM scans their own writing. */
export const DEFAULT_SORT: DocumentSort = { key: 'modified', dir: 'desc' };

/** The stored pick, or the default when nothing valid is stored. */
export function parseDocumentSort(raw: string | null): DocumentSort {
  if (!raw) return DEFAULT_SORT;
  try {
    const v = JSON.parse(raw) as Partial<DocumentSort>;
    if ((v.key === 'name' || v.key === 'modified') && (v.dir === 'asc' || v.dir === 'desc'))
      return { key: v.key, dir: v.dir };
  } catch {
    /* a value from an older build, or nothing at all */
  }
  return DEFAULT_SORT;
}

/** Clicking the column that is already sorted turns it around. */
export function nextDocumentSort(current: DocumentSort, key: DocumentSortKey): DocumentSort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  // A fresh column opens the way that column is read: names from A, dates from
  // the newest.
  return { key, dir: key === 'name' ? 'asc' : 'desc' };
}

/** What a sorted document row needs: a title to read and a time to compare. */
export interface SortableDocument {
  title: string;
  mtime: number;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/** The documents at one level, in the order the page shows them. */
export function sortDocuments<T extends SortableDocument>(notes: T[], sort: DocumentSort): T[] {
  const flip = sort.dir === 'asc' ? 1 : -1;
  return [...notes].sort((a, b) =>
    sort.key === 'name'
      ? flip * byName(a.title, b.title)
      : // Same second, same answer every render: the name breaks the tie.
        flip * (a.mtime - b.mtime) || byName(a.title, b.title),
  );
}

/**
 * When each folder last changed, by the documents inside it (subfolders
 * included). A folder has no modified time of its own, and the newest thing it
 * holds is what a person means by one. An empty folder answers 0, so it sorts
 * oldest.
 */
export function folderMtimes(notes: { path: string; mtime: number }[]): Map<string, number> {
  const times = new Map<string, number>();
  for (const n of notes) {
    if (isFolderIndex(n.path)) continue;
    const key = documentFolder(n.path);
    if (!key) continue;
    const parts = key.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const k = parts.slice(0, i).join('/');
      if ((times.get(k) ?? 0) < n.mtime) times.set(k, n.mtime);
    }
  }
  return times;
}

/**
 * The folders in the order the tree shows them. Feed the result to
 * {@link visibleRows} only: it drops the parent-before-child order that
 * {@link documentFolders} promises, which "Move to" still needs.
 */
export function sortFolders(
  folders: DocumentFolder[],
  sort: DocumentSort,
  times: Map<string, number>,
): DocumentFolder[] {
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

/** One line on the Documents screen: a folder to open, or a document to read. */
export type DocumentRow<T> =
  | { kind: 'folder'; folder: DocumentFolder; depth: number }
  | { kind: 'doc'; note: T; depth: number };

/**
 * The rows the tree draws, top to bottom, at the level the PM is standing in.
 *
 * The order is the same at every level: the child folders first, then the
 * documents. Folders stay on top however the list is sorted, the way the Finder
 * keeps them. An expanded folder puts its own rows straight under it, one step
 * deeper, by the same rule. `depth` is the indent, 0 at the level itself.
 *
 * Hand it both lists already sorted ({@link sortFolders}, {@link
 * sortDocuments}). This function only filters, so the order you give it is the
 * order each level shows.
 */
export function visibleRows<T extends { path: string }>(
  folders: DocumentFolder[],
  notes: T[],
  level: string,
  expanded: ReadonlySet<string>,
): DocumentRow<T>[] {
  const rows: DocumentRow<T>[] = [];
  const walk = (key: string, depth: number) => {
    for (const folder of childFolders(folders, key)) {
      rows.push({ kind: 'folder', folder, depth });
      if (expanded.has(folder.key)) walk(folder.key, depth + 1);
    }
    for (const note of docsAt(notes, key)) rows.push({ kind: 'doc', note, depth });
  };
  walk(level, 0);
  return rows;
}

/**
 * What a drag carries. The drag wiring lives in lib/dnd.ts; the payload and the
 * rule about where it may land live here, with the model they speak about, so
 * both can be read and tested without a DOM.
 */
const DOCUMENT_DRAG = Symbol('documents.drag');

/** The data a dragged row hands to the drop targets. */
export function documentDragData(paths: string[]): Record<string | symbol, unknown> {
  return { [DOCUMENT_DRAG]: paths };
}

/** The documents a drag carries. Empty for a drag that started somewhere else. */
export function draggedDocuments(data: Record<string | symbol, unknown>): string[] {
  const paths = data[DOCUMENT_DRAG];
  return Array.isArray(paths) ? (paths as string[]) : [];
}

/**
 * May these documents land in this folder? Only if at least one of them would
 * actually move. The folder they already sit in takes no drop, so it never
 * lights up under the pointer.
 */
export function acceptsDocuments(paths: string[], folder: string): boolean {
  return paths.some((path) => documentFolder(path) !== folder);
}
