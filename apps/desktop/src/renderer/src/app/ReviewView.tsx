import { useEffect, useMemo, useState } from 'react';
import { Button, Badge } from '@pm/ui';
import { Check, X, Inbox } from 'lucide-react';
import type { ProposalDTO } from '@pm/ipc';
import { useApp } from '../state/app-state';

/**
 * The Inbox as a card stepper (PLAN-V2 §3.3): one approval card at a time.
 * Accept applies it (write + commit); reject drops it; skip defers. Ends with a
 * receipt. Phase 2 recycles this mechanic inside the full Inbox view.
 */
export function ReviewView() {
  const { proposals, acceptProposal, rejectProposal, refreshProposals } = useApp();
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
        <Inbox className="size-4" /> Inbox
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
        ) : (
          <WriteCard
            key={current.id}
            proposal={current}
            busy={busy}
            onAccept={onAccept}
            onReject={onReject}
            onSkip={advance}
          />
        )}
      </div>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  note: 'new note',
  decision: 'decision',
  update: 'update',
};

/** Note/decision/update cards: rationale, evidence, inference badge, review-time diff. */
function WriteCard({
  proposal,
  busy,
  onAccept,
  onReject,
  onSkip,
}: {
  proposal: ProposalDTO;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
  onSkip: () => void;
}) {
  const { previewProposal } = useApp();
  const [preview, setPreview] = useState<{ before: string; after: string; stale: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    void previewProposal(proposal.id).then((p) => alive && setPreview(p));
    return () => {
      alive = false;
    };
  }, [proposal.id, previewProposal]);

  const target = proposal.targetPath ?? (proposal.payload as { path?: string }).path ?? '';

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Badge variant="secondary">{KIND_LABEL[proposal.kind] ?? proposal.kind}</Badge>
        <span className="truncate font-mono text-xs text-muted-foreground">{target}</span>
        {proposal.inference && <Badge>inference</Badge>}
      </div>

      <p className="mb-3 text-sm text-muted-foreground">{proposal.rationale}</p>

      {proposal.evidence.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {proposal.evidence.map((e) => (
            <span key={e.ref} className="rounded bg-brand/8 px-1.5 py-0.5 font-mono text-xs text-brand">
              {e.ref}
            </span>
          ))}
        </div>
      )}

      {preview && (
        <pre className="mb-4 max-h-60 overflow-y-auto rounded-lg bg-muted/60 p-3 text-xs whitespace-pre-wrap">
          {proposal.kind === 'update' ? renderDiff(preview.before, preview.after) : preview.after}
        </pre>
      )}

      {preview?.stale && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive">
          The target changed since this was proposed — re-run the session to regenerate.
        </div>
      )}

      <div className="flex gap-2">
        <Button size="sm" onClick={onAccept} disabled={busy || preview?.stale}>
          <Check className="size-3.5" /> Accept
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

/** A minimal line diff for the update preview. */
function renderDiff(before: string, after: string): string {
  const b = before.split('\n');
  const a = after.split('\n');
  const out: string[] = [];
  const max = Math.max(b.length, a.length);
  for (let i = 0; i < max; i++) {
    if (b[i] === a[i]) out.push(`  ${a[i] ?? ''}`);
    else {
      if (b[i] !== undefined) out.push(`- ${b[i]}`);
      if (a[i] !== undefined) out.push(`+ ${a[i]}`);
    }
  }
  return out.join('\n');
}
