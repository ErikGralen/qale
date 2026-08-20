import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';

/**
 * List selection, shared by every page that renders a {@link NoteList}.
 *
 * The rule the whole feature rests on: a click on a row always opens it, on
 * every page, whether or not something is selected. Selection is made on the
 * checkbox, so the meaning of a click never changes under the PO's finger.
 * Shift extends from the last row touched (the anchor), the way every list on
 * the desktop does it.
 *
 * The selection is kept as a raw set but always READ through the list's own
 * order, so it prunes itself: filter the page, delete the rows, switch folders,
 * and whatever is no longer on screen is no longer selected. Nothing can act on
 * a row the PO can't see.
 */
export interface Selection {
  /** Selected paths, in list order. Never holds a path the list stopped showing. */
  paths: string[];
  count: number;
  /** Every visible row is selected (false when the list is empty). */
  all: boolean;
  /** Something is selected: checkboxes stay out, shift-click extends. */
  active: boolean;
  isSelected: (path: string) => boolean;
  /** Toggle one row, or with `range` select everything from the anchor to it. */
  toggle: (path: string, opts?: { range?: boolean }) => void;
  selectAll: () => void;
  clear: () => void;
}

/**
 * @param ordered every selectable path the page currently shows, in the order
 * it shows them. Memoize it: range selection and pruning both read it.
 */
export function useSelection(ordered: string[]): Selection {
  const [raw, setRaw] = useState<ReadonlySet<string>>(() => new Set<string>());
  const anchor = useRef<string | null>(null);

  const paths = useMemo(() => ordered.filter((p) => raw.has(p)), [ordered, raw]);

  const toggle = useCallback(
    (path: string, opts?: { range?: boolean }) => {
      setRaw((prev) => {
        const next = new Set(prev);
        const from = anchor.current;
        if (opts?.range && from && from !== path) {
          const a = ordered.indexOf(from);
          const b = ordered.indexOf(path);
          // A range only adds. Sweeping back over rows already selected is a
          // correction of the range's end, not an undo of the whole gesture.
          if (a !== -1 && b !== -1) {
            for (const p of ordered.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(p);
            return next;
          }
        }
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      anchor.current = path;
    },
    [ordered],
  );

  const selectAll = useCallback(() => {
    setRaw(new Set(ordered));
    anchor.current = ordered[ordered.length - 1] ?? null;
  }, [ordered]);

  const clear = useCallback(() => {
    setRaw(new Set<string>());
    anchor.current = null;
  }, []);

  const isSelected = useCallback((path: string) => raw.has(path), [raw]);

  return {
    paths,
    count: paths.length,
    all: ordered.length > 0 && paths.length === ordered.length,
    active: paths.length > 0,
    isSelected,
    toggle,
    selectAll,
    clear,
  };
}

/**
 * The page-level keys, wired by every page that offers selection: Escape drops
 * the selection, ⌘A takes the whole list. ⌘A only binds once something is
 * selected — an unarmed page must not steal select-all from the browser.
 * Returns true when the key was spent, so the caller can stop there.
 */
export function selectionKeyDown(e: KeyboardEvent, selection: Selection): boolean {
  const t = e.target as HTMLElement;
  const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
  if (e.key === 'Escape' && selection.active) {
    e.preventDefault();
    selection.clear();
    return true;
  }
  if ((e.key === 'a' || e.key === 'A') && (e.metaKey || e.ctrlKey) && selection.active && !typing) {
    e.preventDefault();
    selection.selectAll();
    return true;
  }
  return false;
}
