import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isFolderIndex, dirForType, layerForType } from '@pm/domain';
import { Button, Spinner } from '@pm/ui';
import {
  FolderOpen,
  Sparkles,
  Check,
  Wand2,
  X,
  FileUp,
  Search,
  Settings,
  SquarePen,
  Inbox,
  ChevronRight,
  ListTodo,
} from 'lucide-react';
import { useApp, type SessionOverview } from '../state/app-state';
import { navFromEvent } from '../lib/nav';
import { localDateStr } from '../lib/dates';
import { noteTypeIcon } from '../lib/note-icons';
import { ToolbarButton } from '../components/ToolbarButton';
import {
  byRecent,
  isUpcomingMeeting,
  meetingMeta,
  meetingStart,
  needsReview,
} from '../lib/note-status';
import type { NoteRefDTO, NoteType, VaultTreeGroupDTO } from '@pm/ipc';

// Clear the macOS traffic lights in the frameless window (hiddenInset).
const isMac = navigator.userAgent.includes('Macintosh');

const needsYou = (s: SessionOverview): boolean => s.pendingCards > 0 || s.unread;

/** Rows the Activity monitor shows: in flight, needing the PO, or finished within the hour. */
function activityRows(sessions: SessionOverview[]): SessionOverview[] {
  const cutoff = Date.now() - 60 * 60 * 1000;
  return sessions
    .filter((s) => s.running || (s.lifecycle === 'active' && (needsYou(s) || s.updated > cutoff)))
    .sort((a, b) => {
      if (a.running !== b.running) return a.running ? -1 : 1;
      if (needsYou(a) !== needsYou(b)) return needsYou(a) ? -1 : 1;
      return b.updated - a.updated;
    });
}

/** Sidebar disclosure state, remembered across launches (per section, app-wide). */
function useSection(id: string, defaultOpen: boolean): [boolean, () => void] {
  const key = `pm.sidebar.${id}`;
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
 * A collapsible sidebar group: a quiet header row (label · count · chevron) over
 * an animated body. `locked` forces it open and hides the chevron — used when the
 * section holds something that needs the PO (nothing that needs you should hide).
 */
function Section({
  label,
  count,
  countTone = 'muted',
  open,
  onToggle,
  locked,
  action,
  children,
}: {
  label: string;
  count?: number;
  countTone?: 'muted' | 'brand';
  open: boolean;
  onToggle: () => void;
  locked?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const expanded = open || !!locked;
  return (
    <div className="px-2 pt-1">
      <div className="group/head flex items-center gap-1 pr-1">
        <button
          className="flex flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-left text-xs font-medium text-muted-foreground/80 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={locked ? undefined : onToggle}
          aria-expanded={expanded}
          disabled={locked}
        >
          <ChevronRight
            className={`size-3 shrink-0 text-muted-foreground/60 transition-transform duration-150 motion-reduce:transition-none ${
              expanded ? 'rotate-90' : ''
            } ${locked ? 'opacity-0' : ''}`}
            aria-hidden
          />
          <span className="uppercase tracking-wide">{label}</span>
          {count != null && count > 0 && (
            <span
              className={`ml-1 rounded-full px-1.5 text-xs font-semibold tabular-nums ${
                countTone === 'brand' ? 'bg-brand/15 text-brand' : 'text-muted-foreground'
              }`}
            >
              {count}
            </span>
          )}
        </button>
        {action}
      </div>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden" inert={!expanded ? true : undefined}>
          <div className="pt-0.5 pb-0.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * The live session monitor — a kicked-off agent stays visible here until the PO
 * has dealt with it. Running rows spin quietly; rows needing a decision carry the
 * terracotta dot (the one accent = "action lives here"); finished-and-seen rows
 * keep a check for an hour, then decay off the rail.
 */
function ActivitySection() {
  const { sessions, openChat, openChats } = useApp();
  const rows = activityRows(sessions);
  const attention = rows.filter(needsYou).length;
  const [open, toggle] = useSection('activity', true);
  // Nothing that needs the PO is ever allowed to hide.
  const locked = attention > 0;

  return (
    <Section
      label="Activity"
      open={open}
      onToggle={toggle}
      locked={locked}
      action={
        <button
          className="rounded px-1.5 py-0.5 text-xs text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={() => openChats()}
          title="All sessions — running, waiting on you, and past conversations"
        >
          All
        </button>
      }
    >
      {rows.length === 0 ? (
        <p className="px-2 py-1 text-[13px] text-muted-foreground">Nothing running.</p>
      ) : (
        <ul className="flex flex-col">
          {rows.slice(0, 6).map((s) => {
            const wants = needsYou(s);
            const reason =
              s.pendingCards > 0
                ? `${s.pendingCards} card${s.pendingCards === 1 ? '' : 's'}`
                : s.unread
                  ? s.sessionType === 'ask'
                    ? 'answered'
                    : 'ready'
                  : s.running
                    ? 'working'
                    : null;
            return (
              <li key={s.id}>
                <button
                  className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 pl-2 text-left text-[13px] transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  onClick={(e) => openChat({ id: s.id, sessionType: s.sessionType, title: s.title }, navFromEvent(e))}
                  title={`${s.title} — ${s.running ? 'running' : wants ? 'needs you' : 'done'}`}
                >
                  <span className="flex size-3.5 shrink-0 items-center justify-center" aria-hidden>
                    {s.running ? (
                      <Spinner className="size-3 text-muted-foreground" />
                    ) : wants ? (
                      <span className="size-1.5 rounded-full bg-brand" />
                    ) : (
                      <Check className="size-3 text-muted-foreground/70" />
                    )}
                  </span>
                  <span className={`truncate ${wants ? 'text-sidebar-foreground' : 'text-muted-foreground'}`}>
                    {s.title}
                  </span>
                  {reason && (
                    <span
                      className={`ml-auto shrink-0 text-xs tabular-nums ${
                        wants ? 'font-medium text-brand' : 'text-muted-foreground'
                      }`}
                    >
                      {reason}
                    </span>
                  )}
                  <span className="sr-only">
                    {s.running ? ', running' : wants ? ', needs you' : ', done'}
                  </span>
                </button>
              </li>
            );
          })}
          {rows.length > 6 && (
            <li>
              <button
                className="flex w-full items-center rounded-md py-1 pr-2 pl-7 text-left text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={() => openChats()}
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
  const upcoming = notes.filter(isUpcomingMeeting).sort((a, b) => meetingStart(a) - meetingStart(b));
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
  const { openFolder, openDoc, activeTab, favorites, revealNew, markRevealSeen } = useApp();
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
  // A section the memory just earned: it announces itself once, quietly, and
  // any interaction with it counts as "seen".
  const isNew = revealNew.has(group.type);
  const acknowledge = () => isNew && markRevealSeen(group.type);

  return (
    <li>
      <div className="group/row flex items-center gap-0.5 pr-1">
        <button
          className="shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={() => {
            acknowledge();
            toggle();
          }}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${group.dir}`}
        >
          <ChevronRight
            className={`size-3 transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
          />
        </button>
        {/* A group label, not a row: quieter and smaller than the notes under it,
            so the eye chunks the tree by section instead of reading one flat list. */}
        <button
          className={`flex flex-1 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-xs font-medium capitalize transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
            folderActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-muted-foreground'
          }`}
          onClick={(e) => {
            acknowledge();
            openFolder(group.dir, navFromEvent(e));
          }}
          title={
            isNew
              ? `Browse all ${group.dir} — the memory just filed its first`
              : `Browse all ${group.dir}`
          }
        >
          <Icon className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
          <span className="flex-1 truncate">{group.dir}</span>
          {isNew && (
            <>
              <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
              <span className="sr-only">, new in the memory</span>
            </>
          )}
        </button>
      </div>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden" inert={!open ? true : undefined}>
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
                    <SquarePen className="size-3 shrink-0 text-muted-foreground/70" aria-hidden />
                    <span className="truncate">Jot something down</span>
                    <span className="ml-auto shrink-0 text-muted-foreground/60">⌘N</span>
                  </button>
                </li>
              ) : inviteTranscript ? (
                // Meetings are the memory's front door — an empty section IS the
                // day-one state, so it invites the first transcript.
                <li>
                  <button
                    className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 pl-[30px] text-left text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    onClick={onIngest}
                    title="Drop a transcript (⇧⌘N) — any meeting you already have"
                  >
                    <FileUp className="size-3 shrink-0 text-muted-foreground/70" aria-hidden />
                    <span className="truncate">Drop a transcript</span>
                    <span className="ml-auto shrink-0 text-muted-foreground/60">⇧⌘N</span>
                  </button>
                </li>
              ) : // Meetings exist but none are pinned: the header alone is the
              // browse affordance — no placeholder row (pinned-only rail).
              null
            ) : (
              notes.map((n) => {
                const activeNote = activeTab?.kind === 'doc' && activeTab.path === n.path;
                return (
                  <li key={n.path} className="group/note relative">
                    <button
                      className={`flex w-full items-center gap-2 rounded-md py-1 pr-2 pl-[30px] text-left text-[13px] transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
                        activeNote ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'text-sidebar-foreground'
                      }`}
                      onClick={(e) => void openDoc(n.path, navFromEvent(e))}
                      onAuxClick={(e) => e.button === 1 && void openDoc(n.path, navFromEvent(e))}
                      title={n.title}
                    >
                      <span className="truncate">{n.title}</span>
                      {group.type === 'meeting' && needsReview(n) && (
                        <span
                          className="size-1.5 shrink-0 rounded-full bg-warning transition-opacity group-hover/note:opacity-0 group-focus-within/note:opacity-0"
                          title="Happened — awaiting its After-Meeting review"
                          aria-label="Awaiting review"
                        />
                      )}
                      {group.type === 'meeting' && (
                        <span
                          className={`ml-auto shrink-0 text-xs tabular-nums transition-opacity group-hover/note:opacity-0 group-focus-within/note:opacity-0 ${
                            isUpcomingMeeting(n) ? 'font-medium text-brand' : 'text-muted-foreground'
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
                        title="Unpin — remove from the sidebar"
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
  const [open, toggle] = useSection('memory', true);
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
      open={open}
      onToggle={toggle}
      action={
        <button
          className="rounded px-1.5 py-0.5 text-xs text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={(e) => openMemory(navFromEvent(e))}
          title="The whole memory — sources, insights, customers, people, sessions, notes"
        >
          All
        </button>
      }
    >
      <ul className="flex flex-col gap-1">
        {groups.map((g) => (
          <TypeSection key={g.dir} group={g} onUnpin={onUnpin} onNewNote={onNewNote} onIngest={onIngest} />
        ))}
      </ul>
    </Section>
  );
}

/** One always-available header action: 28px hit area, quiet until hovered. */
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
    tree,
    openVaultDialog,
    openSession,
    openSettings,
    openInbox,
    openTodos,
    openSkills,
    attentionCount,
    toggleFavorite,
  } = useApp();

  // Unpinning a note is reversible: it leaves a one-tap Undo strip for a few
  // seconds, then quietly settles. (The red toast is errors-only.)
  const [unpinned, setUnpinned] = useState<{ path: string; title: string } | null>(null);
  const unpinTimer = useRef<number | null>(null);
  useEffect(() => () => void (unpinTimer.current && window.clearTimeout(unpinTimer.current)), []);
  const unpinNote = useCallback(
    (n: NoteRefDTO) => {
      toggleFavorite(n.path);
      setUnpinned({ path: n.path, title: n.title });
      if (unpinTimer.current) window.clearTimeout(unpinTimer.current);
      unpinTimer.current = window.setTimeout(() => setUnpinned(null), 6000);
    },
    [toggleFavorite],
  );
  const undoUnpin = useCallback(() => {
    if (unpinned) toggleFavorite(unpinned.path); // re-pin: the exact inverse of the unpin
    setUnpinned(null);
    if (unpinTimer.current) window.clearTimeout(unpinTimer.current);
  }, [unpinned, toggleFavorite]);

  const skillsGroup = tree?.groups.find((g) => g.type === 'skill');
  // The PO's own open todos due today or slipped — the "deal with these" count.
  const todosDue = useMemo(() => {
    const iso = localDateStr();
    const group = tree?.groups.find((g) => g.type === 'todo');
    return (group?.notes ?? []).filter(
      (n) =>
        !isFolderIndex(n.path) &&
        (n.status ?? 'open') === 'open' &&
        !n.owner &&
        !!n.due &&
        n.due <= iso,
    ).length;
  }, [tree]);

  return (
    <div className="flex h-full flex-col">
      <div
        className={`flex h-10 shrink-0 items-center gap-0.5 pr-1.5 ${isMac ? 'pl-[70px]' : 'pl-1.5'}`}
        style={{ WebkitAppRegion: 'drag' } as never}
      >
        {vault && (
          <>
            <ToolbarButton label="New note" keys={['⌘', 'N']} icon={SquarePen} onClick={onNewNote} />
            <ToolbarButton label="Ingest" keys={['⇧', '⌘', 'N']} icon={FileUp} onClick={onIngest} />
          </>
        )}
        <ToolbarButton
          label="Settings"
          icon={Settings}
          className="ml-auto"
          onClick={() => openSettings()}
        />
      </div>

      {vault && (
        <div className="px-2 pb-1.5">
          <button
            className="flex h-8 w-full items-center gap-2 rounded-lg border border-sidebar-border bg-card/50 px-2.5 text-[13px] text-muted-foreground transition-colors duration-150 hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
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
          <button
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={(e) => openInbox(navFromEvent(e))}
          >
            <Inbox className="size-4 text-brand" aria-hidden />
            Inbox
            {attentionCount > 0 && (
              <span className="ml-auto rounded-full bg-brand/15 px-1.5 text-xs font-semibold text-brand">
                {attentionCount}
              </span>
            )}
          </button>
          <button
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
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
          <button
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={(e) => openSession('ask', navFromEvent(e))}
          >
            <Sparkles className="size-4 text-muted-foreground" aria-hidden />
            Ask
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
            <ActivitySection />
            {/* Day one teaches itself: the Meetings and Notes sections carry their
                own invitations, so no extra empty-workspace paragraph. */}
            <MemoryTree onUnpin={unpinNote} onNewNote={onNewNote} onIngest={onIngest} />
          </div>

          {unpinned && (
            <div
              role="status"
              className="mx-2 mb-1.5 flex items-center gap-2 rounded-lg border border-sidebar-border bg-card/70 px-2.5 py-1.5 text-xs text-muted-foreground"
            >
              <Check className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                Unpinned <span className="text-foreground">{unpinned.title}</span>
              </span>
              <button
                className="shrink-0 rounded px-1 font-medium text-brand transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={undoUnpin}
              >
                Undo
              </button>
            </div>
          )}

          <button
            className="flex items-center gap-2 border-t border-sidebar-border px-3.5 py-2 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={(e) => openSkills(navFromEvent(e))}
            title="Skills — how the agent behaves: voices, playbooks, triggers, and what it may do on its own"
          >
            <Wand2 className="size-3.5" aria-hidden /> Skills{skillsGroup ? ` (${skillsGroup.notes.length})` : ''}
          </button>
        </>
      )}
    </div>
  );
}
