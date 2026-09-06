import type { SessionOverview } from '../state/app-state';

/** How long ago, in words. `now` is injectable so a derivation can date a whole
 *  list against one clock (and so a test can state its own). */
export function timeAgo(ms: number, now: number = Date.now()): string {
  const diff = now - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? 'yesterday' : `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

/**
 * `asking` is the set of sessions parked on a question. It counts as
 * needing the PO even though the run is technically still going: a turn that
 * asked something and got no answer looks exactly like a turn that is working,
 * and the difference is that this one will wait forever.
 */
export const needsYou = (s: SessionOverview, asking?: ReadonlySet<string>): boolean =>
  s.pendingCards > 0 || s.unread || !!asking?.has(s.id);

/**
 * Rows the Sessions rail shows: in flight, needing the PO, or finished within
 * the hour. A clock started an `automatic` session, not the PO, so nobody is
 * watching it run — it earns a place here only once it actually has something
 * (a card, or a parked question), never for merely running or having just
 * finished. `unread` doesn't count: an empty pass still leaves a transcript.
 */
export function sessionRows(
  sessions: SessionOverview[],
  asking: ReadonlySet<string>,
  now: number = Date.now(),
): SessionOverview[] {
  const cutoff = now - 60 * 60 * 1000;
  return sessions
    .filter((s) =>
      s.automatic
        ? s.pendingCards > 0 || asking.has(s.id)
        : s.running || (s.lifecycle === 'active' && (needsYou(s, asking) || s.updated > cutoff)),
    )
    .sort((a, b) => {
      // A question outranks a running row: it is the only one that can't finish
      // on its own.
      if (asking.has(a.id) !== asking.has(b.id)) return asking.has(a.id) ? -1 : 1;
      if (a.running !== b.running) return a.running ? -1 : 1;
      if (needsYou(a, asking) !== needsYou(b, asking)) return needsYou(a, asking) ? -1 : 1;
      return b.updated - a.updated;
    });
}
