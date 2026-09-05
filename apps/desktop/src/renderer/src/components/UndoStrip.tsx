import { useCallback, useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';

/**
 * The way back from a small write, offered for six seconds and then gone.
 *
 * The rule it keeps: anything the app does on one click and can undo on one
 * click says so where the click happened, and settles on its own. It is not an
 * error, so it is not the red toast; it is not a decision, so it is not a
 * dialog. The sidebar's unpin, a move in Documents, a delete in Documents: one
 * strip, one vocabulary.
 */
export interface UndoOffer {
  /** What happened, in one word: "Unpinned", "Moved", "Deleted". */
  label: string;
  /** What it happened to. Reads in ink, so the eye lands on it. */
  title: string;
  /** Where it went, when that is part of the sentence ("to specs"). */
  suffix?: string;
  undo: () => void;
}

/**
 * Holds the offer and lets it lapse. The timer restarts on every new offer, so
 * two moves in a row leave one strip, counting from the second.
 */
export function useUndoOffer(): {
  offer: UndoOffer | null;
  /** Show this one. It replaces whatever is on screen. */
  offerUndo: (offer: UndoOffer) => void;
  /** Run the offer and take the strip away. */
  runUndo: () => void;
} {
  const [offer, setOffer] = useState<UndoOffer | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);

  const offerUndo = useCallback((next: UndoOffer) => {
    setOffer(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOffer(null), 6000);
  }, []);

  const runUndo = useCallback(() => {
    setOffer((current) => {
      current?.undo();
      return null;
    });
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  return { offer, offerUndo, runUndo };
}

/** The strip itself. `className` places it; the look is the same everywhere. */
export function UndoStrip({
  offer,
  onUndo,
  className = '',
}: {
  offer: UndoOffer | null;
  onUndo: () => void;
  className?: string;
}) {
  if (!offer) return null;
  return (
    <div
      role="status"
      className={`flex items-center gap-2 rounded-lg border border-border bg-card/70 px-2.5 py-1.5 text-xs text-muted-foreground ${className}`}
    >
      <Check className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        {offer.label} <span className="text-foreground">{offer.title}</span>
        {offer.suffix ? ` ${offer.suffix}` : ''}
      </span>
      <button
        className="shrink-0 rounded px-1 font-medium text-brand transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={onUndo}
      >
        Undo
      </button>
    </div>
  );
}
