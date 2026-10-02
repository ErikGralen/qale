/**
 * Which outbound update is open when a session has several (docs/receipt-redesign.md,
 * "Several updates open one at a time").
 *
 * The outbound updates draw as rows in one card and one row is open at a time. These are
 * the rules for which one, with no React in them, so they can be tested on
 * their own.
 */

/**
 * The outbound update that is open.
 *
 * `ids` is every outbound update in the order the list draws them. `waiting` holds the
 * ones not sent yet. `picked` is the row the PO last chose, or null.
 *
 * A picked row that still waits stays open. Once it has left, the next waiting
 * row after it opens, so approving one outbound update moves on to the one below. If
 * nothing waits below, the first waiting row opens. Null means nothing waits.
 */
export function currentOutbound(
  ids: readonly string[],
  waiting: ReadonlySet<string>,
  picked: string | null,
): string | null {
  if (picked !== null && waiting.has(picked)) return picked;
  const from = picked === null ? -1 : ids.indexOf(picked);
  return (
    ids.find((id, i) => i > from && waiting.has(id)) ?? ids.find((id) => waiting.has(id)) ?? null
  );
}

/**
 * The waiting outbound update one step from `current`: the next one down (`dir` 1) or the
 * one before (`dir` -1). Null at either end, so the control that steps can
 * leave the screen when there is nowhere to go.
 */
export function stepOutbound(
  ids: readonly string[],
  waiting: ReadonlySet<string>,
  current: string | null,
  dir: 1 | -1,
): string | null {
  const at = current === null ? -1 : ids.indexOf(current);
  if (at < 0) return null;
  for (let i = at + dir; i >= 0 && i < ids.length; i += dir) {
    if (waiting.has(ids[i]!)) return ids[i]!;
  }
  return null;
}
