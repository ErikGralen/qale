/**
 * Dates in a script, resolved for the demo day (docs/plan-demo-replay.md,
 * section 4.1).
 *
 * A script is written in anchor time: `vault-dev/` calls 2026-07-17 "today".
 * At serve time every plain date in prose slides by today's offset, and a
 * date inside a path or a wikilink stays, which is the rule `replay-dates.ts`
 * already has. The one escape hatch is a template, for a path that carries a
 * demo-day date (a calendar mirror, a `sources/` page written today):
 *
 *   {{today}}           the demo day
 *   {{today+7}}         seven days after it, {{today-1}} the day before
 *   {{date:2026-07-16}} that anchor date, slid to the demo day's frame
 *
 * A template resolves to a final date wherever it stands, prose or path. It
 * is hidden behind a sentinel while the plain dates slide, so its value is
 * never slid a second time.
 */
import { ANCHOR } from '@qale/domain/demo';
import { shiftDatesInText, shiftDay } from './replay-dates.js';
import type { ToolCall, Turn } from './scenario.js';
import { turnText } from './scenario.js';

const TEMPLATE = /\{\{\s*(today(?:\s*[+-]\s*\d+)?|date:\s*\d{4}-\d{2}-\d{2})\s*\}\}/g;

/**
 * The sentinel cannot occur in a script, so restoring is unambiguous. Not the
 * one `replay-dates.ts` uses: its own restore runs in between and must not
 * pick these up.
 */
const MARK = '\u0001';

/** One template's value, given the anchor and the demo day's offset. */
export function resolveTemplate(body: string, offsetDays: number): string {
  const inner = body.replace(/\s+/g, '');
  if (inner.startsWith('date:')) return shiftDay(inner.slice('date:'.length), offsetDays);
  const delta = inner.slice('today'.length);
  const days = delta ? Number(delta) : 0;
  return shiftDay(ANCHOR, offsetDays + days);
}

/**
 * The text as it goes out: templates resolved, plain dates slid, paths and
 * wikilinks left as they are.
 */
export function expandText(text: string, offsetDays: number): string {
  const held: string[] = [];
  const masked = text.replace(TEMPLATE, (_, body: string) => {
    held.push(resolveTemplate(body, offsetDays));
    return `${MARK}${held.length - 1}${MARK}`;
  });
  return shiftDatesInText(masked, offsetDays).replace(
    new RegExp(`${MARK}(\\d+)${MARK}`, 'g'),
    (_, i: string) => held[Number(i)] ?? '',
  );
}

/** The same, walked through anything JSON can hold (a tool call's input). */
export function expandDeep<T>(value: T, offsetDays: number): T {
  if (typeof value === 'string') return expandText(value, offsetDays) as T;
  if (Array.isArray(value)) return value.map((v) => expandDeep(v, offsetDays)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>))
      out[key] = expandDeep(v, offsetDays);
    return out as T;
  }
  return value;
}

/** A turn ready to serve: one text string and the tool calls, all dated for today. */
export interface RenderedTurn {
  pause?: number;
  text: string;
  tools: ToolCall[];
}

export function renderTurn(turn: Turn, offsetDays: number): RenderedTurn {
  return {
    ...(turn.pause !== undefined ? { pause: turn.pause } : {}),
    text: expandText(turnText(turn), offsetDays),
    tools: (turn.tools ?? []).map((tool) => ({
      name: tool.name,
      input: expandDeep(tool.input, offsetDays),
    })),
  };
}

/** A lookup table with templates resolved in both the keys and the values. */
export function expandTable(
  table: Record<string, string> | undefined,
  offsetDays: number,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(table ?? {}))
    out[expandText(key, offsetDays)] = expandText(value, offsetDays);
  return out;
}
