import type { KeyboardEvent } from 'react';

/**
 * Arrow-key focus inside a list of rows.
 *
 * Every row that can take focus carries `data-note-row`. Down and up walk those
 * elements in DOM order, which is the order the eye reads them. One helper, so
 * a plain note list and the Documents tree move the same way.
 *
 * Returns true when the key was spent, so the caller can stop there.
 */
export function moveRowFocus(e: KeyboardEvent<HTMLElement>): boolean {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return false;
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-note-row]')];
  const idx = rows.findIndex((r) => r === document.activeElement);
  if (idx === -1) return false;
  e.preventDefault();
  rows[Math.min(rows.length - 1, Math.max(0, idx + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  return true;
}
