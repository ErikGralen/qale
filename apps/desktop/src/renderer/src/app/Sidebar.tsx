import { useMemo, useState } from 'react';
import { isFolderIndex } from '@pm/domain';
import { Button, Spinner } from '@pm/ui';
import {
  FolderOpen,
  Sparkles,
  Check,
  Wand2,
  Star,
  FileUp,
  Search,
  Settings,
  SquarePen,
  Inbox,
  ChevronRight,
  ListTodo,
  type LucideIcon,
} from 'lucide-react';
import { useApp, type SessionOverview } from '../state/app-state';
import { localDateStr } from '../lib/dates';
import { noteTypeIcon } from '../lib/note-icons';
import {
  byRecent,
  isUnprocessedSource,
  isUpcomingMeeting,
  meetingMeta,
  meetingStart,
  needsReview,
} from '../lib/note-status';
import type { NoteRefDTO, NoteType, ProblemHeatDTO, VaultTreeGroupDTO } from '@pm/ipc';

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
      count={attention}
      countTone="brand"
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
                  onClick={() => openChat({ id: s.id, sessionType: s.sessionType, title: s.title })}
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

/** The PO's curated shortlist — starred notes, in the order they were pinned. */
function FavoritesSection({ notes }: { notes: NoteRefDTO[] }) {
  const { openDoc, activeTab, toggleFavorite } = useApp();
  const [open, toggle] = useSection('favourites', true);
  return (
    <Section label="Favourites" open={open} onToggle={toggle}>
      {notes.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          Star <Star className="inline size-3 align-[-1px]" aria-hidden /> a note to keep it here.
        </p>
      ) : (
        <ul className="flex flex-col">
          {notes.map((n) => {
            const Icon = noteTypeIcon(n.type);
            const active = activeTab?.kind === 'doc' && activeTab.path === n.path;
            return (
              <li key={n.path} className="group relative">
                <button
                  className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 pr-6 text-left text-[13px] transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
                    active ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'text-sidebar-foreground'
                  }`}
                  onClick={() => void openDoc(n.path)}
                  onDoubleClick={() => void openDoc(n.path, { preview: false })}
                  title={n.title}
                >
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{n.title}</span>
                </button>
                <button
                  className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-0.5 text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  onClick={() => toggleFavorite(n.path)}
                  aria-label={`Remove ${n.title} from favourites`}
                  title="Remove from favourites"
                >
                  <Star className="size-3 fill-current" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

const SHORTLIST = 5;

interface Shortlist {
  /** The most-relevant handful for this type. */
  notes: NoteRefDTO[];
  /** Everything in the folder, to decide whether a "more" row is needed. */
  total: number;
}

/**
 * What each type opens to: not "all N", but the handful that actually earns a
 * glance. Live things first (open problems, active decisions, planned releases),
 * everything else by recency — the note you touched last is the one you want.
 */
function shortlistFor(g: VaultTreeGroupDTO, problems: ProblemHeatDTO[]): Shortlist {
  const all = g.notes.filter((n) => !isFolderIndex(n.path));
  const take = (list: NoteRefDTO[]): Shortlist => ({ notes: list.slice(0, SHORTLIST), total: all.length });
  switch (g.type) {
    case 'source': {
      const unprocessed = all.filter((n) => n.status === 'new' || n.status === 'stale');
      return unprocessed.length ? take(unprocessed.sort(byRecent)) : take([...all].sort(byRecent));
    }
    case 'meeting': {
      // Upcoming first (soonest on top), then unreviewed, then the recent past.
      const upcoming = all.filter(isUpcomingMeeting).sort((a, b) => meetingStart(a) - meetingStart(b));
      const unreviewed = all.filter(needsReview).sort(byRecent);
      const rest = all
        .filter((n) => !isUpcomingMeeting(n) && !needsReview(n))
        .sort(byRecent);
      return take([...upcoming, ...unreviewed, ...rest]);
    }
    case 'problem': {
      const open = problems.filter((p) => p.stance !== 'wont-do');
      return open.length ? take(open) : take([...all].sort(byRecent));
    }
    case 'decision': {
      const active = all.filter((n) => (n.status ?? 'active') !== 'superseded' && !n.supersededBy);
      return active.length ? take(active.sort(byRecent)) : take([...all].sort(byRecent));
    }
    case 'release': {
      const planned = all.filter((n) => (n.status ?? 'planned') !== 'shipped');
      return planned.length ? take(planned.sort(byRecent)) : take([...all].sort(byRecent));
    }
    case 'customer': {
      const live = all.filter((n) => (n.status ?? 'active') !== 'churned');
      return take((live.length ? live : all).sort(byRecent));
    }
    default:
      return take([...all].sort(byRecent));
  }
}

/**
 * One note type, opened to its most-relevant handful (PLAN-V2 §3.3). The header
 * name browses the whole folder; the chevron folds the shortlist away. No counts:
 * the memory's size isn't the point on the way past it — the live items are.
 */
function TypeSection({ group, problems }: { group: VaultTreeGroupDTO; problems: ProblemHeatDTO[] }) {
  const { openFolder, openDoc, activeTab } = useApp();
  const [open, toggle] = useSection(`type.${group.type}`, true);
  const { notes, total } = useMemo(() => shortlistFor(group, problems), [group, problems]);
  if (total === 0) return null;
  const Icon = noteTypeIcon(group.type);
  const folderActive = activeTab?.kind === 'folder' && activeTab.dir === group.dir;
  const more = total - notes.length;

  return (
    <li>
      <div className="group/row flex items-center gap-0.5 pr-1">
        <button
          className="shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={toggle}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${group.dir}`}
        >
          <ChevronRight
            className={`size-3 transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
          />
        </button>
        <button
          className={`flex flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[13px] capitalize transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
            folderActive ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'text-sidebar-foreground'
          }`}
          onClick={() => openFolder(group.dir)}
          onDoubleClick={() => openFolder(group.dir, { preview: false })}
          title={`Browse all ${group.dir}`}
        >
          <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex-1 truncate">{group.dir}</span>
        </button>
      </div>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden" inert={!open ? true : undefined}>
          <ul className="flex flex-col pb-0.5">
            {notes.map((n) => {
              const activeNote = activeTab?.kind === 'doc' && activeTab.path === n.path;
              return (
                <li key={n.path}>
                  <button
                    className={`flex w-full items-center gap-2 rounded-md py-1 pr-2 pl-[30px] text-left text-[13px] transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
                      activeNote ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'text-sidebar-foreground'
                    }`}
                    onClick={() => void openDoc(n.path)}
                    onDoubleClick={() => void openDoc(n.path, { preview: false })}
                    title={n.title}
                  >
                    <span className="truncate">{n.title}</span>
                    {group.type === 'meeting' && needsReview(n) && (
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-warning"
                        title="Happened — awaiting its After-Meeting review"
                        aria-label="Awaiting review"
                      />
                    )}
                    {group.type === 'meeting' && (
                      <span
                        className={`ml-auto shrink-0 text-xs tabular-nums ${
                          isUpcomingMeeting(n) ? 'font-medium text-brand' : 'text-muted-foreground'
                        }`}
                      >
                        {meetingMeta(n)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
            {more > 0 && (
              <li>
                <button
                  className="flex w-full items-center rounded-md py-1 pr-2 pl-[30px] text-left text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  onClick={() => openFolder(group.dir)}
                >
                  {more} more →
                </button>
              </li>
            )}
          </ul>
        </div>
      </div>
    </li>
  );
}

/**
 * The rail carries only the PO's working set — the four types the between-
 * meetings loops actually touch: meetings (review them), decisions (answer
 * "what did we decide"), problems (what's live), releases (what's shipping).
 * Reference shelves — sources, insights, customers, people, sessions, notes —
 * are reached by ⌘K, wikilinks, or the full Memory page behind "All".
 */
const RAIL_TYPES: readonly NoteType[] = ['meeting', 'decision', 'problem', 'release'];

/** The memory, opened to what's live in each working type — never an inventory. */
function MemoryTree() {
  const { tree, problems, openMemory } = useApp();
  // Skills have their footer button; todos have the first-class Todos view.
  const all = (tree?.groups ?? []).filter((g) => g.type !== 'skill' && g.type !== 'todo');
  const groups = all
    .filter((g) => RAIL_TYPES.includes(g.type))
    .sort((a, b) => RAIL_TYPES.indexOf(a.type) - RAIL_TYPES.indexOf(b.type));
  // Nothing that needs you should hide: unprocessed sources live off-rail, so
  // their count surfaces here in the flag voice, next to the door to them.
  const unprocessed = all
    .filter((g) => g.type === 'source')
    .flatMap((g) => g.notes)
    .filter((n) => !isFolderIndex(n.path) && isUnprocessedSource(n)).length;
  if (all.length === 0) return null;
  return (
    <div className="px-2 pt-1">
      <div className="flex items-center gap-1 pr-1 pb-0.5">
        <div className="flex-1 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/80">Memory</div>
        {unprocessed > 0 && (
          <span
            className="text-xs font-medium text-warning tabular-nums"
            title={`${unprocessed} unprocessed source${unprocessed === 1 ? '' : 's'}`}
          >
            {unprocessed}
          </span>
        )}
        <button
          className="rounded px-1.5 py-0.5 text-xs text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={() => openMemory()}
          onDoubleClick={() => openMemory({ preview: false })}
          title="The whole memory — sources, insights, customers, people, sessions, notes"
        >
          All
        </button>
      </div>
      <ul className="flex flex-col">
        {groups.map((g) => (
          <TypeSection key={g.dir} group={g} problems={problems} />
        ))}
      </ul>
    </div>
  );
}

/** One always-available header action: 28px hit area, quiet until hovered. */
function HeaderButton({
  label,
  title,
  icon: Icon,
  className = '',
  onClick,
  onDoubleClick,
}: {
  label: string;
  title: string;
  icon: LucideIcon;
  className?: string;
  onClick: () => void;
  onDoubleClick?: () => void;
}) {
  return (
    <button
      className={`rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${className}`}
      style={{ WebkitAppRegion: 'no-drag' } as never}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      aria-label={label}
      title={title}
    >
      <Icon className="size-4" />
    </button>
  );
}

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
    favorites,
  } = useApp();

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
  // Resolve favourite paths against the live tree — deleted notes drop out.
  const favoriteNotes = useMemo(() => {
    const byPath = new Map<string, NoteRefDTO>();
    for (const g of tree?.groups ?? []) for (const n of g.notes) byPath.set(n.path, n);
    return favorites.map((p) => byPath.get(p)).filter((n): n is NoteRefDTO => !!n);
  }, [tree, favorites]);

  return (
    <div className="flex h-full flex-col">
      <div
        className={`flex h-11 shrink-0 items-center gap-0.5 pr-2 ${isMac ? 'pl-[70px]' : 'pl-2'}`}
        style={{ WebkitAppRegion: 'drag' } as never}
      >
        {vault && (
          <>
            <HeaderButton label="New note" title="New note (⌘N)" icon={SquarePen} onClick={onNewNote} />
            <HeaderButton label="Ingest" title="Ingest — drop anything (⇧⌘N)" icon={FileUp} onClick={onIngest} />
          </>
        )}
        <HeaderButton
          label="Settings"
          title="Settings"
          icon={Settings}
          className="ml-auto"
          onClick={() => openSettings()}
          onDoubleClick={() => openSettings({ preview: false })}
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
            onClick={() => openInbox()}
            onDoubleClick={() => openInbox({ preview: false })}
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
            onClick={() => openTodos()}
            onDoubleClick={() => openTodos({ preview: false })}
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
            onClick={() => openSession('ask')}
            onDoubleClick={() => openSession('ask', { preview: false })}
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
            <FavoritesSection notes={favoriteNotes} />
            <MemoryTree />
            {(tree?.groups ?? []).every((g) => g.type === 'skill' || g.notes.every((n) => isFolderIndex(n.path))) && (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                Empty workspace — start a note with ⌘N, or dump anything with ⇧⌘N or a drop.
              </p>
            )}
          </div>

          <button
            className="flex items-center gap-2 border-t border-sidebar-border px-3.5 py-2 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => openSkills()}
            onDoubleClick={() => openSkills({ preview: false })}
            title="Skills — how the agent behaves: voices, playbooks, triggers, and what it may do on its own"
          >
            <Wand2 className="size-3.5" aria-hidden /> Skills{skillsGroup ? ` (${skillsGroup.notes.length})` : ''}
          </button>
        </>
      )}
    </div>
  );
}
