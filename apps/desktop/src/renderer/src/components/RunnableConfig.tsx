import {
  BookOpen,
  CalendarClock,
  FolderClosed,
  FolderInput,
  Lock,
  RefreshCw,
  Send,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { CapabilityDTO, StartDTO, StartEvent } from '@qale/ipc';
import { cn } from '@qale/ui';

/**
 * The two configured facts every skill and agent shows: what starts it, and
 * what it may do. Both are data (see `@qale/sessions/runnable`) — the file's
 * instructions never describe them, and these chips are the only place the app
 * puts them into words, so the wiring and the wording cannot drift apart.
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
      'May draft things that leave the workspace: Jira comments, pages, messages. Nothing is sent without your approval.',
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
 * Starts worth a chip. `you-run-it` and `model-picks-it-up` are left out
 * everywhere: they are true of almost every file, so a chip for either says
 * nothing the page doesn't already imply — and on an agent row they crowded out
 * the one start that IS news, the clock.
 */
type ShownKind = 'always' | 'read-when-relevant' | 'interval' | 'before-meeting' | 'event';
type ShownStart = Extract<StartDTO, { kind: ShownKind }>;

const WORTH_SHOWING: ShownKind[] = [
  'always',
  'read-when-relevant',
  'interval',
  'before-meeting',
  'event',
];

/** The starts that earn a chip, in the order given. */
export function visibleStarts(starts: StartDTO[]): ShownStart[] {
  return starts.filter((s): s is ShownStart => (WORTH_SHOWING as string[]).includes(s.kind));
}

function startWords(s: ShownStart): { icon: LucideIcon; text: string } {
  switch (s.kind) {
    case 'always':
      return {
        icon: Lock,
        text: s.audience ? `Always: drafting for ${s.audience}` : 'Always in effect',
      };
    case 'read-when-relevant':
      return { icon: BookOpen, text: 'Read when relevant' };
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
