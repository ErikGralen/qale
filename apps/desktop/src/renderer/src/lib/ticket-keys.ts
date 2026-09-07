/**
 * Ticket keys, in one place: the shape, and how to find them in a sentence.
 *
 * A key is a reference whether it was written as `[[SCH-231]]` or just typed
 * into the line, so every surface that draws card text splits with this rather
 * than carrying its own copy of the pattern.
 */

/** Bare ticket key, e.g. "PAY-142" — the shape POs type and providers mint. */
export const TICKET_KEY_RE = /^[A-Z][A-Z0-9]{1,9}-\d+$/;

/** The same shape inside running text. Word boundaries keep "xSCH-1" and
 *  "SCH-1a" out: a key is a whole word or it is not a key. */
const IN_TEXT_RE = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

/**
 * Split a sentence into its plain runs and the ticket keys inside it. Syntax
 * only — plenty of words wear a key's shape without being one ("COVID-19"), so
 * the caller still has to look each one up before it draws anything clickable.
 */
export function splitTicketKeys(text: string): (string | { key: string })[] {
  const parts: (string | { key: string })[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  IN_TEXT_RE.lastIndex = 0;
  while ((match = IN_TEXT_RE.exec(text)) !== null) {
    const key = match[0];
    if (!TICKET_KEY_RE.test(key)) continue;
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push({ key });
    last = match.index + key.length;
  }
  if (parts.length === 0) return [text];
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
