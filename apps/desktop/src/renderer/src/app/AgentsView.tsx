import { Bot, ChevronRight, Sparkles } from 'lucide-react';
import type { AgentDTO } from '@pm/ipc';
import { useApp } from '../state/app-state';
import { navFromEvent } from '../lib/nav';
import { PageHeader } from '../components/PageHeader';
import { AgentSwitch } from '../components/AgentSwitch';
import { AgentLifeSigns, AgentBlockedNotice } from '../components/AgentLifeSigns';

/**
 * The Agents view — the sibling of Skills. Skills are what the agent works
 * with when you hand it work; agents start THEMSELVES. Every agent IS a file
 * (`agents/<name>/AGENT.md`): the row is a door to it, and the file is the editor for
 * everything — identity, instructions, the switch. So the row stays small: one
 * summary line, one meta line (when it runs, when it last ran, what's waiting),
 * and the switch. The switch is real — off is written into the file's
 * frontmatter and stops the sweep, it doesn't just hide the row.
 */

function AgentRow({ agent }: { agent: AgentDTO }) {
  const { openDoc, setAgentEnabled } = useApp();
  return (
    <li className="group relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/50">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {/* The whole row is the door — same gesture as a Skills row. The
              title button's ::after stretches over the row; the switch and
              inline links sit above it on their own `relative`. */}
          <button
            className="truncate rounded text-sm font-semibold text-foreground after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset"
            onClick={(e) => void openDoc(agent.path, navFromEvent(e))}
            title={`Open ${agent.path}`}
          >
            {agent.title}
          </button>
        </div>
        <p className="mt-0.5 text-dense text-muted-foreground">{agent.summary}</p>
        <AgentLifeSigns agent={agent} className="mt-1" />
        <AgentBlockedNotice agent={agent} className="mt-2" />
      </div>

      <span className="relative mt-0.5">
        <AgentSwitch
          enabled={agent.enabled}
          label={agent.title}
          onToggle={(enabled) => void setAgentEnabled(agent.id, enabled)}
        />
      </span>
      <ChevronRight
        className="mt-0.5 size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground"
        aria-hidden
      />
    </li>
  );
}

export function AgentsView() {
  const { agents } = useApp();

  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={Bot} label="Agents" meta={agents.length > 0 ? agents.length : undefined} />

      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-8 py-5">
        <p className="mb-3 px-1 text-dense text-muted-foreground">
          Agents start themselves — on a clock, or when something happens in the workspace.
          Everything they produce waits in the Inbox for your approval.
        </p>

        {agents.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-brand/10">
              <Bot className="size-6 text-brand" aria-hidden />
            </div>
            <h2 className="text-lg font-semibold">No agents yet</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              The built-in agents are seeded when a workspace opens, and the app starts them
              itself — on a clock, or when something happens in the workspace.
            </p>
          </div>
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-border">
              {agents.map((agent) => (
                <AgentRow key={agent.id} agent={agent} />
              ))}
            </ul>
            <p className="mt-3 flex items-center gap-1.5 px-1 pb-4 text-xs text-muted-foreground/70">
              <Sparkles className="size-3" aria-hidden />
              Every agent is a file you can read and edit.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
