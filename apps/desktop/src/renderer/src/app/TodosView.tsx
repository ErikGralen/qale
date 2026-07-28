import { useMemo, useRef, useState } from 'react';
import {
  Calendar,
  Check,
  CornerDownRight,
  ListTodo,
  Plus,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  User,
  X,
} from 'lucide-react';
import { Spinner, cn } from '@pm/ui';
import type { NoteRefDTO } from '@pm/ipc';
import { byDue, todoLane, type TodoLane, isFolderIndex } from '@pm/domain';
import { useApp } from '../state/app-state';
import { navFromEvent } from '../lib/nav';
import { useToast } from '../components/toast';
import { AtRiskMarker, riskFor, useAtRisk } from '../components/ExternalRef';
import { localDateStr } from '../lib/dates';
import { parseTodoInput } from '../lib/todo-parse';
import { handleTodoSeed } from '../lib/agent-nudges';
import type { AtRiskLinkDTO } from '../lib/connections';

/**
 * The commitment ledger (PLAN-V2 Todos): the PO's own todos lane-grouped by due
 * date, external commitments in a "Waiting on" lane, closed ones accreting in
 * Done. Every row is a real note in todos/ — opening it shows provenance
 * (sources, backlinks); the checkbox and quick-add are the fast paths.
 */

const LANE_ORDER: TodoLane[] = ['overdue', 'today', 'upcoming', 'someday', 'waiting', 'closed'];

const LANE_LABEL: Record<TodoLane, string> = {
  overdue: 'Overdue',
  today: 'Due today',
  upcoming: 'Upcoming',
  someday: 'Someday',
  waiting: 'Waiting on others',
  closed: 'Done',
};

const dueFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const dueFmtYear = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const todayHeadFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/** today + n days as a local YYYY-MM-DD string — the this-week / later cutoff. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "today" / "tomorrow" / "18 Jul" — compact, relative where it reads faster. */
function dueLabel(due: string, today: string): string {
  if (due === today) return 'today';
  const d = new Date(`${due}T00:00`);
  const t = new Date(`${today}T00:00`);
  const days = Math.round((d.getTime() - t.getTime()) / 86400000);
  if (days === 1) return 'tomorrow';
  return (d.getFullYear() === t.getFullYear() ? dueFmt : dueFmtYear).format(d);
}

/** "[[people/jonas]]" or "people/jonas" → slug; plain names return null. */
function refSlug(ref: string): string | null {
  const m = /^\[\[([^\]|#]+)/.exec(ref.trim());
  return m?.[1]?.replace(/\.md$/, '') ?? (ref.includes('/') ? ref.replace(/\.md$/, '') : null);
}

interface TodoRow {
  note: NoteRefDTO;
  lane: TodoLane;
  overdue: boolean;
}

function QuickAdd() {
  const { captureTodo } = useApp();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseTodoInput(value), [value]);
  const showChips = value.trim().length > 0 && (parsed.due || parsed.owner);

  const submit = async () => {
    if (!parsed.title || busy) return;
    setBusy(true);
    setError(null);
    try {
      await captureTodo({ title: parsed.title, due: parsed.due, owner: parsed.owner });
      setValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not add the todo');
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 transition-colors focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand/20">
        {busy ? (
          <Spinner className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <input
          ref={inputRef}
          className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/80"
          placeholder="Add a todo — try “email Åsa tomorrow” or “@Jonas update the docs”"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
          // Never disabled while saving — disabling drops focus and breaks
          // rapid entry (add three todos in a row without re-clicking).
          aria-label="Add a todo"
          autoFocus
        />
        {showChips && (
          <span className="flex shrink-0 items-center gap-1.5" aria-live="polite">
            {parsed.due && (
              <span className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground/80">
                <Calendar className="size-3" aria-hidden />
                {dueLabel(parsed.due, localDateStr())}
              </span>
            )}
            {parsed.owner && (
              <span className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground/80">
                <User className="size-3" aria-hidden />
                waiting on {parsed.owner}
              </span>
            )}
          </span>
        )}
        {value.trim() && !busy && (
          <span className="shrink-0 text-xs text-muted-foreground/70">↵ add</span>
        )}
      </div>
      {error && <p className="mt-1 px-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function TodoRowItem({
  row,
  today,
  peopleBySlug,
  busy,
  risk,
  onToggle,
  onDrop,
  onReopen,
}: {
  row: TodoRow;
  today: string;
  peopleBySlug: Map<string, NoteRefDTO>;
  busy: boolean;
  /** A linked ticket went blocked / drifted — the commitment may be at risk. */
  risk?: AtRiskLinkDTO;
  onToggle: () => void;
  onDrop: () => void;
  onReopen: () => void;
}) {
  const { openDoc, openSession } = useApp();
  const n = row.note;
  const closed = row.lane === 'closed';
  const dropped = n.status === 'dropped';

  const ownerSlug = n.owner ? refSlug(n.owner) : null;
  const ownerNote = ownerSlug ? peopleBySlug.get(ownerSlug) : undefined;
  const ownerName = ownerNote?.title ?? n.owner?.replace(/^\[\[|\]\]$/g, '').split('/').pop();

  const srcSlug = n.sourceRef ? refSlug(n.sourceRef) : null;
  const srcNote = srcSlug ? peopleBySlug.get(srcSlug) : undefined;

  return (
    <li className={`group relative hover:bg-accent/40 ${closed ? 'opacity-65' : ''}`}>
      {/* Stretched row button: Enter opens the note; Space flips done; x drops. */}
      <button
        data-todo-row
        className="absolute inset-0 w-full cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-none"
        onClick={(e) => void openDoc(n.path, navFromEvent(e))}
        onAuxClick={(e) => e.button === 1 && void openDoc(n.path, navFromEvent(e))}
        onKeyDown={(e) => {
          if (e.key === ' ') {
            e.preventDefault();
            if (closed) onReopen();
            else onToggle();
          } else if ((e.key === 'x' || e.key === 'Backspace') && !closed) {
            e.preventDefault();
            onDrop();
          }
        }}
        aria-label={`${n.title}${n.due ? `, due ${dueLabel(n.due, today)}` : ''}${
          row.overdue ? ', overdue' : ''
        }${ownerName ? `, waiting on ${ownerName}` : ''}${
          risk && !closed ? `, at risk — ${risk.externalId} ${risk.reason === 'blocked' ? 'blocked' : 'changed'}` : ''
        }${closed ? (dropped ? ', dropped' : ', done') : ''}`}
        aria-keyshortcuts="Space Enter"
        title={n.title}
      />
      <div className="pointer-events-none relative flex items-center gap-2.5 px-2 py-1.5">
        {closed ? (
          <button
            className="pointer-events-auto flex size-4 shrink-0 items-center justify-center rounded-full border border-transparent bg-muted text-muted-foreground transition-colors hover:border-border hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={onReopen}
            disabled={busy}
            aria-label={`Reopen "${n.title}"`}
            title="Reopen"
          >
            {dropped ? <X className="size-2.5" aria-hidden /> : <Check className="size-2.5" aria-hidden />}
          </button>
        ) : (
          <button
            className="pointer-events-auto flex size-4 shrink-0 items-center justify-center rounded-full border border-border text-transparent transition-colors duration-150 hover:border-brand hover:text-brand focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={onToggle}
            disabled={busy}
            aria-label={`Mark "${n.title}" done`}
            title="Mark done"
          >
            <Check className="size-2.5" aria-hidden />
          </button>
        )}

        <span
          className={`min-w-0 flex-1 truncate text-sm ${
            closed ? 'text-muted-foreground line-through decoration-border' : 'font-medium'
          }`}
        >
          {n.title}
        </span>

        {risk && !closed && (
          <span className="pointer-events-auto shrink-0">
            <AtRiskMarker risk={risk} onOpen={(p) => void openDoc(p)} />
          </span>
        )}

        {ownerName && row.lane !== 'waiting' && !closed && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <User className="size-3" aria-hidden />
            {ownerName}
          </span>
        )}
        {ownerName && (row.lane === 'waiting' || closed) && (
          ownerNote ? (
            <button
              className="pointer-events-auto flex shrink-0 items-center gap-1 rounded text-xs text-muted-foreground transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => void openDoc(ownerNote.path)}
              title={`Open ${ownerNote.title}`}
            >
              <User className="size-3" aria-hidden />
              {ownerName}
            </button>
          ) : (
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              <User className="size-3" aria-hidden />
              {ownerName}
            </span>
          )
        )}

        {srcNote && (
          <button
            className="pointer-events-auto flex min-w-0 max-w-32 shrink-0 items-center gap-1 rounded text-xs text-muted-foreground transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => void openDoc(srcNote.path)}
            title={`From ${srcNote.title}`}
          >
            <CornerDownRight className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{srcNote.title}</span>
          </button>
        )}

        {closed ? (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {dropped ? 'dropped' : 'done'}
            {n.resolvedOn ? ` ${dueLabel(n.resolvedOn, today)}` : ''}
          </span>
        ) : n.due ? (
          row.overdue ? (
            <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-warning tabular-nums">
              <TriangleAlert className="size-3" aria-hidden />
              overdue · {dueLabel(n.due, today)}
            </span>
          ) : (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{dueLabel(n.due, today)}</span>
          )
        ) : null}

        {!closed && (
          <button
            className="pointer-events-auto shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-brand focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() =>
              openSession('commitment-check', {
                initialPrompt: handleTodoSeed(
                  { path: n.path, title: n.title, due: n.due, owner: n.owner },
                  today,
                ),
                title: `Handle — ${n.title}`,
                fresh: true,
              })
            }
            aria-label={`Help me handle "${n.title}"`}
            title="Help me handle this — the memory plans it out as approval cards"
          >
            <Sparkles className="size-3.5" aria-hidden />
          </button>
        )}

        {!closed && (
          <button
            className="pointer-events-auto shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={onDrop}
            disabled={busy}
            aria-label={`Drop "${n.title}"`}
            title="Drop — keeps the record, closes the todo"
          >
            <X className="size-3" aria-hidden />
          </button>
        )}
      </div>
    </li>
  );
}

/** Lane / band header: label + count pill, an optional flag and a trailing action. */
function LaneHead({
  label,
  count,
  focus = false,
  dot = false,
  flag,
  action,
}: {
  label: string;
  count: number;
  focus?: boolean;
  dot?: boolean;
  flag?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 px-1">
      {dot && <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />}
      <h3
        className={cn(
          'flex items-center gap-1.5 text-[0.6875rem] font-semibold tracking-[0.07em] uppercase',
          focus ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
        <span className="rounded bg-muted px-1.5 py-px text-[0.6875rem] font-semibold text-muted-foreground tabular-nums">
          {count}
        </span>
      </h3>
      {flag}
      {action && <div className="ml-auto flex items-center">{action}</div>}
    </div>
  );
}

/** Sub-tier divider inside a lane (this week / later). */
function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pt-2 pb-0.5 text-[0.625rem] font-semibold tracking-wide text-muted-foreground/70 uppercase first:pt-0.5">
      {children}
    </div>
  );
}

export function TodosView() {
  const { tree, setTodoStatus, openFolder } = useApp();
  const toast = useToast();
  const today = localDateStr();
  const risks = useAtRisk();
  const [showDone, setShowDone] = useState(false);
  /** Optimistic status while the write+reindex round-trips. */
  const [pending, setPending] = useState<Record<string, string>>({});

  // People resolve owner refs; todos come straight off the live tree.
  const { todos, peopleBySlug } = useMemo(() => {
    const bySlug = new Map<string, NoteRefDTO>();
    let todoNotes: NoteRefDTO[] = [];
    for (const g of tree?.groups ?? []) {
      for (const n of g.notes) {
        if (isFolderIndex(n.path)) continue;
        bySlug.set(n.slug, n);
        if (g.type === 'todo') todoNotes = [...todoNotes, n];
      }
    }
    return { todos: todoNotes, peopleBySlug: bySlug };
  }, [tree]);

  const lanes = useMemo(() => {
    const map = new Map<TodoLane, TodoRow[]>();
    for (const n of todos) {
      const status = pending[n.path] ?? n.status ?? 'open';
      const shape = { status, due: n.due ?? null, owner: n.owner ?? null };
      const lane = todoLane(shape, today);
      const overdue = status === 'open' && !!n.due && n.due < today;
      const rows = map.get(lane) ?? [];
      rows.push({ note: n, lane, overdue });
      map.set(lane, rows);
    }
    for (const [lane, rows] of map) {
      if (lane === 'closed') {
        rows.sort((a, b) =>
          (b.note.resolvedOn ?? '').localeCompare(a.note.resolvedOn ?? '') || b.note.mtime - a.note.mtime,
        );
      } else if (lane === 'someday') {
        rows.sort((a, b) => b.note.mtime - a.note.mtime);
      } else {
        rows.sort((a, b) => byDue({ due: a.note.due }, { due: b.note.due }) || b.note.mtime - a.note.mtime);
      }
    }
    return map;
  }, [todos, pending, today]);

  const openCount = todos.filter((n) => (pending[n.path] ?? n.status ?? 'open') === 'open' && !n.owner).length;
  const waitingCount = lanes.get('waiting')?.length ?? 0;
  const closedRows = lanes.get('closed') ?? [];

  // The board reads by time-horizon. "Now" fuses overdue + due-today into the one
  // worklist to clear before the next meeting; the three horizon lanes sit below
  // it, quieter and recessed. Overdue is folded in (not its own lane) because for
  // a PO between meetings "already late" and "due today" are one act-now list.
  const overdueRows = lanes.get('overdue') ?? [];
  const nowRows = [...overdueRows, ...(lanes.get('today') ?? [])];
  const upcomingRows = lanes.get('upcoming') ?? [];
  const somedayRows = lanes.get('someday') ?? [];
  const waitingRows = lanes.get('waiting') ?? [];

  // Split Upcoming so "next week and beyond" reads as its own tier from "this week".
  const weekCutoff = addDays(today, 7);
  const thisWeekRows = upcomingRows.filter((r) => (r.note.due ?? '') < weekCutoff);
  const laterRows = upcomingRows.filter((r) => (r.note.due ?? '') >= weekCutoff);

  const ownOverdue = overdueRows.length;
  const waitingOverdue = waitingRows.filter((r) => r.overdue).length;
  const todayHead = todayHeadFmt.format(new Date(`${today}T00:00`));

  const flip = async (path: string, status: 'open' | 'done' | 'dropped') => {
    setPending((p) => ({ ...p, [path]: status }));
    try {
      await setTodoStatus(path, status);
    } catch (err) {
      // The optimistic checkbox reverts (pending cleared below) — say why.
      toast(`Couldn't update the todo: ${err instanceof Error ? err.message : 'the write failed.'}`);
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[path];
        return next;
      });
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'j' && e.key !== 'k') return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const down = e.key === 'ArrowDown' || e.key === 'j';
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-todo-row]')];
    const idx = buttons.findIndex((b) => b === document.activeElement);
    if (idx === -1 && !down) return;
    e.preventDefault();
    buttons[Math.min(buttons.length - 1, Math.max(0, idx + (down ? 1 : -1)))]?.focus();
  };

  /** One lane's rows as a divided list — shared by every band and column. */
  const renderRows = (rows: TodoRow[]) => (
    <ul className="flex flex-col divide-y divide-border/60">
      {rows.map((row) => (
        <TodoRowItem
          key={row.note.path}
          row={row}
          today={today}
          peopleBySlug={peopleBySlug}
          busy={row.note.path in pending}
          risk={riskFor(risks, row.note.path)}
          onToggle={() => void flip(row.note.path, 'done')}
          onDrop={() => void flip(row.note.path, 'dropped')}
          onReopen={() => void flip(row.note.path, 'open')}
        />
      ))}
    </ul>
  );

  const empty = todos.length === 0;
  const allClear = !empty && LANE_ORDER.slice(0, 5).every((l) => (lanes.get(l)?.length ?? 0) === 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 items-center gap-2 border-b border-border px-5 text-sm font-medium text-muted-foreground">
        <ListTodo className="size-4" aria-hidden /> Todos
        {!empty && (
          <span className="text-xs">
            · {openCount} open
            {ownOverdue > 0 && <span className="font-semibold text-warning"> · {ownOverdue} overdue</span>}
            {waitingCount > 0 ? ` · ${waitingCount} waiting` : ''}
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground/80 tabular-nums">{todayHead}</span>
      </div>

      <div
        className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto px-8 py-5"
        onKeyDown={onListKeyDown}
      >
        <QuickAdd />

        {empty ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-brand/10">
              <ListTodo className="size-6 text-brand" aria-hidden />
            </div>
            <h2 className="text-lg font-semibold">Nothing tracked yet</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Type a commitment above — yours or one you're waiting on. After-Meeting sessions extract
              them from transcripts as approval cards, each citing where it was said.
            </p>
          </div>
        ) : allClear ? (
          <section className="flex items-center gap-3 rounded-xl bg-card px-4 py-5 ring-1 ring-border">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success/10">
              <Check className="size-5 text-success" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">All clear — nothing open, nothing owed.</p>
              <p className="text-sm text-muted-foreground">
                New commitments land here as you capture them or approve them from a session.
              </p>
            </div>
          </section>
        ) : (
          <div className="flex flex-col gap-4">
            {/* NOW — the raised worklist to clear today; overdue folded in and flagged. */}
            <section className="rounded-xl bg-card p-3 ring-1 ring-border sm:p-4">
              <LaneHead
                label="Now"
                count={nowRows.length}
                focus
                dot
                flag={
                  ownOverdue > 0 ? (
                    <span className="flex items-center gap-1 text-[0.6875rem] font-semibold text-warning">
                      <TriangleAlert className="size-3" aria-hidden />
                      {ownOverdue} overdue
                    </span>
                  ) : undefined
                }
              />
              {nowRows.length > 0 ? (
                renderRows(nowRows)
              ) : (
                <div className="flex items-center gap-2 px-2 py-2.5 text-sm text-muted-foreground">
                  <Check className="size-4 text-success" aria-hidden />
                  Nothing due today — you're ahead.
                </div>
              )}
            </section>

            {/* HORIZON — full-width lanes below the fold so titles never truncate. */}
            {upcomingRows.length + somedayRows.length + waitingRows.length > 0 && (
              <div className="flex flex-col gap-6 border-t border-border/60 pt-4">
                {upcomingRows.length > 0 && (
                  <section>
                    <LaneHead label="Upcoming" count={upcomingRows.length} />
                    {thisWeekRows.length > 0 && (
                      <>
                        {laterRows.length > 0 && <SubLabel>This week</SubLabel>}
                        {renderRows(thisWeekRows)}
                      </>
                    )}
                    {laterRows.length > 0 && (
                      <>
                        {thisWeekRows.length > 0 && <SubLabel>Later</SubLabel>}
                        {renderRows(laterRows)}
                      </>
                    )}
                  </section>
                )}

                {somedayRows.length > 0 && (
                  <section>
                    <LaneHead label="Someday" count={somedayRows.length} />
                    {renderRows(somedayRows)}
                  </section>
                )}

                {waitingRows.length > 0 && (
                  <section>
                    <LaneHead
                      label="Waiting on others"
                      count={waitingRows.length}
                      flag={
                        waitingOverdue > 0 ? (
                          <span className="flex items-center gap-1 text-[0.6875rem] font-semibold text-warning">
                            <TriangleAlert className="size-3" aria-hidden />
                            {waitingOverdue} overdue
                          </span>
                        ) : undefined
                      }
                    />
                    {renderRows(waitingRows)}
                  </section>
                )}
              </div>
            )}
          </div>
        )}

        {closedRows.length > 0 && (
          <section className="mt-5">
            <button
              className="mb-1 flex items-baseline gap-1.5 rounded px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/80 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => setShowDone((s) => !s)}
              aria-expanded={showDone}
            >
              {LANE_LABEL.closed}
              <span className="font-semibold tabular-nums">{closedRows.length}</span>
              <span className="normal-case tracking-normal">{showDone ? 'hide' : 'show'}</span>
            </button>
            {showDone && (
              <>
                <ul className="flex flex-col divide-y divide-border/60">
                  {closedRows.slice(0, 30).map((row) => (
                    <TodoRowItem
                      key={row.note.path}
                      row={row}
                      today={today}
                      peopleBySlug={peopleBySlug}
                      busy={row.note.path in pending}
                      onToggle={() => void flip(row.note.path, 'done')}
                      onDrop={() => void flip(row.note.path, 'dropped')}
                      onReopen={() => void flip(row.note.path, 'open')}
                    />
                  ))}
                </ul>
                {closedRows.length > 30 && (
                  <button
                    className="mt-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    onClick={() => openFolder('todos')}
                  >
                    {closedRows.length - 30} more in todos/ →
                  </button>
                )}
              </>
            )}
          </section>
        )}

        {closedRows.length > 0 && (
          <p className="mt-3 flex items-center gap-1 px-2 pb-4 text-xs text-muted-foreground/70">
            <RotateCcw className="size-3" aria-hidden />
            Done and dropped todos stay on the ledger — the memory accretes.
          </p>
        )}
      </div>
    </div>
  );
}
