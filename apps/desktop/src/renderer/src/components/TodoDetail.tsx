import { useEffect, useState } from 'react';
import { Check, Clock, FileText, RotateCcw, Sparkles, X } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogTitle, cn } from '@qale/ui';
import type { NoteDTO, NoteRefDTO } from '@qale/ipc';
import { todoAddedOn } from '@qale/domain';
import { useApp } from '../state/app-state';
import { invoke } from '../lib/ipc';
import { dateLabel, dueStanding, weekdayLabel, type DueTone } from '../lib/due-date';
import { handleTodoSeed } from '../lib/agent-nudges';
import type { AtRiskLinkDTO } from '../lib/connections';
import { AtRiskMarker } from './ExternalRef';
import { DatePicker } from './DatePicker';
import { Markdown } from './Markdown';
import { PersonChip } from './PersonChip';

/**
 * One todo, read as a promise rather than as a file (E-13).
 *
 * A todo IS a markdown note, and opening the file gave the PO a note page:
 * frontmatter, a body, a properties block. None of that answers the five
 * questions a person actually has about a commitment — who owes it, to whom,
 * when it was promised, where it came from, and what to do about it now. This
 * panel answers those in that order and puts every action within one click.
 * The file is still one button away, because the vault is the deliverable.
 *
 * Two facts are read, never guessed: "promised" is the date of the meeting the
 * commitment cites, and "who was there" is that meeting's participants. With
 * nothing citing it, the row changes to "written down" and gives the day the
 * file was made, which is a different fact and says so.
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

/** One label + value line. Rows with nothing to say are left out entirely. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="pt-0.5 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </>
  );
}

/** A note this todo cites, as a name you can press. */
function SourceLink({ note, onOpen }: { note: NoteRefDTO; onOpen: () => void }) {
  return (
    <button
      className="rounded text-left font-medium text-foreground underline decoration-border underline-offset-2 transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      onClick={onOpen}
      title={`Open ${note.title}`}
    >
      {note.title}
    </button>
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
  const { openDoc, openSession } = useApp();
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
      const people = meeting.frontmatter['participants'];
      setRoom(
        Array.isArray(people) ? people.filter((p): p is string => typeof p === 'string') : [],
      );
    })();
    return () => {
      alive = false;
    };
  }, [open, note.path, resolveRef]);

  const closed = commitment !== 'open';
  const dropped = commitment === 'dropped';
  const standing = dueStanding(note.due, today);

  const ownerName = note.owner
    ?.replace(/^\[\[|\]\]$/g, '')
    .split('/')
    .pop();
  const lead = ownerName
    ? `${ownerName} ${closed ? 'owed' : 'owes'} you this.`
    : `You ${closed ? 'owed' : 'owe'} this.`;

  const rawSources = full?.frontmatter['sources'];
  const sources = (Array.isArray(rawSources) ? rawSources : note.sourceRef ? [note.sourceRef] : [])
    .filter((r): r is string => typeof r === 'string')
    .map((r) => ({ raw: r, note: resolveRef(r) }));
  const firstSource = sources[0];
  const restSources = sources.slice(1).filter((s) => s.note);
  const promisedOn = firstSource?.note?.date ?? null;
  const addedOn = todoAddedOn(note.path);

  const body = full?.body.trim() ?? '';

  const chip = closed
    ? `${dropped ? 'Dropped' : 'Done'}${note.resolvedOn ? ` ${dayText(note.resolvedOn, today)}` : ''}`
    : standing.text;

  const go = (path: string) => {
    onOpenChange(false);
    void openDoc(path);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg" aria-describedby={undefined}>
        <div className="px-4 pt-4 pb-3.5">
          <div className="flex flex-wrap items-center gap-2 pr-7">
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-xs font-medium',
                closed ? 'bg-muted text-muted-foreground' : TONE_CLASS[standing.tone],
              )}
            >
              {chip}
            </span>
            {risk && !closed && <AtRiskMarker risk={risk} onOpen={go} />}
          </div>
          <DialogTitle
            className={cn(
              'mt-2 text-base leading-snug font-semibold',
              closed && 'text-muted-foreground',
            )}
          >
            {note.title}
          </DialogTitle>
          <p className="mt-1 text-sm text-muted-foreground">{lead}</p>
        </div>

        <dl className="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2.5 border-t border-border px-4 py-3.5">
          <Fact label="Who owes it">
            {note.owner ? (
              <PersonChip value={note.owner} />
            ) : (
              <span className="text-foreground">You</span>
            )}
          </Fact>

          <Fact label="Due">
            <span className="flex flex-wrap items-center gap-2">
              <span className={note.due ? 'text-foreground tabular-nums' : 'text-muted-foreground'}>
                {note.due ? dayText(note.due, today) : 'No date yet'}
              </span>
              {!closed && (
                <DatePicker
                  value={note.due ?? null}
                  today={today}
                  open={dateOpen}
                  onOpenChange={setDateOpen}
                  onPick={onSnooze}
                  align="start"
                  clearHint="someday"
                >
                  <Button variant="outline" size="xs" disabled={busy}>
                    <Clock aria-hidden />
                    {note.due ? 'Change date' : 'Set a date'}
                  </Button>
                </DatePicker>
              )}
            </span>
          </Fact>

          {firstSource?.note ? (
            <Fact label={promisedOn ? 'Promised' : 'From'}>
              <span className="flex flex-wrap items-baseline gap-x-1.5">
                {promisedOn && (
                  <span className="text-muted-foreground tabular-nums">
                    {dayText(promisedOn, today)}, in
                  </span>
                )}
                <SourceLink note={firstSource.note} onOpen={() => go(firstSource.note!.path)} />
              </span>
            </Fact>
          ) : addedOn ? (
            <Fact label="Written down">
              <span className="tabular-nums">{dayText(addedOn, today)}</span>
            </Fact>
          ) : null}

          {room.length > 0 && (
            <Fact label="Who was there">
              <span className="flex flex-wrap gap-1">
                {room.map((p) => (
                  <PersonChip key={p} value={p} />
                ))}
              </span>
            </Fact>
          )}

          {restSources.length > 0 && (
            <Fact label="Also from">
              <span className="flex flex-col items-start gap-1">
                {restSources.map((s) => (
                  <SourceLink key={s.raw} note={s.note!} onOpen={() => go(s.note!.path)} />
                ))}
              </span>
            </Fact>
          )}
        </dl>

        {body && (
          <div className="border-t border-border px-4 py-3.5">
            {/* The words the commitment was drawn from, as they were written. */}
            <div className="max-h-56 overflow-y-auto text-sm">
              <Markdown content={body} onOpenNote={(p) => go(p)} />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
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
                onClick={() => {
                  onOpenChange(false);
                  openSession('commitment-check', {
                    initialPrompt: handleTodoSeed(
                      { path: note.path, title: note.title, due: note.due, owner: note.owner },
                      today,
                    ),
                    title: `Handle: ${note.title}`,
                    fresh: true,
                  });
                }}
                title="Reads the todo, where it came from and what's on the calendar, then turns what to do into proposals you approve"
              >
                <Sparkles aria-hidden />
                Help me handle this
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                disabled={busy}
                onClick={onDrop}
                title="Keeps the record, closes the todo"
              >
                <X aria-hidden />
                Drop
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-muted-foreground"
            onClick={() => go(note.path)}
            title="The markdown file this todo lives in"
          >
            <FileText aria-hidden />
            Open the file
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
