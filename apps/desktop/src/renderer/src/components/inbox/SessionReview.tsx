import { useCallback, useMemo, useState } from 'react';
import { Button } from '@pm/ui';
import { Check } from 'lucide-react';
import type { ProposalDTO } from '@pm/ipc';
import { useApp } from '../../state/app-state';
import { CardItem } from './CardItem';
import { orderCards } from './cardMeta';

/**
 * The in-session review (the session-focused path): the cards a session just
 * proposed, approvable right where they were produced instead of only in the
 * Inbox. The PO just had the meeting — they can rip through the changes without
 * a context hop. Same cards, same order as the Inbox; approving here or there
 * is the same write, so the two stay in sync through `proposals`.
 */
export function SessionReview({ sessionId }: { sessionId: string }) {
  const { proposals, acceptProposal, rejectProposal, openDoc, openInbox } = useApp();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [focusId, setFocusId] = useState<string | null>(null);

  const cards = useMemo(
    () => orderCards(proposals.filter((p) => p.status === 'pending' && p.sessionId === sessionId)),
    [proposals, sessionId],
  );

  const setError = (id: string, message: string | null) =>
    setErrors((e) => {
      const next = { ...e };
      if (message === null) delete next[id];
      else next[id] = message;
      return next;
    });

  const onAccept = useCallback(
    async (p: ProposalDTO, edited?: unknown) => {
      setBusy(true);
      setError(p.id, null);
      try {
        const r = await acceptProposal(p.id, edited);
        if (!r.ok) {
          setError(
            p.id,
            r.stale
              ? "This card no longer fits the note's current text. Open it to review, or re-run the session to regenerate it."
              : r.error ?? 'Could not apply this card — the workspace rejected the write.',
          );
        }
      } catch (err) {
        setError(p.id, err instanceof Error ? err.message : 'Something went wrong applying this card.');
      } finally {
        setBusy(false);
      }
    },
    [acceptProposal],
  );

  const onReject = useCallback(
    async (p: ProposalDTO) => {
      setBusy(true);
      setError(p.id, null);
      try {
        await rejectProposal(p.id);
      } catch (err) {
        setError(p.id, err instanceof Error ? err.message : 'Something went wrong discarding this card.');
      } finally {
        setBusy(false);
      }
    },
    [rejectProposal],
  );

  const internal = useMemo(() => cards.filter((c) => c.kind !== 'outbound'), [cards]);
  const acceptAll = useCallback(async () => {
    setBusy(true);
    try {
      for (const p of internal) {
        // Outbound never rides along — each send is its own decision.
        await acceptProposal(p.id).catch((err: unknown) =>
          setError(p.id, err instanceof Error ? err.message : 'Failed — retry from the card.'),
        );
      }
    } finally {
      setBusy(false);
    }
  }, [internal, acceptProposal]);

  if (cards.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card/60 ring-1 ring-foreground/5">
      <div className="flex items-start gap-3 border-b border-border/60 px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {cards.length} change{cards.length === 1 ? '' : 's'} to review
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Nothing's filed until you approve ·{' '}
            <button
              className="underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => openInbox()}
              title="Review these in the Inbox instead"
            >
              review in the Inbox
            </button>
          </p>
        </div>
        {internal.length > 1 && (
          <Button size="sm" variant="ghost" className="shrink-0" onClick={() => void acceptAll()} disabled={busy}>
            <Check className="size-3.5" /> Approve all ({internal.length})
          </Button>
        )}
      </div>
      <ul className="flex flex-col gap-2 p-2.5">
        {cards.map((p) => (
          <CardItem
            key={p.id}
            proposal={p}
            busy={busy}
            focused={focusId === p.id}
            error={errors[p.id] ?? null}
            onFocus={() => setFocusId(p.id)}
            onAccept={(edited) => void onAccept(p, edited)}
            onReject={() => void onReject(p)}
            onOpen={openDoc}
          />
        ))}
      </ul>
    </div>
  );
}
