import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isFolderIndex,
  dirForType,
  layerForType,
  noteTypeLabel,
  HAND_CREATABLE_TYPES,
  NEW_NOTE_PURPOSE,
} from '@qale/domain';
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
  Sparkles,
  Check,
  Wand2,
  Bot,
  X,
  FileUp,
  House,
  Search,
  Settings,
  SquarePen,
  Inbox,
  ChevronRight,
  ListTodo,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import { useApp, type SessionOverview } from '../state/app-state';
import { countOf } from '../lib/attention';
import { navFromEvent } from '../lib/nav';
import { useNewNote } from '../lib/new-note';
import { noteTypeIcon } from '../lib/note-icons';
import { timeAgo } from '../lib/session-meta';
import { ToolbarButton } from '../components/ToolbarButton';
import {
  byRecent,
  isUpcomingMeeting,
  meetingMeta,
  meetingStart,
  needsReview,
} from '../lib/note-status';
import type { NoteRefDTO, NoteType, VaultTreeGroupDTO } from '@qale/ipc';

// Clear the macOS traffic lights in the frameless window (hiddenInset).
const isMac = navigator.userAgent.includes('Macintosh');

/** One cleared row, and the way back: what the Undo strip at the foot of the rail shows. */
type UndoOffer = { label: string; title: string; undo: () => void };

/**
 * `asking` is the set of sessions parked on a question card. It counts as
 * needing the PO even though the run is technically still going: a turn that
 * asked something and got no answer looks exactly like a turn that is working,
 * and the difference is that this one will wait forever.
 */
const needsYou = (s: SessionOverview, asking?: ReadonlySet<string>): boolean =>
  s.pendingCards > 0 || s.unread || !!asking?.has(s.id);

/** Rows the Sessions rail shows: in flight, needing the PO, or finished within the hour. */
function sessionRows(sessions: SessionOverview[], asking: ReadonlySet<string>): SessionOverview[] {
  const cutoff = Date.now() - 60 * 60 * 1000;
  return sessions
    .filter(
      (s) => s.running || (s.lifecycle === 'active' && (needsYou(s, asking) || s.updated > cutoff)),
    )
    .sort((a, b) => {
      // A question outranks a running row: it is the only one that can't finish
      // on its own.
      if (asking.has(a.id) !== asking.has(b.id)) return asking.has(a.id) ? -1 : 1;
      if (a.running !== b.running) return a.running ? -1 : 1;
      if (needsYou(a, asking) !== needsYou(b, asking)) return needsYou(a, asking) ? -1 : 1;
      return b.updated - a.updated;
    });
}

/** Disclosure state for one type's pins, remembered across launches. */
function useSection(id: string, defaultOpen: boolean): [boolean, () => void] {
  const key = `qale.sidebar.${id}`;
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v == null ? defaultOpen : v === '1';
    } catch {
      return defaultOpen;
    }
  });
  const toggle = () => {
    setOpen((o) => {
      const next = !o;
      try {
        localStorage.setItem(key, next ? '1' : '0');
      } catch {
        /* ignore quota */
      }
      return next;
    });
  };
  return [open, toggle];
}

/**
 * A sidebar group: a quiet header row over its rows. The header never folds the
 * body away — these two sections carry the live work, and a rail that can hide
 * it is a rail you have to remember to unhide. The header is the way into the
 * full page instead, so the label does the job the old "All" button did.
 */
function Section({
  label,
  title,
  onOpen,
  action,
  children,
}: {
  label: string;
  title: string;
  onOpen: (e: React.MouseEvent) => void;
  /** The one thing this section can start, sat at the end of its header row. */
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-2 pt-1">
      <div className="flex items-center pr-1">
        <button
          className="flex flex-1 items-center rounded-md px-1 py-0.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={onOpen}
          title={title}
        >
          <span className="uppercase tracking-wide">{label}</span>
        </button>
        {action}
      </div>
      <div className="pt-0.5 pb-0.5">{children}</div>
    </div>
  );
}

/**
 * The live session monitor — a kicked-off agent stays visible here until the PO
 * has dealt with it. Running rows spin quietly; rows needing a decision carry the
 * ink-blue dot (the one accent = "action lives here"); finished-and-seen rows
 * keep a check for an hour, then decay off the rail — or leave the moment you
 * mark them done, which is the sessions' answer to unpinning a note.
 */
function SessionsSection({ onUndo }: { onUndo: (a: UndoOffer) => void }) {
  const { sessions, openChat, openChats, askRequests, setSessionLifecycle } = useApp();
  const asking = useMemo(() => new Set(Object.keys(askRequests)), [askRequests]);
  const rows = sessionRows(sessions, asking);

  return (
    <Section
      label="Sessions"
      title="All sessions: running, waiting on you, and finished"
      onOpen={(e) => openChats(navFromEvent(e))}
    >
      {/* Nothing live is its own answer: the header alone stands in, rather than a
          row of prose saying so. */}
      {rows.length > 0 && (
        <ul className="flex flex-col">
          {rows.slice(0, 6).map((s) => {
            const wants = needsYou(s, asking);
            const waitingOnAnswer = asking.has(s.id);
            const reason = waitingOnAnswer
              ? 'question'
              : s.pendingCards > 0
                ? `${s.pendingCards} card${s.pendingCards === 1 ? '' : 's'}`
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
                {/* Same gesture as unpinning a note: the row you are done with
                    leaves the rail on one click. A running row has no button —
                    it would keep spinning here either way, so answering it or
                    letting it finish is the only honest next step. */}
                {!s.running && (
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-r-md bg-gradient-to-l from-sidebar-accent from-65% to-transparent pr-1 pl-6 opacity-0 transition-opacity group-hover/session:opacity-100 group-focus-within/session:opacity-100">
                    <button
                      className="pointer-events-auto rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                      onClick={(e) => {
                        e.stopPropagation();
                        void setSessionLifecycle(s.id, 'done');
                        onUndo({
                          label: 'Marked done',
                          title: s.title,
                          undo: () => void setSessionLifecycle(s.id, 'active'),
                        });
                      }}
                      aria-label={`Mark ${s.title} done`}
                      title="Mark done: remove from the sidebar (a new message reopens it)"
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
      )}
    </Section>
  );
}

/**
 * How a type's pins order on the rail. Meetings read best upcoming-first (soonest
 * on top) with the rest trailing by recency; every other type is simply
 * most-recently-relevant first — the note you touched last is the one you want.
 */
function railOrder(notes: NoteRefDTO[], type: NoteType): NoteRefDTO[] {
  if (type !== 'meeting') return [...notes].sort(byRecent);
  const upcoming = notes
    .filter((n) => isUpcomingMeeting(n))
    .sort((a, b) => meetingStart(a) - meetingStart(b));
  const rest = notes.filter((n) => !isUpcomingMeeting(n)).sort(byRecent);
  return [...upcoming, ...rest];
}

/**
 * One type's pins. The header name browses the whole folder; the chevron folds the
 * list away. The rail shows exactly what's pinned for this type — no ranking it
 * away, no cap, no "N more". Each row carries one action: the X that unpins it.
 */
function TypeSection({
  group,
  onUnpin,
  onNewNote,
  onIngest,
}: {
  group: VaultTreeGroupDTO;
  onUnpin: (n: NoteRefDTO) => void;
  onNewNote?: () => void;
  onIngest?: () => void;
}) {
  const { openFolder, openDoc, activeTab, favorites, autoPinNew, markPinSeen } = useApp();
  const [open, toggle] = useSection(`type.${group.type}`, true);
  const notes = useMemo(() => {
    const pinned = new Set(favorites);
    return railOrder(
      group.notes.filter((n) => pinned.has(n.path) && !isFolderIndex(n.path)),
      group.type,
    );
  }, [group, favorites]);
  const isNote = group.type === 'note';
  // The transcript invitation only shows while the memory holds no meetings at
  // all — "meetings exist but none pinned" gets the honest placeholder instead.
  const inviteTranscript =
    group.type === 'meeting' && !group.notes.some((n) => !isFolderIndex(n.path));
  const Icon = noteTypeIcon(group.type);
  const folderActive = activeTab?.kind === 'folder' && activeTab.dir === group.dir;
  // A section with nothing under it keeps its label (the browse affordance) but
  // drops the chevron: no disclosure that discloses nothing.
  const hasBody = notes.length > 0 || isNote || inviteTranscript;
  const expanded = open && hasBody;

  return (
    <li>
      <div className="group/row flex items-center gap-0.5 pr-1">
        <button
          className="shrink-0 rounded p-0.5 text-muted-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={toggle}
          aria-expanded={hasBody ? expanded : undefined}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${group.dir}`}
          disabled={!hasBody}
        >
          <ChevronRight
            className={`size-3 transition-transform duration-150 motion-reduce:transition-none ${
              expanded ? 'rotate-90' : ''
            } ${hasBody ? '' : 'opacity-0'}`}
          />
        </button>
        {/* A group label, not a row: quieter and smaller than the notes under it,
            so the eye chunks the tree by section instead of reading one flat list. */}
        <button
          className={`flex flex-1 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-xs font-medium capitalize transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
            folderActive
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-muted-foreground'
          }`}
          onClick={(e) => openFolder(group.dir, navFromEvent(e))}
          title={`Browse all ${group.dir}`}
        >
          <Icon className="size-3.5 shrink-0 text-muted-foreground/80" aria-hidden />
          <span className="flex-1 truncate">{group.dir}</span>
          {/* Folding a section costs you the rows, never the count. */}
          {!expanded && notes.length > 0 && (
            <span className="shrink-0 tabular-nums text-muted-foreground">{notes.length}</span>
          )}
        </button>
      </div>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden" inert={!expanded ? true : undefined}>
          <ul className="flex flex-col pb-0.5">
            {notes.length === 0 ? (
              isNote ? (
                // The scratch pad is always on the rail — an empty one invites the
                // first jot rather than sitting blank.
                <li>
                  <button
                    className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 pl-[30px] text-left text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    onClick={onNewNote}
                    title="Start a note (⌘N)"
                  >
                    <SquarePen className="size-3 shrink-0 text-muted-foreground/80" aria-hidden />
                    <span className="truncate">Jot something down</span>
                    <span className="ml-auto shrink-0 text-muted-foreground">⌘N</span>
                  </button>
                </li>
              ) : inviteTranscript ? (
                // Meetings are the memory's front door — an empty section IS the
                // day-one state, so it invites the first transcript.
                <li>
                  <button
                    className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 pl-[30px] text-left text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    onClick={onIngest}
                    title="Drop a transcript (⇧⌘N): any meeting you already have"
                  >
                    <FileUp className="size-3 shrink-0 text-muted-foreground/80" aria-hidden />
                    <span className="truncate">Drop a transcript</span>
                    <span className="ml-auto shrink-0 text-muted-foreground">⇧⌘N</span>
                  </button>
                </li>
              ) : // Meetings exist but none are pinned: the header alone is the
              // browse affordance — no placeholder row (pinned-only rail).
              null
            ) : (
              notes.map((n) => {
                const activeNote = activeTab?.kind === 'doc' && activeTab.path === n.path;
                // A row the system pinned on its own, not yet opened from here.
                const newPin = autoPinNew.has(n.path);
                const openRow = (e: React.MouseEvent) => {
                  if (newPin) markPinSeen(n.path);
                  void openDoc(n.path, navFromEvent(e));
                };
                return (
                  <li key={n.path} className="group/note relative">
                    <button
                      className={`flex w-full items-center gap-2 rounded-md py-1 pr-2 pl-[30px] text-left text-dense transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
                        activeNote
                          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                          : 'text-sidebar-foreground'
                      }`}
                      onClick={openRow}
                      onAuxClick={(e) => e.button === 1 && openRow(e)}
                      title={n.title}
                    >
                      <span className="truncate">{n.title}</span>
                      {/* The rail added this itself, so it says so — once. Anchored
                          in the indent gutter so every badge shares one column
                          instead of trailing titles of different lengths. */}
                      {newPin && (
                        <>
                          <span
                            className="absolute top-1/2 left-[18px] size-1.5 -translate-y-1/2 rounded-full bg-brand"
                            title="Pinned for you, not opened yet"
                            aria-hidden
                          />
                          <span className="sr-only">, newly pinned for you</span>
                        </>
                      )}
                      {group.type === 'meeting' && needsReview(n) && (
                        <span
                          className="size-1.5 shrink-0 rounded-full bg-warning transition-opacity group-hover/note:opacity-0 group-focus-within/note:opacity-0"
                          title="Happened, not read yet"
                          aria-label="Awaiting review"
                        />
                      )}
                      {group.type === 'meeting' && (
                        <span
                          className={`ml-auto shrink-0 text-xs tabular-nums transition-opacity group-hover/note:opacity-0 group-focus-within/note:opacity-0 ${
                            isUpcomingMeeting(n)
                              ? 'font-medium text-brand'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {meetingMeta(n)}
                        </span>
                      )}
                    </button>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-r-md bg-gradient-to-l from-sidebar-accent from-65% to-transparent pr-1 pl-6 opacity-0 transition-opacity group-hover/note:opacity-100 group-focus-within/note:opacity-100">
                      <button
                        className="pointer-events-auto rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUnpin(n);
                        }}
                        aria-label={`Unpin ${n.title}`}
                        title="Unpin: remove from the sidebar"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      </div>
    </li>
  );
}

/**
 * The core rail — always present, even empty, because they carry the day-one
 * invitations: meetings (drop a transcript) and notes (the scratch pad).
 */
const CORE_RAIL: readonly NoteType[] = ['meeting', 'note'];

/**
 * Preferred ordering for pin-holding sections — the between-meetings working
 * set first (tickets, decisions, themes), anything else after.
 */
const RAIL_ORDER: readonly NoteType[] = ['meeting', 'note', 'ticket', 'decision', 'theme'];

/**
 * The "+" on the Memory header: start a page of any type the PM authors,
 * without first finding the shelf it belongs on.
 *
 * A menu rather than four rows, because only one of the four (a note) is a
 * daily thing — and ⌘N already covers that one. The rail stays the working set;
 * this is the door to the rest of the ceiling, one click deep. Each row says
 * what the type is for, so the choice is about the work rather than about our
 * vocabulary.
 */
function NewNoteMenu() {
  const { create, busy } = useNewNote();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-grid size-5 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none aria-expanded:bg-sidebar-accent aria-expanded:text-foreground disabled:opacity-50"
          title="Start a new page: note, theme, customer, person"
          aria-label="New page"
          disabled={busy}
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-72 motion-reduce:animate-none">
        {HAND_CREATABLE_TYPES.map((type) => {
          const Icon = noteTypeIcon(type);
          return (
            <DropdownMenuItem
              key={type}
              className="gap-2 px-2 py-1.5"
              onClick={() => void create(type)}
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0">
                <span className="block">New {noteTypeLabel(type).toLowerCase()}</span>
                <span className="block text-xs text-muted-foreground">
                  {NEW_NOTE_PURPOSE[type]}
                </span>
              </span>
              {type === 'note' && <span className="ml-auto pl-3 text-xs text-muted-foreground">⌘N</span>}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The rail: the two core sections always, plus a section for any type that
 * currently holds a pin — which vanishes with its last pin. No placeholders:
 * anything in the sidebar IS pinned, so an unpinned category has no row here
 * (its home is the Memory page). Skills/todos keep their first-class homes.
 */
function MemoryTree({
  onUnpin,
  onNewNote,
  onIngest,
}: {
  onUnpin: (n: NoteRefDTO) => void;
  onNewNote: () => void;
  onIngest: () => void;
}) {
  const { tree, favorites, openMemory } = useApp();
  const groups = useMemo(() => {
    const byType = new Map<NoteType, VaultTreeGroupDTO>();
    for (const g of tree?.groups ?? []) byType.set(g.type, g);
    const core = CORE_RAIL.map(
      (t) => byType.get(t) ?? { dir: dirForType(t), type: t, layer: layerForType(t), notes: [] },
    );
    const pinned = new Set(favorites);
    const rest = (tree?.groups ?? []).filter(
      (g) =>
        !CORE_RAIL.includes(g.type) &&
        g.type !== 'skill' &&
        g.type !== 'agent' &&
        g.type !== 'todo' &&
        g.notes.some((n) => pinned.has(n.path) && !isFolderIndex(n.path)),
    );
    const rank = (t: NoteType): number => {
      const i = RAIL_ORDER.indexOf(t);
      return i === -1 ? RAIL_ORDER.length : i;
    };
    rest.sort((a, b) => rank(a.type) - rank(b.type) || a.dir.localeCompare(b.dir));
    return [...core, ...rest];
  }, [tree, favorites]);
  if (!tree) return null;
  return (
    <Section
      label="Memory"
      title="The whole memory: sources, insights, customers, people, notes"
      onOpen={(e) => openMemory(navFromEvent(e))}
      action={<NewNoteMenu />}
    >
      <ul className="flex flex-col gap-1">
        {groups.map((g) => (
          <TypeSection
            key={g.dir}
            group={g}
            onUnpin={onUnpin}
            onNewNote={onNewNote}
            onIngest={onIngest}
          />
        ))}
      </ul>
    </Section>
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
 * that. Skills and Agents are configuration — read once, edited rarely — so
 * they stop holding a permanent shelf at the foot of the rail (where they
 * competed with the working set) and join Settings under the cog.
 *
 * Filing them away costs nothing only if a broken one can still shout: a skill
 * with frontmatter errors or an agent that has quietly stopped puts a dot on
 * the cog and spells out why on its row (Nothing silent). Settings keeps ⌘, so
 * the most conventional of the three is still one keystroke, not two clicks.
 */
function SetupMenu() {
  const { skills, agents, openSkills, openAgents, openSettings } = useApp();
  const skillsToFix = skills.filter((s) => s.errors.length > 0).length;
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
          title="Skills: how work you hand over gets done, from playbooks to always-on rules to reference"
          meta={
            skillsToFix > 0
              ? `${skillsToFix} to fix`
              : skills.length > 0
                ? `${skills.length}`
                : undefined
          }
          metaTone={skillsToFix > 0 ? 'destructive' : 'muted'}
          onClick={(e) => openSkills(navFromEvent(e))}
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
          onClick={(e) => openAgents(navFromEvent(e))}
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
 * The fixed places above the memory tree — Home, Inbox, Todos, New session. One row
 * vocabulary so the cluster reads as a single group, and the row for the place
 * you are standing in carries the same accent tint a pinned note does.
 */
const PLACE_ROW =
  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm font-medium text-sidebar-foreground transition-colors duration-150 hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground motion-reduce:transition-none';

/**
 * The left rail: a header of always-available actions (28px hit areas, quiet
 * until hovered) over search, the destinations, the live sessions, and the
 * memory tree. Nothing below the tree — the rail ends where the work does.
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
    openInbox,
    openTodos,
    attention,
    waitingCount,
    toggleFavorite,
  } = useApp();

  // Every way of clearing a row off the rail — unpinning a note, marking a
  // session done — is reversible: it leaves a one-tap Undo strip for a few
  // seconds, then quietly settles. (The red toast is errors-only.)
  const [undoable, setUndoable] = useState<UndoOffer | null>(null);
  const undoTimer = useRef<number | null>(null);
  useEffect(() => () => void (undoTimer.current && window.clearTimeout(undoTimer.current)), []);
  const offerUndo = useCallback((offer: UndoOffer) => {
    setUndoable(offer);
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndoable(null), 6000);
  }, []);
  const unpinNote = useCallback(
    (n: NoteRefDTO) => {
      toggleFavorite(n.path);
      // Re-pinning is the exact inverse of the unpin.
      offerUndo({ label: 'Unpinned', title: n.title, undo: () => toggleFavorite(n.path) });
    },
    [toggleFavorite, offerUndo],
  );
  const runUndo = useCallback(() => {
    undoable?.undo();
    setUndoable(null);
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
  }, [undoable]);

  // Both badges are filters over the one attention list — never their own sums.
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
              label="New note"
              keys={['⌘', 'N']}
              icon={SquarePen}
              onClick={onNewNote}
            />
            <ToolbarButton
              label="Add material"
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

      {vault && (
        <div className="flex flex-col gap-0.5 px-2 pb-1.5">
          {/* Home leads the cluster: it is the one row every other destination is
              reachable from, and the only one with two keyboard paths (⇧⌘H here,
              ⌘T for a fresh tab). */}
          <button
            className={PLACE_ROW}
            // An empty workbench IS Home (App's Center falls back to it), so the
            // row is lit then too — never a screen you're on with nothing marked.
            data-active={activeTab?.kind === 'home' || !activeTab || undefined}
            onClick={(e) => openHome(navFromEvent(e))}
            title="Home: what's waiting on you, and everything you can start"
          >
            <House className="size-4 text-muted-foreground" aria-hidden />
            Home
            <span className="ml-auto text-xs text-muted-foreground">⇧⌘H</span>
          </button>
          <button
            className={PLACE_ROW}
            data-active={activeTab?.kind === 'inbox' || undefined}
            onClick={(e) => openInbox(navFromEvent(e))}
          >
            {/* The accent means "something is waiting" — an empty queue keeps the
                glyph muted like its neighbours (The Inactive-Never-Accent Rule). */}
            <Inbox
              className={`size-4 ${waitingCount > 0 ? 'text-brand' : 'text-muted-foreground'}`}
              aria-hidden
            />
            Inbox
            {waitingCount > 0 && (
              <span className="ml-auto rounded-full bg-brand/15 px-1.5 text-xs font-semibold text-brand">
                {waitingCount}
              </span>
            )}
          </button>
          <button
            className={PLACE_ROW}
            data-active={activeTab?.kind === 'todos' || undefined}
            onClick={(e) => openTodos(navFromEvent(e))}
          >
            <ListTodo className="size-4 text-muted-foreground" aria-hidden />
            Todos
            {todosDue > 0 && (
              <span className="ml-auto rounded-full bg-warning/15 px-1.5 text-xs font-semibold text-warning">
                {todosDue} due
              </span>
            )}
          </button>
          {/* "Ask" named a place after a verb, next to a Sessions rail full of
              the same thing. The row starts a session; it says so. */}
          <button
            className={PLACE_ROW}
            onClick={(e) => openSession('ask', navFromEvent(e))}
            title="Start a session: ask the memory a question, or hand it a piece of work"
          >
            <Sparkles className="size-4 text-muted-foreground" aria-hidden />
            New session
            <span className="ml-auto text-xs text-muted-foreground">⌘↵</span>
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
          <div className="flex-1 overflow-y-auto pb-2">
            <SessionsSection onUndo={offerUndo} />
            {/* Day one teaches itself: the Meetings and Notes sections carry their
                own invitations, so no extra empty-workspace paragraph. */}
            <MemoryTree onUnpin={unpinNote} onNewNote={onNewNote} onIngest={onIngest} />
          </div>

          {undoable && (
            <div
              role="status"
              className="mx-2 mb-1.5 flex items-center gap-2 rounded-lg border border-sidebar-border bg-card/70 px-2.5 py-1.5 text-xs text-muted-foreground"
            >
              <Check className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                {undoable.label} <span className="text-foreground">{undoable.title}</span>
              </span>
              <button
                className="shrink-0 rounded px-1 font-medium text-brand transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={runUndo}
              >
                Undo
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
