import { useEffect, useMemo, useState } from 'react';
import { isFolderIndex } from '@qale/domain';
import { CalendarDays } from 'lucide-react';
import type { NoteRefDTO } from '@qale/ipc';
import { useApp } from '../state/app-state';
import { useAimedDrop } from '../lib/aimed-drop';
import { navFromEvent } from '../lib/nav';
import { calendarSections, meetingStanding, type MeetingTone } from '../lib/meeting-read';
import { meetingMeta } from '../lib/note-status';
import { PageHeader } from '../components/PageHeader';
import { MeetingDetail } from '../components/MeetingDetail';
import { ScopedAskComposer } from '../components/ScopedAskComposer';
import { MeetingWeek } from './MeetingWeek';

/**
 * The Calendar (E-12): what is coming and what happened.
 *
 * Meetings are markdown files, but a folder of markdown files is the wrong read
 * of a week. This page opens on the grid, keeps a plain list one click away for
 * the weeks a grid is too much for, and hands the meeting itself to a panel that
 * answers what a meeting is about (components/MeetingDetail). Pressing a block
 * never drops the PO into a note page again, though ⌘-pressing one still opens
 * the file in a tab, because every other list in the app works that way.
 */

const VIEW_KEY = 'qale.calendar.view';

type CalendarLayout = 'week' | 'list';

function storedLayout(): CalendarLayout {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'week';
  } catch {
    return 'week';
  }
}

/** The clock, re-read once a minute so "Happening now" stops being true. */
function useNow(ms = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

const TONE_CLASS: Record<MeetingTone, string> = {
  brand: 'text-brand',
  warning: 'text-warning',
  muted: 'text-muted-foreground',
};

/** One meeting in the list read: when it is, what it is, where it stands. */
function AgendaRow({
  note,
  now,
  onOpen,
}: {
  note: NoteRefDTO;
  now: number;
  onOpen: (note: NoteRefDTO, click: React.MouseEvent) => void;
}) {
  const standing = meetingStanding(note, now);
  const cancelled = note.eventStatus === 'cancelled';
  return (
    <button
      className="flex w-full items-baseline gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      onClick={(e) => onOpen(note, e)}
      onAuxClick={(e) => e.button === 1 && onOpen(note, e)}
      title={note.summary || note.title}
    >
      <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">
        {meetingMeta(note)}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-sm font-medium ${cancelled ? 'text-muted-foreground line-through' : ''}`}
        >
          {note.title}
        </span>
        {note.summary && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {note.summary}
          </span>
        )}
      </span>
      {standing && (
        <span className={`shrink-0 text-xs ${TONE_CLASS[standing.tone]}`}>{standing.text}</span>
      )}
    </button>
  );
}

export function CalendarView() {
  const { tree, openDoc } = useApp();
  const now = useNow();
  const [layout, setLayoutState] = useState<CalendarLayout>(storedLayout);
  const [selected, setSelected] = useState<NoteRefDTO | null>(null);

  const setLayout = (v: CalendarLayout) => {
    setLayoutState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private-mode / file:// builds just lose the preference */
    }
  };

  const meetings = useMemo(() => {
    const group = tree?.groups.find((g) => g.type === 'meeting');
    return (group?.notes ?? []).filter((n) => !isFolderIndex(n.path));
  }, [tree]);

  // No tag filter here: tags are the agent's now (E-15). A calendar is filtered
  // by time, which the two sections below already do.
  const { coming, happened } = useMemo(() => calendarSections(meetings, now), [meetings, now]);

  // The panel is the meeting's page here, but a modifier still means "in a tab",
  // which on a meeting means the file. One rule for the grid and the list.
  const open = (note: NoteRefDTO, click?: React.MouseEvent) => {
    if (click && (click.metaKey || click.ctrlKey || click.shiftKey || click.button === 1)) {
      return void openDoc(note.path, navFromEvent(click));
    }
    setSelected(note);
  };

  // Dropping on the calendar says the source is a meeting, so the agent never
  // has to ask which shelf it belongs on.
  const aimed = useAimedDrop({ kind: 'folder', dir: 'meetings' });

  const viewToggle = meetings.length > 0 && (
    <div
      className="flex items-center rounded-lg bg-muted p-0.5"
      role="group"
      aria-label="Calendar view"
    >
      {(['week', 'list'] as const).map((v) => (
        <button
          key={v}
          className={`rounded-md px-2 py-0.5 text-xs font-medium capitalize transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
            layout === v
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setLayout(v)}
          aria-pressed={layout === v}
        >
          {v}
        </button>
      ))}
    </div>
  );

  return (
    <div
      className={`flex h-full flex-col ${aimed.over ? 'bg-brand/5 ring-1 ring-brand/40 ring-inset' : ''}`}
      {...aimed.handlers}
    >
      <PageHeader icon={CalendarDays} label="Calendar" />

      {meetings.length === 0 ? (
        <div className="flex-1 overflow-y-auto px-8 py-3">
          <div className="mx-auto w-full max-w-2xl px-1 py-2">
            <p className="text-sm text-muted-foreground">
              No meetings yet. Drop a transcript (or paste one with ⇧⌘N) and it gets filed as a
              meeting. Connect Google Calendar in Settings and the ones you already have appear
              here.
            </p>
          </div>
        </div>
      ) : layout === 'week' ? (
        <MeetingWeek notes={meetings} toolbarLead={viewToggle} onOpen={open} />
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/70 px-4 py-2">
            {viewToggle}
          </div>

          <div className="flex-1 overflow-y-auto px-8 py-3">
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
              <section>
                <h2 className="mb-1 px-2 text-xs font-medium text-muted-foreground">Coming up</h2>
                {coming.length === 0 ? (
                  <p className="px-2 text-sm text-muted-foreground">Nothing ahead.</p>
                ) : (
                  coming.map((n) => <AgendaRow key={n.path} note={n} now={now} onOpen={open} />)
                )}
              </section>
              <section>
                <h2 className="mb-1 px-2 text-xs font-medium text-muted-foreground">Happened</h2>
                {happened.length === 0 ? (
                  <p className="px-2 text-sm text-muted-foreground">Nothing behind you yet.</p>
                ) : (
                  happened.map((n) => <AgendaRow key={n.path} note={n} now={now} onOpen={open} />)
                )}
              </section>
            </div>
          </div>
        </>
      )}

      {selected && (
        <MeetingDetail
          key={selected.path}
          note={selected}
          open
          onOpenChange={(v) => !v && setSelected(null)}
        />
      )}

      <ScopedAskComposer
        scope={{ kind: 'folder', label: 'meetings' }}
        sessionTitle="Ask · meetings"
        scopePrefix="Scoped to my meetings."
      />
    </div>
  );
}
