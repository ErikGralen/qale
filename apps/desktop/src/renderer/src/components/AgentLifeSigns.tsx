import { TriangleAlert } from 'lucide-react';
import type { AgentDTO } from '@pm/ipc';
import { cn } from '@pm/ui';
import { relativeTime } from '../lib/dates';
import { useApp } from '../state/app-state';
import { navFromEvent } from '../lib/nav';
import { StartChips, CanChips, visibleStarts } from './RunnableConfig';

/**
 * The lines an agent shows wherever it appears — the Agents list row and the
 * agent's own page — kept in one place so the words never drift apart.
 */

/**
 * The life signs: what starts it and what it may do (both config, both chips),
 * then what it has actually done. Kept as separate lines because they answer
 * separate questions — an agent can have a clock and still have never fired.
 */
export function AgentLifeSigns({ agent, className }: { agent: AgentDTO; className?: string }) {
  const { openInbox } = useApp();
  // An agent with no clock is one the app never begins by itself. That is the
  // whole point of the page, so it is said in words rather than left as a gap.
  const selfStarting = visibleStarts(agent.starts).length > 0;
  // The last run had nothing to report, and it really was the LAST one: the
  // quiet stamp only speaks for the run it belongs to, so a later run that DID
  // say something takes the line back (QM ticket 2).
  const quietRun =
    agent.lastQuietMs && agent.lastQuietMs >= (agent.lastRunMs ?? 0) ? agent.lastQuietMs : null;
  // Same rule, and it outranks the quiet line: a run that stopped because it
  // needed the PM has a reason worth naming, where a quiet one only has an
  // absence (QM ticket 9). This is the whole of what that run leaves, and it
  // waits here to be found rather than arriving as a notification.
  const stoppedRun =
    agent.lastStoppedMs && agent.lastStoppedMs >= (agent.lastRunMs ?? 0) ? agent.lastStoppedMs : null;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {selfStarting ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <StartChips starts={agent.starts} />
          <CanChips can={agent.can} />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-xs text-muted-foreground/80">
            Nothing starts this — the app never begins it on its own
          </p>
          <CanChips can={agent.can} />
        </div>
      )}
      <p className="text-xs text-muted-foreground/80">
        {agent.status === 'off'
          ? 'Switched off'
          : stoppedRun
            ? `Stopped ${relativeTime(stoppedRun)}: needed a decision, nobody was here`
            : // A scheduled run with nothing to say leaves no receipt, no session
              // and no badge, so this line is the whole of what it leaves.
              quietRun
              ? `Ran ${relativeTime(quietRun)}, nothing to report`
              : agent.lastRunMs
                ? `Last ran ${relativeTime(agent.lastRunMs)}`
                : // It looked and found nothing to do — said plainly, so a quiet
                  // agent reads as watching rather than as broken.
                  agent.lastCheckedMs
                  ? `Last checked ${relativeTime(agent.lastCheckedMs)}`
                  : 'Not yet this session'}
        {agent.pendingCards > 0 && (
          <>
            {' · '}
            {/* `relative` lifts the link above AgentRow's whole-row click overlay. */}
            <button
              className="relative rounded font-medium text-brand underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={(e) => openInbox(navFromEvent(e))}
            >
              {agent.pendingCards} card{agent.pendingCards === 1 ? '' : 's'} in the Inbox
            </button>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Blocked, never silent: why it can't run, and the door to the fix. A missing
 * key is a config gap (amber, with the way to Settings); a broken file is an
 * error (red) whose fix is the file itself. The agent's page hides this for
 * broken files — its pinned error list already says the same thing louder.
 */
export function AgentBlockedNotice({ agent, className }: { agent: AgentDTO; className?: string }) {
  const { openSettings } = useApp();
  if (agent.status !== 'blocked' || !agent.blockedReason) return null;
  const broken = agent.errors.length > 0;
  return (
    <p
      className={cn(
        'flex items-start gap-1.5 rounded-md px-2.5 py-1.5 text-xs',
        broken ? 'bg-destructive/8 text-destructive' : 'bg-warning/10 text-warning',
        className,
      )}
    >
      <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{agent.blockedReason}</span>
      {!broken && (
        <button
          className="relative shrink-0 rounded font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={(e) => openSettings(navFromEvent(e))}
        >
          Open Settings
        </button>
      )}
    </p>
  );
}
