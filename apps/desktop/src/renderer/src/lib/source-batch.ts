import type { ArrivalProgressDTO } from '@qale/ipc';

/**
 * What a dropped pile says at each end (docs/critical-mass.md CM-2).
 *
 * A backlog drop is the one capture that takes minutes and costs real money, so
 * the tray names the number before it starts, the session counts it down while
 * it runs, and one sentence sums it up at the close. Every number here comes
 * from something that happened: the files in the tray, and the filings the run
 * actually made. Nothing in this file guesses, and nothing rounds.
 *
 * A drop of one or two files says none of it. The counting reads as bookkeeping
 * when there is nothing to keep track of.
 */

/**
 * Where a drop becomes a pile. Three files are a meeting with its notes; four
 * is a backlog, and a backlog is worth naming and worth warning about.
 */
export const PILE = 4;

/** The submit button. A pile says the number, because the number is the cost. */
export function submitLabel(count: number): string {
  if (count >= PILE) return `Read ${count} files`;
  return count > 1 ? `Add ${count} files` : 'Add source';
}

/** The line under the button. Only a pile earns it. */
export function pileWarning(count: number): string | null {
  return count >= PILE ? 'This takes a few minutes and runs in the background.' : null;
}

/**
 * The line while it runs: how many pieces went in, and what has landed. The
 * counts only appear once something has, so the first minute reads as "Reading
 * 24 files." rather than as a row of zeros.
 */
export function progressLine(progress: ArrivalProgressDTO): string {
  const { total, filed, matched } = progress;
  const head = `Reading ${total} file${total === 1 ? '' : 's'}.`;
  if (filed === 0) return head;
  const parts = [`${filed} filed`];
  if (matched > 0) parts.push(`${matched} matched to meetings`);
  return `${head} ${parts.join(', ')}.`;
}

/**
 * The sentence that replaces it once the run settles.
 *
 * "Matched to meetings" is a transcript that joined a meeting the calendar
 * already held; the rest of what was filed is a note on a shelf. Pieces the run
 * read and did not file are counted as unfiled and nothing more: whether one
 * was a duplicate, a dead end or a mistake is the session's own reply to make,
 * and this line will not guess at it.
 */
export function receiptLine(progress: ArrivalProgressDTO): string {
  const { total, filed, matched } = progress;
  const notes = filed - matched;
  const left = total - filed;
  const parts: string[] = [];
  if (matched > 0)
    parts.push(
      matched === 1
        ? '1 matched to a meeting on your calendar'
        : `${matched} matched to meetings on your calendar`,
    );
  if (notes > 0) parts.push(notes === 1 ? '1 filed as a note' : `${notes} filed as notes`);
  if (left > 0) parts.push(`${left} not filed`);
  const head = `${total} file${total === 1 ? '' : 's'} read.`;
  return parts.length > 0 ? `${head} ${parts.join(', ')}.` : head;
}

/** Whether this batch is big enough to be counted out loud at all. */
export function isPile(progress: ArrivalProgressDTO | undefined): progress is ArrivalProgressDTO {
  return !!progress && progress.total >= PILE;
}
