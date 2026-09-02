import { useMemo, useState } from 'react';
import { CalendarOff, ChevronLeft, ChevronRight, CornerDownLeft } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger, cn } from '@qale/ui';
import {
  addDays,
  addMonths,
  datePresets,
  monthGrid,
  monthLabel,
  parseDateInput,
  sameMonth,
  toDate,
  weekdayLabel,
} from '../lib/due-date';

/**
 * Pick a date: four presets, a typed line, and a month to click.
 *
 * The old menu offered three fixed jumps and nothing else, so "the 12th" meant
 * opening the note and editing frontmatter. Three ways in, in the order they
 * cost keystrokes: press a preset, type "12" or "next fri" and press Enter, or
 * click the day. The field takes focus on open, so the typed path needs no
 * mouse at all, and the arrow keys walk the calendar while the field is empty.
 *
 * Every date the app asks for comes through here: the due date on a todo, and
 * every day-field in frontmatter. The browser's own calendar was the one piece
 * of another app's chrome left in ours, so it went.
 */

const WEEK_HEADS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const ROW =
  'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none';

export interface DatePickerProps {
  /** The date the field holds now, or null when it has none. */
  value: string | null;
  /** Local "YYYY-MM-DD" for the PO's today. */
  today: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The chosen date; `null` clears the field. */
  onPick: (date: string | null) => void;
  /** Which side of the trigger the panel lines up with. */
  align?: 'start' | 'end';
  /** What clearing means here, as a trailing hint ("someday" on a todo). */
  clearHint?: string;
  /** The trigger button. */
  children: React.ReactNode;
}

export function DatePicker({
  value,
  today,
  open,
  onOpenChange,
  onPick,
  align = 'end',
  clearHint,
  children,
}: DatePickerProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} sideOffset={6} className="w-64 p-1.5">
        {/* Radix unmounts the content on close, so the body's state is fresh
            every time: an empty field, on the month of the date it has now. */}
        <PickerBody
          value={value}
          today={today}
          clearHint={clearHint}
          onPick={(date) => {
            onPick(date);
            onOpenChange(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function PickerBody({
  value,
  today,
  clearHint,
  onPick,
}: {
  value: string | null;
  today: string;
  clearHint?: string;
  onPick: (date: string | null) => void;
}) {
  const [text, setText] = useState('');
  /** The keyboard's day, and what the calendar scrolls to follow. */
  const [cursor, setCursor] = useState(value ?? today);
  /**
   * True while the month chevrons drive the view. The cursor has to move with
   * the visible month (so the arrow keys pick up where you look), but a cursor
   * dragged along by browsing was never aimed at a day — ringing it made "the
   * 30th" look marked in every month. While browsing, nothing is aimed and
   * Enter commits nothing; the first arrow key aims again.
   */
  const [browsing, setBrowsing] = useState(false);

  const typed = text.trim().length > 0;
  const parsed = useMemo(() => (typed ? parseDateInput(text, today) : null), [text, typed, today]);
  /** What Enter commits: the typed date, or the day the arrow keys are on. */
  const aimed = typed ? parsed : browsing ? null : cursor;
  const month = parsed ?? cursor;
  const grid = useMemo(() => monthGrid(month), [month]);
  const presets = useMemo(() => datePresets(today), [today]);

  /** Stepping through the months is browsing, so the typed line gives way. */
  const stepMonth = (delta: number) => {
    setCursor(addMonths(month, delta));
    setBrowsing(true);
    setText('');
  };

  /** Arrow keys walk the calendar, but only while the field is empty. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (aimed) onPick(aimed);
      return;
    }
    const step =
      e.key === 'ArrowLeft'
        ? -1
        : e.key === 'ArrowRight'
          ? 1
          : e.key === 'ArrowUp'
            ? -7
            : e.key === 'ArrowDown'
              ? 7
              : 0;
    if (step && !typed) {
      e.preventDefault();
      setBrowsing(false);
      setCursor((c) => addDays(c, step));
    }
  };

  return (
    <div onKeyDown={onKeyDown}>
      <input
        className="mb-1 h-8 w-full rounded-md bg-muted/60 px-2 text-sm outline-none placeholder:text-muted-foreground/70 focus:bg-muted"
        placeholder="Type a date, “12”, “next fri”"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Type a date"
        autoFocus
      />

      {typed ? (
        parsed ? (
          <button className={ROW} onClick={() => onPick(parsed)}>
            <span className="min-w-0 truncate font-medium">{weekdayLabel(parsed)}</span>
            <CornerDownLeft
              className="ml-auto size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </button>
        ) : (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">No date in that.</p>
        )
      ) : (
        <div className="flex flex-col">
          {presets.map((p) => (
            <button key={p.label} className={ROW} onClick={() => onPick(p.due)}>
              <span className="min-w-0 truncate">{p.label}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                {weekdayLabel(p.due)}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-1 border-t border-border/60 pt-1.5">
        <div className="mb-1 flex items-center gap-1 px-1">
          <span className="text-sm font-medium">{monthLabel(month)}</span>
          <button
            className="ml-auto rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => stepMonth(-1)}
            aria-label="Previous month"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <button
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => stepMonth(1)}
            aria-label="Next month"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>

        <div className="grid grid-cols-7 px-0.5" aria-hidden>
          {WEEK_HEADS.map((d, i) => (
            <span
              key={i}
              className="pb-0.5 text-center text-2xs font-semibold text-muted-foreground/70"
            >
              {d}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-7 px-0.5">
          {grid.map((day) => {
            // Filled = the date it has now. Ringed = what Enter would set.
            const set = day === value;
            const isToday = day === today;
            return (
              <button
                key={day}
                className={cn(
                  'flex h-7 items-center justify-center rounded-md text-xs tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                  set ? 'bg-brand font-semibold text-brand-foreground' : 'hover:bg-accent',
                  !set && isToday && 'font-semibold text-brand',
                  !set && !sameMonth(day, month) && 'text-muted-foreground/40',
                  day === aimed && !set && 'font-semibold ring-1 ring-brand/70 ring-inset',
                )}
                onClick={() => onPick(day)}
                aria-label={weekdayLabel(day)}
                aria-current={isToday ? 'date' : undefined}
              >
                {toDate(day).getDate()}
              </button>
            );
          })}
        </div>
      </div>

      {value && (
        <div className="mt-1 border-t border-border/60 pt-1">
          <button className={cn(ROW, 'text-muted-foreground')} onClick={() => onPick(null)}>
            <CalendarOff className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">No date</span>
            {clearHint && (
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{clearHint}</span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
