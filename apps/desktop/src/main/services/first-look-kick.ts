/**
 * The knock chases the sync (docs/first-look-debrief.md, FD-2 amended
 * 2026-08-31).
 *
 * Confirming the follow picker used to end in silence. The confirm starts a sync
 * tick of its own, but only the maintenance pass fires the debrief, and that
 * pass runs on a five-minute clock. So the person who just pressed the button
 * waited minutes for anything to happen, which is the fizzle this closes.
 *
 * The picker sends one `setFollow` per container, so this debounces: the last
 * call wins and the whole confirm is one kick. Turning a follow OFF is
 * maintenance and needs nothing.
 *
 * The retry is the one case the debounce cannot cover. A maintenance pass that
 * is already running is joined, not queued, so a kick that lands after that pass
 * read the first-look flag resolves with nothing done. `stillOwed` asks whether
 * that happened, and one more pass settles it.
 */
export interface FirstLookKick {
  /** A follow changed. Only turning one ON is worth a kick. */
  follow(followed: boolean): void;
  /** Drop a kick that has not fired yet. */
  cancel(): void;
}

export interface FirstLookKickOptions {
  /** How long the last `setFollow` of a confirm has to be the last one. */
  delayMs: number;
  /** The maintenance pass. It runs sync first, so it waits for the confirm's
   *  own tick rather than racing it. */
  pass: () => Promise<void>;
  /** Is a debrief still owed after that pass? */
  stillOwed: () => boolean;
  onError?: (err: unknown) => void;
}

export function createFirstLookKick(opts: FirstLookKickOptions): FirstLookKick {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fire = async (): Promise<void> => {
    await opts.pass();
    if (opts.stillOwed()) await opts.pass();
  };

  return {
    follow(followed: boolean): void {
      if (!followed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fire().catch((err) => opts.onError?.(err));
      }, opts.delayMs);
      // A pending kick must never be the reason the process stays up.
      (timer as { unref?: () => void }).unref?.();
    },
    cancel(): void {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
