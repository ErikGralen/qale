import type { ArrivalResultDTO } from '@pm/ipc';

/**
 * Where an arrival leaves the PO, and whether it owes them a receipt.
 *
 * These two questions are one question, so they live in one place. Landing
 * somewhere IS the confirmation: if the app opens the review it just started,
 * a floating card announcing that review is noise in the corner of every
 * capture. The receipt only earns its place when the screen can't speak for
 * itself. Kept out of the components so neither rule can drift from the other.
 */

export interface ArrivalOutcome {
  /** Items that became a note, ignoring failures. */
  filed: ArrivalResultDTO['items'];
  failed: ArrivalResultDTO['items'];
  sessions: ArrivalResultDTO['items'];
}

export function outcomeOf(arrival: ArrivalResultDTO): ArrivalOutcome {
  return {
    filed: arrival.items.filter((i) => i.path && !i.error),
    failed: arrival.items.filter((i) => i.error),
    sessions: arrival.items.filter((i) => i.session),
  };
}

/**
 * Does this arrival land the PO on its own result?
 *
 * One review is a place to be, so we open it. Several at once is a tab
 * explosion nobody asked for. One filed document with nothing running opens
 * too — otherwise it vanishes into a folder with no acknowledgement at all.
 */
export function landsOnResult(arrival: ArrivalResultDTO): boolean {
  const { filed, sessions } = outcomeOf(arrival);
  return sessions.length === 1 || (sessions.length === 0 && filed.length === 1);
}

/**
 * Is there anything left to say once the PO is looking at the result?
 *
 * A batch (nothing was opened, the outcome is a count), a failure (an
 * unreadable file, a review that could not start), or a catch-up where the
 * news is that nothing ran.
 */
export function worthAReceipt(arrival: ArrivalResultDTO): boolean {
  const { failed } = outcomeOf(arrival);
  return !landsOnResult(arrival) || failed.length > 0 || arrival.reviewsFailed > 0;
}
