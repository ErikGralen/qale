import { Button } from '@pm/ui';
import { ArrowRight, FileUp, FolderOpen, Inbox, Sparkles } from 'lucide-react';
import { useApp } from '../state/app-state';
import { requestCapture } from '../lib/capture-event';

/**
 * The home surface, organized around the PO's jobs (PLAN-V2 §3.3): pending
 * cards first, universal capture as the primary affordance, ask as a quiet
 * second. The shell handles drag-and-drop anywhere; this page is the visible
 * invitation.
 */
export function Landing() {
  const { vault, openVaultDialog, openInbox, openSession, pendingCount, tree } = useApp();

  const empty = !tree || tree.groups.every((g) => g.notes.length === 0);

  if (!vault) {
    return (
      <div className="flex h-full flex-col">
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-8 pb-24">
          <div className="space-y-1.5">
            <h1 className="font-serif text-3xl font-semibold tracking-tight text-balance">
              What did we just learn?
            </h1>
            <p className="max-w-prose text-[15px] text-muted-foreground">
              Produktminnet turns what you dump into it — transcripts, links, screenshots — into
              decisions, actions, and drafts. Nothing is written anywhere without your approval.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-border p-4">
            <FolderOpen className="size-5 text-muted-foreground" />
            <div className="flex-1">
              <div className="text-sm font-medium">Open a workspace to start</div>
              <div className="text-sm text-muted-foreground">
                Any folder of markdown works — an existing Obsidian vault included.
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={openVaultDialog}>
              Open workspace…
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-5 px-8 pb-20">
        <div className="space-y-1.5">
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-balance">
            What did we just learn?
          </h1>
          <p className="max-w-prose text-[15px] text-muted-foreground">
            Dump anything and the system files it: a transcript runs After-Meeting, a link or
            screenshot gets connected to your memory — all as cards you approve.
          </p>
        </div>

        {pendingCount > 0 && (
          <button
            className="flex items-center gap-2.5 rounded-xl border border-brand/40 bg-brand/8 px-4 py-3 text-left transition-colors hover:bg-brand/12 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => openInbox()}
          >
            <Inbox className="size-4.5 text-brand" />
            <span className="flex-1 text-sm font-medium text-foreground">
              {pendingCount} card{pendingCount === 1 ? '' : 's'} waiting for your approval
            </span>
            <span className="flex items-center gap-1 text-sm font-medium text-brand">
              Open Inbox <ArrowRight className="size-3.5" />
            </span>
          </button>
        )}

        <button
          className="group flex flex-col items-center gap-2.5 rounded-xl border-2 border-dashed border-border bg-card/50 px-8 py-9 transition-colors hover:border-brand/50 hover:bg-card focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={() => requestCapture()}
        >
          <FileUp className="size-6 text-muted-foreground transition-colors group-hover:text-brand" />
          <div className="text-center">
            <div className="text-sm font-semibold">Drop anything, anywhere</div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              A transcript, a link, a screenshot, a thought — or press{' '}
              <kbd className="rounded border border-border bg-muted px-1 text-xs">⇧⌘N</kbd> to paste
            </div>
          </div>
        </button>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => openSession('ask')}>
            <Sparkles className="size-3.5" /> Ask the memory
            <kbd className="ml-1 text-xs text-muted-foreground">⌘↵</kbd>
          </Button>
        </div>

        {empty && (
          <p className="max-w-prose text-sm text-muted-foreground">
            Week one starts here. Everything you dump adds decisions, insights and customer
            notes you can ask about later — the memory is plain markdown you can always open.
          </p>
        )}
      </div>
    </div>
  );
}
