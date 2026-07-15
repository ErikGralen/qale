import { useEffect, useMemo, useState } from 'react';
import { Button, Badge } from '@pm/ui';
import { Check, X, Inbox, Layers } from 'lucide-react';
import type { ProposalDTO } from '@pm/ipc';
import { useApp } from '../state/app-state';

const KIND_LABEL: Record<string, string> = { note: 'new note', decision: 'decision', update: 'update' };

/**
 * The Inbox (PLAN-V2 §3.3) — home, not a dashboard. A unified list of approval
 * cards with a reachable zero. Each card carries a diff, a one-line because, and
 * evidence receipts; judged in seconds. Batch accept clears a streak.
 */
export function InboxView() {
  const { proposals, acceptProposal, rejectProposal, refreshProposals, openDoc } = useApp();
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ accepted: number; rejected: number }>({ accepted: 0, rejected: 0 });

  useEffect(() => {
    void refreshProposals();
  }, [refreshProposals]);

  const queue = useMemo(() => proposals.filter((p) => p.status === 'pending'), [proposals]);

  const onAccept = async (id: string) => {
    setBusy(true);
    const r = await acceptProposal(id);
    setBusy(false);
    if (!r.stale) setReceipt((x) => ({ ...x, accepted: x.accepted + 1 }));
  };
  const onReject = async (id: string) => {
    setBusy(true);
    await rejectProposal(id);
    setBusy(false);
    setReceipt((x) => ({ ...x, rejected: x.rejected + 1 }));
  };
  const acceptAll = async () => {
    setBusy(true);
    for (const p of queue) {
      // eslint-disable-next-line no-await-in-loop
      const r = await acceptProposal(p.id);
      if (!r.stale) setReceipt((x) => ({ ...x, accepted: x.accepted + 1 }));
    }
    setBusy(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 items-center gap-2 border-b border-border px-5 text-sm font-medium text-muted-foreground">
        <Inbox className="size-4" /> Inbox
        <span className="text-xs">· {queue.length} pending</span>
        {queue.length > 1 && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={acceptAll} disabled={busy}>
            <Layers className="size-3.5" /> Accept all ({queue.length})
          </Button>
        )}
      </div>

      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-8 py-5">
        {queue.length === 0 ? (
          <div className="mt-16 flex flex-col items-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-brand/10">
              <Check className="size-6 text-brand" />
            </div>
            <h2 className="font-serif text-2xl font-semibold">Inbox zero</h2>
            {(receipt.accepted > 0 || receipt.rejected > 0) && (
              <p className="text-sm text-muted-foreground">
                {receipt.accepted} accepted · {receipt.rejected} dismissed this session.
              </p>
            )}
            <p className="max-w-sm text-sm text-muted-foreground">
              Nothing needs you. Drop a meeting or ask a question and the agent will bring cards here.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {queue.map((p) => (
              <CardItem
                key={p.id}
                proposal={p}
                busy={busy}
                onAccept={() => onAccept(p.id)}
                onReject={() => onReject(p.id)}
                onOpen={openDoc}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CardItem({
  proposal,
  busy,
  onAccept,
  onReject,
  onOpen,
}: {
  proposal: ProposalDTO;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
  onOpen: (path: string) => void;
}) {
  const { previewProposal } = useApp();
  const [preview, setPreview] = useState<{ before: string; after: string; stale: boolean } | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    void previewProposal(proposal.id).then((p) => alive && setPreview(p));
    return () => {
      alive = false;
    };
  }, [proposal.id, previewProposal]);

  const target = proposal.targetPath ?? (proposal.payload as { path?: string }).path ?? '';
  const supersedes = (proposal.payload as { supersedes?: string }).supersedes;

  return (
    <li className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{KIND_LABEL[proposal.kind] ?? proposal.kind}</Badge>
        <button className="truncate font-mono text-xs text-muted-foreground hover:text-foreground" onClick={() => onOpen(target)}>
          {target}
        </button>
        {supersedes && <Badge variant="outline">supersedes {supersedes.split('/').pop()}</Badge>}
        {proposal.inference && <Badge className="bg-chart-4/15 text-chart-4">inference</Badge>}
      </div>

      <p className="mb-2 text-sm">{proposal.rationale}</p>

      {proposal.evidence.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {proposal.evidence.map((e) => (
            <button
              key={e.ref}
              className="rounded bg-brand/8 px-1.5 py-0.5 font-mono text-xs text-brand hover:bg-brand/15"
              onClick={() => onOpen(e.ref.replace(/^\[\[/, '').replace(/\]\]$/, ''))}
            >
              {e.ref}
            </button>
          ))}
        </div>
      )}

      {preview && (
        <button
          className="mb-2 block w-full text-left"
          onClick={() => setExpanded((x) => !x)}
        >
          <pre
            className={`overflow-y-auto rounded-lg bg-muted/60 p-3 text-xs whitespace-pre-wrap ${
              expanded ? 'max-h-96' : 'max-h-24'
            }`}
          >
            {proposal.kind === 'update' ? renderDiff(preview.before, preview.after) : preview.after}
          </pre>
        </button>
      )}

      {preview?.stale && (
        <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive">
          The target changed since this was proposed — re-run the session to regenerate.
        </div>
      )}

      <div className="flex gap-2">
        <Button size="sm" onClick={onAccept} disabled={busy || preview?.stale}>
          <Check className="size-3.5" /> Approve
        </Button>
        <Button size="sm" variant="outline" onClick={onReject} disabled={busy}>
          <X className="size-3.5" /> Discard
        </Button>
      </div>
    </li>
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
