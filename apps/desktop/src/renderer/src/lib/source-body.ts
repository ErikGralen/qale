/**
 * A source page is one address (E-18): what we made of the source on top, what
 * arrived underneath. This splits the two apart so the page can show the first
 * and fold the second away.
 *
 * The seam is a heading, written by `file_source`
 * (`SOURCE_ORIGINAL_HEADING` in @qale/application's arrival use-case). The
 * spelling is repeated here rather than imported because the renderer does not
 * load the application package. Change one and change the other, or the fold
 * quietly stops and a 12,000-word transcript buries the four lines worth
 * reading.
 */
const ORIGINAL = /^## Original[ \t]*$/m;

export interface SourceParts {
  /** What the source says, in the reader's words. Markdown. */
  summary: string;
  /** What arrived, verbatim. Markdown. */
  original: string;
  /** How long the original is, for the line that offers to show it. */
  words: number;
}

/** Words in a string, counted the cheap way: runs between whitespace. */
export function wordCount(s: string): number {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const space = c === 32 || c === 9 || c === 10 || c === 13;
    if (space) inWord = false;
    else if (!inWord) {
      inWord = true;
      n++;
    }
  }
  return n;
}

/**
 * The two halves of a source body, or null when there is only one thing here.
 *
 * Null covers every source filed before the summary existed, and every one
 * filed without reading. Those pages read exactly as they always have: the
 * fold is an offer the page can only make when there is something to fold.
 */
export function splitSource(body: string): SourceParts | null {
  const seam = ORIGINAL.exec(body);
  if (!seam) return null;
  const summary = body.slice(0, seam.index).trim();
  const original = body.slice(seam.index + seam[0].length).trim();
  if (!summary || !original) return null;
  return { summary, original, words: wordCount(original) };
}
