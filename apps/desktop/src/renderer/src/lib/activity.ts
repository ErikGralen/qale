import type { ActivityDTO } from '@qale/ipc';

/**
 * The reading order of the receipt (docs/easier-tickets.md E-9).
 *
 * Everything here is pure so it can be tested without a browser: the view holds
 * the markup and nothing else. A row is one thing the agent wrote without
 * asking, and the page's job is to make a week of them scannable — which is a
 * question about days, not about rows.
 */

/** One day's writes, newest first, under the name a person gives that day. */
export interface ActivityDay {
  /** Local YYYY-MM-DD — the group's identity, never shown. */
  key: string;
  /** "Today", "Yesterday", or the date written out. */
  label: string;
  rows: ActivityDTO[];
}

/** Local YYYY-MM-DD, so a late evening never counts as tomorrow. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Midnight this morning, local. */
export function startOfToday(now: number = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * What to call a day. The two names a person actually uses, then the date. No
 * "3 days ago": inside a list of dates it makes the reader do arithmetic.
 */
export function dayLabel(at: number, now: number = Date.now()): string {
  const key = dayKey(new Date(at));
  if (key === dayKey(new Date(now))) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === dayKey(yesterday)) return 'Yesterday';
  return new Date(at).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** The time of day one row landed, for the row's own meta line. */
export function timeOfDay(at: string): string {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Rows split into days, newest day first, order inside a day untouched (the
 * channel already answers newest first). Rows with an unreadable timestamp are
 * dropped rather than heaped into a day of their own: a receipt that cannot say
 * when is not a receipt.
 */
export function groupByDay(rows: ActivityDTO[], now: number = Date.now()): ActivityDay[] {
  const days: ActivityDay[] = [];
  for (const row of rows) {
    const at = Date.parse(row.at);
    if (Number.isNaN(at)) continue;
    const key = dayKey(new Date(at));
    const last = days.at(-1);
    if (last?.key === key) last.rows.push(row);
    else days.push({ key, label: dayLabel(at, now), rows: [row] });
  }
  return days;
}

/**
 * What the agent has written on its own today, for the quiet number on the rail.
 * A row that was put back is not something it did: undoing it is the whole
 * point of the list, and a count that ignores the undo would nag about work
 * that no longer exists.
 */
export function countToday(rows: ActivityDTO[], now: number = Date.now()): number {
  const since = startOfToday(now);
  return rows.filter((r) => !r.reverted && Date.parse(r.at) >= since).length;
}
