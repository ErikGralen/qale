/**
 * Line diffing, shared by every surface that shows a change before it happens:
 * the Inbox's redline of a proposed edit, and the Skills page's "here is what
 * moved in our version". Rendering is the caller's business — an approval card
 * renders prose, a skill file renders text — but the rows underneath are the
 * same rows.
 */

export type DiffRow =
  | { kind: 'same' | 'add' | 'del'; text: string }
  | { kind: 'replace'; text: string; before: string; after: string };

export type DiffView = DiffRow | { kind: 'gap'; text: string };

/** Longest-common-subsequence line diff — insertions no longer cascade. */
export function diffLines(before: string, after: string): DiffRow[] {
  const b = before.split('\n');
  const a = after.split('\n');
  // Guard pathological sizes; the preview is judged in seconds, not scrolled for minutes.
  if (b.length * a.length > 250_000) {
    return a.map((text) => ({ kind: 'same' as const, text }));
  }
  const m = b.length;
  const n = a.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i]![j] = b[i] === a[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (b[i] === a[j]) {
      rows.push({ kind: 'same', text: a[j]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      rows.push({ kind: 'del', text: b[i]! });
      i++;
    } else {
      rows.push({ kind: 'add', text: a[j]! });
      j++;
    }
  }
  while (i < m) rows.push({ kind: 'del', text: b[i++]! });
  while (j < n) rows.push({ kind: 'add', text: a[j++]! });
  return rows;
}

/** Keep `ctx` unchanged lines around every change; collapse the rest to a marker. */
export function withContext(rows: DiffRow[], ctx: number): DiffView[] {
  const keep = new Array(rows.length).fill(false);
  rows.forEach((r, i) => {
    if (r.kind === 'same') return;
    for (let j = Math.max(0, i - ctx); j <= Math.min(rows.length - 1, i + ctx); j++) keep[j] = true;
  });
  const out: DiffView[] = [];
  let hidden = 0;
  // The marker carries its own count: "⋯" alone left the PO unable to tell a
  // one-line skip from half the page, in the view they use to judge a write.
  const flush = () => {
    if (hidden > 0) out.push({ kind: 'gap', text: `${hidden} unchanged line${hidden === 1 ? '' : 's'}` });
    hidden = 0;
  };
  rows.forEach((r, i) => {
    if (keep[i]) {
      flush();
      out.push(r);
    } else {
      hidden++;
    }
  });
  flush();
  return out;
}
