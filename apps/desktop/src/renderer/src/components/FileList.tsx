import type { KeyboardEvent, ReactNode } from 'react';
import { moveRowFocus } from '../lib/row-focus';

/**
 * The `ul` a list of {@link FileRow}s sits in: the role, the hairline
 * separators, and the arrow keys.
 *
 * Cards were the clutter. Dense rows on hairlines read as one table, and one
 * list component keeps every page moving the same way: down and up walk the
 * rows in the order the eye reads them.
 *
 * It is always a `role="tree"`, because every {@link FileRow} is a `treeitem`
 * and a treeitem outside a tree is not a thing. A flat list is a tree one level
 * deep, which is what the rows already say through `aria-level`.
 *
 * A page with its own keys says so. Documents runs its handler FIRST, because
 * it has to move the focus and then take the selection with it. Whatever that
 * handler spends (it calls `preventDefault`, the way {@link moveRowFocus} does)
 * is not spent again here.
 */
export function FileList({
  label,
  multiselectable,
  onKeyDown,
  className = '',
  children,
}: {
  /** What a screen reader calls the list. A tree has to be named. */
  label: string;
  multiselectable?: boolean;
  /** The page's own keys. They run before the arrows. */
  onKeyDown?: (e: KeyboardEvent<HTMLUListElement>) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ul
      role="tree"
      aria-label={label}
      aria-multiselectable={multiselectable}
      className={`flex flex-col divide-y divide-border/70 ${className}`}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        moveRowFocus(e);
      }}
    >
      {children}
    </ul>
  );
}
