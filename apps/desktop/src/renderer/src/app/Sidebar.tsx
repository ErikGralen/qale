import { useCallback, useMemo } from 'react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Spinner,
} from '@qale/ui';
import {
  FolderOpen,
  Check,
  Clock,
  Wand2,
  Bot,
  X,
  CalendarDays,
  FileUp,
  Files,
  History,
  House,
  Library,
  Search,
  Settings,
  SquarePen,
  ListTodo,
  Plus,
  ScrollText,
  type LucideIcon,
} from 'lucide-react';
import { isFolderIndex } from '@qale/domain';
import { useApp, useMinuteClock } from '../state/app-state';
import { countOf } from '../lib/attention';
import { useReorderableRow } from '../lib/dnd';
import { navFromEvent } from '../lib/nav';
import { noteTypeIcon } from '../lib/note-icons';
import { unprocessedSourceCount } from '../lib/note-status';
import { sidebarMeetingMeta, upcomingSidebarMeetings } from '../lib/meeting-read';
import { documentPins, mirrorPins } from '../lib/pins';
import { providerRows, type ProviderRow } from '../lib/providers';
import { needsYou, sessionRows, timeAgo } from '../lib/session-meta';
import { tabForFile } from '../lib/skills-tabs';
import { ToolbarButton } from '../components/ToolbarButton';
import { UndoStrip, useUndoOffer, type UndoOffer } from '../components/UndoStrip';
import type { NoteRefDTO } from '@qale/ipc';

// Clear the macOS traffic lights in the frameless window (hiddenInset).
const isMac = navigator.userAgent.includes('Macintosh');

/**
 * One row vocabulary for the whole rail (E-11). Five places and a row per
 * connected system, one after the other, and the row for the place you are
 * standing in carries the same accent tint a pinned note does.
 */
const PLACE_ROW =
  'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm font-medium text-sidebar-foreground transition-colors duration-150 hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground motion-reduce:transition-none';

/**
 * A rail place: icon, name, at most one number, at most one thing it can start.
 *
 * Three carry live rows underneath: the sessions in flight, the pinned
 * documents, and each system's pinned mirrors. Those rows never fold away. They
 * are the live work, and a rail that can hide it is a rail you have to remember
 * to unhide.
 */
function PlaceRow({
  icon: Icon,
  label,
  title,
  active,
  onOpen,
  iconClassName,
  badge,
  hint,
  action,
  children,
}: {
  icon: LucideIcon;
  label: string;
  title?: string;
  active?: boolean;
  onOpen: (e: React.MouseEvent) => void;
  iconClassName?: string;
  /** The one number this place carries, already styled by its owner. */
  badge?: React.ReactNode;
  /** Its keyboard path, shown when there is no number to show instead. */
  hint?: string;
  /** The one thing this place can start, sat at the end of the row. */
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li>
      <div className="flex items-center gap-0.5 pr-1">
        <button
          className={PLACE_ROW}
          data-active={active || undefined}
          onClick={onOpen}
          title={title}
        >
          <Icon className={`size-4 ${iconClassName ?? 'text-muted-foreground'}`} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {badge ??
            (hint && <span className="shrink-0 text-xs text-muted-foreground">{hint}</span>)}
        </button>
        {action}
      </div>
      {children && <div className="pt-0.5 pb-1">{children}</div>}
    </li>
  );
}

/**
 * The live session monitor — a kicked-off agent stays visible here until the PO
 * has dealt with it. Running rows spin quietly; rows needing a decision carry the
 * ink-blue dot (the one accent = "action lives here"); finished-and-seen rows
 * keep a check for an hour, then decay off the rail — or leave the moment you
 * unpin them.
 */
function SessionRows({ onUndo }: { onUndo: (a: UndoOffer) => void }) {
  const { sessions, openChat, openChats, askRequests, setSessionLifecycle } = useApp();
  const asking = useMemo(() => new Set(Object.keys(askRequests)), [askRequests]);
  const rows = sessionRows(sessions, asking);
  // Nothing live is its own answer: the Sessions row alone stands in, rather
  // than a row of prose saying so.
  if (rows.length === 0) return null;

  return (
    <ul className="flex flex-col">
      {rows.slice(0, 6).map((s) => {
        const wants = needsYou(s, asking);
        const waitingOnAnswer = asking.has(s.id);
        const reason = waitingOnAnswer
          ? 'question'
          : s.pendingCards > 0
            ? `${s.pendingCards} proposal${s.pendingCards === 1 ? '' : 's'}`
            : s.unread
              ? 'ready'
              : s.running
                ? 'working'
                : // A finished row still owes you the one fact left: how long
                  // ago it landed, so a stale check reads as stale.
                  timeAgo(s.updated);
        return (
          <li key={s.id} className="group/session relative">
            <button
              className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 pl-2 text-left text-dense transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={(e) => openChat({ id: s.id, title: s.title }, navFromEvent(e))}
              title={`${s.title}: ${
                waitingOnAnswer
                  ? 'waiting on your answer'
                  : s.running
                    ? 'running'
                    : wants
                      ? 'needs you'
                      : 'done'
              }`}
            >
              <span className="flex size-3.5 shrink-0 items-center justify-center" aria-hidden>
                {waitingOnAnswer ? (
                  <span className="size-1.5 rounded-full bg-brand" />
                ) : s.running ? (
                  <Spinner className="size-3 text-muted-foreground" />
                ) : wants ? (
                  <span className="size-1.5 rounded-full bg-brand" />
                ) : (
                  <Check className="size-3 text-muted-foreground/80" />
                )}
              </span>
              <span
                className={`truncate ${wants ? 'text-sidebar-foreground' : 'text-muted-foreground'}`}
              >
                {s.title}
              </span>
              {reason && (
                <span
                  className={`ml-auto shrink-0 text-xs tabular-nums ${
                    // The done button takes this corner on hover, so the
                    // status label steps aside rather than sitting under it.
                    s.running
                      ? ''
                      : 'transition-opacity group-hover/session:opacity-0 group-focus-within/session:opacity-0'
                  } ${wants ? 'font-medium text-brand' : 'text-muted-foreground'}`}
                >
                  {reason}
                </span>
              )}
              <span className="sr-only">
                {waitingOnAnswer
                  ? ', waiting on your answer'
                  : s.running
                    ? ', running'
                    : wants
                      ? ', needs you'
                      : ', done'}
              </span>
            </button>
            {/* Same gesture as unpinning a note: the row leaves the rail on
                    one click. A running row has no button — it would keep
                    spinning here either way, so answering it or letting it
                    finish is the only honest next step. */}
            {!s.running && (
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-r-md bg-gradient-to-l from-sidebar-accent from-65% to-transparent pr-1 pl-6 opacity-0 transition-opacity group-hover/session:opacity-100 group-focus-within/session:opacity-100">
                <button
                  className="pointer-events-auto rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
                  disabled={s.pendingCards > 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    void setSessionLifecycle(s.id, 'unpinned');
                    onUndo({
                      label: 'Unpinned',
                      title: s.title,
                      undo: () => void setSessionLifecycle(s.id, 'active'),
                    });
                  }}
                  aria-label={
                    s.pendingCards > 0
                      ? `Decide on its ${s.pendingCards} proposal${s.pendingCards === 1 ? '' : 's'} first`
                      : `Unpin ${s.title}`
                  }
                  title={
                    s.pendingCards > 0
                      ? `Decide on its ${s.pendingCards} proposal${s.pendingCards === 1 ? '' : 's'} first`
                      : 'Unpin: remove from the sidebar (a new message reopens it)'
                  }
                >
                  <X className="size-3" />
                </button>
              </div>
            )}
          </li>
        );
      })}
      {rows.length > 6 && (
        <li>
          <button
            className="flex w-full items-center rounded-md py-1 pr-2 pl-7 text-left text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={(e) => openChats(navFromEvent(e))}
          >
            {rows.length - 6} more →
          </button>
        </li>
      )}
    </ul>
  );
}

/**
 * Memory in the footer, above Activity (docs/memory-placement.md). What Qale
 * knows is the proof the product works, so it stays on screen; it is not the
 * working set, so it stays quiet and holds nothing under it.
 *
 * The one number it carries is the sources nobody has read yet. That count used
 * to be a row per source on the rail, pinned by the app and left there.
 */
function MemoryRow() {
  const { tree, activeTab, openMemory } = useApp();
  const unprocessed = useMemo(() => unprocessedSourceCount(tree), [tree]);
  const active = activeTab?.kind === 'memory';
  return (
    <button
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-dense transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:text-foreground'
      }`}
      onClick={(e) => openMemory(navFromEvent(e))}
      onAuxClick={(e) => e.button === 1 && openMemory(navFromEvent(e))}
      title="Memory: what Qale knows, and where it got it."
    >
      <Library className="size-3.5 shrink-0 text-muted-foreground/80" aria-hidden />
      <span className="min-w-0 flex-1 truncate">Memory</span>
      {unprocessed > 0 && (
        <span
          className="shrink-0 rounded-full bg-brand/15 px-1.5 text-xs font-semibold text-brand"
          title={`${unprocessed} source${unprocessed === 1 ? '' : 's'} nobody has read yet`}
        >
          {unprocessed}
        </span>
      )}
    </button>
  );
}

/**
 * The way into the receipt (E-9): the last thing on the rail, below the scroll.
 *
 * It sat under Sessions until it read as a session, which it is not — a session
 * is work you started, and this is the log of what happened without you. So it
 * moved to the foot of the rail: no pin list can push it out of sight, and it is
 * always here, because a receipt you have to find is not proof of anything.
 * Quieter than the places above it, because it is a fixture, not an eighth
 * surface.
 */
function ActivityRow() {
  const { activeTab, openActivity } = useApp();
  const active = activeTab?.kind === 'activity';
  return (
    <button
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-dense transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:text-foreground'
      }`}
      onClick={(e) => openActivity(navFromEvent(e))}
      onAuxClick={(e) => e.button === 1 && openActivity(navFromEvent(e))}
      title="Activity: what I wrote on my own, newest first. Any of it can be undone."
    >
      <ScrollText className="size-3.5 shrink-0 text-muted-foreground/80" aria-hidden />
      <span className="min-w-0 flex-1 truncate">Activity</span>
    </button>
  );
}

/**
 * One connected system on the rail: Jira, Confluence (docs/memory-placement.md).
 *
 * Qale copies these pages and never edits them, so they are not Memory and they
 * are not Documents. The row is the system's own name, because that is the name
 * the PO already uses for them. No `+`: nothing here is made in Qale.
 */
function ProviderPlaceRow({
  row,
  onUnpin,
}: {
  row: ProviderRow;
  onUnpin: (n: NoteRefDTO) => void;
}) {
  const { tree, favorites, activeTab, openFolder } = useApp();
  const pins = useMemo(() => mirrorPins(tree, favorites, row.dir), [tree, favorites, row.dir]);
  const page = row.kind === 'wikipage' ? 'page' : 'ticket';
  const system = row.kind === 'wikipage' ? 'wiki' : 'tracker';
  // The folder itself, or any mirror inside it: both are this row's place.
  const active =
    (activeTab?.kind === 'folder' && activeTab.dir === row.dir) ||
    (activeTab?.kind === 'doc' && activeTab.path.startsWith(`${row.dir}/`));
  return (
    <PlaceRow
      icon={noteTypeIcon(row.kind)}
      label={row.label}
      title={`${row.label}: what Qale copied from your ${system}. It never edits these. Pinned ${page}s show underneath.`}
      active={active}
      onOpen={(e) => openFolder(row.dir, navFromEvent(e))}
    >
      <PinRows notes={pins} list={row.dir} onUnpin={onUnpin} />
    </PlaceRow>
  );
}

/**
 * One row of the Meetings section (docs/sidebar-ia.md, SB-6): a meeting
 * starting within the day, and nothing else. Its place in the list is the
 * clock's, not the PO's, so it does not drag like a pin — the one choice left
 * is to dismiss this occurrence, which fades it out until it is over.
 */
function MeetingRow({
  note,
  now,
  onDismiss,
}: {
  note: NoteRefDTO;
  now: number;
  onDismiss: (n: NoteRefDTO) => void;
}) {
  const { openDoc, activeTab } = useApp();
  const active = activeTab?.kind === 'doc' && activeTab.path === note.path;
  const openRow = (e: React.MouseEvent) => void openDoc(note.path, navFromEvent(e));
  return (
    <li className="group/meeting relative">
      <button
        className={`flex w-full items-center gap-1.5 rounded-md py-0.5 pr-2 pl-3 text-left text-xs transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
          active
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`}
        onClick={openRow}
        onAuxClick={(e) => e.button === 1 && openRow(e)}
        title={note.title}
      >
        <span className="flex size-3.5 shrink-0 items-center justify-center" aria-hidden>
          <span className="size-1 rounded-full bg-current opacity-50" />
        </span>
        <span className="truncate">{note.title}</span>
        <span
          className="ml-auto shrink-0 pl-2 text-xs tabular-nums text-muted-foreground/80 transition-opacity group-hover/meeting:opacity-0 group-focus-within/meeting:opacity-0"
          aria-hidden
        >
          {sidebarMeetingMeta(note, now)}
        </span>
      </button>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-r-md bg-gradient-to-l from-sidebar-accent from-65% to-transparent pr-1 pl-6 opacity-0 transition-opacity group-hover/meeting:opacity-100 group-focus-within/meeting:opacity-100">
        <button
          className="pointer-events-auto rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(note);
          }}
          aria-label={`Dismiss ${note.title}`}
          title="Dismiss: hide this meeting from the rail until it's over"
        >
          <X className="size-3" />
        </button>
      </div>
    </li>
  );
}

/**
 * The Meetings row's children: up to three, soonest first, or nothing at all
 * — most of the day, that is the honest answer, so the row must be free to
 * show nothing rather than pad itself out to a fixed height.
 */
function MeetingRows({
  notes,
  now,
  onDismiss,
}: {
  notes: NoteRefDTO[];
  now: number;
  onDismiss: (n: NoteRefDTO) => void;
}) {
  if (notes.length === 0) return null;
  return (
    <ul className="flex flex-col">
      {notes.map((n) => (
        <MeetingRow key={n.path} note={n} now={now} onDismiss={onDismiss} />
      ))}
    </ul>
  );
}

/**
 * One pinned row: open it, unpin it, or drag it somewhere else in the list.
 *
 * The row is its own drag source and its own drop target. An insert line says
 * where it would land, above or below the row under the pointer, and the drop
 * moves it there for good.
 */
function PinRow({
  note,
  list,
  onUnpin,
}: {
  note: NoteRefDTO;
  /** The list this row sorts inside. Rows of other lists take no drop here. */
  list: string;
  onUnpin: (n: NoteRefDTO) => void;
}) {
  const { openDoc, activeTab, movePin } = useApp();
  const { ref, dragging, edge } = useReorderableRow(list, note.path, movePin);
  const active = activeTab?.kind === 'doc' && activeTab.path === note.path;
  const openRow = (e: React.MouseEvent) => void openDoc(note.path, navFromEvent(e));
  return (
    <li
      ref={ref}
      data-pin={note.path}
      className={`group/note relative ${dragging ? 'opacity-40' : ''}`}
    >
      {/* Where the row lands if you let go now. */}
      {edge && (
        <span
          className={`pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded-full bg-brand ${
            edge === 'before' ? '-top-px' : '-bottom-px'
          }`}
          aria-hidden
        />
      )}
      <button
        className={`flex w-full items-center gap-1.5 rounded-md py-0.5 pr-2 pl-3 text-left text-xs transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
          active
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`}
        onClick={openRow}
        onAuxClick={(e) => e.button === 1 && openRow(e)}
        title={note.title}
      >
        {/* A subitem marker, smaller than the place row's icon above it,
            so the row reads as one level down rather than a peer. */}
        <span className="flex size-3.5 shrink-0 items-center justify-center" aria-hidden>
          <span className="size-1 rounded-full bg-current opacity-50" />
        </span>
        <span className="truncate">{note.title}</span>
      </button>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-r-md bg-gradient-to-l from-sidebar-accent from-65% to-transparent pr-1 pl-6 opacity-0 transition-opacity group-hover/note:opacity-100 group-focus-within/note:opacity-100">
        <button
          className="pointer-events-auto rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={(e) => {
            e.stopPropagation();
            onUnpin(note);
          }}
          aria-label={`Unpin ${note.title}`}
          title="Unpin: remove from the sidebar"
        >
          <X className="size-3" />
        </button>
      </div>
    </li>
  );
}

/**
 * The pinned rows under a place: one flat list, no sections and no cap
 * (docs/sidebar-ia.md, SB-1). A row under a place is a pinned item of that
 * place. Every row is one type, so no glyph leads it: the place above already
 * says what these are.
 *
 * The order is the PO's: a new pin arrives on top, and a drag puts any row
 * anywhere. Rows only sort inside their own place, so a ticket never lands
 * among the documents.
 *
 * Each row carries one action: the X that unpins it, which leaves the Undo
 * strip at the foot of the rail.
 */
function PinRows({
  notes,
  list,
  onUnpin,
}: {
  notes: NoteRefDTO[];
  list: string;
  onUnpin: (n: NoteRefDTO) => void;
}) {
  // Nothing pinned is its own answer: the place row alone stands in.
  if (notes.length === 0) return null;

  return (
    <ul className="flex flex-col">
      {notes.map((n) => (
        <PinRow key={n.path} note={n} list={list} onUnpin={onUnpin} />
      ))}
    </ul>
  );
}

/** One row of the setup menu: icon · name · the one fact about it, right-aligned. */
function SetupItem({
  icon: Icon,
  label,
  title,
  meta,
  metaTone = 'muted',
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  title: string;
  meta?: string;
  metaTone?: 'muted' | 'warning' | 'destructive';
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <DropdownMenuItem className="gap-2 px-2 py-1.5" onClick={onClick} title={title}>
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      {label}
      {meta && (
        <span
          className={`ml-auto pl-3 text-xs tabular-nums ${
            metaTone === 'destructive'
              ? 'font-medium text-destructive'
              : metaTone === 'warning'
                ? 'font-medium text-warning'
                : 'text-muted-foreground'
          }`}
        >
          {meta}
        </span>
      )}
    </DropdownMenuItem>
  );
}

/**
 * How the app itself is set up, behind the one glyph that has always meant
 * that. Skills are configuration: read once, edited rarely. So they stop
 * holding a permanent shelf at the foot of the rail (where they competed with
 * the working set) and join Settings under the cog. Agents are one of the
 * Skills page's five tabs now (SK-12); the row stays because a blocked agent
 * has to be one click away, and it aims at that tab.
 *
 * Filing them away costs nothing only if a broken one can still shout: a skill
 * with frontmatter errors or an agent that has quietly stopped puts a dot on
 * the cog and spells out why on its row (Nothing silent). Settings keeps ⌘, so
 * the most conventional of the three is still one keystroke, not two clicks.
 */
function SetupMenu() {
  const { skills, agents, openSkills, openSettings } = useApp();
  const skillsToFix = skills.filter((s) => s.errors.length > 0).length;
  // The row counts what is on the Skills tab: work you run. The house rules,
  // the moments and the voices share the page but are not that (SK-12).
  const skillCount = skills.filter((s) => tabForFile(s) === 'skills').length;
  const agentsBlocked = agents.filter((a) => a.status === 'blocked').length;
  // A file that won't parse is an error; an agent waiting on a key is a config
  // gap — the same two voices these states already use on their own pages, so
  // the dot and the row it stands for never disagree about how bad this is.
  const agentsBroken = agents.some((a) => a.errors.length > 0);
  const broken = skillsToFix > 0 || agentsBroken;
  const attention = [
    skillsToFix > 0 ? `${skillsToFix} skill${skillsToFix === 1 ? '' : 's'} to fix` : null,
    agentsBlocked > 0 ? `${agentsBlocked} agent${agentsBlocked === 1 ? '' : 's'} blocked` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={attention ? `Settings: ${attention}` : 'Settings'}
          title={attention ? `Skills, agents, settings: ${attention}` : 'Skills, agents, settings'}
          className="relative ml-auto inline-grid size-7 place-items-center rounded-md text-muted-foreground transition-[color,background-color,transform] duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none active:translate-y-px aria-expanded:bg-accent aria-expanded:text-foreground"
          style={{ WebkitAppRegion: 'no-drag' } as never}
        >
          <Settings className="size-4" aria-hidden />
          {/* Ringed in the rail's own colour so the dot reads as a mark on the
              glyph rather than a speck of the icon. */}
          {attention.length > 0 && (
            <span
              className={`absolute top-0.5 right-0.5 size-1.5 rounded-full ring-2 ring-sidebar ${
                broken ? 'bg-destructive' : 'bg-warning'
              }`}
              aria-hidden
            />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-60 motion-reduce:animate-none"
        aria-label="Skills, agents and settings"
      >
        <SetupItem
          icon={Wand2}
          label="Skills"
          title="Skills: how work you hand over gets done"
          meta={
            skillsToFix > 0 ? `${skillsToFix} to fix` : skillCount > 0 ? `${skillCount}` : undefined
          }
          metaTone={skillsToFix > 0 ? 'destructive' : 'muted'}
          onClick={(e) => openSkills(undefined, navFromEvent(e))}
        />
        <SetupItem
          icon={Bot}
          label="Agents"
          title="Agents: what runs on its own while the app is open, and how to switch it off"
          meta={
            agentsBlocked > 0
              ? `${agentsBlocked} blocked`
              : agents.length > 0
                ? `${agents.length}`
                : undefined
          }
          metaTone={agentsBlocked > 0 ? (agentsBroken ? 'destructive' : 'warning') : 'muted'}
          onClick={(e) => openSkills('agents', navFromEvent(e))}
        />
        <DropdownMenuSeparator />
        <SetupItem
          icon={Settings}
          label="Settings"
          title="Settings: workspace, connections, and who you are"
          meta="⌘,"
          onClick={(e) => openSettings(undefined, navFromEvent(e))}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The one thing a rail row can start, sat at the end of it: quiet until the
 * pointer or the keyboard finds the row.
 */
function RowAction({
  icon: Icon,
  label,
  title,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  title: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      className="inline-grid size-5 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      onClick={onClick}
      title={title}
      aria-label={label}
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
}

/**
 * The left rail: a header of always-available actions (28px hit areas, quiet
 * until hovered) over search, the six places, and a row for each connected
 * system. Under them, on a rule of their own, the two quiet rows: Memory and
 * Activity.
 */
export function Sidebar({
  onSearch,
  onNewNote,
  onIngest,
}: {
  onSearch: () => void;
  onNewNote: () => void;
  onIngest: () => void;
}) {
  const {
    vault,
    activeTab,
    openVaultDialog,
    openSession,
    openHome,
    openTodos,
    openCalendar,
    openDocuments,
    openChats,
    attention,
    waitingCount,
    toggleFavorite,
    tree,
    favorites,
    connections,
    sidebarMeetingDismissed,
    dismissSidebarMeeting,
    undoSidebarMeeting,
  } = useApp();

  // One pin set, split by place: what you write under Documents, and each
  // system's mirrors under that system's own row.
  const docPins = useMemo(() => documentPins(tree, favorites), [tree, favorites]);
  const systems = useMemo(() => providerRows(connections, tree), [connections, tree]);

  // Meetings starting within the day, soonest first (docs/sidebar-ia.md,
  // SB-6). Ages against the same clock the attention list does, so a meeting
  // leaves this row and the "now" state at once, never one before the other.
  const now = useMinuteClock();
  const meetingNotes = useMemo(() => {
    const group = tree?.groups.find((g) => g.type === 'meeting');
    return (group?.notes ?? []).filter((n) => !isFolderIndex(n.path));
  }, [tree]);
  const upcomingMeetings = useMemo(
    () => upcomingSidebarMeetings(meetingNotes, sidebarMeetingDismissed ?? [], now),
    [meetingNotes, sidebarMeetingDismissed, now],
  );

  // Every way of clearing a row off the rail — unpinning a note, marking a
  // session done — is reversible: it leaves a one-tap Undo strip for a few
  // seconds, then quietly settles. (The red toast is errors-only.)
  const { offer: undoable, offerUndo, runUndo } = useUndoOffer();
  const unpinNote = useCallback(
    (n: NoteRefDTO) => {
      toggleFavorite(n.path);
      // Re-pinning is the exact inverse of the unpin.
      offerUndo({ label: 'Unpinned', title: n.title, undo: () => toggleFavorite(n.path) });
    },
    [toggleFavorite, offerUndo],
  );
  const dismissMeeting = useCallback(
    (n: NoteRefDTO) => {
      void dismissSidebarMeeting(n.path);
      offerUndo({
        label: 'Dismissed',
        title: n.title,
        undo: () => void undoSidebarMeeting(n.path),
      });
    },
    [dismissSidebarMeeting, undoSidebarMeeting, offerUndo],
  );

  // Both badges (Sessions, Todos) are filters over the one attention list,
  // never their own sums.
  const todosDue = countOf(attention, 'todo');

  return (
    <div className="flex h-full flex-col">
      <div
        className={`flex h-10 shrink-0 items-center gap-0.5 pr-1.5 ${isMac ? 'pl-[70px]' : 'pl-1.5'}`}
        style={{ WebkitAppRegion: 'drag' } as never}
      >
        {vault && (
          <>
            <ToolbarButton
              label="New document"
              keys={['⌘', 'N']}
              icon={SquarePen}
              onClick={onNewNote}
            />
            <ToolbarButton
              label="Add source"
              keys={['⇧', '⌘', 'N']}
              icon={FileUp}
              onClick={onIngest}
            />
          </>
        )}
        {/* The one door to how the app is set up — skills, agents, settings. */}
        <SetupMenu />
      </div>

      {vault && (
        <div className="px-2 pb-1.5">
          <button
            className="flex h-8 w-full items-center gap-2 rounded-lg border border-sidebar-border bg-card/50 px-2.5 text-dense text-muted-foreground transition-colors duration-150 hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={onSearch}
          >
            <Search className="size-3.5 shrink-0" aria-hidden />
            Search
            <span className="ml-auto text-xs tabular-nums">⌘K</span>
          </button>
        </div>
      )}

      {!vault ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <FolderOpen className="size-6 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">No workspace open.</p>
          <Button variant="outline" size="sm" onClick={openVaultDialog}>
            Open workspace…
          </Button>
        </div>
      ) : (
        <>
          {/* The three places that never move. They sit above the scroll so a
              busy week of sessions can never push Home out of reach. */}
          <ul className="flex flex-col gap-0.5 border-b border-sidebar-border px-2 pb-1.5">
            {/* Home leads: it is the one row every other place is reachable
                from, and the only one with two keyboard paths (⇧⌘H here, ⌘T for
                a fresh tab). */}
            <PlaceRow
              icon={House}
              label="Home"
              hint="⇧⌘H"
              title="Home: what's waiting on you, and everything you can start"
              // An empty workbench IS Home (App's Center falls back to it), so
              // the row is lit then too — never a screen you're on with nothing
              // marked.
              active={activeTab?.kind === 'home' || !activeTab}
              onOpen={(e) => openHome(navFromEvent(e))}
            />
            <PlaceRow
              icon={CalendarDays}
              label="Calendar"
              title="Calendar: what is coming, and what happened"
              active={activeTab?.kind === 'calendar'}
              onOpen={(e) => openCalendar(navFromEvent(e))}
            />
            {/* Meetings starting within the day, up to three (docs/sidebar-ia.md,
                SB-6). Not a place of its own — Calendar stays the one home for
                every meeting — so the row carries no accent tint and shows
                nothing at all once the day is clear. */}
            {upcomingMeetings.length > 0 && (
              <PlaceRow
                icon={Clock}
                label="Meetings"
                title="Meetings: what's starting within the day"
                onOpen={(e) => openCalendar(navFromEvent(e))}
              >
                <MeetingRows notes={upcomingMeetings} now={now} onDismiss={dismissMeeting} />
              </PlaceRow>
            )}
            <PlaceRow
              icon={ListTodo}
              label="Todos"
              title="Todos: what you owe, and what you are waiting on"
              active={activeTab?.kind === 'todos'}
              onOpen={(e) => openTodos(navFromEvent(e))}
              badge={
                todosDue > 0 ? (
                  <span className="shrink-0 rounded-full bg-warning/15 px-1.5 text-xs font-semibold text-warning">
                    {todosDue} due
                  </span>
                ) : undefined
              }
            />
          </ul>

          {/* The two that carry live rows under them. They scroll, because
              what hangs off them has no fixed height. */}
          <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
            <PlaceRow
              icon={History}
              label="Sessions"
              title="Sessions: what's waiting on you, running, and finished"
              active={activeTab?.kind === 'chats'}
              onOpen={(e) => openChats(navFromEvent(e))}
              // The accent means "something is waiting" — nothing waiting keeps
              // the glyph muted like its neighbours (The Inactive-Never-Accent
              // Rule). No count here: the rows underneath already say what is
              // waiting and how many — a badge on top of them would only repeat it.
              iconClassName={waitingCount > 0 ? 'text-brand' : undefined}
              action={
                <RowAction
                  icon={Plus}
                  label="New session"
                  title="New session (⌘↵): ask a question, or hand over a piece of work"
                  onClick={(e) => openSession('ask', navFromEvent(e))}
                />
              }
            >
              <SessionRows onUndo={offerUndo} />
            </PlaceRow>
            <PlaceRow
              icon={Files}
              label="Documents"
              title="Documents: what you write. Pinned documents show underneath."
              active={activeTab?.kind === 'documents'}
              onOpen={(e) => openDocuments('', navFromEvent(e))}
              action={
                <RowAction
                  icon={Plus}
                  label="New document"
                  title="New document (⌘N): a blank page, named as you type"
                  onClick={onNewNote}
                />
              }
            >
              <PinRows notes={docPins} list="documents" onUnpin={unpinNote} />
            </PlaceRow>
            {/* Then the systems Qale reads, one row each, in name order. They
                come and go with the connections, so nothing is here to explain
                itself on a workspace that has none. */}
            {systems.map((row) => (
              <ProviderPlaceRow key={row.dir} row={row} onUnpin={unpinNote} />
            ))}
          </ul>

          {/* Below the scroll, on a rule of its own: what Qale knows, and the
              log of what it did while nobody was watching. Last, and always in
              view. */}
          <div className="flex flex-col gap-0.5 border-t border-sidebar-border px-2 py-1.5">
            <MemoryRow />
            <ActivityRow />
          </div>

          <UndoStrip offer={undoable} onUndo={runUndo} className="mx-2 mb-1.5" />
        </>
      )}
    </div>
  );
}
