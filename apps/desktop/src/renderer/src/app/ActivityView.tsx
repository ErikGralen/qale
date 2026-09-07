import { useEffect, useMemo, useState } from 'react';
import { Spinner } from '@qale/ui';
import {
  BookMarked,
  FilePen,
  FilePlus2,
  GraduationCap,
  MessageSquare,
  ScrollText,
  Tags,
  Trash2,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import type { ActivityDTO, GitStatusDTO } from '@qale/ipc';
import { titleFromSlug } from '@qale/domain';
import { useApp } from '../state/app-state';
import { invoke } from '../lib/ipc';
import { navFromEvent } from '../lib/nav';
import { groupByDay, timeOfDay } from '../lib/activity';
import { useToast } from '../components/toast';
import { PageHeader } from '../components/PageHeader';

/** One glyph per verb, so a week of rows can be read down the left edge. */
const ACTION_ICON: Record<string, LucideIcon> = {
  created: FilePlus2,
  updated: FilePen,
  remembered: BookMarked,
  deleted: Trash2,
  labelled: Tags,
  // What Qale worked out about how the PM works, apart from a rule they stated.
  learned: GraduationCap,
};

/**
 * What the agent wrote without asking (docs/easier-tickets.md E-9).
 *
 * The proof that the silence was earned. Each row is the agent's own sentence
 * about one write, in the first person and the past tense, next to the day it
 * happened and the way back. Nothing here asks for a decision: the decisions
 * are in the sessions, and mixing the two would turn a receipt into a queue.
 */
export function ActivityView() {
  const { activity, refreshActivity, revertActivity, openDoc, openChat, sessions } = useApp();
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [git, setGit] = useState<GitStatusDTO | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);

  useEffect(() => {
    void refreshActivity().finally(() => setLoaded(true));
    void invoke['git:status']()
      .then(setGit)
      .catch(() => setGit(null));
  }, [refreshActivity]);

  const days = useMemo(() => groupByDay(activity), [activity]);

  const putBack = async (row: ActivityDTO) => {
    setUndoing(row.id);
    try {
      await revertActivity(row.id);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That could not be put back.');
    } finally {
      setUndoing(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={ScrollText} label="Activity" />

      <div className="flex-1 overflow-y-auto px-6">
        <div className="mx-auto max-w-2xl py-4">
          {/* The one thing that makes every row here final. Said once, at the
              top, rather than as a shrug on each row that has no button. */}
          {git && !git.repo && activity.length > 0 && (
            <p className="mb-4 rounded-lg border border-border bg-card/50 px-3 py-2 text-xs text-muted-foreground">
              This workspace keeps no history, so nothing below can be put back.
              {git.hint ? ` ${git.hint}` : ''}
            </p>
          )}

          {!loaded && activity.length === 0 ? (
            <div className="mt-16 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" /> Loading…
            </div>
          ) : days.length === 0 ? (
            <p className="mt-16 text-center text-sm text-muted-foreground">
              Nothing yet. When I write something without asking, I note it here, and you can undo
              it.
            </p>
          ) : (
            days.map((day) => (
              <section key={day.key} className="mb-5">
                <h2 className="sticky top-0 z-10 bg-background/95 py-1 text-xs font-medium text-muted-foreground">
                  {day.label}
                </h2>
                <ul className="flex flex-col">
                  {day.rows.map((row) => (
                    <Row
                      key={row.id}
                      row={row}
                      busy={undoing === row.id}
                      onOpenNote={(e) => row.path && void openDoc(row.path, navFromEvent(e))}
                      onOpenSession={(e) =>
                        openChat(
                          {
                            id: row.sessionId ?? '',
                            // The stored session names itself; the fallback
                            // only ever shows for a run whose row has aged out.
                            title: sessions.find((s) => s.id === row.sessionId)?.title ?? 'Session',
                          },
                          navFromEvent(e),
                        )
                      }
                      onPutBack={() => void putBack(row)}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One write. The sentence leads; everything else is small and grey underneath —
 * when it happened, the page it touched, and the session it came out of.
 * "Put it back" waits for the pointer or the keyboard, because a receipt read
 * from top to bottom should not look like a row of buttons.
 */
function Row({
  row,
  busy,
  onOpenNote,
  onOpenSession,
  onPutBack,
}: {
  row: ActivityDTO;
  busy: boolean;
  onOpenNote: (e: React.MouseEvent) => void;
  onOpenSession: (e: React.MouseEvent) => void;
  onPutBack: () => void;
}) {
  const Icon = ACTION_ICON[row.action] ?? FilePen;
  return (
    <li className="group flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-accent/60">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${row.reverted ? 'text-muted-foreground line-through' : ''}`}>
          {row.line}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="tabular-nums">{timeOfDay(row.at)}</span>
          {row.path && (
            <>
              <span aria-hidden>·</span>
              <button
                className="max-w-full truncate rounded px-0.5 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={onOpenNote}
                onAuxClick={(e) => e.button === 1 && onOpenNote(e)}
                title={`Open ${row.path}`}
              >
                {titleFromSlug(row.path)}
              </button>
            </>
          )}
          {/* A maintenance pass has no chat behind it, so the row names none. */}
          {row.sessionId && (
            <>
              <span aria-hidden>·</span>
              <button
                className="inline-flex items-center gap-1 rounded px-0.5 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={onOpenSession}
                onAuxClick={(e) => e.button === 1 && onOpenSession(e)}
                title="Open the session this came from"
              >
                <MessageSquare className="size-3" aria-hidden />
                the session
              </button>
            </>
          )}
          {/* The policy's own words for why this needed no card. Behind the
              hover, because the row is the point and this is the footnote. */}
          {row.reason && (
            <span className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              · {row.reason}
            </span>
          )}
        </p>
      </div>
      {row.reverted ? (
        <span className="mt-0.5 shrink-0 text-xs text-muted-foreground">Put back</span>
      ) : row.revertable ? (
        <button
          className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
          onClick={onPutBack}
          disabled={busy}
          title="Put it back the way it was. The undo is itself undoable."
        >
          {busy ? <Spinner className="size-3" /> : <Undo2 className="size-3" aria-hidden />}
          Put it back
        </button>
      ) : null}
    </li>
  );
}
