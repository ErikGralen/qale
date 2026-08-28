import { Button } from '@qale/ui';
import { Check } from 'lucide-react';
import type { ProposalDTO } from '@qale/ipc';
import type { NavOpts } from '../../lib/nav';
import { CardItem, HousekeepingItem } from './CardItem';
import { cardRank, HOUSEKEEPING_RANK } from './cardMeta';
import type { Approvals } from './approvals';

/**
 * The one batch button, with the one scope: the group it sits on. It counts
 * what it will actually apply — a group with a pending send says "3", not
 * "all", and the send stays its own decision on its own card below.
 */
export function ApproveAll({
  cards,
  approvals,
  className,
}: {
  cards: ProposalDTO[];
  approvals: Approvals;
  className?: string;
}) {
  const internal = cards.filter((c) => c.kind !== 'outbound');
  if (internal.length < 2) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      className={className}
      onClick={() => approvals.acceptAll(cards)}
      disabled={approvals.busy}
    >
      <Check className="size-3.5" /> Approve all {internal.length}
    </Button>
  );
}

export interface CardRowsProps {
  /** One group's cards, already in narrative order. */
  cards: ProposalDTO[];
  approvals: Approvals;
  /** The card the roving cursor is on, by id. */
  focusedId: string | null;
  onFocus: (id: string) => void;
  onOpen: (path: string, opts?: NavOpts) => void;
  /**
   * `fold` (the default): the housekeeping tail folds into one labelled block.
   * `compact-updates`: every update is a one-line row and nothing folds — the
   * librarian's repairs are all housekeeping, so a fold would wrap the lot.
   */
  variant?: 'fold' | 'compact-updates';
  /** Tighter rows for the librarian's one-line repairs. */
  gap?: 'card' | 'row';
}

/**
 * The rows a group of cards renders as — the same component in the Inbox and in
 * the session that proposed them. There is one card, one approve path and one
 * set of rows; the session's review block is the Inbox's rows in another place,
 * never a second implementation of them.
 */
export function CardRows({
  cards,
  approvals,
  focusedId,
  onFocus,
  onOpen,
  variant = 'fold',
  gap = 'card',
}: CardRowsProps) {
  const { busy, errors, staleSends, accept, reject } = approvals;
  const row = (p: ProposalDTO, compact: boolean) => {
    const shared = {
      proposal: p,
      busy,
      focused: focusedId === p.id,
      error: errors[p.id] ?? null,
      staleSend: staleSends[p.id] ?? false,
      onFocus: () => onFocus(p.id),
      onAccept: (edited?: unknown) => accept(p, edited),
      onReject: () => reject(p),
      onOpen,
    };
    return compact ? (
      <HousekeepingItem key={p.id} {...shared} />
    ) : (
      <CardItem key={p.id} {...shared} />
    );
  };
  const listClass = `flex flex-col ${gap === 'row' ? 'gap-1.5' : 'gap-3'}`;

  if (variant === 'compact-updates') {
    // A repointed link is glance-and-go; anything richer (a drafted page
    // update, say) gets the full card.
    return <ul className={listClass}>{cards.map((p) => row(p, p.kind === 'update'))}</ul>;
  }

  // Housekeeping folds away as the boring tail of a bigger story. When it IS the
  // whole group there is no story to spare the PO, and every card stays legible.
  const hkOnly = cards.every((c) => cardRank(c) === HOUSEKEEPING_RANK);
  const hkStart = hkOnly ? -1 : cards.findIndex((c) => cardRank(c) === HOUSEKEEPING_RANK);
  const hkEnd =
    hkStart === -1
      ? -1
      : cards.findIndex((c, i) => i >= hkStart && cardRank(c) > HOUSEKEEPING_RANK);
  const hk = hkStart === -1 ? [] : cards.slice(hkStart, hkEnd === -1 ? undefined : hkEnd);

  return (
    <ul className={listClass}>
      {hk.length === 0
        ? cards.map((p) => row(p, false))
        : [
            ...cards.slice(0, hkStart).map((p) => row(p, false)),
            <li key="hk" className="flex flex-col gap-1.5">
              {/* A label, not a second batch button: the group above owns the
                  one "Approve all", so the fold only says what it holds. */}
              <span className="mt-1 px-0.5 text-xs font-medium text-muted-foreground">
                Housekeeping · {hk.length}: ledgers & links, glance and go
              </span>
              <ul className="flex flex-col gap-1.5">{hk.map((p) => row(p, true))}</ul>
            </li>,
            ...cards.slice(hkStart + hk.length).map((p) => row(p, false)),
          ]}
    </ul>
  );
}
