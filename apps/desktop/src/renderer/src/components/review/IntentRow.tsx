import { useState } from 'react';
import { Button } from '@qale/ui';
import { Check, ChevronDown, Layers, X } from 'lucide-react';
import type { ProposalDTO } from '@qale/ipc';
import type { NavOpts } from '../../lib/nav';
import { CardItem, HousekeepingItem } from './CardItem';
import { cardHeadline, titleForRef } from './cardMeta';
import { rowFocusClass, useQueueFocus } from './shared';
import type { Approvals } from './approvals';

/** How many item names the shut row lists before it counts the rest. Three fits
 *  one line at the review's width; past that the row is a list, not a sentence. */
const NAMED = 3;

/** What one card in the group is called, in one or two words. */
function itemName(p: ProposalDTO): string {
  const { note, headline } = cardHeadline(p);
  const target = p.targetPath ?? (p.payload as { path?: string }).path ?? '';
  return note?.title || titleForRef(target) || headline;
}

/** The shut row's second line: the first few by name, then a count. */
function itemsLine(cards: readonly ProposalDTO[]): string {
  const names = cards.slice(0, NAMED).map(itemName);
  const rest = cards.length - names.length;
  return rest > 0 ? `${names.join(' · ')} · and ${rest} more` : names.join(' · ');
}

export interface IntentRowProps {
  /** The row: one plain sentence for the whole group, composed in the domain. */
  sentence: string;
  /** The group's cards, in the queue's own order. */
  cards: ProposalDTO[];
  approvals: Approvals;
  /** The queue's cursor is on this row. A group is ONE stop: ↵ approves all of
   *  it, so the cursor never walks members the row is not showing. */
  focused: boolean;
  onFocus: () => void;
  onOpen: (path: string, opts?: NavOpts) => void;
}

/**
 * One intent, as one row (docs/easier-tickets.md E-6).
 *
 * Six patches from one transcript used to be six cards, each with its own
 * headline, its own preview and its own two buttons, and the PM read the same
 * sentence six times to make one decision. Here the sentence is said once, the
 * count is in it, and the whole group is one tap.
 *
 * Opening it hands back every card, one at a time, with the same controls it
 * would have had on its own — so grouping never takes an option away. Approving
 * part of a group is a real answer: the rest re-key to the same intent and the
 * row comes back saying four instead of six.
 */
export function IntentRow({
  sentence,
  cards,
  approvals,
  focused,
  onFocus,
  onOpen,
}: IntentRowProps) {
  const [open, setOpen] = useState(false);
  const ref = useQueueFocus<HTMLLIElement>(focused);
  const { busy, errors, staleSends, accept, reject, acceptAll, rejectAll } = approvals;
  // A card that refused to apply has to speak, whatever the row is doing. The
  // group opens itself rather than hiding an error behind a count.
  const failed = cards.some((c) => errors[c.id]);
  const showing = open || failed;

  const row = (p: ProposalDTO) => {
    const shared = {
      proposal: p,
      busy,
      // The cursor stops on the group, never inside it. A member is reached
      // with the mouse or with Tab, which is what "one by one" means here.
      focused: false,
      error: errors[p.id] ?? null,
      staleSend: staleSends[p.id] ?? false,
      onFocus,
      onAccept: (edited?: unknown) => accept(p, edited),
      onReject: () => reject(p),
      onOpen,
    };
    // A one-line row that expands into the full card, the same one the queue
    // uses for housekeeping. An error forces the full card open.
    return errors[p.id] ? (
      <CardItem key={p.id} {...shared} />
    ) : (
      <HousekeepingItem key={p.id} {...shared} />
    );
  };

  return (
    <li
      ref={ref}
      tabIndex={-1}
      onClick={onFocus}
      onFocus={onFocus}
      className={`overflow-hidden rounded-xl bg-card ${rowFocusClass()}`}
    >
      <div className="flex items-start gap-2 px-4 py-3">
        <Layers className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <button
          className="min-w-0 flex-1 cursor-pointer text-left focus-visible:outline-none"
          onClick={() => setOpen((x) => !x)}
          aria-expanded={showing}
        >
          <span className="block text-sm leading-snug font-medium text-balance break-words text-foreground">
            {sentence}
          </span>
          {!showing && (
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {itemsLine(cards)}
            </span>
          )}
        </button>
        <span className="flex shrink-0 items-center gap-0.5">
          <Button
            size="sm"
            variant="ghost"
            className="text-brand"
            onClick={() => acceptAll(cards)}
            disabled={busy}
          >
            <Check className="size-3.5" /> Approve all {cards.length}
          </Button>
          {/* Said in words, not as a bare X. One tap here loses every card in
              the group, and a glyph that small cannot carry that. */}
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => rejectAll(cards)}
            disabled={busy}
          >
            <X className="size-3.5" /> Discard all
          </Button>
          <button
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => setOpen((x) => !x)}
            aria-label={showing ? 'Collapse' : 'Handle one by one'}
            title={showing ? 'Collapse' : 'Handle one by one'}
          >
            <ChevronDown className={`size-4 transition-transform ${showing ? 'rotate-180' : ''}`} />
          </button>
        </span>
      </div>

      {showing && (
        <ul className="flex flex-col gap-1.5 border-t border-border/60 px-2 pt-2 pb-2">
          {cards.map(row)}
        </ul>
      )}
    </li>
  );
}
