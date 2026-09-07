/**
 * The sort a list screen remembers.
 *
 * Every file list in the app has a column rail: you click a column to sort by
 * it, click it again to turn it around, and the page comes back the way you
 * left it. This holds that model, and nothing about which screen is asking.
 *
 * The key is a plain string, not a closed union. Documents sorts by `name` and
 * `modified`; a Jira or Confluence mirror adds `state`. The screen owns its
 * columns, so the screen owns the words for them.
 */

/** Which column a list is sorted by. The screen names its own columns. */
export type ListSortKey = string;
export type ListSortDir = 'asc' | 'desc';
export interface ListSort {
  key: ListSortKey;
  dir: ListSortDir;
}

/** Names compare the way a person reads them: case and accents do not split. */
export const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'base' });

/**
 * The stored pick, or the fallback when nothing valid is stored.
 *
 * Pass `keys` when the screen knows its columns: a key from a build that had a
 * different column would otherwise come back and sort by nothing.
 */
export function parseListSort(
  raw: string | null,
  fallback: ListSort,
  keys?: readonly string[],
): ListSort {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw) as Partial<ListSort>;
    const keyOk = typeof v.key === 'string' && v.key !== '' && (!keys || keys.includes(v.key));
    if (keyOk && (v.dir === 'asc' || v.dir === 'desc')) return { key: v.key as string, dir: v.dir };
  } catch {
    /* a value from an older build, or nothing at all */
  }
  return fallback;
}

/**
 * Clicking the column that is already sorted turns it around. A fresh column
 * opens the way that column is read, which only the screen knows: names from A,
 * dates from the newest. That is what `openDir` says.
 */
export function nextListSort(current: ListSort, key: ListSortKey, openDir: ListSortDir): ListSort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: openDir };
}

/**
 * Where one screen's remembered sort is kept. `surface` is the screen, or the
 * screen and the folder it stands in, e.g. `documents` or `mirror.jira`.
 *
 * There is no migration from the old `qale.documents.sort` key. A sort is a
 * browse preference, not the user's data. One reset to the default costs a
 * click; migration code costs a file that lives forever.
 */
const storageKey = (surface: string) => `qale.list.${surface}.sort`;

/**
 * The sort this surface was left in, or the fallback.
 *
 * A packaged build runs from `file://`, where there is no localStorage at all
 * and touching it throws. Every read has to survive that, so the caller always
 * gets a sort back.
 */
export function readListSort(
  surface: string,
  fallback: ListSort,
  keys?: readonly string[],
): ListSort {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    return parseListSort(localStorage.getItem(storageKey(surface)), fallback, keys);
  } catch {
    return fallback;
  }
}

/** Remember the sort. A write can fail the same way a read can, and silently. */
export function writeListSort(surface: string, sort: ListSort): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(surface), JSON.stringify(sort));
  } catch {
    /* no storage, or it is full. The list still sorts, it just forgets. */
  }
}

/** What a sorted row needs: a title to read and a time to compare. */
export interface SortableRow {
  title: string;
  mtime: number;
}

/**
 * The rows at one level, in the order the page shows them.
 *
 * `name` compares the title. Every other key compares the modified time, which
 * reads the file's own mtime and nothing else. The rest of the app shows a
 * frontmatter date when a note carries one (see `refDate`), which is right for
 * a meeting and wrong here: a column called Modified has to say when the file
 * changed.
 */
export function sortDocuments<T extends SortableRow>(rows: T[], sort: ListSort): T[] {
  const flip = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) =>
    sort.key === 'name'
      ? flip * byName(a.title, b.title)
      : // Same second, same answer every render: the name breaks the tie.
        flip * (a.mtime - b.mtime) || byName(a.title, b.title),
  );
}
