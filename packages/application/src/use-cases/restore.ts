import { refToSlug, titleFromSlug, type Frontmatter, type Note } from '@qale/domain';
import { parseNote } from '@qale/markdown';
import type { UseCaseContext } from '../ports.js';
import { saveAuthoredNote } from './notes.js';
import { applyPatch, logError } from './proposals.js';

/** Leading YAML frontmatter block (optional BOM, CRLF tolerant). */
const FRONTMATTER_RE = /^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** What the restored version is called in the history list. */
export const RESTORE_LABEL = 'restored an earlier version';

export interface RestoreNoteVersionInput {
  path: string;
  /** The version to bring back, as listed by `getNoteHistory`. */
  hash: string;
}

/**
 * Put a note back to how it read at an earlier version.
 *
 * Written FORWARD, as an ordinary save: the earlier text becomes the newest
 * version and everything in between stays in the record. A rewind would make
 * the history lie about what happened, and would leave the restore itself as
 * the one write with no way back.
 *
 * Body only, on purpose. The history view shows prose, so prose is what the
 * person is choosing; the properties underneath carry live state the old
 * version knows nothing about (whether a commitment is closed, which calendar
 * event or ticket the note mirrors, whether the source has been read).
 * Dragging those backwards would quietly re-open finished work and re-point
 * live links, none of it visible in what was previewed. `writeBody` keeps the
 * current block byte for byte.
 */
export async function restoreNoteVersion(
  ctx: UseCaseContext,
  input: RestoreNoteVersionInput,
): Promise<Note> {
  const raw = await ctx.git.fileAt(input.path, input.hash);
  // Null covers both "no history on this machine" and "the note did not exist
  // at that version" — either way there is nothing to put back, and the write
  // must not proceed with an empty body.
  if (raw === null) throw new Error('that version is no longer available');
  const body = raw.replace(FRONTMATTER_RE, '').replace(/^\s+/, '');
  // Deliberately the same use-case the editor saves through, so the search
  // index, the file watcher and any open tab see the ordinary write it is.
  return saveAuthoredNote(ctx, input.path, body, RESTORE_LABEL);
}

/** What the label on a reverted change says in the history list. */
export const REVERT_LABEL = 'undo';

export interface RevertChangeInput {
  path: string;
  /** The change to undo, by the commit hash the history list shows. */
  hash: string;
  /**
   * The Activity row this undo came from, when it came from one. Stamped only
   * after the files are back, so a row never says "put back" for a revert that
   * threw.
   */
  activityId?: string;
  /**
   * The card that change applied, when a card was behind it. Its evidence names
   * the sources the accept marked as read, which is what {@link revertNoteChange}
   * puts back along with the page.
   */
  proposalId?: string;
}

/** What the undo did. `removed` means that change had created the note. */
export type RevertOutcome = 'restored' | 'undeleted' | 'removed';

/**
 * How the note went back.
 *
 * `patch` took out the change's own lines and left everything written since.
 * `snapshot` wrote the whole file as it read before, so anything typed after
 * the change went with it. The row says which, because the two are different
 * news for the person who typed in between.
 */
export type RevertMethod = 'patch' | 'snapshot';

export interface RevertResult {
  /** The note the undo left behind, or the one it took away. */
  path: string;
  outcome: RevertOutcome;
  method: RevertMethod;
}

/**
 * Undo one recorded change to one note (E-2).
 *
 * The whole change goes back, frontmatter and all, which is the difference from
 * {@link restoreNoteVersion} above. A person picking a version out of the
 * history list is choosing prose they can read. Undoing a change the agent
 * applied on its own is a different act: what it changed may be a tag, a link
 * or a lifecycle field that never showed on screen, and putting half of it back
 * would leave the note in a state nobody ever wrote. Nothing is invented here
 * either way. Every byte written back is a byte the workspace itself recorded.
 *
 * The change, not the file. Every autosave is its own commit, so a person who
 * kept typing after the agent wrote has versions of their own on top. Taking the
 * change's own lines out and leaving the rest is the only undo that does not
 * erase them (docs/fewer-approvals.md, "what has to hold before this is safe"
 * item 1). When the reverse patch has nowhere to land, the whole file goes back
 * as it did before and `method` says so, so the row can warn them.
 *
 * Written forward, like a restore: the undo is a new version on top and the
 * change it undid stays in the record, so the undo is itself undoable.
 *
 * Four cases, all one loop. A modified note goes back to its earlier text. A
 * deleted note comes back. A note the change created goes away. A renamed note
 * gets both sides put back, which is why the git layer answers with the paths
 * and not just a yes.
 */
export async function revertNoteChange(
  ctx: UseCaseContext,
  input: RevertChangeInput,
): Promise<RevertResult> {
  if (!ctx.vault.contain(input.path)) throw new Error('that note is not in this workspace');
  if (!ctx.git.pathsChangedWith) throw new Error('this workspace cannot undo changes');
  const touched = await ctx.git.pathsChangedWith(input.hash, input.path);
  // The refusal that matters: a hash from somewhere else reads back a perfectly
  // valid older file, and undoing with it would overwrite work nobody named.
  if (touched.length === 0) throw new Error('that change did not touch this note');

  let landed: string | null = null;
  let undeleted = false;
  let method: RevertMethod = 'patch';
  for (const path of touched) {
    // `hash^` is the state before the change, `hash` is what it wrote. A first
    // commit has no parent, so `before` reads as null and the note is taken
    // away, which is right: that commit is where the note began.
    const before = await ctx.git.fileAt(path, `${input.hash}^`);
    const after = await ctx.git.fileAt(path, input.hash);
    const current = await ctx.vault.readRaw(path);
    if (before === null) {
      if (current === null) continue;
      // The note goes, and with it anything typed into it since. Nothing else
      // is possible: the change is the reason the file exists.
      if (current !== after) method = 'snapshot';
      await ctx.vault.remove(path);
      ctx.index.removeByPath(path);
      continue;
    }
    let next = before;
    if (current !== null && current !== after) {
      // Somebody wrote here after the change. Take out the change's own lines
      // and leave theirs, or say the whole file went back.
      const reversed = after === null ? null : reversePatch(before, after, current);
      if (reversed === null) method = 'snapshot';
      else next = reversed;
    }
    await ctx.vault.writeRaw(path, next);
    const note = await ctx.vault.readNote(path);
    if (note) ctx.index.reindex(note);
    landed = path;
    undeleted = current === null;
  }

  const alsoBack = await putReadMarksBack(ctx, input, touched);
  const path = landed ?? input.path;
  await ctx.git.commitPaths([...touched, ...alsoBack], `${REVERT_LABEL}: ${titleFromSlug(path)}`);
  if (input.activityId && ctx.activity) {
    const at = Date.parse(ctx.clock.now());
    ctx.activity.markReverted(input.activityId, Number.isNaN(at) ? Date.now() : at);
  }
  return {
    path,
    outcome: landed === null ? 'removed' : undeleted ? 'undeleted' : 'restored',
    method,
  };
}

/**
 * Take one change back out of the file as it reads now.
 *
 * The change's own diff, turned around: each thing it added becomes the search
 * text and what stood there before becomes the replacement, with a few lines of
 * context so the anchor is unique. {@link applyPatch} then places it exactly as
 * it places an update card, which is the same refusal contract: null when an
 * anchor is gone or appears twice, and the caller writes the whole file instead.
 */
export function reversePatch(before: string, after: string, current: string): string | null {
  const blocks = reverseBlocks(before, after);
  if (blocks === null) return null;
  return applyPatch(current, blocks);
}

/** Lines of unchanged text kept each side of a change, so its anchor is unique. */
const CONTEXT_LINES = 3;

/**
 * How many changed lines are worth lining up. Past this the comparison costs
 * more than it saves and the whole file goes back instead. Notes are prose; a
 * thousand changed lines is not one.
 */
const DIFF_LINE_CAP = 1000;

/** One line of the comparison: in both files, in the old one, or in the new one. */
interface DiffLine {
  kind: 'same' | 'old' | 'new';
  text: string;
}

/**
 * The search/replace blocks that take `after` back to `before`. Null when the
 * two files are too far apart to line up, or when a block would have no text to
 * search for (a change that only removed lines at the very edge of the file).
 */
function reverseBlocks(
  before: string,
  after: string,
): { search: string; replace: string }[] | null {
  const lines = compareLines(before.split('\n'), after.split('\n'));
  if (lines === null) return null;
  const blocks: { search: string; replace: string }[] = [];
  for (const [from, to] of changedRanges(lines)) {
    const span = lines.slice(from, to);
    const search = span
      .filter((l) => l.kind !== 'old')
      .map((l) => l.text)
      .join('\n');
    const replace = span
      .filter((l) => l.kind !== 'new')
      .map((l) => l.text)
      .join('\n');
    if (search === '') return null;
    blocks.push({ search, replace });
  }
  return blocks.length > 0 ? blocks : null;
}

/**
 * Line up two versions of a file: the lines they share, the lines only the old
 * one has, and the lines only the new one has.
 *
 * The shared head and tail are matched first, which is most of any note, and
 * only what is left in the middle is compared line against line. Null when that
 * middle is bigger than {@link DIFF_LINE_CAP}.
 */
function compareLines(a: string[], b: string[]): DiffLine[] | null {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  if (midA.length > DIFF_LINE_CAP || midB.length > DIFF_LINE_CAP) return null;

  const out: DiffLine[] = a.slice(0, head).map((text) => ({ kind: 'same', text }));
  out.push(...middle(midA, midB));
  for (const text of a.slice(a.length - tail)) out.push({ kind: 'same', text });
  return out;
}

/**
 * Line up the part that differs, keeping as many shared lines as possible.
 *
 * The table holds, for every pair of positions, how many lines the two sides
 * still have in common from there on. Walking it from the front turns that into
 * the answer: take a shared line when both agree, otherwise drop the side that
 * gives up less.
 */
function middle(a: string[], b: string[]): DiffLine[] {
  const width = b.length + 1;
  const common = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      common[i * width + j] =
        a[i] === b[j]
          ? common[(i + 1) * width + j + 1]! + 1
          : Math.max(common[(i + 1) * width + j]!, common[i * width + j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! });
      i++;
      j++;
    } else if (common[(i + 1) * width + j]! >= common[i * width + j + 1]!) {
      out.push({ kind: 'old', text: a[i]! });
      i++;
    } else {
      out.push({ kind: 'new', text: b[j]! });
      j++;
    }
  }
  for (; i < a.length; i++) out.push({ kind: 'old', text: a[i]! });
  for (; j < b.length; j++) out.push({ kind: 'new', text: b[j]! });
  return out;
}

/**
 * The stretches worth writing a block for: every run of changed lines, widened
 * by {@link CONTEXT_LINES} each side. Two runs close enough to share context
 * become one block, because the blocks apply in order and the second one's
 * context must not be text the first one just rewrote.
 */
function changedRanges(lines: DiffLine[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.kind === 'same') continue;
    let end = i;
    while (end < lines.length && lines[end]!.kind !== 'same') end++;
    const from = Math.max(0, i - CONTEXT_LINES);
    const to = Math.min(lines.length, end + CONTEXT_LINES);
    const last = ranges[ranges.length - 1];
    if (last && from <= last[1]) last[1] = to;
    else ranges.push([from, to]);
    i = end;
  }
  return ranges;
}

/**
 * Put the sources back to unread when this change is what marked them read.
 *
 * Accepting a card flips every source and meeting it cites to `processing:
 * processed`, in commits of its own with no row behind them
 * (docs/fewer-approvals.md item 4). The page's undo takes those with it, so the
 * transcript is offered for reading again instead of sitting there as done for
 * a write that no longer exists.
 *
 * Only that one field moves, and only when the file said `new` or `stale` at the
 * moment the change landed. Anything the person wrote in the source since stays
 * where it is. Best-effort, like the flip itself: a bad reference costs a log
 * line, never the undo.
 */
async function putReadMarksBack(
  ctx: UseCaseContext,
  input: RevertChangeInput,
  touched: string[],
): Promise<string[]> {
  const back: string[] = [];
  try {
    for (const path of await citedPaths(ctx, input, touched)) {
      const note = await ctx.vault.readNote(path);
      if (!note) continue;
      if (note.type !== 'source' && note.type !== 'meeting') continue;
      const fm = note.frontmatter as Record<string, unknown>;
      if (fm['processing'] !== 'processed') continue;
      const raw = await ctx.git.fileAt(path, input.hash);
      if (raw === null) continue;
      const was = parseNote(raw).frontmatter['processing'];
      if (was !== 'new' && was !== 'stale') continue;
      const written = await ctx.vault.writeNote(
        path,
        { ...note.frontmatter, processing: was } as Frontmatter,
        note.body,
      );
      ctx.index.reindex(written);
      back.push(path);
    }
  } catch (err) {
    logError('[qale] putting the read marks back failed (the note is back):', err);
  }
  return back;
}

/** The sources and meetings the reverted change cited, as vault paths. */
async function citedPaths(
  ctx: UseCaseContext,
  input: RevertChangeInput,
  touched: string[],
): Promise<string[]> {
  const refs: string[] = [];
  for (const path of touched) {
    const raw = await ctx.git.fileAt(path, input.hash);
    if (raw === null) continue;
    const fm = parseNote(raw).frontmatter;
    // A meeting page cites its recording as `transcript` and a derived note
    // cites its material as `evidence` or `sources`, so all three are read.
    for (const key of ['evidence', 'sources', 'transcript']) refs.push(...refsIn(fm[key]));
  }
  // The card's own evidence counts too, exactly as it does when the accept
  // flips them: a page can cite a source the card named without listing it.
  const card = input.proposalId ? ctx.proposals.get(input.proposalId) : null;
  for (const e of card?.evidence ?? []) refs.push(e.ref);

  const paths: string[] = [];
  for (const ref of new Set(refs)) {
    const slug = refToSlug(ref);
    if (!slug) continue;
    const path =
      ctx.index.resolve(slug) ?? ((await ctx.vault.exists(`${slug}.md`)) ? `${slug}.md` : null);
    if (!path || touched.includes(path) || paths.includes(path)) continue;
    paths.push(path);
  }
  return paths;
}

/** One reference, a list of them, or nothing at all. */
function refsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}
