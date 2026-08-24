import { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger, cn } from '@qale/ui';
import { ChevronRight } from 'lucide-react';

/**
 * The token walk, unfolded on request (clarity review area 5). The one-line
 * hint compressed real work: sign in, find the page, create, and copy before
 * the dialog closes. First-timers lose the token to the closed dialog, or hit
 * an org that blocks API tokens and re-check three correct fields forever.
 * Shared by the onboarding connect form and Settings → Connections, so the
 * walk is told the same way in both places.
 */
export function AtlassianTokenHelp() {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 rounded text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none">
        <ChevronRight
          className={cn(
            'size-3.5 transition-transform motion-reduce:transition-none',
            open && 'rotate-90',
          )}
          aria-hidden
        />
        How do I get a token?
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 space-y-2 rounded-xl bg-card p-4 text-sm text-muted-foreground ring-1 ring-border">
          <ol className="list-decimal space-y-1 pl-4">
            <li>Open id.atlassian.com and sign in with your work account.</li>
            <li>Go to Security, then API tokens, and press “Create API token”.</li>
            <li>Copy the token right away. Once the window closes, it cannot be shown again.</li>
          </ol>
          <p>
            If there is no create button, your company blocks API tokens; ask your Atlassian
            administrator. This works with Jira Cloud, where your address ends in atlassian.net.
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
