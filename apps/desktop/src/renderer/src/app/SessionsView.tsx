import { useEffect, useMemo, useState } from 'react';
import { Spinner } from '@qale/ui';
import type { SessionLifecycle } from '@qale/ipc';
import {
  Check,
  History,
  MessageSquare,
  MessageSquarePlus,
  Pin,
  PinOff,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useApp, type SessionOverview } from '../state/app-state';
import { navFromEvent } from '../lib/nav';
import { timeAgo } from '../lib/session-meta';
import { HeaderAction, HeaderActions, PageHeader } from '../components/PageHeader';

/**
 * Every session, newest first — the browse surface behind the sidebar rail.
 * Status is part of the row: running sessions spin, sessions waiting on the PO
 * carry the ink-blue dot and the reason, everything else rests with a check.
 */
export function SessionsView() {
  const { sessions, openChat, openSession, refreshSessions, deleteSession, setSessionLifecycle } =
    useApp();
  const [loaded, setLoaded] = useState(false);
  const [showAutomatic, setShowAutomatic] = useState(false);

  useEffect(() => {
    void refreshSessions().finally(() => setLoaded(true));
  }, [refreshSessions]);

  // Every session shows here, pinned or not — the sidebar is where pinning
  // matters. A clock's own runs (the librarian, a weekly digest) are noise
  // beside a real conversation, so they stay off until asked for.
  const automaticCount = useMemo(
    () => sessions.filter((s) => s.automatic).length,
    [sessions],
  );

  const rows = useMemo(
    () => (showAutomatic ? sessions : sessions.filter((s) => !s.automatic)),
    [sessions, showAutomatic],
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={History} label="Sessions">
        <HeaderActions>
          <HeaderAction
            icon={MessageSquarePlus}
            label="New session"
            onClick={() => openSession(undefined, { fresh: true })}
          />
        </HeaderActions>
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6">
        <div className="mx-auto max-w-2xl py-4">
          {automaticCount > 0 && (
            <div
              className="mb-3 flex flex-wrap items-center gap-1"
              role="group"
              aria-label="Filter sessions"
            >
              <span className="ml-auto">
                <FilterChip
                  label={`Automatic (${automaticCount})`}
                  active={showAutomatic}
                  onClick={() => setShowAutomatic((v) => !v)}
                />
              </span>
            </div>
          )}

          {!loaded && sessions.length === 0 ? (
            <div className="mt-16 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" /> Loading sessions…
            </div>
          ) : rows.length === 0 ? (
            <p className="mt-16 text-center text-sm text-muted-foreground">
              {sessions.length > 0
                ? 'Every session here runs on its own — turn on Automatic to see them.'
                : 'No sessions yet. A session is saved here once it gets its first reply.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {rows.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  onOpen={(e) => openChat({ id: s.id, title: s.title }, e && navFromEvent(e))}
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

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded-md px-2 py-0.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
        active
          ? 'bg-secondary font-medium text-secondary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
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
  onDelete,
  onSetLifecycle,
}: {
  session: SessionOverview;
  onOpen: (e?: React.MouseEvent) => void;
  onDelete: () => void;
  onSetLifecycle: (lifecycle: SessionLifecycle) => void;
}) {
  const unpinned = s.lifecycle !== 'active' && !s.running;
  const needsYou = !unpinned && (s.pendingCards > 0 || s.unread);
  // Deleting a transcript is permanent and the icon sits beside Reopen —
  // one misclick must not destroy a session. Same confirm as NoteView.
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <li className="group relative">
      <button
        className="flex w-full flex-col gap-0.5 rounded-lg border border-transparent px-3 py-2 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={onOpen}
        onAuxClick={(e) => e.button === 1 && onOpen(e)}
      >
        <span className="flex items-center gap-2">
          <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className={`truncate text-sm ${needsYou ? 'font-semibold' : 'font-medium'}`}>
            {s.title}
          </span>
          {s.running ? (
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              <Spinner className="size-3" /> working
            </span>
          ) : s.pendingCards > 0 ? (
            <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-brand">
              <span className="size-1.5 rounded-full bg-brand" aria-hidden />
              {s.pendingCards} proposal{s.pendingCards === 1 ? '' : 's'}
            </span>
          ) : s.unread ? (
            <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-brand">
              <span className="size-1.5 rounded-full bg-brand" aria-hidden />
              ready
            </span>
          ) : (
            <Check className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
          )}
          <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
            {timeAgo(s.updated)}
          </span>
        </span>
        <span className="flex items-center gap-2 pl-5.5 text-xs text-muted-foreground">
          <span className="shrink-0">
            {s.messageCount} message{s.messageCount === 1 ? '' : 's'}
          </span>
        </span>
      </button>
      <span className="absolute right-2 bottom-2 flex items-center gap-0.5">
        {confirmDelete ? (
          <span className="flex items-center gap-1 rounded-md bg-background px-1 shadow-sm">
            <span className="text-xs text-destructive">Delete?</span>
            <button
              className="rounded px-1.5 py-0.5 text-xs font-medium text-destructive hover:bg-destructive/10"
              onClick={onDelete}
            >
              Yes
            </button>
            <button
              className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </button>
          </span>
        ) : (
          <>
            {!s.running && s.lifecycle === 'active' && (
              <RowAction
                Icon={PinOff}
                label={
                  s.pendingCards > 0
                    ? `Decide on its ${s.pendingCards} proposal${s.pendingCards === 1 ? '' : 's'} first`
                    : `Unpin "${s.title}"`
                }
                title={
                  s.pendingCards > 0
                    ? `Decide on its ${s.pendingCards} proposal${s.pendingCards === 1 ? '' : 's'} first`
                    : 'Unpin: not relevant right now'
                }
                disabled={s.pendingCards > 0}
                onClick={() => onSetLifecycle('unpinned')}
              />
            )}
            {unpinned && (
              <RowAction
                Icon={Pin}
                label={`Pin "${s.title}"`}
                title="Pin: back on the active list"
                onClick={() => onSetLifecycle('active')}
              />
            )}
            <RowAction
              Icon={Trash2}
              label={`Delete "${s.title}"`}
              title="Delete session"
              destructive
              onClick={() => setConfirmDelete(true)}
            />
          </>
        )}
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
  disabled,
}: {
  Icon: LucideIcon;
  label: string;
  title: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`rounded p-1 text-muted-foreground opacity-0 group-focus-within:opacity-70 group-hover:opacity-70 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30 ${
        destructive
          ? 'hover:bg-destructive/10 hover:text-destructive'
          : 'hover:bg-accent hover:text-foreground'
      }`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
    >
      <Icon className="size-3.5" />
    </button>
  );
}
