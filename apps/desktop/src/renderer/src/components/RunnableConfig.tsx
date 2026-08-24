import {
  CalendarClock,
  Eye,
  FolderClosed,
  FolderInput,
  RefreshCw,
  Send,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { CapabilityDTO, StartDTO, StartEvent } from '@qale/ipc';
import { cn } from '@qale/ui';

/**
 * The configured facts a skill or an agent shows: what it may do, and for an
 * agent, what clock starts it. Both are data (see `@qale/sessions/runnable` and
 * main's `agents.ts`) — the file's instructions never describe them, and these
 * chips are the only place the app puts them into words, so the wiring and the
 * wording cannot drift apart.
 */

/** The phrase for each watched happening. Main names the event; the words are ours. */
const EVENT_PHRASE: Record<StartEvent, string> = {
  'decision-superseded': 'When you approve a decision that replaces another',
};

const CAN_META: Record<CapabilityDTO, { icon: LucideIcon; text: string; title: string }> = {
  'draft-outbound': {
    icon: Send,
    text: 'Drafts outgoing updates',
    title:
      'May draft things that leave the workspace: comments on tickets and edits to wiki pages. Nothing is sent without your approval.',
  },
  'draft-calendar': {
    icon: CalendarClock,
    text: 'Drafts calendar changes',
    title:
      'May draft a new meeting, a move of one, or a reply to an invitation. Nothing reaches your calendar or the guests without your approval.',
  },
  'keep-working-files': {
    icon: FolderClosed,
    text: 'Keeps working files',
    title:
      'May keep scratch files for the length of a session. Working material, never part of the memory.',
  },
  'file-material': {
    icon: FolderInput,
    text: 'Files what you hand over',
    title:
      'May put material you dropped in where it belongs, and move it when that turns out to be wrong. Filing needs no approval; everything it goes on to write about the material is still a card.',
  },
  'track-external': {
    icon: Eye,
    text: 'Watches your tracker and wiki',
    title:
      'May start watching a ticket or a wiki page, so the workspace keeps its own copy up to date, and may record your answer about a whole project or space. It writes nothing to the tracker or the wiki, so it needs no approval. Reading them needs no permission at all.',
  },
};

/**
 * A span in the shortest true form — "5 min", "1 h", "1 h 30 min". Local to
 * this file: starts are the only place the app says a duration out loud.
 */
function span(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * Every start is a clock now, and every clock is worth a chip: it is the one
 * thing about an agent a person cannot read off its page.
 */
export function visibleStarts(starts: StartDTO[]): StartDTO[] {
  return starts;
}

function startWords(s: StartDTO): { icon: LucideIcon; text: string } {
  switch (s.kind) {
    case 'interval':
      return { icon: RefreshCw, text: `Every ${span(s.everyMs)}` };
    case 'before-meeting':
      // "synced" is load-bearing: it only sees meetings the calendar connector
      // put in the workspace, never a meeting note typed by hand.
      return { icon: CalendarClock, text: `${span(s.leadMs)} before a synced meeting` };
    case 'event':
      return { icon: Zap, text: EVENT_PHRASE[s.event] };
  }
}

function Chip({
  icon: Icon,
  children,
  title,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-micro text-muted-foreground ring-1 ring-border/60 ring-inset"
      {...(title ? { title } : {})}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {children}
    </span>
  );
}

/**
 * What starts this file, one chip each — and nothing at all when none of its
 * starts is worth saying. The absence is not silence: a caller that needs to
 * state it (an agent with no clock) says so in its own words.
 */
export function StartChips({ starts, className }: { starts: StartDTO[]; className?: string }) {
  const shown = visibleStarts(starts);
  if (shown.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {shown.map((s, i) => {
        const { icon, text } = startWords(s);
        return (
          <Chip key={i} icon={icon}>
            {text}
          </Chip>
        );
      })}
    </div>
  );
}

/**
 * What it may do. Nothing renders when the list is empty: reading and proposing
 * cards is the floor every session has, and a chip saying so would be noise on
 * every row.
 */
export function CanChips({ can, className }: { can: CapabilityDTO[]; className?: string }) {
  if (can.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {can.map((c) => {
        const meta = CAN_META[c];
        return (
          <Chip key={c} icon={meta.icon} title={meta.title}>
            {meta.text}
          </Chip>
        );
      })}
    </div>
  );
}
