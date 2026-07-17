import { useEffect, useMemo, useState } from 'react';
import { Spinner } from '@pm/ui';
import type { SessionLifecycle } from '@pm/ipc';
import {
  Archive,
  Check,
  MessageSquare,
  MessageSquarePlus,
  RotateCcw,
  Sparkles,
  Trash2,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import { useApp, type SessionOverview } from '../state/app-state';
import { sessionLabel, timeAgo } from '../lib/session-meta';

const TYPE_ICON: Record<string, LucideIcon> = {
  ask: Sparkles,
  librarian: Wand2,
};

/**
 * Every session, newest first — the browse surface behind the sidebar rail.
 * Status is part of the row: running sessions spin, sessions waiting on the PO
 * carry the terracotta dot and the reason, everything else rests with a check.
 */
export function ChatsView() {
  const { sessions, openChat, openSession, openInbox, refreshSessions, deleteSession, setSessionLifecycle } = useApp();
  const [loaded, setLoaded] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    void refreshSessions().finally(() => setLoaded(true));
  }, [refreshSessions]);

  const types = useMemo(() => {
    const seen = new Map<string, number>();
    for (const s of sessions) seen.set(s.sessionType, (seen.get(s.sessionType) ?? 0) + 1);
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [sessions]);

  // A running conversation is always on the active shelf, whatever its stored state.
  const archivedCount = useMemo(
    () => sessions.filter((s) => s.lifecycle !== 'active' && !s.running).length,
    [sessions],
  );

  const rows = useMemo(() => {
    const shelf = sessions.filter((s) =>
      showArchived ? s.lifecycle !== 'active' && !s.running : s.lifecycle === 'active' || s.running,
    );
    return typeFilter ? shelf.filter((s) => s.sessionType === typeFilter) : shelf;
  }, [sessions, typeFilter, showArchived]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 items-center border-b border-border px-5 text-sm font-medium text-muted-foreground">
        Sessions
        <button
          className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={() => openSession('chat', { fresh: true })}
          title="Start a new conversation"
        >
          <MessageSquarePlus className="size-3.5" /> New chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6">
        <div className="mx-auto max-w-2xl py-4">
          {(types.length > 1 || archivedCount > 0) && (
            <div className="mb-3 flex flex-wrap items-center gap-1" role="group" aria-label="Filter sessions">
              {types.length > 1 && (
                <>
                  <FilterChip label="All" active={typeFilter === null} onClick={() => setTypeFilter(null)} />
                  {types.map((t) => (
                    <FilterChip
                      key={t}
                      label={sessionLabel(t)}
                      active={typeFilter === t}
                      onClick={() => setTypeFilter(typeFilter === t ? null : t)}
                    />
                  ))}
                </>
              )}
              {archivedCount > 0 && (
                <span className="ml-auto">
                  <FilterChip
                    label={`Archived (${archivedCount})`}
                    active={showArchived}
                    onClick={() => setShowArchived((v) => !v)}
                  />
                </span>
              )}
            </div>
          )}

          {!loaded && sessions.length === 0 ? (
            <div className="mt-16 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" /> Loading sessions…
            </div>
          ) : rows.length === 0 ? (
            <p className="mt-16 text-center text-sm text-muted-foreground">
              {showArchived
                ? 'Nothing archived — mark a conversation done (or dismiss it) to shelve it here.'
                : typeFilter
                  ? `No ${sessionLabel(typeFilter)} sessions yet.`
                  : 'No sessions yet — a conversation is saved here once it gets its first reply.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {rows.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  onOpen={() => openChat({ id: s.id, sessionType: s.sessionType, title: s.title })}
                  onOpenCards={() => openInbox()}
                  onDelete={() => void deleteSession(s.id)}
                  onSetLifecycle={(lc) => void setSessionLifecycle(s.id, lc)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`rounded-md px-2 py-0.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
        active ? 'bg-secondary font-medium text-secondary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      }`}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function SessionRow({
  session: s,
  onOpen,
  onOpenCards,
  onDelete,
  onSetLifecycle,
}: {
  session: SessionOverview;
  onOpen: () => void;
  onOpenCards: () => void;
  onDelete: () => void;
  onSetLifecycle: (lifecycle: SessionLifecycle) => void;
}) {
  const Icon = TYPE_ICON[s.sessionType] ?? MessageSquare;
  const archived = s.lifecycle !== 'active' && !s.running;
  const needsYou = !archived && (s.pendingCards > 0 || s.unread);
  return (
    <li className="group relative">
      <button
        className="flex w-full flex-col gap-0.5 rounded-lg border border-transparent px-3 py-2 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={onOpen}
      >
        <span className="flex items-center gap-2 pr-8">
          <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className={`truncate text-sm ${needsYou ? 'font-semibold' : 'font-medium'}`}>{s.title}</span>
          {s.running ? (
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              <Spinner className="size-3" /> working
            </span>
          ) : archived ? (
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground/70">
              {s.lifecycle === 'done' ? <Check className="size-3" aria-hidden /> : <Archive className="size-3" aria-hidden />}
              {s.lifecycle === 'done' ? 'done' : 'dismissed'}
            </span>
          ) : s.pendingCards > 0 ? (
            <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-brand">
              <span className="size-1.5 rounded-full bg-brand" aria-hidden />
              {s.pendingCards} card{s.pendingCards === 1 ? '' : 's'}
            </span>
          ) : s.unread ? (
            <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-brand">
              <span className="size-1.5 rounded-full bg-brand" aria-hidden />
              {s.sessionType === 'ask' ? 'answered' : 'ready'}
            </span>
          ) : (
            <Check className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
          )}
          <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums transition-opacity group-focus-within:opacity-0 group-hover:opacity-0">
            {timeAgo(s.updated)}
          </span>
        </span>
        <span className="flex items-center gap-2 pl-5.5 text-xs text-muted-foreground">
          <span className="shrink-0">
            {sessionLabel(s.sessionType)} · {s.messageCount} message{s.messageCount === 1 ? '' : 's'}
          </span>
        </span>
      </button>
      {s.pendingCards > 0 && (
        <button
          className="absolute right-8 bottom-2 rounded-md px-1.5 py-0.5 text-xs text-brand opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-brand/10 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={onOpenCards}
        >
          Review in Inbox →
        </button>
      )}
      <span className="absolute top-2 right-2 flex gap-0.5">
        {!s.running && s.lifecycle === 'active' && (
          <>
            <RowAction Icon={Check} label={`Mark "${s.title}" done`} title="Mark done" onClick={() => onSetLifecycle('done')} />
            <RowAction
              Icon={Archive}
              label={`Dismiss "${s.title}"`}
              title="Dismiss — won't be useful"
              onClick={() => onSetLifecycle('dismissed')}
            />
          </>
        )}
        {archived && (
          <RowAction Icon={RotateCcw} label={`Reopen "${s.title}"`} title="Reopen" onClick={() => onSetLifecycle('active')} />
        )}
        <RowAction
          Icon={Trash2}
          label={`Delete "${s.title}"`}
          title="Delete conversation"
          destructive
          onClick={onDelete}
        />
      </span>
    </li>
  );
}

function RowAction({
  Icon,
  label,
  title,
  onClick,
  destructive,
}: {
  Icon: LucideIcon;
  label: string;
  title: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      className={`rounded p-1 text-muted-foreground opacity-0 group-focus-within:opacity-70 group-hover:opacity-70 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
        destructive ? 'hover:bg-destructive/10 hover:text-destructive' : 'hover:bg-accent hover:text-foreground'
      }`}
      onClick={onClick}
      aria-label={label}
      title={title}
    >
      <Icon className="size-3.5" />
    </button>
  );
}
