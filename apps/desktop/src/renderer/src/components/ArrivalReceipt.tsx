import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Undo2, X } from 'lucide-react';
import { Button } from '@pm/ui';
import type { ArrivalResultDTO } from '@pm/ipc';
import { useApp } from '../state/app-state';
import { useToast } from './toast';
import { RAIL_SLOT_ID } from './toast';
import { outcomeOf } from '../lib/arrival-outcome';

/**
 * What a batch did, and the way back (docs/vision/arrival.md §8).
 *
 * Deliberately NOT a toast — it does not time out, because the Undo it carries
 * restores every path the batch touched and an affordance with a deadline is
 * worse than none. It is also deliberately rare: see `worthAReceipt`.
 *
 * Undo is a BATCH affordance. Taking back one document is the document's own
 * job — it is open in front of you and its ⋯ menu deletes it — and offering a
 * second, weaker path to the same thing in a floating card is how you end up
 * with two ways to delete a note and no clear one.
 */
export function ArrivalReceipt({
  arrival,
  onDismiss,
}: {
  arrival: ArrivalResultDTO;
  onDismiss: () => void;
}) {
  const { undoArrival, openFolder } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  // The rail slot mounts with the provider, one paint before this does.
  useEffect(() => setSlot(document.getElementById(RAIL_SLOT_ID)), []);

  const { filed, failed, sessions } = outcomeOf(arrival);

  const undo = async () => {
    setBusy(true);
    try {
      const { removed, restored } = await undoArrival(arrival.id);
      if (removed.length + restored.length === 0) {
        toast('Nothing left to undo — those files have already moved.');
      }
      onDismiss();
    } catch (err) {
      toast(`Undo failed: ${err instanceof Error ? err.message : 'the workspace rejected the write.'}`);
    } finally {
      setBusy(false);
    }
  };

  const headline =
    filed.length === 1
      ? (filed[0]!.title ?? filed[0]!.name)
      : `${filed.length} file${filed.length === 1 ? '' : 's'} filed`;
  /** One item is deletable where it stands; a batch is not. */
  const canUndo = filed.length > 1;

  const body = (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-lg duration-150 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2"
    >
      <div className="flex items-start gap-2">
        <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground" title={headline}>
            {headline}
          </p>
          {/* Two lines, not one truncated one: "1 review could not start" and
              "1 unreadable" are both things the PO has to act on, and a clause
              cut off mid-word is the same as not saying it. */}
          <p className="mt-0.5 text-xs leading-snug text-balance text-muted-foreground">
            {arrival.ambition === 'catchup'
              ? 'Caught up — nothing was run over them'
              : arrival.reviews > 0
                ? `${arrival.reviews} review${arrival.reviews === 1 ? '' : 's'} started`
                : arrival.reviewsFailed > 0
                  ? `Filed — ${arrival.reviewsFailed} review${arrival.reviewsFailed === 1 ? '' : 's'} could not start`
                  : 'Nothing to run'}
            {failed.length > 0 && (
              <span className="text-destructive"> · {failed.length} unreadable</span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {(canUndo || sessions.length > 1) && (
        <div className="flex items-center gap-1.5">
          {/* Undo never wears the accent: it is the action you hope not to need,
              and terracotta means "this is the way forward" everywhere else. */}
          {canUndo && (
            <Button size="xs" variant="ghost" onClick={undo} disabled={busy} className="-ml-1">
              <Undo2 className="size-3" aria-hidden />
              {busy ? 'Undoing…' : 'Undo all'}
            </Button>
          )}
          {sessions.length > 1 ? (
            <span className="ml-auto text-xs text-muted-foreground">
              {sessions.length} reviews in Sessions
            </span>
          ) : (
            canUndo && (
              <Button
                size="xs"
                variant="ghost"
                className="ml-auto"
                onClick={() => {
                  openFolder(filed[0]!.dir!.replace(/\/$/, ''));
                  onDismiss();
                }}
              >
                Show them
              </Button>
            )
          )}
        </div>
      )}
    </div>
  );

  return slot ? createPortal(body, slot) : null;
}
