import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { connections, type DeliveryDeltaDTO } from '../lib/connections';
import { ExternalRefChip } from './ExternalRef';

/**
 * The meeting page's "since last time" line: what moved in delivery between the
 * previous meeting in this series and now, straight from the local mirror. It
 * lives on the meeting page — the owning view — never as an Inbox row. Blocked
 * transitions fly the amber flag (icon + word, not color alone); quiet or empty
 * weeks render nothing at all.
 */
export function MeetingDelivery({ path, onOpen }: { path: string; onOpen: (p: string) => void }) {
  const [deltas, setDeltas] = useState<DeliveryDeltaDTO[]>([]);

  useEffect(() => {
    let alive = true;
    void connections
      .deliveryDelta(path)
      .then((d) => alive && setDeltas(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [path]);

  if (deltas.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg bg-muted/40 px-3 py-2 ring-1 ring-border/70">
      <span className="text-xs font-medium text-muted-foreground">Since last time</span>
      <ul className="mt-1 flex flex-col gap-1">
        {deltas.map((d) => (
          <li
            key={d.externalId}
            className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm"
          >
            <ExternalRefChip target={d.slug} onOpen={onOpen} />
            <span className="min-w-0 truncate text-muted-foreground">{d.title}</span>
            <span
              className={`inline-flex items-center gap-1 font-medium ${
                d.stateCategory === 'blocked'
                  ? 'text-warning'
                  : d.stateCategory === 'done'
                    ? 'text-success'
                    : 'text-foreground/80'
              }`}
            >
              {d.stateCategory === 'blocked' && <AlertTriangle className="size-3" aria-hidden />}
              {d.line}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
