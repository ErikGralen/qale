/** The given date (default: now) as local "YYYY-MM-DD" — never UTC, so a late
 *  evening doesn't slip into tomorrow. */
export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
