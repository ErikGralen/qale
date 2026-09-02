/**
 * Due dates for the commitment ledger: the arithmetic, the labels, the four
 * presets and the one-line parser behind the date picker.
 *
 * Every date here is a local "YYYY-MM-DD" string, never a UTC instant, so a
 * late evening never slips into tomorrow. The parser is deliberately small: a
 * handful of shapes a PO actually types ("fri", "5 sep", "in 2 weeks", "12"),
 * and null for everything else. A miss is shown in the picker before Enter, so
 * it is visible, not silent.
 */

import { localDateStr } from './dates';

/** A local "YYYY-MM-DD" string as a Date at local midnight. */
export function toDate(iso: string): Date {
  return new Date(`${iso}T00:00`);
}

/** `iso` moved by `days` days. */
export function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}

/** `iso` moved by `months` months, clamped to the end of the shorter month. */
export function addMonths(iso: string, months: number): string {
  const d = toDate(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
  return localDateStr(d);
}

/** Whole days from `from` to `to`; negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86400000);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Year/month/day as a date string, or null if that day does not exist. */
function ymd(year: number, month: number, day: number): string | null {
  if (month < 0 || month > 11 || day < 1 || day > daysInMonth(year, month)) return null;
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The next `dow` (0=Sunday) on or after `today`. Today itself counts. */
function nextDow(today: string, dow: number): string {
  return addDays(today, (dow - toDate(today).getDay() + 7) % 7);
}

/** The Monday of the week `iso` sits in — weeks run Monday to Sunday. */
export function startOfWeek(iso: string): string {
  return addDays(iso, -((toDate(iso).getDay() + 6) % 7));
}

/** The next Monday strictly after `today`. */
export function nextMonday(today: string): string {
  return addDays(today, (8 - toDate(today).getDay()) % 7 || 7);
}

/** The coming Friday — this week's if it is still ahead, else next week's. */
export function endOfWeek(today: string): string {
  return nextDow(today, 5);
}

/** The four presets, in the order a PO reaches for them. */
const PRESETS: { label: string; due: (today: string) => string }[] = [
  { label: 'Today', due: (t) => t },
  { label: 'Tomorrow', due: (t) => addDays(t, 1) },
  { label: 'End of week', due: endOfWeek },
  { label: 'End of next week', due: (t) => addDays(endOfWeek(t), 7) },
];

/**
 * The presets as dates, minus the collisions — on a Friday "end of week" is
 * today, and offering the same day twice makes the menu look broken.
 */
export function datePresets(today: string): { label: string; due: string }[] {
  const all = PRESETS.map((p) => ({ label: p.label, due: p.due(today) }));
  return all.filter((p, i) => all.findIndex((o) => o.due === p.due) === i);
}

const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const dayMonthYear = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const weekdayDayMonth = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const monthYear = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

/** "today" / "tomorrow" / "18 Jul" — compact, relative where it reads faster. */
export function dueLabel(due: string, today: string): string {
  if (due === today) return 'today';
  const days = daysBetween(today, due);
  if (days === 1) return 'tomorrow';
  const d = toDate(due);
  return (d.getFullYear() === toDate(today).getFullYear() ? dayMonth : dayMonthYear).format(d);
}

/** "4 Sep 2026" — a date as a property value, where the year is part of it. */
export function dateLabel(iso: string): string {
  return dayMonthYear.format(toDate(iso));
}

/** "Fri 4 Sep" — the trailing hint on a picker row, where the weekday matters. */
export function weekdayLabel(due: string): string {
  return weekdayDayMonth.format(toDate(due));
}

/** "August 2026" — the calendar heading. */
export function monthLabel(iso: string): string {
  return monthYear.format(toDate(iso));
}

/**
 * The six-week grid that holds the month `iso` sits in, Monday first. Always 42
 * days, so the calendar keeps its height as the months change.
 */
export function monthGrid(iso: string): string[] {
  const d = toDate(iso);
  const first = ymd(d.getFullYear(), d.getMonth(), 1)!;
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** Same year and month? */
export function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** "sep" / "sept" / "september" → 8. Needs three letters, so "ma" stays a miss. */
function monthIndex(word: string): number | null {
  if (word.length < 3) return null;
  const w = word === 'sept' ? 'sep' : word;
  const hits = MONTHS.filter((m) => m.startsWith(w));
  return hits.length === 1 ? MONTHS.indexOf(hits[0]!) : null;
}

/** "mon" / "monday" → 1. Three letters is enough to be unambiguous. */
function weekdayIndex(word: string): number | null {
  if (word.length < 3) return null;
  const hits = WEEKDAYS.filter((d) => d.startsWith(word));
  return hits.length === 1 ? WEEKDAYS.indexOf(hits[0]!) : null;
}

/** The year that puts day/month next, not last: this one, or the one after. */
function comingYear(today: string, month: number, day: number): string | null {
  const year = toDate(today).getFullYear();
  const here = ymd(year, month, day);
  if (here && here >= today) return here;
  return ymd(year + 1, month, day);
}

/**
 * One typed line → a date, or null. Understands: today, tomorrow, weekday
 * names, "next <weekday>", next week, end of week, "in 3 days", "2w",
 * "2026-09-04", "4/9", "4 sep", "sep 4" and a bare day of the month.
 */
export function parseDateInput(raw: string, today: string = localDateStr()): string | null {
  const text = raw.trim().toLowerCase().replace(/\s+/g, ' ').replace(/,/g, '');
  if (!text) return null;

  if (/^(today|tod|tdy|now)$/.test(text)) return today;
  if (/^(tomorrow|tomorow|tom|tmr|tmrw|tmw)$/.test(text)) return addDays(today, 1);
  if (/^(eow|end of (the )?week)$/.test(text)) return endOfWeek(today);
  if (/^(eonw|end of next week)$/.test(text)) return addDays(endOfWeek(today), 7);
  if (/^next week$/.test(text)) return nextMonday(today);
  if (/^next month$/.test(text)) return addMonths(today, 1);

  // "in 3 days", "in a week", "3d", "2 weeks", "6w", "in 2 months".
  const rel = /^(?:in )?(a|an|\d{1,3}) ?(d|w|m|days?|weeks?|months?)$/.exec(text);
  if (rel) {
    const n = /^\d+$/.test(rel[1]!) ? parseInt(rel[1]!, 10) : 1;
    const unit = rel[2]![0];
    return unit === 'd'
      ? addDays(today, n)
      : unit === 'w'
        ? addDays(today, n * 7)
        : addMonths(today, n);
  }

  // "friday" is the coming Friday (today counts); "next friday" is a week on.
  const dow = /^(next )?([a-z]{3,9})$/.exec(text);
  if (dow) {
    const idx = weekdayIndex(dow[2]!);
    if (idx !== null) {
      const hit = nextDow(today, idx);
      return dow[1] && hit === today ? addDays(hit, 7) : hit;
    }
  }

  // "2026-09-04" — already the storage shape.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) return ymd(+iso[1]!, +iso[2]! - 1, +iso[3]!);

  // "4/9", "4.9.26", "4-9-2026" — day first, the way the app prints dates.
  const numeric = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/.exec(text);
  if (numeric) {
    const day = +numeric[1]!;
    const month = +numeric[2]! - 1;
    if (!numeric[3]) return comingYear(today, month, day);
    const y = +numeric[3];
    return ymd(y < 100 ? 2000 + y : y, month, day);
  }

  // "4 sep", "4 september 2027", "sep 4".
  const dm = /^(\d{1,2}) ?([a-z]{3,9})\.? ?(\d{4})?$/.exec(text);
  const md = /^([a-z]{3,9})\.? ?(\d{1,2})(?: (\d{4}))?$/.exec(text);
  const named = dm
    ? { day: +dm[1]!, word: dm[2]!, year: dm[3] }
    : md
      ? { day: +md[2]!, word: md[1]!, year: md[3] }
      : null;
  if (named) {
    const month = monthIndex(named.word);
    if (month !== null) {
      return named.year ? ymd(+named.year, month, named.day) : comingYear(today, month, named.day);
    }
  }

  // A bare day of the month: this month if it is still ahead, else the next.
  const bare = /^(\d{1,2})$/.exec(text);
  if (bare) {
    const day = +bare[1]!;
    const d = toDate(today);
    const here = ymd(d.getFullYear(), d.getMonth(), day);
    if (here && here >= today) return here;
    const next = toDate(addMonths(`${today.slice(0, 8)}01`, 1));
    return ymd(next.getFullYear(), next.getMonth(), day);
  }

  return null;
}
