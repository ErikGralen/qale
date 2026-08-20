import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import type { NoteRefDTO } from '@qale/ipc';
import { useApp } from '../state/app-state';
import { navFromEvent } from '../lib/nav';
import { TagChip } from '../components/TagChip';
import { needsReview } from '../lib/note-status';

/**
 * The meetings week — the default read of the meetings folder. A PO's recall
 * cue for meetings is temporal ("Thursday's check-in", "what's left this
 * week"), so the page opens as a Monday-start week grid: upcoming meetings on
 * card white, past ones receded to the wash, past-but-unreviewed ones flying
 * the amber flag (icon + word, never color alone), and cancelled ones struck
 * through. Weekends only earn a column when something actually happened on them.
 */

const HOUR_PX = 52;
const DEFAULT_DURATION_MIN = 30;
const MIN_EVENT_PX = 22;

interface CalEvent {
  note: NoteRefDTO;
  start: Date;
  end: Date;
  timed: boolean;
}

/** Parse frontmatter date (+ optional "HH:MM") as *local* time — Date.parse
 *  treats bare dates as UTC, which shifts meetings across midnight. */
function parseLocal(date: string, time?: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return null;
  let hh = 0;
  let mm = 0;
  if (time) {
    const t = /^(\d{1,2}):(\d{2})/.exec(time);
    if (t) {
      hh = Number(t[1]);
      mm = Number(t[2]);
    }
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hh, mm);
}

function mondayOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The last calendar day an event touches. An end landing exactly on midnight
 *  belongs to the day before, so 09:00–24:00 stays a single-day event. */
function lastDay(e: CalEvent): Date {
  return new Date(e.end.getTime() - 1);
}

/** Spans more than one calendar day — belongs in the banner lane, not the
 *  timed grid (where its full duration would render as one super-tall block). */
function isMultiDay(e: CalEvent): boolean {
  return !sameDay(e.start, lastDay(e));
}

/** Does the event overlap the given day at all (used for banner spanning). */
function coversDay(e: CalEvent, d: Date): boolean {
  const s = startOfDay(d);
  return e.start < addDays(s, 1) && e.end > s;
}

function isoWeek(d: Date): number {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(
      ((date.getTime() - week1.getTime()) / 86_400_000 - 3 + ((week1.getDay() + 6) % 7)) / 7,
    )
  );
}

const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: 'short' });
const WEEKDAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

function weekLabel(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const from = `${MONTH_FMT.format(weekStart)} ${weekStart.getDate()}`;
  const to =
    weekStart.getMonth() === end.getMonth()
      ? `${end.getDate()}`
      : `${MONTH_FMT.format(end)} ${end.getDate()}`;
  return `${from} – ${to}, ${end.getFullYear()}`;
}

function fmtClock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Side-by-side placement for overlapping events within one day. */
function layoutColumns(evts: CalEvent[]): Map<CalEvent, { col: number; cols: number }> {
  const sorted = [...evts].sort(
    (a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime(),
  );
  const placements = new Map<CalEvent, { col: number; cols: number }>();
  let cluster: CalEvent[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    if (cluster.length === 0) return;
    const colEnds: number[] = [];
    const local = new Map<CalEvent, number>();
    for (const e of cluster) {
      let col = colEnds.findIndex((end) => end <= e.start.getTime());
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(0);
      }
      colEnds[col] = e.end.getTime();
      local.set(e, col);
    }
    for (const [e, col] of local) placements.set(e, { col, cols: colEnds.length });
    cluster = [];
    clusterEnd = -Infinity;
  };
  for (const e of sorted) {
    if (e.start.getTime() >= clusterEnd) flush();
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, e.end.getTime());
  }
  flush();
  return placements;
}

/** Visual voice per lifecycle: upcoming on card white, past receded, unreviewed
 *  amber, cancelled struck through (never color alone) so it can't be misread
 *  as a meeting that is still on. */
function eventTone(
  e: CalEvent,
  now: Date,
): { cls: string; timeCls: string; titleCls: string; flag: boolean } {
  if (e.note.eventStatus === 'cancelled') {
    return {
      cls: 'bg-muted/50 ring-border/60 text-muted-foreground hover:bg-muted',
      timeCls: 'text-muted-foreground',
      titleCls: 'line-through',
      flag: false,
    };
  }
  if (needsReview(e.note)) {
    return {
      cls: 'bg-warning/10 ring-warning/35 text-warning hover:bg-warning/15',
      timeCls: 'text-warning/80',
      titleCls: '',
      flag: true,
    };
  }
  if (e.end.getTime() < now.getTime()) {
    return {
      cls: 'bg-muted/70 ring-border/70 text-foreground/70 hover:bg-muted',
      timeCls: 'text-muted-foreground',
      titleCls: '',
      flag: false,
    };
  }
  return {
    cls: 'bg-card ring-foreground/15 text-foreground hover:bg-accent/60',
    timeCls: 'text-muted-foreground',
    titleCls: '',
    flag: false,
  };
}

/** What a block's state adds to its accessible name, when it has one. */
function eventStateLabel(e: CalEvent): string {
  if (e.note.eventStatus === 'cancelled') return ', cancelled';
  return needsReview(e.note) ? ', needs review' : '';
}

function eventTooltip(e: CalEvent): string {
  const head = e.timed ? `${fmtClock(e.start)}–${fmtClock(e.end)} · ${e.note.title}` : e.note.title;
  const state =
    e.note.eventStatus === 'cancelled'
      ? '\nCancelled'
      : needsReview(e.note)
        ? '\nHappened, not read yet'
        : '';
  return e.note.summary ? `${head}${state}\n${e.note.summary}` : `${head}${state}`;
}

export function MeetingWeek({
  notes,
  allTags,
  contextFacet,
  onToggleContext,
  toolbarLead,
}: {
  notes: NoteRefDTO[];
  allTags: string[];
  contextFacet: string | null;
  onToggleContext: (tag: string) => void;
  /** The Week/List switch, owned by the folder page so both views share it. */
  toolbarLead?: ReactNode;
}) {
  const { openDoc } = useApp();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [now, setNow] = useState(() => new Date());

  // Keep the now-line honest across long-lived windows.
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const events = useMemo((): CalEvent[] => {
    return notes
      .filter((n) => !contextFacet || n.tags?.includes(contextFacet))
      .flatMap((n) => {
        if (!n.date) return [];
        const start = parseLocal(n.date, n.time ?? undefined);
        if (!start) return [];
        const timed = !!n.time;
        const end = new Date(start.getTime() + (n.durationMin ?? DEFAULT_DURATION_MIN) * 60_000);
        return [{ note: n, start, end, timed }];
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [notes, contextFacet]);

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  // Overlap, not start-within: a multi-day event running in from last week
  // still belongs on this week's banner lane.
  const weekEvents = useMemo(
    () => events.filter((e) => e.start < weekEnd && e.end > weekStart),
    [events, weekStart, weekEnd],
  );

  // Mon–Fri always; Sat/Sun only when something actually touches them.
  const days = useMemo(() => {
    const all = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    return all.filter((d, i) => i < 5 || weekEvents.some((e) => coversDay(e, d)));
  }, [weekStart, weekEvents]);

  const multiDay = useMemo(() => weekEvents.filter(isMultiDay), [weekEvents]);
  const timed = useMemo(() => weekEvents.filter((e) => e.timed && !isMultiDay(e)), [weekEvents]);
  const untimed = useMemo(() => weekEvents.filter((e) => !e.timed && !isMultiDay(e)), [weekEvents]);

  // Multi-day events become horizontal banners spanning their visible days,
  // stacked into rows so concurrent spans never collide.
  const banners = useMemo(() => {
    const items = multiDay
      .map((e) => {
        let startCol = -1;
        let endCol = -1;
        days.forEach((d, i) => {
          if (coversDay(e, d)) {
            if (startCol === -1) startCol = i;
            endCol = i;
          }
        });
        return { e, startCol, endCol };
      })
      .filter((b) => b.startCol !== -1)
      .sort((a, b) => a.startCol - b.startCol || b.endCol - a.endCol);
    const rowEnds: number[] = [];
    const placed = items.map((b) => {
      let row = rowEnds.findIndex((end) => end < b.startCol);
      if (row === -1) row = rowEnds.length;
      rowEnds[row] = b.endCol;
      return { ...b, row };
    });
    return { placed, rows: rowEnds.length };
  }, [multiDay, days]);

  // Working hours by default; stretch to fit whatever the week actually holds.
  const [startHour, endHour] = useMemo(() => {
    let lo = 8;
    let hi = 18;
    for (const e of timed) {
      lo = Math.min(lo, e.start.getHours());
      hi = Math.max(hi, e.end.getMinutes() > 0 ? e.end.getHours() + 1 : e.end.getHours());
    }
    return [Math.max(0, lo), Math.min(24, hi)];
  }, [timed]);

  const gridHeight = (endHour - startHour) * HOUR_PX;
  const hours = useMemo(
    () => Array.from({ length: endHour - startHour }, (_, i) => startHour + i),
    [startHour, endHour],
  );

  const isCurrentWeek = sameDay(mondayOf(now), weekStart);
  const nowTop = (now.getHours() + now.getMinutes() / 60 - startHour) * HOUR_PX;
  const gridCols = { gridTemplateColumns: `3.25rem repeat(${days.length}, minmax(0, 1fr))` };

  const openEvent = (e: CalEvent, click?: React.MouseEvent) =>
    void openDoc(e.note.path, click && navFromEvent(click));

  const eventBody = (e: CalEvent, heightPx: number) => {
    const tone = eventTone(e, now);
    const tall = heightPx >= 40;
    return tall ? (
      <>
        <div
          className={`flex items-center gap-1 text-xs leading-tight tabular-nums ${tone.timeCls}`}
        >
          {tone.flag && <AlertTriangle className="size-3 shrink-0" aria-hidden />}
          {e.timed && fmtClock(e.start)}
          {tone.flag && <span className="font-medium">review</span>}
        </div>
        <div className={`truncate text-xs leading-tight font-medium ${tone.titleCls}`}>
          {e.note.title}
        </div>
        {heightPx >= 76 && e.note.summary && (
          <div className={`mt-0.5 line-clamp-2 text-xs leading-snug ${tone.timeCls}`}>
            {e.note.summary}
          </div>
        )}
      </>
    ) : (
      <div className="flex items-center gap-1">
        {tone.flag && <AlertTriangle className={`size-3 shrink-0 ${tone.timeCls}`} aria-hidden />}
        {/* Flagged blocks spend the space on the word (the grid already shows the time). */}
        {tone.flag ? (
          <span className={`text-xs font-medium ${tone.timeCls}`}>review</span>
        ) : (
          e.timed && (
            <span className={`text-xs tabular-nums ${tone.timeCls}`}>{fmtClock(e.start)}</span>
          )
        )}
        <span className={`truncate text-xs font-medium ${tone.titleCls}`}>{e.note.title}</span>
      </div>
    );
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(e) => {
        const t = e.target as HTMLElement;
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setWeekStart((w) => addDays(w, -7));
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          setWeekStart((w) => addDays(w, 7));
        } else if (e.key === 't' || e.key === 'T') {
          setWeekStart(mondayOf(new Date()));
        }
      }}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/70 px-4 py-2">
        {toolbarLead}
        <div className="flex items-center gap-1">
          <button
            className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            aria-label="Previous week"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            aria-label="Next week"
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            className="ml-0.5 h-7 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
            onClick={() => setWeekStart(mondayOf(new Date()))}
            disabled={isCurrentWeek}
          >
            Today
          </button>
        </div>
        <span className="text-sm font-medium">
          {weekLabel(weekStart)}
          <span className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums">
            W{isoWeek(weekStart)}
          </span>
        </span>
        {allTags.length > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-1">
            {allTags.map((t) => (
              <TagChip
                key={t}
                tag={t}
                active={contextFacet === t}
                onToggle={() => onToggleContext(t)}
              />
            ))}
          </div>
        )}
      </div>

      <div
        className="relative flex-1 overflow-y-auto focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-none"
        tabIndex={0}
        aria-label={`Week of ${weekLabel(weekStart)}. Arrow keys change week, T returns to today.`}
      >
        <div className="sticky top-0 z-10 border-b border-border bg-background">
          <div className="grid" style={gridCols}>
            <div />
            {days.map((d) => {
              const today = sameDay(d, now);
              return (
                <div
                  key={d.getTime()}
                  className="flex items-baseline gap-1.5 border-l border-border/70 px-2 py-1.5"
                >
                  <span
                    className={`text-xs font-medium ${today ? 'text-brand' : 'text-muted-foreground'}`}
                  >
                    {WEEKDAY_FMT.format(d)}
                  </span>
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      today
                        ? 'flex size-5 items-center justify-center rounded-full bg-brand text-xs text-brand-foreground'
                        : ''
                    }`}
                  >
                    {d.getDate()}
                  </span>
                </div>
              );
            })}
          </div>
          {banners.placed.length > 0 && (
            <div
              className="grid border-t border-border/50 py-0.5"
              style={{
                ...gridCols,
                gridTemplateRows: `repeat(${banners.rows}, minmax(0, auto))`,
              }}
            >
              <div
                className="self-center pr-1.5 text-right text-xs text-muted-foreground"
                style={{ gridColumn: 1, gridRow: '1 / -1' }}
              >
                multi-day
              </div>
              {days.map((d, i) => (
                <div
                  key={d.getTime()}
                  className="border-l border-border/70"
                  style={{ gridColumn: i + 2, gridRow: '1 / -1' }}
                  aria-hidden
                />
              ))}
              {banners.placed.map(({ e, startCol, endCol, row }) => {
                const first = days[startCol];
                const last = days[endCol];
                if (!first || !last) return null;
                const tone = eventTone(e, now);
                const openLeft = e.start < startOfDay(first);
                const openRight = e.end > addDays(startOfDay(last), 1);
                const range = `${MONTH_FMT.format(e.start)} ${e.start.getDate()} – ${MONTH_FMT.format(
                  lastDay(e),
                )} ${lastDay(e).getDate()}`;
                return (
                  <button
                    key={e.note.path}
                    className={`z-10 my-0.5 flex items-center gap-1 overflow-hidden px-1.5 py-0.5 text-left text-xs font-medium ring-1 transition-colors focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${tone.cls} ${openLeft ? '' : 'ml-1 rounded-l-md'} ${openRight ? '' : 'mr-1 rounded-r-md'}`}
                    style={{ gridColumn: `${startCol + 2} / ${endCol + 3}`, gridRow: row + 1 }}
                    onClick={(click) => openEvent(e, click)}
                    title={`${range} · ${e.note.title}${e.note.summary ? `\n${e.note.summary}` : ''}`}
                    aria-label={`${e.note.title}, ${range}${eventStateLabel(e)}`}
                  >
                    {tone.flag && <AlertTriangle className="size-3 shrink-0" aria-hidden />}
                    <span className={`truncate ${tone.titleCls}`}>{e.note.title}</span>
                  </button>
                );
              })}
            </div>
          )}
          {untimed.length > 0 && (
            <div className="grid border-t border-border/50" style={gridCols}>
              <div className="py-1 pr-1.5 text-right text-xs text-muted-foreground">no time</div>
              {days.map((d) => (
                <div
                  key={d.getTime()}
                  className="flex flex-col gap-0.5 border-l border-border/70 p-0.5"
                >
                  {untimed
                    .filter((e) => sameDay(e.start, d))
                    .map((e) => {
                      const tone = eventTone(e, now);
                      return (
                        <button
                          key={e.note.path}
                          className={`w-full rounded-md px-1.5 py-0.5 text-left ring-1 transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${tone.cls}`}
                          onClick={(click) => openEvent(e, click)}
                          title={eventTooltip(e)}
                          aria-label={`${e.note.title}${eventStateLabel(e)}`}
                        >
                          {eventBody(e, 0)}
                        </button>
                      );
                    })}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid" style={gridCols}>
          <div className="relative" style={{ height: gridHeight }}>
            {hours.slice(1).map((h) => (
              <span
                key={h}
                className="absolute right-1.5 -translate-y-1/2 text-xs text-muted-foreground tabular-nums"
                style={{ top: (h - startHour) * HOUR_PX }}
              >
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {days.map((d) => {
            const dayEvents = timed.filter((e) => sameDay(e.start, d));
            const placements = layoutColumns(dayEvents);
            const today = sameDay(d, now);
            return (
              <div
                key={d.getTime()}
                className="relative border-l border-border/70"
                style={{ height: gridHeight }}
              >
                {hours.slice(1).map((h) => (
                  <div
                    key={h}
                    className="absolute right-0 left-0 border-t border-border/50"
                    style={{ top: (h - startHour) * HOUR_PX }}
                    aria-hidden
                  />
                ))}
                {dayEvents.map((e) => {
                  const { col, cols } = placements.get(e) ?? { col: 0, cols: 1 };
                  const top =
                    (e.start.getHours() + e.start.getMinutes() / 60 - startHour) * HOUR_PX;
                  const height = Math.max(
                    MIN_EVENT_PX,
                    ((e.end.getTime() - e.start.getTime()) / 3_600_000) * HOUR_PX - 2,
                  );
                  const tone = eventTone(e, now);
                  return (
                    <button
                      key={e.note.path}
                      className={`absolute overflow-hidden rounded-md px-1.5 py-1 text-left ring-1 transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${tone.cls}`}
                      style={{
                        top,
                        height,
                        left: `calc(${(col / cols) * 100}% + 2px)`,
                        width: `calc(${100 / cols}% - 4px)`,
                      }}
                      onClick={(click) => openEvent(e, click)}
                      title={eventTooltip(e)}
                      aria-label={`${e.timed ? `${fmtClock(e.start)}, ` : ''}${e.note.title}${eventStateLabel(e)}`}
                    >
                      {eventBody(e, height)}
                    </button>
                  );
                })}
                {today && isCurrentWeek && nowTop >= 0 && nowTop <= gridHeight && (
                  <div
                    className="pointer-events-none absolute right-0 left-0 z-10"
                    style={{ top: nowTop }}
                    aria-hidden
                  >
                    <div className="absolute -top-[3px] -left-[3px] size-1.5 rounded-full bg-brand" />
                    <div className="h-px bg-brand" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
