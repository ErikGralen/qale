/**
 * The quick-add one-liner parser: "email Åsa tomorrow" → title + due,
 * "@Jonas update the docs" → title + owner (a waiting-on item). Light-touch by
 * design — a handful of unambiguous English date phrases, nothing clever. The
 * parse is previewed as chips before Enter, so a miss is visible, not silent.
 */

export interface ParsedTodo {
  title: string;
  /** "YYYY-MM-DD". */
  due?: string;
  /** External commitment — who owes it. */
  owner?: string;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(now: Date, n: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() + n);
  return fmt(d);
}

interface DueRule {
  re: RegExp;
  resolve: (m: RegExpMatchArray, now: Date) => string;
}

// Each rule optionally swallows a leading "by"/"on"/"due" connector.
const DUE_RULES: DueRule[] = [
  { re: /(?:\b(?:by|on|due)\s+)?\b(\d{4}-\d{2}-\d{2})\b/i, resolve: (m) => m[1]! },
  {
    re: /(?:\b(?:by|due)\s+)?\b(?:today|tonight|this\s+(?:morning|afternoon|evening)|eod|end\s+of\s+day)\b/i,
    resolve: (_m, now) => fmt(now),
  },
  { re: /(?:\b(?:by|due)\s+)?\b(?:tomorrow|tmrw|tmr)\b/i, resolve: (_m, now) => addDays(now, 1) },
  { re: /\bnext\s+week\b/i, resolve: (_m, now) => addDays(now, ((8 - now.getDay()) % 7) || 7) },
  {
    re: /\bin\s+(a|\d+)\s+(day|days|week|weeks)\b/i,
    resolve: (m, now) => {
      const n = m[1]!.toLowerCase() === 'a' ? 1 : parseInt(m[1]!, 10);
      return addDays(now, m[2]!.toLowerCase().startsWith('week') ? n * 7 : n);
    },
  },
  {
    re: /(?:\b(?:by|on|due)\s+)?\b(next\s+)?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/i,
    resolve: (m, now) => {
      let delta = (WEEKDAYS[m[2]!.toLowerCase()]! - now.getDay() + 7) % 7;
      // Bare "friday" on a Friday means today; "next friday" means a week out.
      if (m[1] && delta === 0) delta = 7;
      return addDays(now, delta);
    },
  },
];

function tidy(s: string): string {
  return s
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s,;:—-]+$/g, '')
    .replace(/^[\s,;:]+/g, '')
    .trim();
}

export function parseTodoInput(raw: string, now: Date = new Date()): ParsedTodo {
  let rest = raw;
  let owner: string | undefined;

  // "@Jonas update the docs" — @-mention anywhere claims the owner.
  const at = /(?:^|\s)@([\p{L}\p{N}_'-]+)/u.exec(rest);
  if (at) {
    owner = at[1];
    rest = rest.replace(at[0], ' ');
  } else {
    // "Jonas: update the docs" — a leading capitalised name with a colon.
    const named = /^\s*(\p{Lu}[\p{L}'-]{1,20}(?:\s+\p{Lu}[\p{L}'-]{1,20})?):\s+(.+)$/u.exec(rest);
    if (named) {
      owner = named[1];
      rest = named[2]!;
    }
  }

  let due: string | undefined;
  for (const rule of DUE_RULES) {
    const m = rule.re.exec(rest);
    if (m) {
      due = rule.resolve(m, now);
      rest = rest.replace(m[0], ' ');
      break;
    }
  }

  return { title: tidy(rest), due, owner };
}
