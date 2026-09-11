import {
  readAppliedReceipt,
  typeForDir,
  type AppliedRow,
  type AppliedVerb,
  type NoteType,
} from '@qale/domain';
import type { RevertResultDTO } from '@qale/ipc';

/**
 * The receipt block in the chat (docs/fewer-approvals.md FA-4).
 *
 * Most writes land without a card now, so the chat has to show them where the PM
 * is already looking: one row per write, above the agent's closing sentences,
 * with a way back on each. From four writes the rows fold behind one line that
 * names what they touched. This file is the block's arithmetic, kept apart from
 * the drawing so it can be read and tested on its own.
 */

/** The prose verb a tool result leads with, and the word the row leads with.
 *  Only ever needed for a result filed before FA-4, which carries no fields. */
const VERB_FOR_PROSE: Record<string, AppliedVerb> = {
  Created: 'New',
  Updated: 'Changed',
  Deleted: 'Removed',
  'Added to rules': 'Changed',
  Learned: 'Changed',
  Labelled: 'Changed',
};

/** What a step in a turn's trail carries, as this file reads it. */
export interface ResultPart {
  type: string;
  state?: string;
  errorText?: string;
  output?: unknown;
}

/** A step the agent gave up on. Same two signals the trail reads. */
const failed = (part: ResultPart): boolean =>
  part.state === 'output-error' || part.errorText !== undefined;

const isTool = (part: ResultPart): boolean =>
  part.type.startsWith('tool-') || part.type === 'dynamic-tool';

/**
 * The write one step landed, or null when it landed none.
 *
 * A result from before FA-4 carries the prose and no fields. It still draws a
 * row, by the name the prose gave it, with no page to open and no way back:
 * saying nothing about a write that happened would be the worse answer.
 */
export function landedWrite(part: ResultPart): AppliedRow | null {
  if (failed(part) || typeof part.output !== 'string') return null;
  const receipt = readAppliedReceipt(part.output);
  if (!receipt) return null;
  if (receipt.row) return receipt.row;
  return {
    verb: VERB_FOR_PROSE[receipt.verb] ?? 'Changed',
    ...(receipt.detail ? { title: receipt.detail } : {}),
  };
}

/** Every write one turn landed, in the order it landed them. */
export function landedWrites(parts: readonly ResultPart[]): AppliedRow[] {
  const out: AppliedRow[] = [];
  for (const part of parts) {
    if (!isTool(part)) continue;
    const row = landedWrite(part);
    if (row) out.push(row);
  }
  return out;
}

/**
 * The tiers a turn's writes fall into, and the order the block says them in
 * (Erik, 2026-09-11).
 *
 * The order is fixed, and it is about what the PM has to act on. A promise made
 * in their name comes first, a promise that moved second, their own documents
 * third, and everything Qale filed for itself after that. A page that went is
 * last of all, because it is the one write they must see whatever else
 * happened.
 */
export type LandedTier =
  /** A to-do or a meeting page that was not there before. */
  | 'new-promise'
  /** A to-do that moved or closed, and a meeting page that changed. */
  | 'promise-moved'
  /** A page in Documents. */
  | 'documents'
  /** An approved send. It writes no page and keeps its own green card
   *  (docs/receipt-redesign.md RC-3), so it draws here only if one ever
   *  reaches this block. */
  | 'sent'
  /** Qale's own record: people, customers, about pages, insights, decisions,
   *  research, sources, sessions, tickets and the rules files. */
  | 'memory'
  /** A page that went. */
  | 'removed';

const TIER_ORDER: readonly LandedTier[] = [
  'new-promise',
  'promise-moved',
  'documents',
  'sent',
  'memory',
  'removed',
];

/** Which tier one write belongs to. The verb says whether it made something or
 *  moved it, and the folder says whose page it is. */
export function tierForRow(row: AppliedRow): LandedTier {
  if (row.verb === 'Removed') return 'removed';
  if (row.verb === 'Sent') return 'sent';
  const type = typeForDir((row.path ?? '').split('/')[0] ?? '');
  if (type === 'todo' || type === 'meeting')
    return row.verb === 'New' || row.verb === 'New todo' ? 'new-promise' : 'promise-moved';
  if (type === 'note') return 'documents';
  // A row filed before this block existed has no path to read, so it lands
  // where everything unplaced lands: Qale's own record, late (RC-5).
  return 'memory';
}

/**
 * A turn's writes in reading order: by tier first, and inside a tier in the
 * order they landed. No word over a tier: the rows are small and few, and a
 * heading over two of them weighed more than the rows did.
 */
export function orderLanded(rows: readonly AppliedRow[]): AppliedRow[] {
  const byTier = new Map<LandedTier, AppliedRow[]>();
  for (const row of rows) {
    const tier = tierForRow(row);
    const held = byTier.get(tier);
    if (held) held.push(row);
    else byTier.set(tier, [row]);
  }
  return TIER_ORDER.flatMap((tier) => byTier.get(tier) ?? []);
}

/**
 * The chip a line draws for the thing a write touched: the kind's icon, the
 * page's own name, and the page it opens. A removed page has nothing to open,
 * and neither has a row filed before this block existed, so both hand back a
 * null path and draw as plain words.
 */
export interface SummaryChip {
  /** The page to open, or null when there is none. */
  path: string | null;
  /** What the chip says. */
  label: string;
  /** Which icon it wears. Null for a row with no folder to read it from. */
  type: NoteType | null;
}

/** The chip for one row. */
export function chipForRow(row: AppliedRow): SummaryChip {
  return {
    path: row.verb === 'Removed' ? null : (row.path ?? null),
    label: row.title ?? 'a page',
    type: typeForDir((row.path ?? '').split('/')[0] ?? ''),
  };
}

/**
 * What a row says after its name, and nothing where it says nothing.
 *
 * Only a page that changed says anything: how much of its body moved. A new
 * page, a new to-do, a to-do that moved or closed, an insight and a page that
 * went are all told by their title alone, and a phrase after them only read
 * the same fact a second time (Erik, 2026-09-09).
 */
export function rowChange(row: AppliedRow): string | undefined {
  return row.verb === 'Changed' ? row.change : undefined;
}

/**
 * From this many writes in one turn, the block draws one line and holds the
 * rows behind a chevron.
 *
 * Three rows are a list a person reads. Seven are a wall they scroll past, and
 * the work is worth more than that (Erik, 2026-09-09).
 */
export const FOLD_FROM = 4;

/** Whether a turn's writes draw as a line rather than as rows. */
export const foldsLanded = (rows: readonly AppliedRow[]): boolean => rows.length >= FOLD_FROM;

/** How many pages a removal clause names before it counts the rest. */
const REMOVED_CAP = 3;

/** One tier's worth of the line, in a few words. */
export interface SummaryClause {
  /** Which tier it came from. The removals clause is drawn in the destructive
   *  colour; nothing else carries one. */
  tier: LandedTier;
  /** What the clause says. */
  text: string;
}

/** One fold's worth of writes, said in one line. */
export interface LandedSummary {
  /** The clauses, in tier order, with " · " between them. */
  clauses: SummaryClause[];
  /** The mark over the line: a plus when the turn made a to-do or a meeting
   *  page, a pencil when it only moved things that were already there. */
  mark: 'new' | 'changed';
  /** The whole line in plain words, for a screen reader and for the tests. */
  text: string;
}

/** "1 todo", "3 todos". */
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** A page said once and counted after that: "new meeting page", "2 new meeting
 *  pages". One of a thing needs no number in front of it. */
const some = (n: number, one: string, many: string): string => (n === 1 ? one : `${n} ${many}`);

/** "A", "A, B", "A, B, C and 2 more". */
function nameRun(names: readonly string[], cap: number): string {
  const named = names.slice(0, cap);
  const more = names.length - named.length;
  const list = named.join(', ');
  return more > 0 ? `${list} and ${more} more` : list;
}

/**
 * One line for what a turn wrote (Erik, 2026-09-11).
 *
 * The tiers are fixed and they are what the PM acts on, in order: to-dos and
 * meeting pages Qale made, to-dos and meeting pages that moved, their own
 * documents, everything Qale filed for itself, then anything that went.
 *
 * The line is words only. It named every page at first, and the names made it
 * longer than the rows it was standing in for (Erik, 2026-09-11). A name that
 * matters is one chevron away, on the row, where it opens. The one exception is
 * a page that went: nothing else on screen says so, so the line says it.
 *
 * The line is built from the rows that still stand, so a row put back from the
 * open list takes itself out of the line instead of leaving it to lie.
 */
export function landedSummary(rows: readonly AppliedRow[]): LandedSummary {
  let newTodos = 0;
  let todosDone = 0;
  let todosChanged = 0;
  let newMeetings = 0;
  let changedMeetings = 0;
  let newDocs = 0;
  let changedDocs = 0;
  let memory = 0;
  let sends = 0;
  const removed: string[] = [];
  const seen = new Set<string>();

  for (const row of orderLanded(rows)) {
    const tier = tierForRow(row);
    if (tier === 'removed') {
      removed.push(row.title ?? 'a page');
      continue;
    }
    if (tier === 'sent') {
      sends++;
      continue;
    }
    // Two writes to one page are one page, or the line counts the work and not
    // the pages.
    const path = row.path ?? '';
    if (path && seen.has(path)) continue;
    if (path) seen.add(path);
    const type = typeForDir(path.split('/')[0] ?? '');
    const isNew = row.verb === 'New' || row.verb === 'New todo';
    if (type === 'todo') {
      if (isNew) newTodos++;
      else if (row.verb === 'Todo done' || row.verb === 'Done') todosDone++;
      else todosChanged++;
    } else if (type === 'meeting') {
      if (isNew) newMeetings++;
      else changedMeetings++;
    } else if (type === 'note') {
      if (isNew) newDocs++;
      else changedDocs++;
    } else memory++;
  }

  const clauses: SummaryClause[] = [];
  const say = (tier: LandedTier, text: string) => clauses.push({ tier, text });

  // Tier one: what Qale promised in the PM's name.
  if (newTodos > 0) say('new-promise', plural(newTodos, 'new todo', 'new todos'));
  if (newMeetings > 0)
    say('new-promise', some(newMeetings, 'new meeting page', 'new meeting pages'));

  // Tier two: a promise that moved. "done" and "updated" are the words Activity
  // uses, so the chat and the ledger never say one write two ways.
  if (todosDone > 0) say('promise-moved', `${plural(todosDone, 'todo', 'todos')} done`);
  if (todosChanged > 0) say('promise-moved', `${plural(todosChanged, 'todo', 'todos')} changed`);
  if (changedMeetings > 0)
    say('promise-moved', `${some(changedMeetings, 'meeting page', 'meeting pages')} updated`);

  // Tier three: the PM's own documents.
  if (newDocs > 0) say('documents', some(newDocs, 'new document', 'new documents'));
  if (changedDocs > 0) say('documents', `${some(changedDocs, 'document', 'documents')} updated`);

  if (sends > 0) say('sent', plural(sends, 'send', 'sends'));

  // Tier four: everything Qale filed for itself, in two words. What it wrote
  // there is its own record, and the rows say which pages.
  if (memory > 0) say('memory', 'updated memory');

  // Tier five: a page that went is always named. Nothing else on screen says a
  // page is gone.
  if (removed.length > 0) say('removed', `removed ${nameRun(removed, REMOVED_CAP)}`);

  // The line opens in the middle of a sentence otherwise ("updated memory"), so
  // the first word it owns is capitalised.
  const opener = clauses[0];
  if (opener) opener.text = opener.text[0]!.toUpperCase() + opener.text.slice(1);

  return {
    clauses,
    mark: newTodos + newMeetings > 0 ? 'new' : 'changed',
    text: clauses.map((c) => c.text).join(' · '),
  };
}
/** What putting one row back came to. */
export interface RowBack {
  ok: boolean;
  /** The undo could not take out only its own lines, so the whole page went
   *  back and anything typed since went with it. The row says so. */
  snapshot: boolean;
  error?: string;
}

/**
 * Put one write back, by the Activity row it left. The same call Activity makes,
 * with the same id: there is one undo in the app, said in two places.
 */
export async function putRowBack(
  id: string,
  revert: (id: string) => Promise<RevertResultDTO>,
): Promise<RowBack> {
  try {
    const result = await revert(id);
    return { ok: true, snapshot: result.method === 'snapshot' };
  } catch (err) {
    return {
      ok: false,
      snapshot: false,
      error: err instanceof Error ? err.message : 'that could not be undone',
    };
  }
}
