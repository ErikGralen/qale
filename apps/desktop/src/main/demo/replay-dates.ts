/**
 * Recorded answers carry the dates of the day they were recorded; the demo
 * vault is re-dated to today at every Reset (docs/demo-mode.md DM-4). So every
 * date token in a recorded answer slides by the difference between the two days
 * before it leaves the server. A todo the model wrote as due "in a week" comes
 * out a week from the demo day, whichever day that is.
 *
 * **A date inside a path or a wikilink never moves.** The vault shift renames
 * nothing (`shiftProse` in @qale/domain/demo masks wikilinks for exactly this
 * reason), so `decisions/2026-05-18-h2-order-payroll-first` is that file's name
 * on every demo day. Sliding it would point a recorded tool call at a file that
 * does not exist, and every one of them would miss.
 *
 * Only the response side moves. The request side is what the matcher reads,
 * and it normalises dates away rather than sliding them.
 */
import type { ContentBlock, WireResponse } from './replay-recordings.js';

const DATE = /\d{4}-\d{2}-\d{2}/g;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A run of slug characters holding a date, e.g. `meetings/2026-07-09-steering`
 * or `2026-07-09-steering.md`. A path or a filename, never prose: prose puts a
 * space after the date.
 */
const SLUG_WITH_DATE = /[\w.-]*\/[\w./-]*\d{4}-\d{2}-\d{2}[\w./-]*|\d{4}-\d{2}-\d{2}[\w-]*\.\w+/g;

/** `[[…]]`, whatever is inside it. Same rule the vault shift uses. */
const WIKILINK = /\[\[[^\]]+\]\]/g;

/** The sentinel cannot occur in a model's answer, so restoring is unambiguous. */
const MARK = '\u0000';

/**
 * Run `slide` over the text with every path and wikilink hidden, then put them
 * back byte for byte.
 */
function protectingPaths(text: string, slide: (t: string) => string): string {
  const held: string[] = [];
  const hide = (m: string): string => {
    held.push(m);
    return `${MARK}${held.length - 1}${MARK}`;
  };
  const masked = text.replace(WIKILINK, hide).replace(SLUG_WITH_DATE, hide);
  return slide(masked).replace(
    new RegExp(`${MARK}(\\d+)${MARK}`, 'g'),
    (_, i: string) => held[Number(i)] ?? '',
  );
}

/** One `YYYY-MM-DD` token, `days` days later. UTC, so no hour is ever lost. */
export function shiftDay(token: string, days: number): string {
  const at = Date.parse(`${token}T00:00:00Z`);
  if (Number.isNaN(at)) return token;
  return new Date(at + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Every date token in a string, slid, except the ones inside a path or a
 * wikilink. Timestamps move too: the date is inside one.
 */
export function shiftDatesInText(text: string, days: number): string {
  if (days === 0) return text;
  return protectingPaths(text, (t) => t.replace(DATE, (token) => shiftDay(token, days)));
}

/** The same, walked through anything JSON can hold (a tool call's input). */
export function shiftDatesDeep<T>(value: T, days: number): T {
  if (days === 0) return value;
  if (typeof value === 'string') return shiftDatesInText(value, days) as T;
  if (Array.isArray(value)) return value.map((v) => shiftDatesDeep(v, days)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>))
      out[key] = shiftDatesDeep(v, days);
    return out as T;
  }
  return value;
}

/**
 * The answer as it goes out: text, thinking and tool-call inputs slid, and the
 * bookkeeping (id, model, usage) left alone. An id that looks like a date is
 * still an id.
 */
export function shiftResponseDates(response: WireResponse, days: number): WireResponse {
  if (days === 0) return response;
  const content = response.content.map((block) => shiftBlock(block, days));
  return { ...response, content };
}

function shiftBlock(block: ContentBlock, days: number): ContentBlock {
  const out: ContentBlock = { ...block };
  if (typeof out.text === 'string') out.text = shiftDatesInText(out.text, days);
  if (typeof out.thinking === 'string') out.thinking = shiftDatesInText(out.thinking, days);
  if (out.input !== undefined) out.input = shiftDatesDeep(out.input, days);
  return out;
}
