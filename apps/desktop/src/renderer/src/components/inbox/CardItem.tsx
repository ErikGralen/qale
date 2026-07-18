import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Badge } from '@pm/ui';
import { AlertTriangle, Check, MessageSquare, Pencil, Send, X } from 'lucide-react';
import type { OutboundPayloadDTO, ProposalDTO, UpdatePayloadDTO } from '@pm/ipc';
import { normalizeLinkTarget } from '@pm/domain';
import { useApp } from '../../state/app-state';
import { invoke } from '../../lib/ipc';
import { KIND_LABEL, WikiText, outboundTarget, stripWikilinks } from './shared';

export interface CardItemProps {
  proposal: ProposalDTO;
  busy: boolean;
  focused: boolean;
  error: string | null;
  onFocus: () => void;
  onAccept: (edited?: unknown) => void;
  onReject: () => void;
  onOpen: (path: string) => void;
}

/**
 * The housekeeping tier of a meeting review — mechanical writes (last_told
 * bumps, hub links) rendered as one-line rows so the review reads as 2 real
 * cards + a batch, not six equal cards. Expands to the full card on demand.
 */
export function HousekeepingItem(props: CardItemProps) {
  const { proposal, busy, focused, error, onFocus, onAccept, onReject, onOpen } = props;
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [focused]);

  if (expanded || error) return <CardItem {...props} />;

  const target = proposal.targetPath ?? (proposal.payload as { path?: string }).path ?? '';
  return (
    <li
      ref={ref}
      onClick={onFocus}
      className={`group flex items-center gap-2 rounded-lg bg-card py-1.5 pr-1.5 pl-3 ring-1 transition-shadow ${
        focused ? 'ring-2 ring-ring/60' : 'ring-foreground/10'
      }`}
    >
      <button
        className="min-w-0 flex-1 truncate text-left text-sm text-foreground/85 focus-visible:outline-none"
        onClick={() => setExpanded(true)}
        title="Show the full card"
      >
        {stripWikilinks(proposal.rationale)}
      </button>
      <button
        className="max-w-48 shrink-0 truncate font-mono text-xs text-muted-foreground hover:text-foreground"
        onClick={() => onOpen(target)}
        title={`Open ${target}`}
      >
        {target.split('/').pop()}
      </button>
      <button
        className="rounded p-1 text-muted-foreground opacity-0 group-focus-within:opacity-70 group-hover:opacity-70 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => setExpanded(true)}
        aria-label="Show the full card"
        title="Show the full card"
      >
        <Pencil className="size-3.5" />
      </button>
      <Button size="sm" variant="ghost" onClick={() => onAccept()} disabled={busy} aria-label="Approve">
        <Check className="size-3.5" />
      </Button>
      <Button size="sm" variant="ghost" onClick={onReject} disabled={busy} aria-label="Discard">
        <X className="size-3.5" />
      </Button>
    </li>
  );
}

export function CardItem({
  proposal,
  busy,
  focused,
  error,
  onFocus,
  onAccept,
  onReject,
  onOpen,
}: CardItemProps) {
  const { previewProposal, openSession } = useApp();
  const [preview, setPreview] = useState<{ before: string; after: string; stale: boolean } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState('');
  const [draftPatch, setDraftPatch] = useState<{ search: string; replace: string }[]>([]);
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    let alive = true;
    void previewProposal(proposal.id).then((p) => alive && setPreview(p));
    return () => {
      alive = false;
    };
  }, [proposal.id, previewProposal]);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [focused]);

  const outbound = proposal.kind === 'outbound' ? (proposal.payload as OutboundPayloadDTO) : null;
  const target = outbound
    ? outboundTarget(outbound)
    : proposal.targetPath ?? (proposal.payload as { path?: string }).path ?? '';
  const supersedes = (proposal.payload as { supersedes?: string }).supersedes;

  const startEdit = () => {
    if (proposal.kind === 'update') {
      setDraftPatch((proposal.payload as UpdatePayloadDTO).patch.map((p) => ({ ...p })));
    } else {
      setDraftBody((proposal.payload as { body?: string }).body ?? '');
    }
    setEditing(true);
  };

  // The escape hatch: talk the card through in a seeded chat. The card stays
  // pending — the conversation can end in approval here or a revised card.
  const discuss = () => {
    const prompt = [
      "I'm looking at a pending approval card and want to talk it through before deciding. Don't apply anything — the card stays pending until I act on it.",
      '',
      `Card: ${proposal.rationale}`,
      `Kind: ${KIND_LABEL[proposal.kind] ?? proposal.kind}`,
      target ? `Target: ${target}` : null,
      proposal.evidence.length > 0 ? `Evidence: ${proposal.evidence.map((e) => e.ref).join(', ')}` : null,
      '',
      'Proposed payload:',
      '```json',
      JSON.stringify(proposal.payload, null, 2).slice(0, 4000),
      '```',
      '',
      "Briefly explain why this was proposed and what approving would change, citing sources. Then ask what I'd like to adjust — if I want changes, propose a revised card.",
    ]
      .filter((line) => line !== null)
      .join('\n');
    openSession('chat', {
      initialPrompt: prompt,
      title: `About: ${target || proposal.rationale.slice(0, 40)}`,
      fresh: true,
    });
  };

  const approveEdited = () => {
    const edited =
      proposal.kind === 'update'
        ? { ...(proposal.payload as UpdatePayloadDTO), patch: draftPatch }
        : { ...(proposal.payload as unknown as Record<string, unknown>), body: draftBody };
    setEditing(false);
    onAccept(edited);
  };

  return (
    <li
      ref={ref}
      onClick={onFocus}
      className={`rounded-xl bg-card ring-1 transition-shadow ${
        focused ? 'ring-2 ring-ring/60' : 'ring-foreground/10'
      } ${outbound ? 'ring-brand/30' : ''}`}
    >
      {outbound && (
        <div className="flex items-center gap-2 rounded-t-xl border-b border-brand/20 bg-brand/6 px-4 py-2 text-sm">
          <Send className="size-4 shrink-0 text-brand" />
          <span className="font-medium text-foreground">
            Sends outside the workspace — {outbound.system}
            {outbound.audience ? ` · for ${outbound.audience}` : ''}
          </span>
          <span className="ml-auto truncate font-mono text-xs text-muted-foreground">{target}</span>
        </div>
      )}

      <div className="p-4">
        {/* The human sentence leads — what approving does. Kind and target are
            metadata below it, not the headline. */}
        <p className="mb-1 text-sm font-medium">
          <WikiText text={proposal.rationale} onOpen={onOpen} />
        </p>

        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs text-muted-foreground">{KIND_LABEL[proposal.kind] ?? proposal.kind}</span>
          {!outbound && (
            <button
              className="truncate font-mono text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onOpen(target)}
              title={`Open ${target}`}
            >
              {target}
            </button>
          )}
          {supersedes && <Badge variant="outline">supersedes {supersedes.split('/').pop()}</Badge>}
          {proposal.inference && (
            <Badge className="gap-1 bg-warning/15 text-warning" title="No citations — the agent inferred this without sources">
              <AlertTriangle className="size-3" /> inference
            </Badge>
          )}
        </div>

        {proposal.evidence.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {proposal.evidence.map((e) => {
              // Evidence refs are wikilink slugs, not file paths — resolve
              // through the index like every other link surface, or the tab
              // opens onto a note:get miss and skeletons forever.
              const { target, alias } = normalizeLinkTarget(e.ref.replace(/^\[\[/, '').replace(/\]\]$/, ''));
              return (
                <button
                  key={e.ref}
                  className="rounded bg-brand/8 px-1.5 py-0.5 font-mono text-xs text-brand hover:bg-brand/15"
                  onClick={async () => {
                    const path = await invoke['note:resolveLink'](target);
                    if (path) onOpen(path);
                  }}
                >
                  {alias ?? target}
                </button>
              );
            })}
          </div>
        )}

        {editing ? (
          <div className="mb-2 flex flex-col gap-2">
            {proposal.kind === 'update' ? (
              draftPatch.map((blk, i) => (
                <div key={i} className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">replaces:</span>
                  <pre className="max-h-24 overflow-y-auto rounded-lg bg-destructive/6 p-2 text-xs whitespace-pre-wrap text-muted-foreground">
                    {blk.search}
                  </pre>
                  <span className="text-xs font-medium text-muted-foreground">with:</span>
                  <textarea
                    value={blk.replace}
                    onChange={(e) =>
                      setDraftPatch((d) => d.map((b, j) => (j === i ? { ...b, replace: e.target.value } : b)))
                    }
                    rows={Math.min(10, blk.replace.split('\n').length + 1)}
                    className="w-full resize-y rounded-lg border border-input bg-background p-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                </div>
              ))
            ) : (
              <textarea
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                rows={Math.min(16, draftBody.split('\n').length + 2)}
                autoFocus
                className="w-full resize-y rounded-lg border border-input bg-background p-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            )}
          </div>
        ) : (
          preview && (
            <button className="mb-2 block w-full text-left" onClick={() => setExpanded((x) => !x)}>
              <div
                className={`overflow-y-auto rounded-lg bg-muted/60 p-3 text-xs ${expanded ? 'max-h-96' : 'max-h-24'}`}
              >
                {proposal.kind === 'update' ? (
                  <DiffBlock before={preview.before} after={preview.after} />
                ) : (
                  <pre className="whitespace-pre-wrap">{preview.after}</pre>
                )}
              </div>
            </button>
          )
        )}

        {preview?.stale && (
          <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive">
            The target changed since this was proposed — re-run the session to regenerate.
          </div>
        )}

        {error && (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive">
            <span className="flex-1">{error}</span>
            <Button size="sm" variant="outline" onClick={() => onAccept()} disabled={busy}>
              Retry
            </Button>
          </div>
        )}

        <div className="flex gap-2">
          {editing ? (
            <>
              <Button size="sm" onClick={approveEdited} disabled={busy || preview?.stale}>
                <Check className="size-3.5" /> {outbound ? 'Approve & send edited' : 'Approve edited'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={() => onAccept()} disabled={busy || preview?.stale}>
                {outbound ? <Send className="size-3.5" /> : <Check className="size-3.5" />}
                {outbound ? 'Approve & send' : 'Approve'}
              </Button>
              <Button size="sm" variant="outline" onClick={startEdit} disabled={busy || preview?.stale}>
                <Pencil className="size-3.5" /> Edit
              </Button>
              <Button size="sm" variant="outline" onClick={onReject} disabled={busy}>
                <X className="size-3.5" /> Discard
              </Button>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={discuss}>
                <MessageSquare className="size-3.5" /> Chat about this
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

type DiffRow = { kind: 'same' | 'add' | 'del'; text: string };

/** Longest-common-subsequence line diff — insertions no longer cascade. */
function diffLines(before: string, after: string): DiffRow[] {
  const b = before.split('\n');
  const a = after.split('\n');
  // Guard pathological sizes; the preview is judged in seconds, not scrolled for minutes.
  if (b.length * a.length > 250_000) {
    return a.map((text) => ({ kind: 'same' as const, text }));
  }
  const m = b.length;
  const n = a.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i]![j] = b[i] === a[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (b[i] === a[j]) {
      rows.push({ kind: 'same', text: a[j]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      rows.push({ kind: 'del', text: b[i]! });
      i++;
    } else {
      rows.push({ kind: 'add', text: a[j]! });
      j++;
    }
  }
  while (i < m) rows.push({ kind: 'del', text: b[i++]! });
  while (j < n) rows.push({ kind: 'add', text: a[j++]! });
  return rows;
}

function DiffBlock({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => diffLines(before, after), [before, after]);
  return (
    <div className="font-mono">
      {rows.map((r, i) => (
        <div
          key={i}
          className={
            r.kind === 'add'
              ? 'bg-success/10 text-foreground'
              : r.kind === 'del'
                ? 'bg-destructive/8 text-muted-foreground line-through decoration-destructive/40'
                : 'text-muted-foreground'
          }
        >
          <span className="select-none">{r.kind === 'add' ? '+ ' : r.kind === 'del' ? '- ' : '  '}</span>
          <span className="whitespace-pre-wrap">{r.text || ' '}</span>
        </div>
      ))}
    </div>
  );
}
