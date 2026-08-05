import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

/**
 * Undo the model's double-escaped Unicode before a tool ever sees its arguments.
 *
 * Seen in the wild on a Swedish session: `frontmatter.summary` arrived as
 * "affärsmodell" while `body` and `rationale` in the SAME call arrived with
 * every å, ä and ö spelled out as a backslash-u escape — six characters where
 * one belongs. A note filed that way is unreadable, and because the model can
 * see its own earlier tool calls, one escaped call teaches the rest of the
 * session to escape too: the run that showed this went from clean to escaped
 * and never came back.
 *
 * It happens where we cannot reach it. A properly escaped ä inside a JSON
 * string decodes to "ä" on its own, so for the escape to survive as text the
 * model has to double the backslash — the value is already wrong by the time pi
 * parses it, and nothing downstream can tell it from text the PM meant. So the
 * repair goes here, at the edge, before validation and before anything is
 * stored.
 *
 * We decode rather than reject because the content is otherwise correct and a
 * rejection costs the PM a whole run. Text that really wants a backslash-u on
 * the page doubles the backslash itself, and the guard below leaves that alone.
 */

/** A `\uXXXX` whose backslash is not itself escaped. */
const ESCAPE_RE = /(?<!\\)\\u([0-9a-fA-F]{4})/g;

/**
 * Decode literal `\uXXXX` sequences back to the characters they spell.
 *
 * Escapes below U+0020 are left as written: an escape for a newline or a tab in
 * a body is far more likely to be text about escape sequences than a character
 * the model meant to type, and decoding one would drop a raw control character
 * into a note.
 */
export function decodeUnicodeEscapes(s: string): string {
  if (!s.includes('\\u')) return s;
  return s.replace(ESCAPE_RE, (whole, hex: string) => {
    const code = parseInt(hex, 16);
    if (code < 0x20 || code === 0x7f) return whole;
    return String.fromCharCode(code);
  });
}

/** Walk a tool's arguments and repair every string in them, at any depth. */
export function decodeArgs<T>(value: T): T {
  if (typeof value === 'string') return decodeUnicodeEscapes(value) as T;
  if (Array.isArray(value)) return value.map((v) => decodeArgs(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = decodeArgs(v);
    return out as T;
  }
  return value;
}

/**
 * Wrap tools so their `execute` receives repaired arguments. Applied to the
 * whole custom tool set rather than to the propose tools alone: the same model
 * writes a draft comment, a session file and a note, and there is no reason the
 * slip would confine itself to one of them.
 */
export function withDecodedArgs(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.map((tool) => {
    const inner = tool.execute.bind(tool) as (id: string, params: unknown, signal?: AbortSignal) => unknown;
    return {
      ...tool,
      execute: (id: string, params: unknown, signal?: AbortSignal) => inner(id, decodeArgs(params), signal),
    } as ToolDefinition;
  });
}
