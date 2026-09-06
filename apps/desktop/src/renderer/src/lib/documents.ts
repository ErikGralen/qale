/**
 * The Documents screen, bound to `notes/`.
 *
 * The folder model itself is in lib/files.ts and works over any directory. This
 * file is the thin layer that says which directory Documents is over, plus the
 * two things that are about documents and nothing else: the sort the screen
 * offers, and what a dragged row carries.
 *
 * Documents live in `notes/`, and the folders under it are the user's own: the
 * one place in the app where the structure a person made means something.
 *
 * The screen reads the PATH, not the note type: `notes/` is the one folder the
 * PM owns, and nothing outside it is a document.
 */
import {
  docsAt as filesAt,
  fileCount,
  folderKeys,
  folderMtimes as filesFolderMtimes,
  folderOf,
  visibleRows as filesVisibleRows,
  type FileFolder,
  type FileListRow,
} from './files';
import type { ListSort, ListSortDir } from './list-sort';

/** The tree walk is the same everywhere, so Documents just re-exports it. */
export { childFolders, sortFolders, toggleExpanded } from './files';
export { sortDocuments, type SortableRow as SortableDocument } from './list-sort';

/** Where the documents live. Everything on this screen is under it. */
export const DOCUMENTS_DIR = 'notes/';

/** Is this file one of the PM's documents? The folder says it. */
export function isDocument(path: string): boolean {
  return path.startsWith(DOCUMENTS_DIR);
}

/** The folder a document sits in, written relative to `notes/`. "" is the top. */
export function documentFolder(path: string): string {
  return folderOf(path, DOCUMENTS_DIR);
}

/** A folder under `notes/`. The same shape every file list uses. */
export type DocumentFolder = FileFolder;

/** One line on the Documents screen: a folder to open, or a document to read. */
export type DocumentRow<T> = FileListRow<T>;

/**
 * Every folder under `notes/`, plus the folders on the way down to it, sorted
 * so a parent always comes straight before its children. Feed it every path,
 * index files included: an empty folder is only in here because its index file
 * is.
 */
export function documentFolders(paths: string[]): DocumentFolder[] {
  return folderKeys(paths, DOCUMENTS_DIR);
}

/** The documents sitting directly at `key`. Not the ones in its subfolders,
 *  and never a folder's own index file. */
export function docsAt<T extends { path: string }>(notes: T[], key: string): T[] {
  return filesAt(notes, DOCUMENTS_DIR, key);
}

/** How many documents a folder holds, subfolders included. Index files never
 *  count: an empty folder counts 0, not 1. */
export function docCount(paths: string[], key: string): number {
  return fileCount(paths, DOCUMENTS_DIR, key);
}

/** When each folder last changed, by the documents inside it. */
export function folderMtimes(notes: { path: string; mtime: number }[]): Map<string, number> {
  return filesFolderMtimes(notes, DOCUMENTS_DIR);
}

/** The rows the tree draws at the level the PM is standing in. Hand it both
 *  lists already sorted. */
export function visibleRows<T extends { path: string }>(
  folders: DocumentFolder[],
  notes: T[],
  level: string,
  expanded: ReadonlySet<string>,
): DocumentRow<T>[] {
  return filesVisibleRows(folders, notes, DOCUMENTS_DIR, level, expanded);
}

/**
 * How the list is ordered. Two columns, two directions, and the page remembers
 * the pick (see `readListSort` in lib/list-sort.ts).
 */
export type DocumentSortKey = 'name' | 'modified';
export type DocumentSortDir = ListSortDir;
export interface DocumentSort extends ListSort {
  key: DocumentSortKey;
}

/** The columns this screen has. A stored key that is not one of them is dead. */
export const DOCUMENT_SORT_KEYS: readonly DocumentSortKey[] = ['name', 'modified'];

/** Newest first: how a PM scans their own writing. */
export const DEFAULT_SORT: DocumentSort = { key: 'modified', dir: 'desc' };

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
