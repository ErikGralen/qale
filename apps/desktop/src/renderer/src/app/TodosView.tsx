import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  Check,
  Clock,
  ListTodo,
  Sparkles,
  TriangleAlert,
  User,
  X,
} from 'lucide-react';
import { Button, Spinner, cn } from '@qale/ui';
import type { NoteRefDTO } from '@qale/ipc';
import { byDue, todoLane, type TodoLane, isFolderIndex } from '@qale/domain';
import { useApp } from '../state/app-state';
import { navFromEvent, type NavOpts } from '../lib/nav';
import { useToast } from '../components/toast';
import { PageHeader } from '../components/PageHeader';
import { riskFor, useAtRisk } from '../components/ExternalRef';
import { localDateStr } from '../lib/dates';
import { addDays, dueLabel } from '../lib/due-date';
import { DatePicker } from '../components/DatePicker';
import { parseTodoInput } from '../lib/todo-parse';
import { todoRowCopy } from '../lib/todo-row';
import { handleTodoSeed } from '../lib/agent-nudges';
import type { AtRiskLinkDTO } from '../lib/connections';
import { TodoDetail } from '../components/TodoDetail';

/**
 * The commitment ledger (PLAN-V2 Todos): the PO's own todos lane-grouped by due
 * date, external commitments in a "Waiting on" lane, closed ones accreting in
 * Done. The checkbox and quick-add are the fast paths.
 *
 * Every row is a real note in todos/, but pressing one opens {@link TodoDetail}
 * and not the file (E-13): a promise reads as who owes it and when it was made,
 * never as frontmatter. ⌘click still opens the markdown in a tab, and so does
 * "Open the file" on the panel.
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

/** "[[people/jonas]]" or "people/jonas" → slug; plain names return null.
 *  Looser than `refSlug` in lib/frontmatter: it takes a bare path too, drops a
 *  `.md` tail, and stops at a `|` or a `#`. A todo's owner is written both
 *  ways. */
function refSlug(ref: string): string | null {
  const m = /^\[\[([^\]|#]+)/.exec(ref.trim());
  return m?.[1]?.replace(/\.md$/, '') ?? (ref.includes('/') ? ref.replace(/\.md$/, '') : null);
}

/** Row-hover action: small, but a button you can see, with a word on it. */
const ROW_ACTION =
  'flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:border-brand/40 hover:text-brand focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50';

interface TodoRow {
  note: NoteRefDTO;
  lane: TodoLane;
  overdue: boolean;
}

/**
 * Quick add, dressed as the todo it creates. The old bar (lone glyph, long
 * placeholder, no button) carried every search-bar signal, and users read it
 * as one. The row costume — the same empty circle the rows wear, a short
 * invitation, a labelled Add button — is what says "this makes a todo".
 */
function QuickAdd() {
  const { captureTodo } = useApp();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseTodoInput(value), [value]);
  const showChips = value.trim().length > 0 && (parsed.due || parsed.owner);
  const ready = !!parsed.title && !busy;

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
      {/* Quiet focus (DESIGN: the composer rule): the bar is focused from page
          load, so an accent ring would glow permanently. The hairline darkens
          one step; the caret and the Add button carry the affordance. */}
      <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card py-1 pr-1.5 pl-3 transition-colors focus-within:border-foreground/20">
        {busy ? (
          <Spinner className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <span className="size-4 shrink-0 rounded-full border border-border" aria-hidden />
        )}
        <input
          ref={inputRef}
          className="h-9 min-w-32 flex-1 bg-transparent text-sm outline-none placeholder:text-foreground/70"
          placeholder="Add a todo"
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
        {/* Ink blue arrives only once there is something to add (DESIGN §6);
            the resting state is a steel fill at full opacity, never a
            washed-out primary. */}
        <Button
          size="sm"
          variant={ready ? 'default' : 'secondary'}
          className="shrink-0 disabled:opacity-100 disabled:text-muted-foreground"
          disabled={!ready}
          onClick={() => void submit()}
          title="Add (↵)"
        >
          Add
        </Button>
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
  onOpen,
  onToggle,
  onDrop,
  onReopen,
  onSnooze,
}: {
  row: TodoRow;
  today: string;
  peopleBySlug: Map<string, NoteRefDTO>;
  busy: boolean;
  /** A linked ticket went blocked / drifted — the commitment may be at risk. */
  risk?: AtRiskLinkDTO;
  /** Press the row: the panel in place, or the file when the click asks for a tab. */
  onOpen: (nav: NavOpts) => void;
  onToggle: () => void;
  onDrop: () => void;
  onReopen: () => void;
  /** Move the due date; `null` clears it and the todo drops to Someday. */
  onSnooze: (due: string | null) => void;
}) {
  const { openSession } = useApp();
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const n = row.note;
  const closed = row.lane === 'closed';
  const dropped = n.lifecycle === 'dropped';
  const copy = todoRowCopy(n);

  const ownerSlug = n.owner ? refSlug(n.owner) : null;
  const ownerNote = ownerSlug ? peopleBySlug.get(ownerSlug) : undefined;
  const ownerName =
    ownerNote?.title ??
    n.owner
      ?.replace(/^\[\[|\]\]$/g, '')
      .split('/')
      .pop();

  return (
    <li className={`group relative hover:bg-accent/40 ${closed ? 'opacity-65' : ''}`}>
      {/* Stretched row button: Enter opens the note; Space flips done; x drops. */}
      <button
        data-todo-row
        className="absolute inset-0 w-full cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-none"
        onClick={(e) => onOpen(navFromEvent(e))}
        onAuxClick={(e) => e.button === 1 && onOpen(navFromEvent(e))}
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
          copy.mark && !closed ? `, ${copy.mark}` : ''
        }${
          risk && !closed
            ? `, at risk: ${risk.externalId} ${risk.reason === 'blocked' ? 'blocked' : 'changed'}`
            : ''
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
            {dropped ? (
              <X className="size-2.5" aria-hidden />
            ) : (
              <Check className="size-2.5" aria-hidden />
            )}
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

        {/* Where the commitment came from, in the same quiet voice as the date
            beside it (PRODUCT.md: what the PO said and what the agent inferred
            stay visibly different). No colour, no badge: it is a fact about the
            row, not a warning about it. */}
        {copy.mark && !closed && (
          <span className="shrink-0 text-xs text-muted-foreground">{copy.mark}</span>
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
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {dueLabel(n.due, today)}
            </span>
          )
        ) : null}

        {!closed && (
          // Named buttons with real chrome, not bare glyphs: on a row this dense
          // an icon alone reads as decoration, so nobody presses it.
          <div
            data-todo-actions
            className={cn(
              'flex shrink-0 items-center gap-1 transition-opacity',
              'group-hover:pointer-events-auto group-hover:opacity-100',
              'group-focus-within:pointer-events-auto group-focus-within:opacity-100',
              snoozeOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
            )}
          >
            <DatePicker
              value={n.due ?? null}
              today={today}
              open={snoozeOpen}
              onOpenChange={setSnoozeOpen}
              onPick={onSnooze}
              clearHint="someday"
            >
              <button
                className={ROW_ACTION}
                disabled={busy}
                aria-label={`${n.due ? 'Change the date on' : 'Set a date for'} "${n.title}"`}
                title={
                  n.due
                    ? 'Move the due date: presets, a typed date, or the calendar'
                    : 'Give it a date so it comes back on the day'
                }
              >
                <Clock className="size-3.5" aria-hidden />
                {n.due ? 'Change date' : 'Set a date'}
              </button>
            </DatePicker>

            <button
              className={ROW_ACTION}
              onClick={() =>
                openSession('commitment-check', {
                  initialPrompt: handleTodoSeed(
                    { path: n.path, title: n.title, due: n.due, owner: n.owner },
                    today,
                  ),
                  title: `Handle: ${n.title}`,
                  fresh: true,
                })
              }
              aria-label={`Help me handle "${n.title}"`}
              title="Help me handle this: reads the todo, where it came from and what's on the calendar, then turns what to do into proposals you approve"
            >
              <Sparkles className="size-3.5" aria-hidden />
              Help me
            </button>

            <button
              className={cn(ROW_ACTION, 'px-1 hover:border-destructive/40 hover:text-destructive')}
              onClick={onDrop}
              disabled={busy}
              aria-label={`Drop "${n.title}"`}
              title={copy.dropHint}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
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
          'flex items-center gap-1.5 text-micro font-semibold tracking-[0.07em] uppercase',
          focus ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
        <span className="rounded bg-muted px-1.5 py-px text-micro font-semibold text-muted-foreground tabular-nums">
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
    <div className="px-2 pt-2 pb-0.5 text-2xs font-semibold tracking-wide text-muted-foreground/70 uppercase first:pt-0.5">
      {children}
    </div>
  );
}

export function TodosView() {
  const { tree, setTodoStatus, setTodoDue, openDoc, openFolder } = useApp();
  const toast = useToast();
  const today = localDateStr();
  const risks = useAtRisk();
  const [showDone, setShowDone] = useState(false);
  /** Optimistic commitment while the write+reindex round-trips. */
  const [pending, setPending] = useState<Record<string, string>>({});
  /** Todos whose due date is mid-write — their row actions stay disabled. */
  const [snoozing, setSnoozing] = useState<string[]>([]);
  /** The todo whose panel is open. Held by path so it survives a reindex. */
  const [peekPath, setPeekPath] = useState<string | null>(null);

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

  /** A frontmatter ref ("[[meetings/…]]") to the note it points at, if we hold it. */
  const resolveRef = useCallback(
    (ref: string) => {
      const slug = refSlug(ref);
      return slug ? peopleBySlug.get(slug) : undefined;
    },
    [peopleBySlug],
  );

  const lanes = useMemo(() => {
    const map = new Map<TodoLane, TodoRow[]>();
    for (const n of todos) {
      const commitment = pending[n.path] ?? n.lifecycle ?? 'open';
      const shape = { commitment, due: n.due ?? null, owner: n.owner ?? null };
      const lane = todoLane(shape, today);
      const overdue = commitment === 'open' && !!n.due && n.due < today;
      const rows = map.get(lane) ?? [];
      rows.push({ note: n, lane, overdue });
      map.set(lane, rows);
    }
    for (const [lane, rows] of map) {
      if (lane === 'closed') {
        rows.sort(
          (a, b) =>
            (b.note.resolvedOn ?? '').localeCompare(a.note.resolvedOn ?? '') ||
            b.note.mtime - a.note.mtime,
        );
      } else if (lane === 'someday') {
        rows.sort((a, b) => b.note.mtime - a.note.mtime);
      } else {
        rows.sort(
          (a, b) => byDue({ due: a.note.due }, { due: b.note.due }) || b.note.mtime - a.note.mtime,
        );
      }
    }
    return map;
  }, [todos, pending, today]);

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

  const flip = async (path: string, commitment: 'open' | 'done' | 'dropped') => {
    setPending((p) => ({ ...p, [path]: commitment }));
    try {
      await setTodoStatus(path, commitment);
    } catch (err) {
      // The optimistic checkbox reverts (pending cleared below) — say why.
      toast(
        `Couldn't update the todo: ${err instanceof Error ? err.message : 'the write failed.'}`,
      );
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[path];
        return next;
      });
    }
  };

  const snooze = async (path: string, due: string | null) => {
    setSnoozing((s) => [...s, path]);
    try {
      await setTodoDue(path, due);
    } catch (err) {
      toast(`Couldn't move the date: ${err instanceof Error ? err.message : 'the write failed.'}`);
    } finally {
      setSnoozing((s) => s.filter((p) => p !== path));
    }
  };

  /** The row whose panel is open, off the live tree so an edit shows straight away. */
  const peek = peekPath ? todos.find((n) => n.path === peekPath) : undefined;

  /** Plain press opens the panel; ⌘click and middle-click still want the file. */
  const openRow = (path: string, nav: NavOpts) => {
    if (nav.newTab) void openDoc(path, nav);
    else setPeekPath(path);
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
          busy={row.note.path in pending || snoozing.includes(row.note.path)}
          risk={riskFor(risks, row.note.path)}
          onOpen={(nav) => openRow(row.note.path, nav)}
          onToggle={() => void flip(row.note.path, 'done')}
          onDrop={() => void flip(row.note.path, 'dropped')}
          onReopen={() => void flip(row.note.path, 'open')}
          onSnooze={(due) => void snooze(row.note.path, due)}
        />
      ))}
    </ul>
  );

  const empty = todos.length === 0;
  const allClear = !empty && LANE_ORDER.slice(0, 5).every((l) => (lanes.get(l)?.length ?? 0) === 0);

  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={ListTodo} label="Todos" />

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
              Type a commitment above, yours or one you're waiting on. A source you hand over gets
              read, and every promise in it comes back as a proposal citing where it was said.
            </p>
          </div>
        ) : allClear ? (
          <section className="flex items-center gap-3 rounded-xl bg-card px-4 py-5 ring-1 ring-border">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success/10">
              <Check className="size-5 text-success" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">All clear: nothing open, nothing owed.</p>
              <p className="text-sm text-muted-foreground">
                New commitments land here as you capture them or approve them from a session.
              </p>
            </div>
          </section>
        ) : (
          <div className="flex flex-col gap-5">
            {/* NOW — the worklist to clear today; overdue folded in and flagged. No card:
                the row actions are hidden until hover, so a filled panel only drew a wide
                empty block on the right. The dot and the dark label carry the emphasis. */}
            <section>
              <LaneHead
                label="Now"
                count={nowRows.length}
                focus
                dot
                flag={
                  ownOverdue > 0 ? (
                    <span className="flex items-center gap-1 text-micro font-semibold text-warning">
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
                  Nothing due today, you're ahead.
                </div>
              )}
            </section>

            {/* HORIZON — full-width lanes below the fold so titles never truncate. */}
            {upcomingRows.length + somedayRows.length + waitingRows.length > 0 && (
              <div className="flex flex-col gap-6 border-t border-border/60 pt-5">
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
                          <span className="flex items-center gap-1 text-micro font-semibold text-warning">
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
                      onOpen={(nav) => openRow(row.note.path, nav)}
                      onToggle={() => void flip(row.note.path, 'done')}
                      onDrop={() => void flip(row.note.path, 'dropped')}
                      onReopen={() => void flip(row.note.path, 'open')}
                      onSnooze={(due) => void snooze(row.note.path, due)}
                    />
                  ))}
                </ul>
                {closedRows.length > 30 && (
                  <button
                    className="mt-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    onClick={() => openFolder('todos')}
                  >
                    {closedRows.length - 30} more in Todos →
                  </button>
                )}
              </>
            )}
          </section>
        )}

      </div>

      {peek && (
        <TodoDetail
          note={peek}
          commitment={pending[peek.path] ?? peek.lifecycle ?? 'open'}
          today={today}
          open
          onOpenChange={(o) => !o && setPeekPath(null)}
          resolveRef={resolveRef}
          risk={riskFor(risks, peek.path)}
          busy={peek.path in pending || snoozing.includes(peek.path)}
          // Closing a commitment closes the panel: the answer is the list again.
          onDone={() => {
            setPeekPath(null);
            void flip(peek.path, 'done');
          }}
          onDrop={() => {
            setPeekPath(null);
            void flip(peek.path, 'dropped');
          }}
          onReopen={() => void flip(peek.path, 'open')}
          onSnooze={(due) => void snooze(peek.path, due)}
        />
      )}
    </div>
  );
}
