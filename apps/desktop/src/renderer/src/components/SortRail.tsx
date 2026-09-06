import { ChevronDown, ChevronUp } from 'lucide-react';
import { nextListSort, type ListSort, type ListSortDir } from '../lib/list-sort';
import { META_COL_HEAD } from './FileRow';

/**
 * One column in the rail: what it holds, and how it sorts.
 *
 * `openDir` is the way the column reads when you first click it: names from A,
 * dates from the newest, a state from the front of the queue. Clicking the
 * column that is already sorted turns it around instead.
 *
 * `ariaLabel` gets the sort the rail is in, so the button can say what the
 * click will DO rather than what the column is called.
 */
export interface SortColumn<K extends string = string> {
  key: K;
  label: string;
  /** The width class, when the column is not the standard one. */
  className?: string;
  openDir: ListSortDir;
  ariaLabel: (sort: ListSort) => string;
}

/**
 * The column rail over a file list, and it does the Finder's one job: click a
 * column to sort by it, click it again to turn it around. There is no menu; a
 * browse page with three facts per row needs three controls and no more.
 *
 * The first column takes the width that is left (the title). The rest sit in
 * the right-hand rail, against the same width classes the rows use, so a
 * heading always stands over its own column.
 */
export function SortRail<K extends string>({
  sort,
  columns,
  onSort,
}: {
  sort: { key: K; dir: ListSortDir };
  columns: SortColumn<K>[];
  onSort: (sort: { key: K; dir: ListSortDir }) => void;
}) {
  const button = (c: SortColumn<K>) => {
    const active = sort.key === c.key;
    const Chevron = sort.dir === 'asc' ? ChevronUp : ChevronDown;
    return (
      <button
        className={`flex h-6 items-center gap-1 rounded px-1 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
          active ? 'text-foreground' : ''
        }`}
        aria-label={c.ariaLabel(sort)}
        onClick={() => onSort({ key: c.key, dir: nextListSort(sort, c.key, c.openDir).dir })}
      >
        {c.label}
        {active && <Chevron className="size-3" aria-hidden />}
      </button>
    );
  };

  const [first, ...rest] = columns;
  return (
    <div className="sticky top-0 z-10 flex h-7 items-center border-b border-border bg-background pr-6 pl-4 text-xs font-medium text-muted-foreground">
      {first && button(first)}
      <span className="flex-1" />
      {rest.map((c) => (
        <span key={c.key} className={c.className ?? META_COL_HEAD}>
          {button(c)}
        </span>
      ))}
    </div>
  );
}
