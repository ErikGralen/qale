import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';

/**
 * List selection, shared by every page that lists notes.
 *
 * Two models sit on one set. Most pages use the checkbox model: a click on a
 * row always opens it, and only the checkbox selects, so the meaning of a click
 * never changes under the PO's finger. Documents uses the Finder model: the row
 * IS the selection, so a click picks it ({@link Selection.only}), ⌘click adds
 * or removes one ({@link Selection.toggle}), and shift picks a range
 * ({@link Selection.extend}).
 *
 * Both models share one anchor: the last row the PO touched. A range always
 * reads from it.
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
  /** Make this row the whole selection, and the anchor. The Finder click. */
  only: (path: string) => void;
  /**
   * Select the anchor's row through this one, and nothing outside that range.
   * The anchor stays put, so sweeping shift back and forth moves the range's
   * end rather than growing a bigger and bigger set. With no anchor yet it
   * falls back to {@link only}.
   */
  extend: (path: string) => void;
  selectAll: () => void;
  clear: () => void;
}

/**
 * The set after a ⌘click, or after a shift-click on a checkbox page.
 *
 * A range only ADDS. Sweeping back over rows already picked is a correction of
 * the range's end, not an undo of the whole gesture.
 */
export function toggled(
  raw: ReadonlySet<string>,
  ordered: string[],
  anchor: string | null,
  path: string,
  range = false,
): Set<string> {
  const next = new Set(raw);
  if (range && anchor && anchor !== path) {
    const a = ordered.indexOf(anchor);
    const b = ordered.indexOf(path);
    if (a !== -1 && b !== -1) {
      for (const p of ordered.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(p);
      return next;
    }
  }
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}

/**
 * The set after a shift-click on a Finder page: the anchor's row through this
 * one, and nothing outside it. With no usable anchor it is just this row.
 */
export function extended(ordered: string[], anchor: string | null, path: string): Set<string> {
  if (anchor === null) return new Set([path]);
  const a = ordered.indexOf(anchor);
  const b = ordered.indexOf(path);
  if (a === -1 || b === -1) return new Set([path]);
  return new Set(ordered.slice(Math.min(a, b), Math.max(a, b) + 1));
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
      setRaw((prev) => toggled(prev, ordered, anchor.current, path, opts?.range));
      anchor.current = path;
    },
    [ordered],
  );

  const only = useCallback((path: string) => {
    setRaw(new Set([path]));
    anchor.current = path;
  }, []);

  const extend = useCallback(
    (path: string) => {
      // The anchor stays put, so it is read before the set is replaced.
      const from = anchor.current;
      setRaw(extended(ordered, from, path));
      if (from === null || ordered.indexOf(from) === -1) anchor.current = path;
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
    only,
    extend,
    selectAll,
    clear,
  };
}

/**
 * The page-level keys, wired by every page that offers selection: Escape drops
 * the selection, ⌘A takes the whole list.
 *
 * On a checkbox page ⌘A only binds once something is selected. An unarmed
 * page must not steal select-all from the browser. On a Finder page the rows
 * are the selection, so ⌘A is always the list's: pass `alwaysSelectAll`.
 *
 * Returns true when the key was spent, so the caller can stop there.
 */
export function selectionKeyDown(
  e: KeyboardEvent,
  selection: Selection,
  opts?: { alwaysSelectAll?: boolean },
): boolean {
  const t = e.target as HTMLElement;
  const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
  if (e.key === 'Escape' && selection.active) {
    e.preventDefault();
    selection.clear();
    return true;
  }
  const armed = opts?.alwaysSelectAll || selection.active;
  if ((e.key === 'a' || e.key === 'A') && (e.metaKey || e.ctrlKey) && armed && !typing) {
    e.preventDefault();
    selection.selectAll();
    return true;
  }
  return false;
}
