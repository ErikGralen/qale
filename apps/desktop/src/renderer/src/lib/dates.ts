/** The given date (default: now) as local "YYYY-MM-DD" — never UTC, so a late
 *  evening doesn't slip into tomorrow. */
export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "just now" / "2h ago" / "3d ago" / "6w ago" — the quiet freshness voice on
 *  hover cards and sync-health lines. Accepts ms epoch or ISO. */
export function relativeTime(when: number | string): string {
  const t = typeof when === 'number' ? when : Date.parse(when);
  if (Number.isNaN(t)) return '';
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 9) return `${weeks}w ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}
