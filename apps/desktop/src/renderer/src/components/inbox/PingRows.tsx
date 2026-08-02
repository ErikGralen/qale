import { useState } from 'react';
import { Button } from '@pm/ui';
import { Check, MessageSquare, Sparkles, Trash2, Wrench, X } from 'lucide-react';
import type {
  AgentPingDTO,
  PingLinkChoiceItemDTO,
  PingOrphanItemDTO,
  PingResolveActionDTO,
} from '@pm/ipc';
import { useApp } from '../../state/app-state';
import { processNoteSeed } from '../../lib/agent-nudges';
import { timeAgo } from '../../lib/session-meta';
import { rowFocusClass, useQueueFocus } from './shared';

/**
 * A librarian finding as one quiet row — the full story lives in the session it
 * opens, not here. Dismissing is cheap; the finding stays quiet for a week.
 */
export function PingItem({
  ping,
  focused,
  onFocus,
  onOpen,
  onDismiss,
}: {
  ping: AgentPingDTO;
  focused: boolean;
  onFocus: () => void;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const ref = useQueueFocus<HTMLLIElement>(focused);
  return (
    <li
      ref={ref}
      tabIndex={-1}
      onClick={onFocus}
      onFocus={onFocus}
      className={`group flex items-center gap-2 rounded-lg bg-card py-1.5 pr-1.5 pl-3 ${rowFocusClass(focused)}`}
    >
      <Wrench className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <button className="min-w-0 flex-1 truncate text-left text-sm focus-visible:outline-none" onClick={onOpen} title={ping.body}>
        {ping.title}
      </button>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{timeAgo(ping.created)}</span>
      <Button size="sm" variant="ghost" onClick={onOpen}>
        <MessageSquare className="size-3.5" /> Ask about this
      </Button>
      <button
        className="rounded p-1 text-muted-foreground opacity-0 group-focus-within:opacity-70 group-hover:opacity-70 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={onDismiss}
        aria-label={`Dismiss "${ping.title}"`}
        title="Dismiss — stays quiet for a week"
      >
        <X className="size-3.5" />
      </button>
    </li>
  );
}

/**
 * A ping that carries its own prepared answers (PLAN-V2 §3.5): each finding is
 * one row with one-tap choices — pick the right link target, wire an orphan
 * into the note that already mentions it, or skip. The tap IS the approval;
 * the card retires itself when every row is settled. A session stays one click away.
 */
export function SuggestionPing({
  ping,
  focused,
  onFocus,
  onOpen,
  onDismiss,
}: {
  ping: AgentPingDTO;
  focused: boolean;
  onFocus: () => void;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const { resolvePingItem, openDoc, deleteNote, openSession } = useApp();
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useQueueFocus<HTMLLIElement>(focused);

  const resolve = async (itemId: string, action: PingResolveActionDTO) => {
    setBusyItem(itemId);
    setError(null);
    try {
      await resolvePingItem(ping.id, itemId, action);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply that fix.');
    } finally {
      setBusyItem(null);
    }
  };

  const payload = ping.payload!;
  return (
    <li
      ref={ref}
      tabIndex={-1}
      onClick={onFocus}
      onFocus={onFocus}
      className={`rounded-xl bg-card ${rowFocusClass(focused)}`}
    >
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <Wrench className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={ping.body}>
          {ping.title}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{timeAgo(ping.created)}</span>
        <Button size="sm" variant="ghost" onClick={onOpen}>
          <MessageSquare className="size-3.5" /> Ask about this
        </Button>
        <button
          className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={onDismiss}
          aria-label={`Dismiss "${ping.title}"`}
          title="Dismiss — stays quiet for a week"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <ul className="flex flex-col gap-1 px-3 py-2.5">
        {payload.kind === 'link-choices'
          ? payload.items.map((item) => (
              <LinkChoiceRow
                key={item.id}
                item={item}
                busy={busyItem !== null}
                onOpen={openDoc}
                onFix={(slug) => void resolve(item.id, { action: 'fix', choice: slug })}
                onSkip={() => void resolve(item.id, { action: 'skip' })}
              />
            ))
          : payload.items.map((item) => (
              <OrphanRow
                key={item.id}
                item={item}
                busy={busyItem !== null}
                onOpen={openDoc}
                onFix={(host) => void resolve(item.id, { action: 'fix', choice: host })}
                onSkip={() => void resolve(item.id, { action: 'skip' })}
                onProcess={() => {
                  openSession('process-note', {
                    initialPrompt: processNoteSeed(item.path),
                    title: `Process — ${item.title}`,
                    fresh: true,
                  });
                  void resolve(item.id, { action: 'process' });
                }}
                onDelete={async () => {
                  await deleteNote(item.path);
                  await resolve(item.id, { action: 'skip' });
                }}
              />
            ))}
      </ul>

      {error && (
        <div
          role="alert"
          className="mx-3 mb-2.5 rounded-md border border-destructive/40 bg-destructive/8 px-3 py-1.5 text-sm text-destructive"
        >
          {error}
        </div>
      )}
    </li>
  );
}

/** Shared chip for the one-tap answers — the wikilink vocabulary, actionable. */
function ChoiceChip({
  label,
  title,
  disabled,
  onClick,
}: {
  label: string;
  title?: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="rounded bg-brand/8 px-1.5 py-0.5 font-mono text-xs text-brand hover:bg-brand/15 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {label}
    </button>
  );
}

function SkipButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
      onClick={onClick}
      disabled={disabled}
    >
      Skip
    </button>
  );
}

/** One dangling link: the broken target, where it sits, and did-you-mean taps. */
function LinkChoiceRow({
  item,
  busy,
  onOpen,
  onFix,
  onSkip,
}: {
  item: PingLinkChoiceItemDTO;
  busy: boolean;
  onOpen: (path: string) => void;
  onFix: (slug: string) => void;
  onSkip: () => void;
}) {
  if (item.resolution) {
    const fixed = item.resolution.action === 'fixed';
    return (
      <li className="flex items-center gap-1.5 px-0.5 text-sm text-muted-foreground">
        {fixed ? <Check className="size-3.5 shrink-0 text-success" aria-hidden /> : <X className="size-3.5 shrink-0" aria-hidden />}
        <span className="font-mono text-xs">[[{item.target}]]</span>
        <span className="min-w-0 truncate">
          {fixed ? `now points at ${(item.resolution as { slug: string }).slug}` : 'skipped'}
        </span>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg bg-muted/50 px-2 py-1.5 text-sm">
      <span className="rounded bg-destructive/8 px-1.5 py-0.5 font-mono text-xs text-destructive">[[{item.target}]]</span>
      <span className="text-xs text-muted-foreground">in</span>
      <button
        className="font-mono text-xs text-muted-foreground hover:text-foreground"
        onClick={() => onOpen(item.from)}
        title={`Open ${item.from}`}
      >
        {item.from.split('/').pop()}
      </button>
      <span className="text-xs text-muted-foreground">— did you mean</span>
      {item.options.map((o) => (
        <ChoiceChip key={o.slug} label={o.slug} title={o.title || o.slug} disabled={busy} onClick={() => onFix(o.slug)} />
      ))}
      {item.options.length === 0 && (
        <span className="text-xs text-muted-foreground italic">no close match — ask about it</span>
      )}
      <span className="ml-auto">
        <SkipButton disabled={busy} onClick={onSkip} />
      </span>
    </li>
  );
}

/** Named pages that fit on one row before the rest becomes a count. */
const MAX_NAMES_SHOWN = 4;

/** What "nothing mentions it" actually means for this kind of note. */
const NO_MENTION_COPY: Record<PingOrphanItemDTO['kind'], string> = {
  capture: 'not wired into anything yet',
  stray: 'nothing mentions it',
};

/**
 * One unlinked note, offering only the answers its cause admits. A raw
 * capture's answer is a Process-Note session, not tidying; Delete survives for
 * exactly one case: a workspace-owned page that cites nothing and that nothing
 * cites. Mirrors of upstream records never reach this row at all.
 */
function OrphanRow({
  item,
  busy,
  onOpen,
  onFix,
  onSkip,
  onProcess,
  onDelete,
}: {
  item: PingOrphanItemDTO;
  busy: boolean;
  onOpen: (path: string) => void;
  onFix: (host: string) => void;
  onSkip: () => void;
  onProcess?: () => void;
  onDelete?: () => void;
}) {
  // Deleting a note is permanent — same inline confirm as NoteView.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const slug = item.path.replace(/\.md$/, '');
  // Old pings (written before orphans were classified) carry no kind; they are
  // all the hygiene case, which is what the sweep used to assume.
  const kind = item.kind ?? 'stray';
  if (item.resolution) {
    const action = item.resolution.action;
    const done = action === 'fixed' || action === 'processing';
    return (
      <li className="flex items-center gap-1.5 px-0.5 text-sm text-muted-foreground">
        {done ? <Check className="size-3.5 shrink-0 text-success" aria-hidden /> : <X className="size-3.5 shrink-0" aria-hidden />}
        <span className="min-w-0 truncate">
          {item.title}{' '}
          {action === 'fixed'
            ? `— linked from ${(item.resolution as { host: string }).host.replace(/\.md$/, '').split('/').pop()}`
            : action === 'processing'
              ? '— handed to a Process session'
              : '— skipped'}
        </span>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg bg-muted/50 px-2 py-1.5 text-sm">
      <button
        className="min-w-0 truncate text-left font-medium hover:text-brand"
        onClick={() => onOpen(item.path)}
        title={`Open ${item.path}`}
      >
        {item.title}
      </button>
      {item.mentions.length > 0 ? (
        <>
          <span className="text-xs text-muted-foreground">— mentioned in</span>
          {item.mentions.map((m) => (
            <ChoiceChip
              key={m.host}
              label={m.host.replace(/\.md$/, '').split('/').pop() ?? m.host}
              title={`"${m.line.trim()}" — link ${slug} here`}
              disabled={busy}
              onClick={() => onFix(m.host)}
            />
          ))}
          <span className="text-xs text-muted-foreground">tap to link it there</span>
        </>
      ) : (
        <span className="text-xs text-muted-foreground italic">{NO_MENTION_COPY[kind]}</span>
      )}
      {/* Evidence that a dump is worth processing: the pages it already names.
          Only the first few fit on a row, so the remainder is counted, never
          silently dropped — the full list rides along in the seeded session. */}
      {kind === 'capture' && item.names && item.names.length > 0 && (
        <span className="text-xs text-muted-foreground" title={item.names.map((n) => n.title).join(', ')}>
          — names {item.names.slice(0, MAX_NAMES_SHOWN).map((n) => n.title).join(', ')}
          {item.names.length > MAX_NAMES_SHOWN && ` +${item.names.length - MAX_NAMES_SHOWN} more`}
        </span>
      )}
      {kind === 'capture' && onProcess && (
        <button
          className="rounded bg-brand/8 px-1.5 py-0.5 text-xs font-medium text-brand hover:bg-brand/15 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
          onClick={onProcess}
          disabled={busy}
          title="Work this note into the memory — links, todos and insights as approval cards"
        >
          <span className="flex items-center gap-1"><Sparkles className="size-3" /> Process</span>
        </button>
      )}
      {kind === 'stray' && onDelete && item.mentions.length === 0 && (
        confirmDelete ? (
          <>
            <span className="text-xs text-destructive">Delete this note?</span>
            <button
              className="rounded px-1.5 py-0.5 text-xs font-medium text-destructive hover:bg-destructive/8 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
              onClick={onDelete}
              disabled={busy}
            >
              Yes, delete
            </button>
            <button
              className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            className="rounded px-1.5 py-0.5 text-xs text-destructive hover:bg-destructive/8 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
            title={`Delete ${item.path}`}
          >
            <span className="flex items-center gap-1"><Trash2 className="size-3" /> Delete</span>
          </button>
        )
      )}
      <span className="ml-auto">
        <SkipButton disabled={busy} onClick={onSkip} />
      </span>
    </li>
  );
}
