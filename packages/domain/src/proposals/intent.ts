/**
 * One row per thing that changes (docs/review-rework.md RR-3).
 *
 * Cards used to group by kind, shape and source. Six edits to six unrelated
 * pages sat together because one meeting produced them, while two changes to the
 * same to-do sat apart because one set a date and the other rewrote a line. A
 * person reads the review by asking "what happens to this?", so the group is the
 * thing itself: the file the card writes, or the external item a send touches.
 *
 * Two rules hold it together:
 *
 * 1. A group is one target. Two cards group only when approving both changes the
 *    same page.
 * 2. A group survives being taken apart. Approve one of three and the other two
 *    still key the same way, so the group stays put and only gets shorter.
 */

/** What one card in the queue carries. The renderer's DTO and the stored record
 *  both satisfy it, so this needs no dependency on @qale/ipc. */
export interface TargetCard {
  id: string;
  kind: string;
  /** The file it writes: `targetPath`, or the path inside the payload. */
  targetPath?: string | null;
  /** The levers a card carries. `targetId` is the external item a send touches. */
  payload?: {
    path?: string;
    targetId?: string;
  } | null;
}

/**
 * What this card changes, as one comparable key: the file in the workspace, or
 * the ticket or page a send is addressed to. A card that names neither (a new
 * ticket, a calendar event) belongs to nothing and gets a row of its own.
 */
export function targetKey(card: TargetCard): string | null {
  const path = card.targetPath ?? card.payload?.path ?? '';
  if (path) return `path:${path}`;
  const external = card.payload?.targetId ?? '';
  return external ? `ref:${external}` : null;
}

/** The cards that change one thing. */
export interface TargetGroup {
  key: string;
  /** In the order they were given, so the queue's own order holds. */
  cards: TargetCard[];
}

/**
 * Group a batch's cards by what they change, keeping the order they arrived in.
 * Every card comes back in exactly one group, so a caller can draw the list
 * without checking for a card twice. A group of one is a row like any other.
 */
export function groupByTarget<T extends TargetCard>(cards: readonly T[]): { key: string; cards: T[] }[] {
  const byKey = new Map<string, T[]>();
  const order: string[] = [];
  cards.forEach((card, i) => {
    // A card that names no target is its own group, keyed so nothing joins it.
    const key = targetKey(card) ?? `alone:${i}`;
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = [];
      byKey.set(key, bucket);
      order.push(key);
    }
    bucket.push(card);
  });
  return order.map((key) => ({ key, cards: byKey.get(key)! }));
}
