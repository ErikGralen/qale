import { useEffect, useState } from 'react';
import { FileText, Mic, Sparkles } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogTitle, cn } from '@qale/ui';
import type { BacklinkDTO, NoteDTO, NoteRefDTO } from '@qale/ipc';
import { transcriptRefs } from '@qale/domain';
import { useApp } from '../state/app-state';
import { invoke } from '../lib/ipc';
import { requestCapture } from '../lib/capture-event';
import { beforeMeetingSeed, readMeetingSeed } from '../lib/agent-nudges';
import { isUnreadMeeting, isUpcomingMeeting, meetingWindowOf } from '../lib/note-status';
import {
  durationText,
  meetingOutcome,
  meetingStanding,
  promiseState,
  type MeetingTone,
} from '../lib/meeting-read';
import { noteTypeIcon } from '../lib/note-icons';
import { Markdown } from './Markdown';
import { PersonChip } from './PersonChip';

/**
 * One meeting, read as a meeting rather than as a file (E-12).
 *
 * A meeting IS a markdown note, and opening the file gave the PO a note page:
 * frontmatter, a body, a properties block. That answers none of the questions a
 * person has after a call: when it was, who was in the room, what got decided,
 * what people promised, and what is still open. This panel answers those in that
 * order and puts the notes underneath, where they belong. The file is still one
 * button away, because the vault is the deliverable.
 *
 * Nothing here is derived twice. The state word comes from the same rules the
 * week grid and the attention list read, and the outcome is the meeting's own
 * inbound links, so the panel can only say what the vault already holds.
 */

const TONE_CLASS: Record<MeetingTone, string> = {
  brand: 'bg-brand/10 text-brand',
  warning: 'bg-warning/15 text-warning',
  muted: 'bg-muted text-muted-foreground',
};

const DAY_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** "Tuesday 18 May, 14:00 – 15:00": the one line that places the meeting. */
function whenLine(start: number, clock: boolean, end: number): string {
  const day = DAY_FMT.format(new Date(start));
  if (!clock) return `${day}, all day`;
  const hhmm = (ts: number): string => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  return `${day}, ${hhmm(start)} – ${hhmm(end)}`;
}

/** One label + value line. A row with nothing to say is left out entirely. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="pt-0.5 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </>
  );
}

/** A note that came out of this meeting, as a name you can press. */
function OutcomeRow({
  note,
  state,
  onOpen,
}: {
  note: NoteRefDTO;
  state?: string;
  onOpen: () => void;
}) {
  const Icon = noteTypeIcon(note.type);
  return (
    <li>
      <button
        className="flex w-full items-baseline gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={onOpen}
        title={`Open ${note.title}`}
      >
        <Icon className="size-3.5 shrink-0 self-center text-muted-foreground/70" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm">{note.title}</span>
        {state && <span className="shrink-0 text-xs text-muted-foreground">{state}</span>}
      </button>
    </li>
  );
}

/** One outcome group. Groups with nothing in them never appear. */
function Outcome({
  heading,
  notes,
  stateOf,
  onOpen,
}: {
  heading: string;
  notes: NoteRefDTO[];
  stateOf?: (n: NoteRefDTO) => string;
  onOpen: (path: string) => void;
}) {
  if (notes.length === 0) return null;
  return (
    <section>
      <h3 className="px-1 text-xs font-medium text-muted-foreground">{heading}</h3>
      <ul className="mt-0.5">
        {notes.map((n) => (
          <OutcomeRow key={n.path} note={n} state={stateOf?.(n)} onOpen={() => onOpen(n.path)} />
        ))}
      </ul>
    </section>
  );
}

export function MeetingDetail({
  note,
  open,
  onOpenChange,
}: {
  note: NoteRefDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { openDoc, openSession } = useApp();
  const [full, setFull] = useState<NoteDTO | null>(null);
  const [backlinks, setBacklinks] = useState<BacklinkDTO[]>([]);

  // Read on open, not with the week: a page of notes for every block on the
  // grid is forty reads for the one meeting the PO actually clicked.
  useEffect(() => {
    if (!open) {
      setFull(null);
      setBacklinks([]);
      return;
    }
    let alive = true;
    void (async () => {
      const [loaded, links] = await Promise.all([
        invoke['note:get'](note.path).catch(() => null),
        invoke['note:backlinks'](note.path).catch(() => [] as BacklinkDTO[]),
      ]);
      if (!alive) return;
      setFull(loaded);
      setBacklinks(links);
    })();
    return () => {
      alive = false;
    };
  }, [open, note.path]);

  const frontmatter = full?.frontmatter ?? {};
  const cancelled = frontmatter['event_status'] === 'cancelled';
  const when = cancelled ? null : meetingWindowOf(frontmatter);
  const standing = meetingStanding(note);
  const people = Array.isArray(frontmatter['participants'])
    ? frontmatter['participants'].filter((p): p is string => typeof p === 'string')
    : [];
  const length = durationText(
    typeof frontmatter['duration_minutes'] === 'number'
      ? frontmatter['duration_minutes']
      : undefined,
  );
  const transcripts = transcriptRefs(frontmatter);
  const body = full?.body.trim() ?? '';
  const outcome = meetingOutcome(backlinks);
  const nothingCameOut =
    full !== null &&
    outcome.decided.length === 0 &&
    outcome.promised.length === 0 &&
    outcome.learned.length === 0 &&
    outcome.linked.length === 0;

  const upcoming = !cancelled && isUpcomingMeeting(note);
  const offerBrief = upcoming && full !== null && !/^## Prep\b/m.test(body);
  const unread = isUnreadMeeting({
    past: !cancelled && !upcoming,
    processing: frontmatter['processing'],
    transcripts: transcripts.length,
    body,
  });

  const go = (path: string) => {
    onOpenChange(false);
    void openDoc(path);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] gap-0 overflow-y-auto p-0 sm:max-w-lg"
        aria-describedby={undefined}
      >
        <div className="px-4 pt-4 pb-3.5">
          {standing && (
            <span
              className={cn('rounded px-1.5 py-0.5 text-xs font-medium', TONE_CLASS[standing.tone])}
            >
              {standing.text}
            </span>
          )}
          <DialogTitle
            className={cn(
              'mt-2 text-base leading-snug font-semibold',
              cancelled && 'text-muted-foreground line-through',
            )}
          >
            {note.title}
          </DialogTitle>
          {note.summary && <p className="mt-1 text-sm text-muted-foreground">{note.summary}</p>}
        </div>

        <dl className="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2.5 border-t border-border px-4 py-3.5">
          {when && (
            <Fact label="When">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span>{whenLine(when.start, when.clock, when.end)}</span>
                {length && when.clock && (
                  <span className="text-xs text-muted-foreground">{length}</span>
                )}
              </span>
            </Fact>
          )}

          {people.length > 0 && (
            <Fact label="Who was there">
              <span className="flex flex-wrap gap-1">
                {people.map((p) => (
                  <PersonChip key={p} value={p} />
                ))}
              </span>
            </Fact>
          )}

          {/* Only once the meeting is behind the PO. "Recording: none" on a call
              that has not happened yet reads as a fault, and it is a fact about
              nothing. */}
          {full !== null && !upcoming && !cancelled && (
            <Fact label="Recording">
              {transcripts.length > 0 ? (
                <span>
                  {transcripts.length === 1 ? '1 transcript' : `${transcripts.length} transcripts`}
                </span>
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </Fact>
          )}
        </dl>

        {full !== null && (
          <div className="flex flex-col gap-3 border-t border-border px-4 py-3.5">
            <Outcome heading="Decided" notes={outcome.decided} onOpen={go} />
            <Outcome
              heading="Promised"
              notes={outcome.promised}
              stateOf={promiseState}
              onOpen={go}
            />
            <Outcome heading="Learned" notes={outcome.learned} onOpen={go} />
            <Outcome heading="Also linked" notes={outcome.linked} onOpen={go} />
            {nothingCameOut && (
              <p className="px-1 text-sm text-muted-foreground">
                Nothing has come out of this meeting yet.
              </p>
            )}
          </div>
        )}

        {body && (
          <div className="border-t border-border px-4 py-3.5">
            {/* What was written down, as it was written. */}
            <div className="max-h-72 overflow-y-auto text-sm">
              <Markdown content={body} onOpenNote={(p) => go(p)} />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          {offerBrief && (
            <Button
              size="sm"
              onClick={() => {
                onOpenChange(false);
                openSession('meeting-prep', {
                  initialPrompt: beforeMeetingSeed(note.path),
                  title: `Brief: ${note.title}`,
                  fresh: true,
                });
              }}
              title="What changed since these people were last told, open questions, loose ends. One proposal writes it onto the page."
            >
              <Sparkles aria-hidden />
              Get the brief
            </Button>
          )}
          {unread && (
            <Button
              size="sm"
              onClick={() => {
                onOpenChange(false);
                openSession('arrival', {
                  initialPrompt: readMeetingSeed(note.path, {
                    transcripts: transcripts.length,
                    typed: body.length > 0,
                  }),
                  title: `Go through: ${note.title}`,
                  fresh: true,
                });
              }}
              title="Go through what this meeting holds, typed notes and recordings alike, and turn what it changes into proposals."
            >
              <Sparkles aria-hidden />
              Go through this meeting
            </Button>
          )}
          {!upcoming && !cancelled && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                requestCapture({
                  aim: { kind: 'meeting', path: note.path, title: note.title },
                });
              }}
              title="Add a recording to this meeting"
            >
              <Mic aria-hidden />
              Add transcript
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-muted-foreground"
            onClick={() => go(note.path)}
            title="The markdown file this meeting lives in"
          >
            <FileText aria-hidden />
            Open the file
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
