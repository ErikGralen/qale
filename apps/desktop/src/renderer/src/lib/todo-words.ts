/**
 * A todo's body, split into the words the commitment was drawn from and
 * everything written after them.
 *
 * The agent writes a todo as a leading blockquote (what was said, then a
 * `from [[meeting]]` line) followed by whatever else is worth keeping. On the
 * panel those are two different things: the quote is set as a quotation, and
 * the citation is already the byline, so it must not be read twice.
 */

export interface TodoWords {
  /** The quoted words, without the surrounding quote marks. Null when the body has no leading quote. */
  quote: string | null;
  /** The `[[…]]` ref on the quote's own `from` line, if it had one. */
  cite: string | null;
  /** Everything after the quote, trimmed. */
  rest: string;
}

const FROM_LINE = /^from\s+(\[\[[^\]]+\]\])\s*$/i;

/** `"…"` or `“…”` → `…`. Only a pair is stripped; a lone mark stays. */
function unquote(text: string): string {
  const m = /^["“](.*)["”]$/s.exec(text);
  return m ? m[1]!.trim() : text;
}

export function splitTodoWords(body: string): TodoWords {
  const lines = body.trim().split('\n');
  let end = 0;
  while (end < lines.length && lines[end]!.startsWith('>')) end++;
  if (end === 0) return { quote: null, cite: null, rest: body.trim() };

  const quoted = lines
    .slice(0, end)
    .map((l) => l.replace(/^>\s?/, ''))
    .filter((l, i, all) => l.trim() !== '' || (i > 0 && i < all.length - 1));

  let cite: string | null = null;
  const last = quoted[quoted.length - 1];
  const from = last ? FROM_LINE.exec(last.trim()) : null;
  if (from) {
    cite = from[1]!;
    quoted.pop();
  }

  const quote = unquote(quoted.join('\n').trim());
  return {
    quote: quote === '' ? null : quote,
    cite,
    rest: lines.slice(end).join('\n').trim(),
  };
}
