/**
 * Put the PM's unsaved edit back on top of a body that changed on disk.
 *
 * The editor holds three texts when the agent writes to a page the PM is typing
 * in: the body the editor loaded (`base`), the body the editor holds now
 * (`mine`), and the body that just arrived (`theirs`). This merges them line by
 * line. Both edits survive when they sit in different places. When they touch
 * the same lines nothing is guessed: the merge refuses, the PM's text stands,
 * and the editor says so.
 *
 * All three texts must be in the same markdown dialect. The editor re-serializes
 * what it parses, so the caller runs the incoming body through the editor first;
 * otherwise formatting drift reads as an edit and every merge refuses.
 */

/** Trailing-newline-insensitive equality; the vault may normalize the tail. */
export function sameBody(a: string, b: string): boolean {
  return a.replace(/\n+$/, '') === b.replace(/\n+$/, '');
}

/** What the editor should do with a body that changed under it. */
export type MergeOutcome =
  /** Nothing of the PM's is pending. Show the new body and drop the pending edit. */
  | { kind: 'replace'; body: string }
  /** Both edits fit. Show this body and keep saving, because it is not on disk yet. */
  | { kind: 'merged'; body: string }
  /** The two edits touch the same lines. Keep the PM's text and tell them. */
  | { kind: 'kept' };

/** The toast, and only when the merge refused. A merge that worked says nothing. */
export const EXTERNAL_CHANGE_KEPT =
  'Qale changed this page while you were typing. Your text is kept. Its change is in Version history.';

/**
 * Decide what the editor does with an external change. `mine` is null when the
 * editor has nothing unsaved, which is the common case and stays what it was:
 * the new body replaces what is on screen.
 */
export function resolveExternalChange({
  base,
  mine,
  theirs,
}: {
  base: string;
  mine: string | null;
  theirs: string;
}): MergeOutcome {
  if (mine === null || sameBody(mine, base) || sameBody(mine, theirs)) {
    return { kind: 'replace', body: theirs };
  }
  const merged = mergeBody(base, mine, theirs);
  return merged === null ? { kind: 'kept' } : { kind: 'merged', body: merged };
}

/**
 * Merge two edits of one text, or return null when they touch the same lines.
 *
 * Each side is read as a list of changes against the base: a run of base lines
 * that goes away, and the lines that take its place. Changes in different
 * places all land. Two changes over the same base lines, or two blocks added at
 * the same point, are a refusal. Nothing is ever guessed at.
 */
export function mergeBody(base: string, mine: string, theirs: string): string | null {
  if (sameBody(mine, theirs)) return theirs;
  if (sameBody(base, mine)) return theirs;
  if (sameBody(base, theirs)) return mine;

  // The tail is not an edit: the vault normalizes it, and a stray empty last
  // line would otherwise drag the last real line into somebody else's change.
  const tail = /\n*$/.exec(theirs)![0];
  const b = trimTail(base).split('\n');
  const mineChanges = changes(b, trimTail(mine).split('\n'));
  const theirsChanges = changes(b, trimTail(theirs).split('\n'));
  if (!mineChanges || !theirsChanges) return null;

  const all: Change[] = [...mineChanges];
  for (const t of theirsChanges) {
    const same = all.find((m) => m.from === t.from && m.to === t.to && sameLines(m.lines, t.lines));
    if (same) continue; // both sides wrote the same thing; write it once
    if (all.some((m) => clash(m, t))) return null;
    all.push(t);
  }
  // Base order, and an insertion goes in before a change that starts where it
  // sits, so added text lands above the line it was added in front of.
  all.sort((x, y) => x.from - y.from || (x.to === x.from ? 0 : 1) - (y.to === y.from ? 0 : 1));

  const out: string[] = [];
  let cursor = 0;
  for (const change of all) {
    out.push(...b.slice(cursor, change.from));
    out.push(...change.lines);
    cursor = change.to;
  }
  out.push(...b.slice(cursor));
  return out.join('\n') + tail;
}

/** Base lines `[from, to)` become `lines`. `from === to` is an insertion. */
interface Change {
  from: number;
  to: number;
  lines: string[];
}

function trimTail(text: string): string {
  return text.replace(/\n+$/, '');
}

function sameLines(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

/** Two changes that cannot both be honoured without picking a winner. */
function clash(a: Change, b: Change): boolean {
  if (a.from === a.to && b.from === b.to) return a.from === b.from; // added at one point
  return a.from < b.to && b.from < a.to; // the same base lines
}

/**
 * What one side did to the base, as a list of changes. Null when the two texts
 * are too big to compare, which the caller reads as a refusal: a merge nobody
 * waits for is worse than a message.
 */
function changes(b: string[], side: string[]): Change[] | null {
  const kept = matchedLines(b, side);
  if (!kept) return null;
  const out: Change[] = [];
  // Walk the lines both texts still share. Whatever sits between two of them
  // is one change, and the ends of the text are two more places one can sit.
  const stops = [...kept, [b.length, side.length] as [number, number]];
  let bi = 0;
  let si = 0;
  for (const [bStop, sStop] of stops) {
    if (bStop > bi || sStop > si) out.push({ from: bi, to: bStop, lines: side.slice(si, sStop) });
    bi = bStop + 1;
    si = sStop + 1;
  }
  return out;
}

/**
 * The lines two texts share, longest common subsequence, as index pairs in
 * order. Null when the comparison is too big to run.
 */
function matchedLines(a: string[], b: string[]): [number, number][] | null {
  const m = a.length;
  const n = b.length;
  if (m * n > 250_000) return null;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}
