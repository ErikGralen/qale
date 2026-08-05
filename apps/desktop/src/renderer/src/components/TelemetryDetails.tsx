import { useState } from 'react';
import {
  TELEMETRY_EVENTS,
  TELEMETRY_IDENTITY,
  TELEMETRY_NEVER,
} from '@qale/ipc';
import { Collapsible, CollapsibleContent, CollapsibleTrigger, cn } from '@qale/ui';
import { ChevronRight } from 'lucide-react';

/**
 * The exact list of what we send, folded away until someone asks for it.
 *
 * The list still comes from the same allowlist the sender reads (`@qale/ipc`
 * telemetry), so the promise and the code stay the same object. What changed is
 * only where it sits: eighteen lines of small print was the first thing anyone
 * met on the setup screen, and a wall of reassurance reads as something to be
 * worried about. The short version answers the question; this answers it in
 * full, one click away, in both places the switch appears.
 */
export function TelemetryDetails() {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 rounded text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none">
        <ChevronRight
          className={cn('size-3.5 transition-transform motion-reduce:transition-none', open && 'rotate-90')}
          aria-hidden
        />
        {open ? 'Hide the exact list' : 'See the exact list'}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 grid gap-x-6 gap-y-4 rounded-xl bg-card p-4 ring-1 ring-border sm:grid-cols-2">
          <div>
            <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              We send
            </div>
            <ul className="mt-2 space-y-1">
              {/* Who the reports are tied to leads the list: it is the one line
                  here nobody would guess. It is also said next to the switch,
                  so nobody has to open this to find it. */}
              <li className="text-dense">{TELEMETRY_IDENTITY}</li>
              {TELEMETRY_EVENTS.map((e) => (
                <li key={e.id} className="text-dense text-muted-foreground">
                  {e.says}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              We never send
            </div>
            <ul className="mt-2 space-y-1">
              {TELEMETRY_NEVER.map((line) => (
                <li key={line} className="text-dense text-muted-foreground">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
