import { useMemo, useRef, useState } from 'react';
import {
  isFolderIndex,
  isHandCreatable,
  lifecycleField,
  lifecycleValueLabel,
  noteTypeLabel,
  parseMirrorRef,
  typeForDir,
  type HandCreatableType,
} from '@qale/domain';
import { Button, ContextMenuItem } from '@qale/ui';
import { AlertTriangle, Copy, ExternalLink, Folder, Plus, Search, X } from 'lucide-react';
import type { NoteRefDTO, NoteType } from '@qale/ipc';
import { useApp } from '../state/app-state';
import { useAimedDrop } from '../lib/aimed-drop';
import { providerLabelOf } from '../lib/connections';
import { shelfLabel } from '../lib/crumbs';
import { mirrorFolder } from '../lib/providers';
import { navFromEvent, surfaceForType } from '../lib/nav';
import { useNewNote } from '../lib/new-note';
import { PageHeader } from '../components/PageHeader';
import { FileList } from '../components/FileList';
import { FileRow, META_COL, formatMtime, type FileRowActions } from '../components/FileRow';
import { SortRail, type SortColumn } from '../components/SortRail';
import { SupersedesChain } from './NoteList';
import { MeetingWeek } from './MeetingWeek';
import { TicketBoard } from './TicketBoard';
import { ScopedAskComposer } from '../components/ScopedAskComposer';
import { SelectionBar } from '../components/SelectionBar';
import { UndoStrip, useUndoOffer } from '../components/UndoStrip';
import { useToast } from '../components/toast';
import { HIDDEN_KEYS } from '../state/properties-schema';
import { formatRefDate } from '../lib/contexts';
import { refSlug } from '../lib/frontmatter';
import { readListSort, writeListSort } from '../lib/list-sort';
import {
  MIRROR_KEYS,
  SHELF_KEYS,
  STATE_TONE,
  sortNotes,
  updatedMs,
  type FolderSort,
  type FolderSortKey,
} from '../lib/folder-sort';
import { deleteDoc } from '../lib/move-documents';
import { selectionKeyDown, useSelection } from '../lib/selection';

/** The spatial layout a folder offers besides the flat list, if any. */
type AltLayout = 'week' | 'board';
type FolderLayout = AltLayout | 'list';

/** Meetings read temporally (a week calendar); tickets read by flight (a board).
 *  Everything else is a list. The alt layout is the folder's default.
 *
 *  It matches on the top-level folder, so one system's tickets
 *  (`tickets/jira`) open on the board like every other ticket folder. */
function altLayoutFor(top: string): AltLayout | null {
  if (top === 'meetings') return 'week';
  if (top === 'tickets') return 'board';
  return null;
}

/**
 * Is this folder a mirror's? `tickets/jira` names one system and `tickets`
 * holds every tracker's at once, and both are copies of something that lives
 * somewhere else.
 *
 * Read off the path, never off the loaded tree: the columns have to be settled
 * before the first row arrives, or a remembered sort points at a column that is
 * not there yet.
 */
function isMirrorDir(top: string): boolean {
  const type = typeForDir(top);
  return type !== null && surfaceForType(type) === 'synced';
}

const LAYOUT_KEY = (dir: string) => `qale.folder-view.${dir}`;

/**
 * The layout this folder was left in, or its default.
 *
 * A packaged build runs from `file://`, where there is no localStorage and
 * touching it throws. Both halves have to survive that: the page still opens on
 * its default layout, it just forgets the pick.
 */
function storedLayout(dir: string, alt: AltLayout | null): FolderLayout {
  if (!alt) return 'list';
  try {
    return localStorage.getItem(LAYOUT_KEY(dir)) === 'list' ? 'list' : alt;
  } catch {
    return alt;
  }
}

function rememberLayout(dir: string, layout: FolderLayout): void {
  try {
    localStorage.setItem(LAYOUT_KEY(dir), layout);
  } catch {
    /* no storage. The toggle still works, it just does not last. */
  }
}

/** What went wrong, in the words the main process used. */
function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// The columns
// ---------------------------------------------------------------------------

const NAME_COLUMN: SortColumn<FolderSortKey> = {
  key: 'name',
  label: 'Name',
  openDir: 'asc',
  ariaLabel: (s) => `Sort by name, ${s.key === 'name' && s.dir === 'asc' ? 'Z to A' : 'A to Z'}`,
};

/** The note's own reference date, never the file's mtime: a decision's date is
 *  what a person means by "when". */
const DATE_COLUMN: SortColumn<FolderSortKey> = {
  key: 'date',
  label: 'Date',
  openDir: 'desc',
  ariaLabel: (s) =>
    `Sort by date, ${s.key === 'date' && s.dir === 'desc' ? 'oldest first' : 'newest first'}`,
};

const STATE_COLUMN: SortColumn<FolderSortKey> = {
  key: 'state',
  label: 'State',
  openDir: 'asc',
  ariaLabel: (s) =>
    `Sort by state, ${s.key === 'state' && s.dir === 'asc' ? 'done first' : 'to do first'}`,
};

const UPDATED_COLUMN: SortColumn<FolderSortKey> = {
  key: 'updated',
  label: 'Updated',
  openDir: 'desc',
  ariaLabel: (s) =>
    `Sort by updated, ${s.key === 'updated' && s.dir === 'desc' ? 'oldest first' : 'newest first'}`,
};

/** What an empty folder means — teach the mechanism, don't just say "nothing". */
const EMPTY_TEACH: Partial<Record<NoteType, string>> = {
  source:
    'No sources yet. Whatever you drop in lands here: transcripts, articles, screenshots, pasted threads. They are kept as they came and never edited.',
  meeting: 'No meetings yet. Drop a transcript (or paste one with ⇧⌘N) and it gets filed here.',
  decision:
    'No decisions yet. Approve a decision from a meeting and it lands here, with the call it replaced kept underneath.',
  insight:
    'No insights yet. When a meeting says something worth keeping, it lands here as one claim with the quote it came from.',
  customer: 'No customers yet. An account gets a page once your meetings and notes name it.',
  research:
    'What Qale worked out: the case for a problem, a competitor scan. Correct anything wrong.',
  about:
    'What is true about you and the company: what the product is, how it is built, who owns what. Tell Qale about your product and these pages get written.',
  person:
    'No people yet. The people you work with appear here, with what they care about and what they were last told.',
  skill: 'No skills yet. Work you hand over is written down here, in words you can edit.',
  // The folder holds copies; the real items live in the connected tracker or
  // wiki. The edit rule waits for the note page, where it answers a question the
  // reader is actually asking.
  ticket:
    'No tickets yet. The ones Qale follows are copied here and kept up to date, so you can read them without leaving. Connect your tracker in Settings → Connections to start.',
  wikipage:
    'No wiki pages yet. The ones Qale follows are copied here, ready for your updates to land on. Connect your wiki in Settings → Connections to start.',
  note: 'No documents yet. Start one with ⌘N: scratch notes, briefs, specs.',
};

/**
 * Lifecycle values worth a facet chip, in chip order. A folder holds one note
 * type, so a folder only ever shows one lifecycle: a decision's `standing`, a
 * source's `processing`. The chip reads as the value's own label, never the raw
 * token.
 *
 * Only the lifecycles the app acts on get chips. `relationship` (a customer)
 * is hidden everywhere else (HIDDEN_KEYS).
 */
const LIFECYCLE_ORDER = [
  'new',
  'processed',
  'active',
  'stale',
  'superseded',
  'open',
  'done',
  'dropped',
];

function FacetChip({
  label,
  active,
  tone = 'neutral',
  onToggle,
  title,
}: {
  label: string;
  active: boolean;
  tone?: 'neutral' | 'warning';
  onToggle: () => void;
  title?: string;
}) {
  const activeCls =
    tone === 'warning'
      ? 'bg-warning/15 text-warning ring-1 ring-warning/40'
      : 'bg-foreground/85 text-background';
  const idleCls =
    tone === 'warning'
      ? 'text-warning/90 hover:bg-warning/10'
      : 'text-muted-foreground hover:bg-accent hover:text-foreground';
  return (
    <button
      className={`flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
        active ? activeCls : idleCls
      }`}
      onClick={onToggle}
      aria-pressed={active}
      title={title}
    >
      {tone === 'warning' && <AlertTriangle className="size-3" aria-hidden />}
      {label}
    </button>
  );
}

/**
 * A folder browse page — built for *finding*, not inventory (the PO's recall
 * cue is a topic, a status, or "a few weeks ago"; never "row 7 of a list").
 *
 * The list is the app's one file list (see {@link FileRow}), at full pane
 * width, with a column rail over it: click a column to sort by it, click it
 * again to turn it around, and the pick is remembered per folder. There is no
 * group-by toggle beside it. A page with a "date / flat" switch AND a clickable
 * Date column teaches two vocabularies for one job, and the rail is the one
 * every other list already speaks.
 *
 * A click picks a row, a double click (or ↵) opens it. There is no checkbox.
 * Every list in the app reads the same way, so a shelf and a mirror do too: a
 * page where the checkbox picked and the click opened taught a second
 * vocabulary for one job. Selection is still what a batch acts on, and the bar
 * above the list is how a run of tickets gets pinned or deleted in one go
 * (docs/memory-placement.md).
 *
 * A shelf sorts by Name and Date, where Date is the note's own reference date.
 * A mirror folder (Jira, Confluence) sorts by Name, State and Updated instead,
 * because a backlog is read by where each item sits in flight.
 *
 * Instant filter and facet chips stay. Every note appears once: a topic is a
 * chip you filter by, never a section, because a note carrying two tags would
 * otherwise show up twice. Docked Ask composer stays scoped to the folder.
 *
 * There is no folder machinery. These folders are flat on disk and Qale files
 * them, so New folder, Move to and drag would all promise ownership the app
 * does not honour. A row can be renamed and deleted; a mirror row cannot even
 * do that, because Qale never authors a mirror.
 */
export function FolderView({ dir }: { dir: string }) {
  const { tree, openMemory, renameNote, deleteNotes } = useApp();
  const { create, busy: creating } = useNewNote();
  const toast = useToast();
  const { offer: undoable, offerUndo, runUndo } = useUndoOffer();
  // A mirror folder names one system: `tickets/jira` is Jira's tickets, and
  // `tickets` is every tracker's at once (docs/memory-placement.md). The notes
  // are grouped by the top-level folder either way, so the page finds its group
  // there and narrows by the path.
  const top = dir.split('/')[0] ?? dir;
  const provider = useMemo(() => mirrorFolder(dir), [dir]);
  // Everything read-only about the page hangs off this: the columns, the rail,
  // the row menu and the drop target. `provider` only says WHICH system, which
  // the bare `tickets` folder cannot answer.
  const mirror = isMirrorDir(top);
  // Some folders default to a spatial layout (week calendar, ticket board),
  // with the flat list one click away.
  const altLayout = altLayoutFor(top);
  const [layout, setLayoutState] = useState<FolderLayout>(() => storedLayout(dir, altLayout));
  const setLayout = (v: FolderLayout) => {
    setLayoutState(v);
    rememberLayout(dir, v);
  };
  const [filter, setFilter] = useState('');
  // Decisions open on the ones that still hold. Replaced ones are one click away.
  const [lifecycleFacet, setLifecycleFacet] = useState<string | null>(
    dir === 'decisions' ? 'active' : null,
  );
  // Each folder keeps its own pick, so Jira can read by flight while decisions
  // read by date.
  const [sort, setSort] = useState<FolderSort>(() =>
    isMirrorDir(top)
      ? (readListSort(dir, { key: 'updated', dir: 'desc' }, MIRROR_KEYS) as FolderSort)
      : (readListSort(dir, { key: 'date', dir: 'desc' }, SHELF_KEYS) as FolderSort),
  );
  const filterRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const group = tree?.groups.find((g) => g.dir === top);
  const notes = useMemo(
    () =>
      (group?.notes ?? []).filter(
        (n) => !isFolderIndex(n.path) && (dir === top || n.path.startsWith(`${dir}/`)),
      ),
    [group, dir, top],
  );

  // A hidden lifecycle gets no chips at all: `active` belongs to a decision's
  // `standing` AND to a customer's `relationship`, so the value alone cannot
  // tell them apart. The field can.
  const lifecycles = useMemo(() => {
    const field = group ? lifecycleField(group.type) : null;
    if (!field || HIDDEN_KEYS.has(field)) return [];
    const present = new Set(notes.map((n) => n.lifecycle).filter((v): v is string => !!v));
    return LIFECYCLE_ORDER.filter((v) => present.has(v));
  }, [notes, group]);

  // A wiki page has no state. An empty column is worse than a missing one, so
  // the folder only gets a State column once a row in it carries a category.
  const hasState = useMemo(() => notes.some((n) => n.stateCategory), [notes]);

  const columns = useMemo((): SortColumn<FolderSortKey>[] => {
    if (!mirror) return [NAME_COLUMN, DATE_COLUMN];
    return hasState ? [NAME_COLUMN, STATE_COLUMN, UPDATED_COLUMN] : [NAME_COLUMN, UPDATED_COLUMN];
  }, [mirror, hasState]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const rows = notes.filter((n) => {
      if (lifecycleFacet && n.lifecycle !== lifecycleFacet) return false;
      if (!q) return true;
      const hay = `${n.title} ${n.summary} ${(n.tags ?? []).join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
    return sortNotes(rows, sort);
  }, [notes, filter, lifecycleFacet, sort]);

  // Selection follows the filter: what is on screen is what can be acted on,
  // so narrowing the page (or emptying it) takes the hidden rows with it.
  const ordered = useMemo(() => filtered.map((n) => n.path), [filtered]);
  const selection = useSelection(ordered);

  const emptyTeach = group ? (EMPTY_TEACH[group.type] ?? 'Nothing here yet.') : 'Nothing here yet.';

  // What the page is called. A mirror folder wears the system's name, the same
  // word the rail row wears.
  const pageLabel = provider ? providerLabelOf(provider.providerId) : shelfLabel(dir);
  const noun = provider ? (provider.kind === 'wikipage' ? 'page' : 'ticket') : null;

  const clearFilters = () => {
    setFilter('');
    setLifecycleFacet(null);
    filterRef.current?.focus();
  };

  const pickSort = (next: FolderSort) => {
    setSort(next);
    writeListSort(dir, next);
  };

  // Nothing is said when it works. The toast is the app's one "that failed"
  // channel, red border and all, so a success line there reads as an alarm; the
  // clipboard is its own receipt.
  const copyLink = (url: string) => {
    void navigator.clipboard.writeText(url).catch(() => toast('The link was not copied.'));
  };

  /**
   * Which system this row's original lives in. A folder that names one answers
   * for every row in it; the bare `tickets` folder holds several, so there the
   * row's own path is what says which. An old flat mirror names none, and then
   * the menu offers the link without claiming where it goes.
   */
  const rowProviderLabel = (n: NoteRefDTO): string | null => {
    if (provider) return pageLabel;
    const id = parseMirrorRef(n.path)?.provider;
    return id ? providerLabelOf(id) : null;
  };

  /**
   * What a right-click offers.
   *
   * A mirror row offers doors to the same item and nothing that writes: Qale
   * never authors a mirror, so Rename and Delete would both fail upstream and
   * lie here. A row with no `url` in its frontmatter keeps the one door it has.
   */
  const rowActions = (n: NoteRefDTO): FileRowActions => {
    if (!mirror) {
      return {
        openInNewTab: true,
        onRename: (note, title) => {
          // A refused rename (a name already taken) leaves the row as it was;
          // the toast is the only thing that says it did not happen.
          void renameNote(note.path, title).catch((err) => toast(`Not renamed: ${reason(err)}`));
        },
        onDelete: (note) => void deleteDoc(note, { deleteNotes, toast, offerUndo }),
      };
    }
    const url = n.remoteUrl;
    const system = rowProviderLabel(n);
    return {
      openInNewTab: true,
      extra: url ? (
        <>
          {system && (
            <ContextMenuItem onSelect={() => window.open(url)}>
              <ExternalLink className="size-4 text-muted-foreground" aria-hidden />
              Open in {system}
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={() => copyLink(url)}>
            <Copy className="size-4 text-muted-foreground" aria-hidden />
            Copy link
          </ContextMenuItem>
        </>
      ) : undefined,
    };
  };

  /**
   * The right-hand rail, one cell per column so a row stands under its own
   * heading. A lifecycle word sits inline before the last column rather than in
   * one: it is a state, not a fact you sort by.
   */
  const rowMeta = (n: NoteRefDTO) =>
    mirror ? (
      <div className="flex h-5 shrink-0 items-center gap-1.5">
        {hasState && (
          <span
            className={`${META_COL} truncate text-xs ${
              n.stateCategory ? STATE_TONE[n.stateCategory] : 'text-muted-foreground'
            }`}
          >
            {n.state ?? ''}
          </span>
        )}
        <span className={`${META_COL} text-xs text-muted-foreground tabular-nums`}>
          {formatMtime(updatedMs(n))}
        </span>
      </div>
    ) : (
      <div className="flex h-5 shrink-0 items-center gap-1.5">
        {n.lifecycle === 'superseded' && (
          <span className="text-xs text-muted-foreground">superseded</span>
        )}
        {n.eventStatus === 'cancelled' && (
          <span className="text-xs text-muted-foreground">cancelled</span>
        )}
        <span className={`${META_COL} text-xs text-muted-foreground tabular-nums`}>
          {formatRefDate(n)}
        </span>
      </div>
    );

  const altMode = altLayout !== null && layout === altLayout && notes.length > 0;
  // The week and the board have no rows to tick, so they never hand the header
  // over.
  const selecting = !altMode && selection.count > 0;

  // Dropping on a shelf says where it goes, so the agent never has to ask.
  // A mirror folder claims no drop: Qale never writes one, so a file aimed here
  // has nowhere to land. It falls through to the Shell, which asks.
  const aimed = useAimedDrop(mirror ? null : { kind: 'folder', dir });

  // The one door left for a page made by hand: the shelf's own folder page,
  // where you are already looking at that shelf (docs/memory-placement.md).
  // Only the four types a person authors get it. The rest arrive as a source or
  // as a card to approve (see HAND_CREATABLE_TYPES).
  const startable = group && isHandCreatable(group.type) ? (group.type as HandCreatableType) : null;
  const newLabel = startable ? `New ${noteTypeLabel(startable).toLowerCase()}` : '';
  const newAction = startable && (
    <Button
      size="sm"
      disabled={creating}
      onClick={(e) => void create(startable, navFromEvent(e))}
      title={`${newLabel}: a blank page, named as you type`}
    >
      <Plus className="size-3.5" /> {newLabel}
    </Button>
  );

  const layoutToggle = altLayout && notes.length > 0 && (
    <div
      className="flex items-center rounded-lg bg-muted p-0.5"
      role="group"
      aria-label={`${pageLabel} view`}
    >
      {([altLayout, 'list'] as const).map((v) => (
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
      onKeyDown={(e) => {
        // Esc drops the selection, ⌘A takes the whole filtered list. The rows
        // ARE the selection here, so ⌘A is the list's whether or not something
        // is picked. The week calendar and the board keep their own keys.
        if (!altMode && selectionKeyDown(e, selection)) return;
        // `/` focuses the filter from anywhere on the page (not while typing).
        const t = e.target as HTMLElement;
        if (!altMode && e.key === '/' && t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') {
          e.preventDefault();
          filterRef.current?.focus();
        }
      }}
    >
      <PageHeader
        icon={Folder}
        // A mirror folder is not Memory's: it belongs to the system it was
        // copied from, and that system is a row on the rail. So it names no
        // parent above it (docs/memory-placement.md).
        crumbs={mirror ? [] : [{ label: 'Memory', onClick: (e) => openMemory(navFromEvent(e)) }]}
        // The shelf's name, not the folder on disk: the page says what the rail
        // and the Memory shelf say (SB-4). A mirror folder says the system's name.
        label={pageLabel}
        selecting={selecting}
      >
        {/* One cluster, two jobs: while a batch is ticked the batch owns it,
            and "New decision" waits until the batch is let go. */}
        {selecting ? (
          <SelectionBar
            selection={selection}
            total={filtered.length}
            // A mirror folder owns a word for what it holds, so the tooltips
            // say "3 tickets". A shelf keeps "note": every type on one is a
            // note, and the plurals a per-type word would need ("persons") are
            // not worth the table.
            noun={noun ?? undefined}
          />
        ) : (
          newAction
        )}
      </PageHeader>

      {altMode && altLayout === 'week' && <MeetingWeek notes={notes} toolbarLead={layoutToggle} />}

      {altMode && altLayout === 'board' && <TicketBoard notes={notes} toolbarLead={layoutToggle} />}

      {!altMode && notes.length > 0 && (
        <div className="shrink-0 border-b border-border/70 px-4 py-2">
          {/* Two fixed rows, never one wrapping one: the controls keep their
              places as a folder grows tags, and the facets get the width they
              need without pushing the toggles onto a line of their own. */}
          <div className="flex w-full flex-col gap-1.5">
            <div className="flex items-center gap-2">
              {layoutToggle}
              <div className="flex h-7 min-w-40 flex-1 items-center gap-1.5 rounded-lg border border-border bg-card px-2 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
                <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <input
                  ref={filterRef}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  onKeyDown={(e) => {
                    // Escape clears the innermost thing that has anything to
                    // clear: the filter first, and only then the selection (which
                    // the page handles once this stops swallowing the key).
                    if (e.key === 'Escape' && filter) {
                      e.stopPropagation();
                      setFilter('');
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      listRef.current?.querySelector<HTMLButtonElement>('[data-note-row]')?.focus();
                    }
                  }}
                  placeholder={`Filter ${top}…  ( / )`}
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  aria-label={`Filter ${top}`}
                  autoFocus
                />
                {filter && (
                  <button
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    onClick={() => {
                      setFilter('');
                      filterRef.current?.focus();
                    }}
                    aria-label="Clear filter"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Lifecycle only. Tags are the agent's filing (E-15), so a row of
                them here was a vocabulary the page taught and nobody kept. */}
            {lifecycles.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                {lifecycles.map((v) => (
                  <FacetChip
                    key={v}
                    label={lifecycleValueLabel(group?.type ?? null, v)}
                    active={lifecycleFacet === v}
                    onToggle={() => setLifecycleFacet((c) => (c === v ? null : v))}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!altMode && (
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
          {notes.length === 0 ? (
            <div className="px-4 py-3">
              <p className="text-sm text-muted-foreground">{emptyTeach}</p>
              {/* The empty page is where the offer matters most, so it repeats
                  the header's action instead of pointing at it. */}
              {startable && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  disabled={creating}
                  onClick={(e) => void create(startable, navFromEvent(e))}
                >
                  <Plus className="size-3.5" /> {newLabel}
                </Button>
              )}
            </div>
          ) : (
            <>
              <SortRail sort={sort} columns={columns} onSort={pickSort} />
              {filtered.length === 0 ? (
                <div className="px-4 py-3 text-sm text-muted-foreground">
                  <p>
                    No {top} match{filter.trim() ? ` “${filter.trim()}”` : ' these filters'}. ⌘K
                    searches the whole workspace.
                  </p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={clearFilters}>
                    Clear filters
                  </Button>
                </div>
              ) : (
                <FileList label={pageLabel} multiselectable>
                  {filtered.map((n) => {
                    const chain = n.supersedes ? refSlug(n.supersedes) : null;
                    return (
                      <FileRow
                        key={n.path}
                        note={n}
                        selection={selection}
                        subline={chain ? <SupersedesChain slug={chain} /> : undefined}
                        meta={rowMeta(n)}
                        actions={rowActions(n)}
                      />
                    );
                  })}
                </FileList>
              )}
            </>
          )}
        </div>
      )}

      <UndoStrip offer={undoable} onUndo={runUndo} className="mx-4 mb-1" />

      <ScopedAskComposer
        scope={{ kind: 'folder', label: pageLabel }}
        sessionTitle={`Ask · ${pageLabel}`}
        // The path, not the name on screen: it is what tells the agent which
        // notes are in scope, and one system's folder is not the whole shelf.
        scopePrefix={`Scoped to the ${dir} folder.`}
      />
    </div>
  );
}
