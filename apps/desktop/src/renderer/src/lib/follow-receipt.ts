/**
 * What the follow picker says once the confirm lands (docs/closing-beat.md,
 * docs/first-look-debrief.md FD-1).
 *
 * The confirm used to end in nothing. Somebody who came from First steps
 * pressed it, the picker collapsed into a row of toggles, and Settings held
 * them there with no word about what had started or where to go. This is the
 * receipt half of the closing beat: what just happened, and what comes of it.
 *
 * The second sentence is a promise, so it is only written when the promise can
 * be kept. The debrief needs a model key (FD-2), and a workspace without one
 * gets the first sentence and nothing more. A reopened picker gets no receipt
 * at all, because it made no promise: changing what a live connection reads is
 * maintenance.
 */

export interface FollowOutcome {
  /** Nothing on this connection was followed before this confirm (FD-1). */
  firstFollow: boolean;
  /** How many containers this confirm started reading. */
  started: number;
}

/**
 * The line that takes the promise's place, or null when there is nothing to
 * say: no first follow, or a confirm that started no read.
 */
export function followReceipt(outcome: FollowOutcome, hasKey: boolean): string | null {
  if (!outcome.firstFollow || outcome.started === 0) return null;
  return hasKey
    ? 'Reading these now. When it has something to say, it knocks on Home.'
    : 'Reading these now. They stay current as notes in your workspace.';
}
