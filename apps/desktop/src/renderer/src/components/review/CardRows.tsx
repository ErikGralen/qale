import { Button } from '@qale/ui';
import { Check } from 'lucide-react';
import type { ProposalDTO } from '@qale/ipc';
import type { NavOpts } from '../../lib/nav';
import { CardItem } from './CardItem';
import { cardGroups, cardHeadline, cardTitle } from './cardMeta';
import { useNoteName } from './titles';
import type { Approvals } from './approvals';

/**
 * The one batch button, with the one count: the changes it will actually apply.
 * A send never rides along, so it is not in the number, and the heading beside
 * this says how many sends are waiting on their own.
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
  /** The batch's cards, already in narrative order. */
  cards: ProposalDTO[];
  approvals: Approvals;
  /** The card the roving cursor is on. Every row is one card, so a group header
   *  is never a stop. */
  focusedId: string | null;
  onFocus: (id: string) => void;
  onOpen: (path: string, opts?: NavOpts) => void;
  /** The cards came from more than one source, so each row names its own. */
  showSource?: boolean;
}

/**
 * The rows a batch of cards draws as. There is one card, one approve path and
 * one row shape, so every surface that shows cards shows these.
 *
 * Cards that change the same thing sit together under its name. Everything else
 * is a row of its own.
 */
export function CardRows({ cards, approvals, focusedId, onFocus, onOpen, showSource }: CardRowsProps) {
  const { busy, errors, staleSends, accept, reject } = approvals;
  const row = (p: ProposalDTO, inGroup: boolean) => (
    <CardItem
      key={p.id}
      proposal={p}
      busy={busy}
      focused={focusedId === p.id}
      error={errors[p.id] ?? null}
      staleSend={staleSends[p.id] ?? false}
      onFocus={() => onFocus(p.id)}
      onAccept={(edited?: unknown) => accept(p, edited)}
      onReject={() => reject(p)}
      onOpen={onOpen}
      inGroup={inGroup}
      showSource={showSource}
    />
  );
  return (
    <ul className="flex flex-col gap-2">
      {cardGroups(cards).map((group) =>
        group.cards.length === 1 ? (
          row(group.cards[0]!, false)
        ) : (
          <TargetGroupRows
            key={group.key}
            cards={group.cards}
            onOpen={onOpen}
            row={(p) => row(p, true)}
          />
        ),
      )}
    </ul>
  );
}

/**
 * Two or more changes to one thing, under its name (docs/review-rework.md RR-3).
 *
 * A new due date and a rewritten line on the same to-do used to sit in different
 * parts of the list, one of them folded away as housekeeping. Here the name is
 * said once and each change keeps its own three controls, because approving one
 * and discarding the other is a real answer. There is no button on the header:
 * the group is approved by approving its rows, or by the batch above.
 */
function TargetGroupRows({
  cards,
  onOpen,
  row,
}: {
  cards: ProposalDTO[];
  onOpen: (path: string, opts?: NavOpts) => void;
  row: (p: ProposalDTO) => React.ReactNode;
}) {
  const first = cards[0]!;
  const { Icon } = cardHeadline(first);
  const target = first.targetPath ?? (first.payload as { path?: string }).path ?? '';
  const known = useNoteName(target || null);
  const title = cardTitle(first, known?.title);
  return (
    <li className="overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10">
      <div className="flex items-center gap-2.5 px-3 pt-2.5">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        {known ? (
          <button
            className="min-w-0 truncate text-left text-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => onOpen(known.path)}
            title={`Open ${title}`}
          >
            {title}
          </button>
        ) : (
          <span className="min-w-0 truncate text-sm font-medium text-foreground">{title}</span>
        )}
        <span className="text-xs text-muted-foreground">{cards.length} changes</span>
      </div>
      <ul className="mt-1.5 flex flex-col divide-y divide-border/60">{cards.map(row)}</ul>
    </li>
  );
}
