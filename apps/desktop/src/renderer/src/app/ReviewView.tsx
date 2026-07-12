import { useEffect, useMemo, useState } from 'react';
import { Button, Badge } from '@pm/ui';
import { Check, X, ChevronRight, Inbox, Link2, Sparkles, Trash2 } from 'lucide-react';
import type { ProposalDTO, TriagePayloadDTO } from '@pm/ipc';
import { useApp } from '../state/app-state';

/**
 * The review queue as a triage stepper (PLAN §3, Phase 3): one proposal at a
 * time, the GROUP is the unit of accept. Accept applies to all member signals;
 * reject drops it; skip defers. Ends with a receipt.
 */
export function ReviewView() {
  const { proposals, acceptProposal, rejectProposal, refreshProposals, openNote } = useApp();
  const [cursor, setCursor] = useState(0);
  const [receipt, setReceipt] = useState<{ accepted: number; rejected: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refreshProposals();
  }, [refreshProposals]);

  const queue = useMemo(() => proposals.filter((p) => p.status === 'pending'), [proposals]);
  const current = queue[cursor];

  const advance = () => setCursor((c) => c + 1);

  const onAccept = async () => {
    if (!current) return;
    setBusy(true);
    const result = await acceptProposal(current.id);
    setBusy(false);
    if (result.stale) return; // stays in queue, card shows stale
    setReceipt((r) => ({ accepted: (r?.accepted ?? 0) + 1, rejected: r?.rejected ?? 0 }));
    advance();
  };

  const onReject = async () => {
    if (!current) return;
    setBusy(true);
    await rejectProposal(current.id);
    setBusy(false);
    setReceipt((r) => ({ accepted: r?.accepted ?? 0, rejected: (r?.rejected ?? 0) + 1 }));
    advance();
  };

  const done = !current;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 items-center gap-2 px-5 text-sm font-medium text-muted-foreground" style={{ WebkitAppRegion: 'drag' } as never}>
        <Inbox className="size-4" /> Review queue
        {queue.length > 0 && <span className="text-xs">· {Math.min(cursor + 1, queue.length)} of {queue.length}</span>}
      </div>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-8 pb-16">
        {done ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-brand/10">
              <Check className="size-6 text-brand" />
            </div>
            <h2 className="font-serif text-2xl font-semibold">All caught up</h2>
            {receipt && (
              <p className="text-sm text-muted-foreground">
                {receipt.accepted} accepted · {receipt.rejected} dismissed this session.
              </p>
            )}
          </div>
        ) : current.kind === 'triage' ? (
          <TriageCard
            proposal={current}
            stale={current.status === 'stale'}
            busy={busy}
            onAccept={onAccept}
            onReject={onReject}
            onSkip={advance}
            onOpen={openNote}
          />
        ) : (
          <GenericCard proposal={current} busy={busy} onAccept={onAccept} onReject={onReject} />
        )}
      </div>
    </div>
  );
}

function TriageCard({
  proposal,
  stale,
  busy,
  onAccept,
  onReject,
  onSkip,
  onOpen,
}: {
  proposal: ProposalDTO;
  stale: boolean;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
  onSkip: () => void;
  onOpen: (path: string) => void;
}) {
  const payload = proposal.payload as TriagePayloadDTO;
  const ActionIcon = payload.action === 'link' ? Link2 : payload.action === 'new-theme' ? Sparkles : Trash2;
  const actionLabel =
    payload.action === 'link'
      ? `Link to ${payload.themeRef}`
      : payload.action === 'new-theme'
        ? `New theme: “${payload.newTheme?.summary}”`
        : 'Discard as noise';

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Badge variant="secondary">triage</Badge>
        <span className="text-xs text-muted-foreground">
          {payload.signalPaths.length} signal{payload.signalPaths.length === 1 ? '' : 's'} · same thing
        </span>
        {proposal.inference && <Badge>inference</Badge>}
      </div>

      <div className="mb-3 flex items-center gap-2 text-[15px] font-medium">
        <ActionIcon className="size-4 text-brand" />
        {actionLabel}
      </div>

      <ul className="mb-4 flex flex-col gap-1 rounded-lg bg-muted/50 p-2">
        {payload.signalPaths.map((path) => (
          <li key={path}>
            <button
              className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm hover:bg-accent"
              onClick={() => onOpen(path)}
            >
              <ChevronRight className="size-3.5 text-muted-foreground" />
              <span className="truncate font-mono text-xs">{path}</span>
            </button>
          </li>
        ))}
      </ul>

      <p className="mb-4 text-sm text-muted-foreground">{payload.rationale}</p>

      {stale && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive">
          The theme changed since this was proposed — re-run triage to regenerate.
        </div>
      )}

      <div className="flex gap-2">
        <Button size="sm" onClick={onAccept} disabled={busy}>
          <Check className="size-3.5" /> Accept group
        </Button>
        <Button size="sm" variant="outline" onClick={onReject} disabled={busy}>
          <X className="size-3.5" /> Dismiss
        </Button>
        <Button size="sm" variant="ghost" onClick={onSkip} disabled={busy}>
          Skip
        </Button>
      </div>
    </div>
  );
}

function GenericCard({
  proposal,
  busy,
  onAccept,
  onReject,
}: {
  proposal: ProposalDTO;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <Badge variant="secondary">{proposal.kind}</Badge>
      <p className="my-3 text-sm">{proposal.rationale}</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={onAccept} disabled={busy}>
          Accept
        </Button>
        <Button size="sm" variant="outline" onClick={onReject} disabled={busy}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
