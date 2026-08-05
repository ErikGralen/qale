import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Spinner } from '@qale/ui';
import { TriangleAlert, X } from 'lucide-react';
import type { ArrivalHandoffDTO } from '@qale/ipc';
import { RAIL_SLOT_ID } from './toast';

/**
 * The moment after the drop (docs/arrival-agentic.md, rung 0).
 *
 * Rung 0 is "drop, Add, done": the agent files and narrates, and if the job was
 * pure filing the session ends quietly and the PM never visits it. That only
 * works if the moment itself is not silent, so this one line stands in for the
 * whole thing — what is happening, and the way in for anyone who wants to watch.
 *
 * It has no timeout. It goes when the session goes: {@link running} is read off
 * the live-session rail, so the line is up for exactly as long as there is
 * something to watch. A run that could not start says why instead and waits to
 * be dismissed, because that one is news.
 */
export function ArrivalHandoff({
  arrival,
  running,
  onOpen,
  onDismiss,
}: {
  /** Null while the batch is still being written (the tray has just closed). */
  arrival: ArrivalHandoffDTO | null;
  /** The session is working right now. */
  running: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById(RAIL_SLOT_ID)), []);

  const stalled = arrival !== null && !arrival.started;
  const refused = arrival?.refused ?? [];

  const body = (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-2 rounded-xl border border-border bg-card p-3 shadow-lg duration-150 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2"
    >
      {stalled ? (
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
      ) : (
        <Spinner className="mt-0.5 size-3.5 shrink-0 text-brand" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground">
          {stalled ? 'Your material is safe, but nothing is reading it' : 'Reading what you added'}
        </p>
        <p className="mt-0.5 text-xs leading-snug text-balance text-muted-foreground">
          {stalled
            ? arrival.reason
            : 'It files each piece where it belongs and proposes what to do about it as cards. Nothing lands in the memory without your approval.'}
        </p>
        {refused.length > 0 && (
          <p className="mt-1 text-xs leading-snug text-balance text-muted-foreground">
            {refused.length === 1
              ? `${refused[0]!.name} was left out: ${refused[0]!.error}`
              : `${refused.length} files were left out because they could not be read.`}
          </p>
        )}
        {arrival && (
          <button
            type="button"
            onClick={onOpen}
            className="mt-1.5 rounded text-xs font-medium text-brand underline-offset-2 transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none"
          >
            {running ? 'Watch it work' : 'Open the session'}
          </button>
        )}
      </div>
      {/* Only the stalled line can be dismissed. The running one dismisses
          itself when the session settles, so a close button would be a control
          for something that is about to happen anyway. */}
      {stalled && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded p-0.5 text-muted-foreground/45 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );

  return slot ? createPortal(body, slot) : null;
}
