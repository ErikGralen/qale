/**
 * Recorded answers are anchored to the day they were recorded; the demo vault
 * is re-dated to today at Reset (docs/demo-mode.md DM-4). So every date token
 * in a recorded answer slides by the same offset before it leaves the server.
 * A recorded todo due "2026-07-25" comes out due the day the vault says.
 *
 * Only the response side moves. The request side is what the matcher reads,
 * and it normalises dates away rather than sliding them.
 */
import type { ContentBlock, WireResponse } from './replay-recordings.js';

const DATE = /\d{4}-\d{2}-\d{2}/g;
const DAY_MS = 24 * 60 * 60 * 1000;

/** One `YYYY-MM-DD` token, `days` days later. UTC, so no hour is ever lost. */
export function shiftDay(token: string, days: number): string {
  const at = Date.parse(`${token}T00:00:00Z`);
  if (Number.isNaN(at)) return token;
  return new Date(at + days * DAY_MS).toISOString().slice(0, 10);
}

/** Every date token in a string, slid. Timestamps move too: the date is inside. */
export function shiftDatesInText(text: string, days: number): string {
  if (days === 0) return text;
  return text.replace(DATE, (token) => shiftDay(token, days));
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
