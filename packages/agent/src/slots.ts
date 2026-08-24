/**
 * Slots. A session leaves them in a working document where it wants the PM's
 * take (docs/brainstorm-skill.md).
 *
 * A slot is a fenced block with `slot` and an id on the opening line:
 *
 * ```slot idea-3
 * Keep? Cut? Smaller?
 * ```
 *
 * The fence was chosen over a marker of our own for two reasons. It degrades to
 * an inert code block in any other markdown renderer, so a round file the PM
 * copies out still reads. And a fence is already this codebase's "not real
 * content" zone: the wikilink plugin walks `text` nodes, a fence is a `code`
 * node, so nothing in a slot is indexed, linked or counted.
 *
 * This module is the one reader of that syntax. The agent package parses to
 * validate a round before it parks on it, and the renderer parses to draw a box
 * where each fence is, so both have to agree down to the character offset. Two
 * scanners here would show the PM a box the parked request has no id for.
 */

/** One slot found in a document, with enough position to swap the fence out. */
export interface Slot {
  id: string;
  /** What the model wrote inside the fence, verbatim. Empty fence ⇒ absent. */
  prompt?: string;
  /** Offset of the first character of the opening fence line. */
  start: number;
  /** Offset just past the last character of the closing fence line. */
  end: number;
}

/** A slot in a parked request: the id the answer is keyed by, and its prompt. */
export interface CommentSlot {
  id: string;
  prompt?: string;
}

/** One document handed to the PM to write in, as the card and the row hold it. */
export interface CommentPlan {
  /** Session-folder-relative path, e.g. "round-1.md". */
  path: string;
  slots: CommentSlot[];
}

/** What came back when the PM pressed Send. */
export interface CommentAnswers {
  /** Slot id → what they wrote. A slot they left empty is simply absent. */
  answers: Record<string, string>;
  /** The general box at the foot of the document, if they used it. */
  general?: string;
}

/**
 * Ids are addresses, so they stay to one word of the characters a path, a JSON
 * key and a heading can all carry without quoting.
 */
const SLOT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Opening or closing fence: up to three spaces, three or more ` or ~, info. */
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*(.*)$/;

/**
 * Find every slot in a document, in the order it appears.
 *
 * A malformed slot fails the whole parse rather than being skipped. A slot is a
 * question the model asked, and dropping one quietly would hand the PM a
 * document with a hole in it where the model believes it asked something.
 *
 * A fence inside another fence is not a slot: it is the outer fence's content,
 * exactly as markdown reads it, so a round file that SHOWS the slot syntax in an
 * example block does not sprout a box.
 */
export function parseSlots(markdown: string): { slots: Slot[] } | { error: string } {
  const slots: Slot[] = [];
  const seen = new Set<string>();
  /** The fence we are inside. `id` is null for a plain fence, which we skip. */
  let open: {
    marker: string;
    width: number;
    start: number;
    id: string | null;
    body: string[];
  } | null = null;
  let offset = 0;

  for (const line of markdown.split('\n')) {
    const start = offset;
    offset += line.length + 1;
    const m = FENCE.exec(line);

    if (open) {
      const closes = m && m[1]![0] === open.marker && m[1]!.length >= open.width && !m[2]!.trim();
      if (closes) {
        if (open.id) {
          const prompt = open.body.join('\n').trim();
          slots.push({
            id: open.id,
            ...(prompt ? { prompt } : {}),
            start: open.start,
            end: start + line.length,
          });
        }
        open = null;
      } else if (open.id) {
        open.body.push(line);
      }
      continue;
    }

    if (!m) continue;
    const marker = m[1]![0]!;
    const width = m[1]!.length;
    const info = m[2]!.trim();
    const words = info.split(/\s+/).filter(Boolean);
    if (words[0] !== 'slot') {
      open = { marker, width, start, id: null, body: [] };
      continue;
    }
    if (words.length === 1) {
      return { error: 'a slot fence has no id. Write ```slot idea-3, with one id per slot.' };
    }
    if (words.length > 2) {
      return {
        error: `the slot id "${words.slice(1).join(' ')}" is more than one word. Use a single word like "idea-3".`,
      };
    }
    const id = words[1]!;
    if (!SLOT_ID.test(id)) {
      return {
        error: `"${id}" is not a usable slot id. Use letters, digits, "-" and "_", starting with a letter or digit.`,
      };
    }
    if (seen.has(id)) {
      return {
        error: `two slots are called "${id}". Every id must be different, or the answers cannot be told apart.`,
      };
    }
    seen.add(id);
    open = { marker, width, start, id, body: [] };
  }

  // A slot fence nobody closed swallows the rest of the document, so the boxes
  // below it disappear. Say so rather than handing back the shorter list.
  if (open?.id) {
    return {
      error: `the slot "${open.id}" is never closed. Every slot fence needs a closing fence.`,
    };
  }
  return { slots };
}
