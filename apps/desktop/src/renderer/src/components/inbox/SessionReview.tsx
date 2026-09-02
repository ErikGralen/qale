import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import type { ProposalDTO } from '@qale/ipc';
import { useApp } from '../../state/app-state';
import { waitingElsewhere } from '../../lib/attention';
import { invoke } from '../../lib/ipc';
import { orderCards, receiptOf, receiptSummary } from './cardMeta';
import { useApprovals } from './approvals';
import { ApproveAll, CardRows } from './CardRows';
import { ReceiptLines } from './Receipt';

/**
 * The in-session review (the session-focused path): the cards a session just
 * proposed, approvable right where they were produced instead of only in the
 * Inbox. The PO just had the meeting — they can rip through the changes without
 * a context hop.
 *
 * Not a sibling of the Inbox: the same rows, the same batch button and the same
 * approve path (`useApprovals`), rendered in a second place. Approving here or
 * there is the same write, so the two stay in sync through `proposals`.
 *
 * Once every card is judged, the block does not vanish. It becomes the receipt
 * for what the session changed, and that receipt is built from the stored cards
 * rather than from this sitting's state, so it is still there next week
 * (docs/closing-beat.md).
 */
export function SessionReview({ sessionId }: { sessionId: string }) {
  const { attention, proposals, openDoc, openInbox } = useApp();
  const approvals = useApprovals();
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ProposalDTO[]>([]);

  const cards = useMemo(
    () => orderCards(proposals.filter((p) => p.status === 'pending' && p.sessionId === sessionId)),
    [proposals, sessionId],
  );

  // Re-read whenever the pending queue moves: the card that just left it is the
  // one the receipt now has to name.
  useEffect(() => {
    let live = true;
    void invoke['proposals:resolved'](sessionId)
      .then((rows) => live && setResolved(rows))
      .catch(() => live && setResolved([]));
    return () => {
      live = false;
    };
  }, [sessionId, proposals]);

  const receipt = useMemo(() => receiptOf(resolved), [resolved]);
  // The door counts what is waiting anywhere else, off the one attention list,
  // never a fresh arithmetic. It drops this session's own cards, which are on the
  // screen already.
  const elsewhere = waitingElsewhere(
    attention,
    cards.map((c) => c.id),
  );

  if (cards.length === 0) {
    // A session that never proposed anything gets no receipt. There is nothing
    // to report, and a landing block would invent one.
    if (receipt.accepted + receipt.rejected === 0) return null;
    return (
      /* The closing beat as one block on one left rail: a mark, what it came
         to, what it touched, and the door. The tally used to sit as a bare bold
         string among three other loose lines, and the door wore the same ink as
         the note links, so a stack of four things read as four unrelated
         fragments in three shades of blue. The check marks the close, the notes
         keep the ink because opening one is the point, and the door steps back
         to muted until the pointer is on it. */
      <section aria-label="What you approved" className="mt-1 px-0.5">
        <div className="flex items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-brand/10">
            <Check className="size-3.5 text-brand" />
          </span>
          <h3 className="text-sm font-semibold text-foreground">{receiptSummary(receipt)}</h3>
        </div>
        {/* Hung off the mark's column, so head and rows share one text edge. */}
        <ReceiptLines entries={receipt.entries} onOpen={openDoc} className="mt-1.5 pl-7" />
        {elsewhere > 0 && (
          <button
            className="mt-2.5 ml-7 flex items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => openInbox()}
          >
            {elsewhere} more waiting in Inbox <ArrowRight className="size-3.5" />
          </button>
        )}
      </section>
    );
  }

  const heading = `${cards.length} change${cards.length === 1 ? '' : 's'} to review`;

  return (
    /* A heading over the cards, not a container around them. Each card already
       carries its own surface, so wrapping the set in a second one boxed a box
       and pushed the change three frames deep before a word of it showed. The
       Inbox groups the same cards under a bare section header; the session says
       it the same way. */
    <section aria-label={heading} className="mt-1">
      {/* One card needs no announcement: the card says what it is. The count
          and the batch button earn a header row only on a pile. */}
      {cards.length > 1 && (
        <div className="mb-1.5 flex items-center gap-3 px-0.5">
          <h3 className="min-w-0 flex-1 text-sm font-semibold text-foreground">{heading}</h3>
          <ApproveAll cards={cards} approvals={approvals} className="shrink-0" />
        </div>
      )}
      <CardRows
        cards={cards}
        approvals={approvals}
        focusedId={focusedId}
        onFocus={setFocusedId}
        onOpen={openDoc}
      />
    </section>
  );
}
