import { useEffect, useState } from 'react';
import { Button } from '@qale/ui';
import { Check } from 'lucide-react';
import type { ProposalDTO } from '@qale/ipc';
import type { NavOpts } from '../../lib/nav';
import type { SentCard } from '../../lib/sent-cards';
import { currentOutbound, stepOutbound } from '../../lib/outbound-steps';
import { CardItem } from './CardItem';
import { cardGroups, cardHeadline, cardTitle } from './cardMeta';
import { useNoteName } from './titles';
import type { Approvals } from './approvals';

/**
 * The one batch button, with the one count: the changes it will actually apply.
 * An outbound update never rides along, so it is not in the number, and the heading beside
 * this says how many outbound updates are waiting on their own.
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
  /** The outbound updates in the list that have already left, by card id. Each keeps
   *  its own row, settled, in the place it was judged. */
  settled?: ReadonlyMap<string, SentCard>;
}

/**
 * The rows a batch of cards draws as. There is one card, one approve path and
 * one row shape, so every surface that shows cards shows these.
 *
 * Cards that change the same thing sit together under its name. Everything else
 * is a row of its own.
 */
export function CardRows({
  cards,
  approvals,
  focusedId,
  onFocus,
  onOpen,
  showSource,
  settled,
}: CardRowsProps) {
  const { busy, errors, staleOutbound, accept, reject } = approvals;
  const row = (
    p: ProposalDTO,
    inGroup: boolean,
    step?: { state: 'open' | 'closed'; pick: () => void },
  ) => (
    <CardItem
      key={p.id}
      proposal={p}
      busy={busy}
      focused={focusedId === p.id}
      error={errors[p.id] ?? null}
      staleOutbound={staleOutbound[p.id] ?? false}
      onFocus={() => {
        onFocus(p.id);
        step?.pick();
      }}
      step={step?.state}
      onAccept={(edited?: unknown) => accept(p, edited)}
      onReject={() => reject(p)}
      onOpen={onOpen}
      inGroup={inGroup}
      showSource={showSource}
      sent={settled?.get(p.id) ?? null}
    />
  );
  // A settled outbound update is never grouped: it is done, and a header over one done
  // row and one waiting row would ask the reader to judge them as a pair. It
  // keeps its own row where the list put it, so the card the PO just pressed
  // stays under their eye.
  const waiting = cards.filter((p) => !settled?.has(p.id));
  const groupOf = new Map<string, { key: string; cards: ProposalDTO[] }>();
  for (const group of cardGroups(waiting)) for (const p of group.cards) groupOf.set(p.id, group);
  const drawn = new Set<string>();
  // Two or more outbound updates draw as one card and open one at a time. The ones that
  // already left count: they stay in it as the lines above and below the open
  // one. An outbound update ranks last in the batch's order, so they are always a run.
  const outbound = cards.filter((p) => p.kind === 'outbound');
  const stepped = outbound.length > 1;
  return (
    <ul className="flex flex-col gap-2">
      {cards.map((p) => {
        if (stepped && p.kind === 'outbound') {
          if (p !== outbound[0]) return null;
          return (
            <OutboundSteps
              key="outbound"
              cards={outbound}
              settled={settled}
              focusedId={focusedId}
              onFocus={onFocus}
              row={(c, state, pick) => row(c, false, { state, pick })}
            />
          );
        }
        if (settled?.has(p.id)) return row(p, false);
        const group = groupOf.get(p.id);
        if (!group || group.cards.length === 1) return row(p, false);
        if (drawn.has(group.key)) return null;
        drawn.add(group.key);
        return (
          <TargetGroupRows
            key={group.key}
            cards={group.cards}
            onOpen={onOpen}
            row={(c) => row(c, true)}
          />
        );
      })}
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

/**
 * Several outbound updates, one open at a time (docs/receipt-redesign.md, "Several updates
 * open one at a time").
 *
 * Three outbound updates used to draw as three full cards, each with its whole message on
 * it, and the PO scrolled a wall to find the second button. An outbound update cannot be
 * taken back, so it deserves to be read alone. Here the outbound updates share one card,
 * built the way the question card is built: the ring that says the session
 * waits here, one step open, the count and the two step buttons on a foot.
 *
 * Every outbound update keeps its row for good. An outbound update that left settles on its row, in
 * past tense with the time, and the next one opens under it in the same
 * motion. An outbound update that waits shows its head alone. The rows never reorder, so
 * the card the PO just pressed answers in the place they pressed it.
 *
 * Skip sends nothing and discards nothing. It leaves the open outbound update waiting and
 * opens the next one.
 */
function OutboundSteps({
  cards,
  settled,
  focusedId,
  onFocus,
  row,
}: {
  /** Every outbound update of the batch, in the order the list draws them. */
  cards: ProposalDTO[];
  settled?: ReadonlyMap<string, SentCard>;
  focusedId: string | null;
  onFocus: (id: string) => void;
  row: (p: ProposalDTO, state: 'open' | 'closed', pick: () => void) => React.ReactNode;
}) {
  const ids = cards.map((c) => c.id);
  const waiting = new Set(ids.filter((id) => !settled?.has(id)));
  const [picked, setPicked] = useState<string | null>(null);
  // The roving cursor opens the outbound update it lands on, so the arrow keys step
  // through the outbound updates the way they walk every other row.
  const onWaitingOutbound = focusedId !== null && waiting.has(focusedId);
  useEffect(() => {
    if (onWaitingOutbound) setPicked(focusedId);
  }, [focusedId, onWaitingOutbound]);

  const current = currentOutbound(ids, waiting, picked);
  const back = stepOutbound(ids, waiting, current, -1);
  const next = stepOutbound(ids, waiting, current, 1);
  const go = (id: string) => {
    setPicked(id);
    onFocus(id);
  };
  const live = waiting.size > 0;

  return (
    <li
      className={`overflow-hidden rounded-xl bg-card ring-1 transition-shadow duration-300 motion-reduce:transition-none ${
        live ? 'ring-brand/30' : 'ring-foreground/10'
      }`}
    >
      <ul className="flex flex-col divide-y divide-border/60">
        {cards.map((c) => row(c, c.id === current ? 'open' : 'closed', () => setPicked(c.id)))}
      </ul>
      {/* The foot folds away with the last outbound update, in the motion the rows use. */}
      <div
        className={`grid transition-[grid-template-rows] duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
          live ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
        inert={!live}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex min-h-11 items-center gap-2 border-t border-border/60 px-3.5 py-1.5">
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {current ? ids.indexOf(current) + 1 : ids.length} of {ids.length}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-2">
              {back && (
                <Button size="sm" variant="ghost" onClick={() => go(back)}>
                  Back
                </Button>
              )}
              {next && (
                <Button
                  size="sm"
                  variant="ghost"
                  title="Leave this one waiting and show the next update"
                  onClick={() => go(next)}
                >
                  Skip
                </Button>
              )}
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}
