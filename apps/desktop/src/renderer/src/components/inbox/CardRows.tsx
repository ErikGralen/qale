import { Button } from '@qale/ui';
import { Check } from 'lucide-react';
import type { ProposalDTO } from '@qale/ipc';
import type { NavOpts } from '../../lib/nav';
import { CardItem, HousekeepingItem } from './CardItem';
import { cardIntents, cardRank, HOUSEKEEPING_RANK } from './cardMeta';
import { IntentRow } from './IntentRow';
import type { Approvals } from './approvals';

/**
 * The one batch button, with the one scope: the section it sits on. It counts
 * what it will actually apply — a section with a pending send says "3", not
 * "all", and the send stays its own decision on its own card below.
 *
 * It stands down when the section IS one intent, because the row below then
 * carries the same button over the same cards. Two "Approve all" with the same
 * count, a line apart, is a reader asking which one is the real one.
 */
export function ApproveAll({
  cards,
  approvals,
  className,
  variant = 'fold',
}: {
  cards: ProposalDTO[];
  approvals: Approvals;
  className?: string;
  /** How the rows below draw — the same word CardRows takes, because the two
   *  have to agree about whether a grouped row exists to hand the button to. */
  variant?: CardRowsProps['variant'];
}) {
  const internal = cards.filter((c) => c.kind !== 'outbound');
  if (internal.length < 2) return null;
  if (variant === 'fold') {
    const intents = cardIntents(cards);
    if (intents.length === 1 && intents[0]!.cards.length > 1) return null;
  }
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
  /** The row the roving cursor is on: a card's id, or an intent's key when the
   *  cursor is on a grouped row. A group is one stop, never N. */
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

  // One card per intent (E-6): the patches and decisions one act of reading
  // produced arrive as ONE row that says what they are, expandable when the PO
  // wants them one at a time. Everything else keeps the card it always had.
  //
  // Keyed by the intent rather than by position, so approving six of ten leaves
  // the row in place saying four — the same group, smaller, not four orphans.
  const intents = cardIntents(cards);
  const singles = intents.filter((g) => g.cards.length === 1).map((g) => g.cards[0]!);

  // Housekeeping folds away as the boring tail of a bigger story. It runs over
  // what did NOT group: a grouped intent is already one line with a name on it,
  // which is what the fold was reaching for and could not say.
  const hkOnly = singles.every((c) => cardRank(c) === HOUSEKEEPING_RANK);
  const hkStart = hkOnly ? -1 : singles.findIndex((c) => cardRank(c) === HOUSEKEEPING_RANK);
  const hkEnd =
    hkStart === -1
      ? -1
      : singles.findIndex((c, i) => i >= hkStart && cardRank(c) > HOUSEKEEPING_RANK);
  const hk = hkStart === -1 ? [] : singles.slice(hkStart, hkEnd === -1 ? undefined : hkEnd);
  const folded = new Set(hk.map((c) => c.id));

  const groupRow = (g: (typeof intents)[number]) =>
    g.cards.length > 1 ? (
      <IntentRow
        key={g.key}
        sentence={g.sentence}
        cards={g.cards}
        approvals={approvals}
        focused={focusedId === g.key}
        onFocus={() => onFocus(g.key)}
        onOpen={onOpen}
      />
    ) : (
      row(g.cards[0]!, false)
    );

  return (
    <ul className={listClass}>
      {intents.map((g) => {
        const card = g.cards.length === 1 ? g.cards[0]! : null;
        if (!card || !folded.has(card.id)) return groupRow(g);
        // The fold is drawn once, where its first card sits; the rest of the run
        // is already inside it.
        if (card.id !== hk[0]!.id) return null;
        return (
          <li key="hk" className="flex flex-col gap-1.5">
            {/* A label, not a batch button: the fold only says what it holds,
                and the section above owns the one button over these cards. */}
            <span className="mt-1 px-0.5 text-xs font-medium text-muted-foreground">
              Housekeeping · {hk.length}: ledgers & links, glance and go
            </span>
            <ul className="flex flex-col gap-1.5">{hk.map((p) => row(p, true))}</ul>
          </li>
        );
      })}
    </ul>
  );
}
