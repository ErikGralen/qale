import { useEffect, useState } from 'react';
import { CalendarDays, Check, FileText, RotateCcw, Sparkles, TriangleAlert, X } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogTitle, cn } from '@qale/ui';
import type { NoteDTO, NoteRefDTO } from '@qale/ipc';
import { todoAddedOn } from '@qale/domain';
import { useApp } from '../state/app-state';
import { invoke } from '../lib/ipc';
import { dateLabel, dueStanding, weekdayLabel, type DueTone } from '../lib/due-date';
import { handleTodoSeed } from '../lib/agent-nudges';
import type { AtRiskLinkDTO } from '../lib/connections';
import { resolveParticipant } from '../lib/people';
import { splitTodoWords } from '../lib/todo-words';
import { todoRowCopy } from '../lib/todo-row';
import { AtRiskMarker } from './ExternalRef';
import { DatePicker } from './DatePicker';
import { Markdown } from './Markdown';
import { PersonChip } from './PersonChip';

/**
 * One todo, read as a promise rather than as a file (E-13).
 *
 * A todo IS a markdown note, and opening the file gave the PO a note page:
 * frontmatter, a body, a properties block. None of that answers the questions
 * a person actually has about a commitment. This panel answers exactly those,
 * top to bottom, and nothing else:
 *
 *   how it stands · what it is · who owes it
 *   when it is due (with the control that moves it) · where it was made
 *   the words that were said
 *   what to do about it now
 *
 * It shares its shell with the meeting panel: the same width, the same fact
 * grid, the same chip and title sizes. The two open from neighbouring lists
 * and must read as one instrument. It is sized by its content, not by a set
 * height: a three-line promise opens a three-line box.
 *
 * Every fact appears once. The byline names the meeting and the day, so the
 * quote's own `from` line is folded into it rather than shown a second time.
 * The owner is a sentence only when it is not you: your own list needs no
 * reminder that it is yours. The byline leaves you out of the room for the
 * same reason. Rows with nothing to say are left out entirely.
 *
 * Two facts are read, never guessed: "promised" is the date of the meeting the
 * commitment cites, and the room is that meeting's participants. With nothing
 * citing it, the row changes to "written down" and gives the day the file was
 * made, which is a different fact and says so.
 */

const TONE_CLASS: Record<DueTone, string> = {
  late: 'bg-warning/15 text-warning',
  today: 'bg-brand/10 text-brand',
  soon: 'bg-muted text-foreground/80',
  later: 'bg-muted text-muted-foreground',
  none: 'bg-muted text-muted-foreground',
};

/**
 * A day, with the weekday people plan by ("Fri 4 Sep") and the year only when
 * it is not this one ("4 Jan 2027"), where leaving it out would mislead.
 */
function dayText(iso: string, today: string): string {
  return iso.slice(0, 4) === today.slice(0, 4) ? weekdayLabel(iso) : dateLabel(iso);
}

/** A note this todo cites, as a name you can press. */
function SourceLink({ note, onOpen }: { note: NoteRefDTO; onOpen: () => void }) {
  return (
    <button
      className="rounded font-medium text-foreground underline decoration-border underline-offset-2 transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      onClick={onOpen}
      title={`Open ${note.title}`}
    >
      {note.title}
    </button>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="pt-0.5 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </>
  );
}

export function TodoDetail({
  note,
  commitment,
  today,
  open,
  onOpenChange,
  resolveRef,
  risk,
  busy,
  onDone,
  onDrop,
  onReopen,
  onSnooze,
}: {
  note: NoteRefDTO;
  /** The live commitment, optimistic write included — not `note.lifecycle`. */
  commitment: string;
  today: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A frontmatter ref ("[[meetings/…]]") to the note it points at. */
  resolveRef: (ref: string) => NoteRefDTO | undefined;
  risk?: AtRiskLinkDTO;
  busy: boolean;
  onDone: () => void;
  onDrop: () => void;
  onReopen: () => void;
  onSnooze: (due: string | null) => void;
}) {
  const { openDoc, openSession, people } = useApp();
  const [full, setFull] = useState<NoteDTO | null>(null);
  const [room, setRoom] = useState<string[]>([]);
  const [dateOpen, setDateOpen] = useState(false);

  // Read on open, not with the list: the body carries the words that were said,
  // and thirty of those on a page nobody asked for is thirty reads wasted.
  useEffect(() => {
    if (!open) {
      setFull(null);
      setRoom([]);
      return;
    }
    let alive = true;
    void (async () => {
      const loaded = await invoke['note:get'](note.path).catch(() => null);
      if (!alive) return;
      setFull(loaded);
      const refs = loaded?.frontmatter['sources'];
      const first = Array.isArray(refs) ? refs.find((r) => typeof r === 'string') : undefined;
      const src = typeof first === 'string' ? resolveRef(first) : undefined;
      if (!src || src.type !== 'meeting') return;
      const meeting = await invoke['note:get'](src.path).catch(() => null);
      if (!alive || !meeting) return;
      const participants = meeting.frontmatter['participants'];
      setRoom(
        Array.isArray(participants)
          ? participants.filter((p): p is string => typeof p === 'string')
          : [],
      );
    })();
    return () => {
      alive = false;
    };
  }, [open, note.path, resolveRef]);

  const closed = commitment !== 'open';
  const dropped = commitment === 'dropped';
  const standing = dueStanding(note.due, today);

  // The byline names the others in the room. You were there (it is your
  // memory) and the owner is already the subject of the sentence above it.
  const personKey = (raw: string): string => {
    const p = resolveParticipant(raw, people);
    if (p.kind === 'self') return 'self';
    if (p.kind === 'person') return `person:${p.person.slug}`;
    return `name:${p.label.toLowerCase()}`;
  };
  const ownerKey = note.owner ? personKey(note.owner) : null;
  const others = room.filter((p) => {
    const key = personKey(p);
    return key !== 'self' && key !== ownerKey;
  });

  const rawSources = full?.frontmatter['sources'];
  const sources = (Array.isArray(rawSources) ? rawSources : note.sourceRef ? [note.sourceRef] : [])
    .filter((r): r is string => typeof r === 'string')
    .map((r) => ({ raw: r, note: resolveRef(r) }));
  const firstSource = sources[0];
  const restSources = sources.slice(1).filter((s) => s.note);
  const promisedOn = firstSource?.note?.date ?? null;
  const addedOn = todoAddedOn(note.path);

  const words = splitTodoWords(full?.body ?? '');
  // The quote's own citation is shown only when it is not the byline already.
  const citeNote = words.cite ? resolveRef(words.cite) : undefined;
  const extraCite = citeNote && citeNote.path !== firstSource?.note?.path ? citeNote : null;
  const hasWords = words.quote !== null || words.rest !== '';
  const hasFacts = !closed || firstSource?.note || addedOn;

  const chip = closed
    ? `${dropped ? 'Dropped' : 'Done'}${note.resolvedOn ? ` ${dayText(note.resolvedOn, today)}` : ''}`
    : standing.text;

  const go = (path: string) => {
    onOpenChange(false);
    void openDoc(path);
  };

  const helpMe = () => {
    onOpenChange(false);
    openSession('commitment-check', {
      initialPrompt: handleTodoSeed(
        { path: note.path, title: note.title, due: note.due, owner: note.owner },
        today,
      ),
      title: `Handle: ${note.title}`,
      fresh: true,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Sized by what is in it, capped by the window. Only the words scroll,
        // so the actions never leave the screen.
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
        aria-describedby={undefined}
        // Land on the panel, not on the first button in it. Radix would put
        // focus on the date control, which draws a ring around a secondary
        // control before the PO has read a word.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus?.();
        }}
      >
        {/* The file itself sits with Close: a way out, not a thing to do. */}
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-2 right-10 text-muted-foreground"
          onClick={() => go(note.path)}
          title="Open the file"
        >
          <FileText aria-hidden />
          <span className="sr-only">Open the file</span>
        </Button>

        <div className="shrink-0 pt-4 pr-20 pb-3.5 pl-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Late is the one state that must not be missed: amber, a glyph, and a word. */}
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium',
                closed ? 'bg-muted text-muted-foreground' : TONE_CLASS[standing.tone],
              )}
            >
              {!closed && standing.tone === 'late' && (
                <TriangleAlert className="size-3" aria-hidden />
              )}
              {chip}
            </span>
            {risk && !closed && <AtRiskMarker risk={risk} onOpen={go} />}
          </div>

          <DialogTitle
            className={cn(
              'mt-2 text-base leading-snug font-semibold text-balance',
              closed && 'text-muted-foreground',
            )}
          >
            {note.title}
          </DialogTitle>

          {note.owner && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
              <PersonChip value={note.owner} />
              <span>{closed ? 'owed you this.' : 'owes you this.'}</span>
            </p>
          )}
        </div>

        {hasFacts && (
          <dl className="grid shrink-0 grid-cols-[6rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 border-t border-border px-4 py-3.5">
            {/* The date is the control: the value you read is the thing you press to move it. */}
            {!closed && (
              <Fact label="Due">
                <DatePicker
                  value={note.due ?? null}
                  today={today}
                  open={dateOpen}
                  onOpenChange={setDateOpen}
                  onPick={onSnooze}
                  align="start"
                  clearHint="someday"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    className={cn(
                      '-my-1 -ml-2.5 tabular-nums',
                      note.due ? 'text-foreground' : 'text-muted-foreground',
                    )}
                    title={note.due ? 'Change the date' : 'Set a date'}
                    aria-label={
                      note.due ? `Due ${dayText(note.due, today)}. Change the date` : 'Set a date'
                    }
                  >
                    <CalendarDays aria-hidden />
                    {note.due ? dayText(note.due, today) : 'Set a date'}
                  </Button>
                </DatePicker>
              </Fact>
            )}

            {/* Which meeting, which day, who else was in the room. */}
            {firstSource?.note ? (
              <Fact label={promisedOn ? 'Promised' : 'From'}>
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  {promisedOn && (
                    <span className="tabular-nums">{dayText(promisedOn, today)} in</span>
                  )}
                  <SourceLink note={firstSource.note} onOpen={() => go(firstSource.note!.path)} />
                  {others.length > 0 && (
                    <>
                      <span className="text-muted-foreground">with</span>
                      {others.map((p) => (
                        <PersonChip key={p} value={p} />
                      ))}
                    </>
                  )}
                </span>
              </Fact>
            ) : addedOn ? (
              <Fact label="Written down">
                <span className="tabular-nums">{dayText(addedOn, today)}</span>
              </Fact>
            ) : null}

            {restSources.length > 0 && (
              <Fact label="Also from">
                <span className="flex flex-wrap items-center gap-x-1">
                  {restSources.map((s, i) => (
                    <span key={s.raw} className="flex items-center gap-x-1">
                      <SourceLink note={s.note!} onOpen={() => go(s.note!.path)} />
                      {i < restSources.length - 1 && <span>,</span>}
                    </span>
                  ))}
                </span>
              </Fact>
            )}
          </dl>
        )}

        {hasWords && (
          <div className="min-h-0 overflow-y-auto border-t border-border px-4 py-3.5">
            {words.quote !== null && (
              // The words, as they were said: a quotation, not a markdown
              // callout. The opening mark hangs so the text keeps the margin.
              <blockquote className="-indent-[0.4em] text-body leading-relaxed text-foreground [&_.note-body]:inline [&_.note-body]:text-inherit [&_.note-body_p]:inline [&_.note-body_p]:m-0">
                <span aria-hidden>“</span>
                <Markdown content={words.quote} onOpenNote={(p) => go(p)} />
                <span aria-hidden>”</span>
                {extraCite && (
                  <span className="ml-1.5 indent-0 text-sm text-muted-foreground">
                    from <SourceLink note={extraCite} onOpen={() => go(extraCite.path)} />
                  </span>
                )}
              </blockquote>
            )}
            {words.rest !== '' && (
              <div className={cn('text-sm', words.quote !== null && 'mt-3')}>
                <Markdown content={words.rest} onOpenNote={(p) => go(p)} />
              </div>
            )}
          </div>
        )}

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          {closed ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={onReopen}>
              <RotateCcw aria-hidden />
              Reopen
            </Button>
          ) : (
            <>
              <Button size="sm" disabled={busy} onClick={onDone}>
                <Check aria-hidden />
                Mark done
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={helpMe}
                title="Reads the todo, where it came from and what's on the calendar, then turns what to do into proposals you approve"
              >
                <Sparkles aria-hidden />
                Help me handle this
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-muted-foreground hover:text-destructive"
                disabled={busy}
                onClick={onDrop}
                title={todoRowCopy(note).dropHint}
              >
                <X aria-hidden />
                Drop
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
