import { sentLine, type SentLine } from '@qale/domain';
import type { OutboundPayloadDTO, ProposalDTO } from '@qale/ipc';

/**
 * The approved sends the session review draws in place.
 *
 * An approved send used to move onto a grouped green "Left your workspace"
 * block. Now its card stays where it was and settles into a "Sent" state. The
 * review learns about a send from two places: the accept in this sitting, and
 * the resolved cards it reads back from the session. This file merges the two
 * and merges the card list, with no React in it, so the rules can be tested on
 * their own.
 */

/** One approved send, as the review draws it: the stored card, the receipt line
 *  it settled on, and whether it settled in this sitting. */
export interface SentCard {
  card: ProposalDTO;
  line: SentLine;
  /** Approved in this sitting, so the card just changed state on screen and
   *  may animate. A card read back from a reopened session never does. */
  fresh: boolean;
  /** When it left, in ms, or null when the card does not say. */
  at: number | null;
}

/** A send approved in this sitting, with the line the accept stamped (it
 *  carries the key and url a ticket created a second ago has). */
export interface SittingSend {
  card: ProposalDTO;
  line: SentLine;
  at: number;
}

/**
 * The approved sends, one per card id, oldest card first.
 *
 * `stored` is every resolved card of the session, of any kind and status. Only
 * accepted outbound cards count. A sitting send wins over the stored card with
 * the same id: its line already has the key and url the send landed on, and
 * it is the one that may animate.
 */
export function sentCards(
  sitting: readonly SittingSend[],
  stored: readonly ProposalDTO[],
): SentCard[] {
  const byId = new Map<string, SentCard>();
  for (const card of stored) {
    if (card.kind !== 'outbound' || card.status !== 'accepted') continue;
    byId.set(card.id, {
      card,
      line: sentLine(card.payload as OutboundPayloadDTO),
      fresh: false,
      at: card.resolved,
    });
  }
  for (const send of sitting) {
    byId.set(send.card.id, { card: send.card, line: send.line, fresh: true, at: send.at });
  }
  return [...byId.values()].sort((a, b) => a.card.created - b.card.created);
}

/**
 * The cards the review draws, one list: the ones still waiting, the ones held
 * on screen while their send is in flight, and the ones that already left.
 * A card that is still pending wins, then a held one, then a sent one, so a
 * send that failed and came back to pending never draws twice. The order is
 * pending first, then held, then sent. The caller sorts afterwards.
 */
export function mergeReviewCards(
  pending: readonly ProposalDTO[],
  held: readonly ProposalDTO[],
  sent: readonly SentCard[],
): ProposalDTO[] {
  const out: ProposalDTO[] = [];
  const seen = new Set<string>();
  const add = (card: ProposalDTO): void => {
    if (seen.has(card.id)) return;
    seen.add(card.id);
    out.push(card);
  };
  for (const card of pending) add(card);
  for (const card of held) add(card);
  for (const { card } of sent) add(card);
  return out;
}
