import { useMemo, useState } from 'react';
import { useApp } from '../../state/app-state';
import { orderCards } from './cardMeta';
import { useApprovals, SpotAudit } from './approvals';
import { ApproveAll, CardRows } from './CardRows';

/**
 * The in-session review (the session-focused path): the cards a session just
 * proposed, approvable right where they were produced instead of only in the
 * Inbox. The PO just had the meeting — they can rip through the changes without
 * a context hop.
 *
 * Not a sibling of the Inbox: the same rows, the same batch button and the same
 * approve path (`useApprovals`), rendered in a second place. Approving here or
 * there is the same write, so the two stay in sync through `proposals`.
 */
export function SessionReview({ sessionId }: { sessionId: string }) {
  const { proposals, openDoc } = useApp();
  const approvals = useApprovals();
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const cards = useMemo(
    () => orderCards(proposals.filter((p) => p.status === 'pending' && p.sessionId === sessionId)),
    [proposals, sessionId],
  );

  if (cards.length === 0) return null;

  const heading = `${cards.length} change${cards.length === 1 ? '' : 's'} to review`;

  return (
    /* A heading over the cards, not a container around them. Each card already
       carries its own surface, so wrapping the set in a second one boxed a box
       and pushed the change three frames deep before a word of it showed. The
       Inbox groups the same cards under a bare section header; the session says
       it the same way. */
    <section aria-label={heading} className="mt-1">
      <div className="mb-1.5 flex items-start gap-3 px-0.5">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">{heading}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Nothing's filed until you approve</p>
        </div>
        <ApproveAll cards={cards} approvals={approvals} className="-mt-1 shrink-0" />
      </div>
      <SpotAudit approvals={approvals} />
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
