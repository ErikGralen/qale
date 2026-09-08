import { readAppliedReceipt, type AppliedRow, type AppliedVerb } from '@qale/domain';
import type { RevertResultDTO } from '@qale/ipc';

/**
 * The receipt block in the chat (docs/fewer-approvals.md FA-4).
 *
 * Most writes land without a card now, so the chat has to show them where the PM
 * is already looking: one row per write, above the agent's closing sentences,
 * with a way back on each. This file is the block's arithmetic, kept apart from
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

/** One row of the block. A landed row and a waiting row are the same shape with
 *  different controls; the question is the one thing that needs their hands. */
export interface BlockRow {
  kind: 'question' | 'landed' | 'waiting';
  /** The write this row draws, on a landed row. */
  landed?: AppliedRow;
}

/**
 * The block, in reading order: the question first, then what landed, then what
 * waits. The question comes first because it is the only row that holds the
 * turn up; everything under it is already done or already safe to leave.
 */
export function blockRows(input: {
  /** The turn is parked on an `ask_user` question. */
  question?: boolean;
  landed?: readonly AppliedRow[];
  /** How many cards this session has waiting. */
  waiting?: number;
}): BlockRow[] {
  const rows: BlockRow[] = [];
  if (input.question) rows.push({ kind: 'question' });
  for (const landed of input.landed ?? []) rows.push({ kind: 'landed', landed });
  for (let i = 0; i < (input.waiting ?? 0); i++) rows.push({ kind: 'waiting' });
  return rows;
}

/**
 * The spheres a turn's writes fall into (docs/receipt-redesign.md RC-1).
 *
 * 'sent' is where an approved outbound card goes once the session's cards are
 * all judged and the review draws them as lines (RC-3). 'other' is the line a
 * session filed before FA-4 left: it has no path, so it cannot be placed, and
 * it draws last (RC-5).
 */
export type LandedGroup = 'todos' | 'meeting' | 'documents' | 'sent' | 'memory' | 'other';

/** The order the block reads in: what Qale promised in the PM's name first,
 *  then the meeting, then their pages, then what went out, then Qale's own
 *  record. */
const GROUP_ORDER: readonly LandedGroup[] = [
  'todos',
  'meeting',
  'documents',
  'sent',
  'memory',
  'other',
];

/** Where one write belongs. The folder decides, the same way the sidebar
 *  decides: anything written outside the PM's three folders is Qale's record. */
export function groupForRow(row: AppliedRow): LandedGroup {
  // A send has no page of its own to place, so it says which group it is in.
  if (row.verb === 'Sent') return 'sent';
  if (!row.path) return 'other';
  const dir = row.path.split('/')[0] ?? '';
  if (dir === 'todos') return 'todos';
  if (dir === 'meetings') return 'meeting';
  if (dir === 'notes') return 'documents';
  return 'memory';
}

/**
 * A turn's writes in reading order: by sphere first, and inside a sphere in
 * the order they landed. No word over a group: the lines are small and few,
 * and a heading over two of them weighed more than the lines did.
 */
export function orderLanded(rows: readonly AppliedRow[]): AppliedRow[] {
  const byGroup = new Map<LandedGroup, AppliedRow[]>();
  for (const row of rows) {
    const group = groupForRow(row);
    const held = byGroup.get(group);
    if (held) held.push(row);
    else byGroup.set(group, [row]);
  }
  return GROUP_ORDER.flatMap((group) => byGroup.get(group) ?? []);
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
