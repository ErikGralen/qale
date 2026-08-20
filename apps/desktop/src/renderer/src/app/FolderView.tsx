import { useMemo, useRef, useState } from 'react';
import {
  isFolderIndex,
  isHandCreatable,
  lifecycleValueLabel,
  noteTypeLabel,
  type HandCreatableType,
} from '@qale/domain';
import { Button } from '@qale/ui';
import { AlertTriangle, Folder, Plus, Search, X } from 'lucide-react';
import type { NoteRefDTO, NoteType } from '@qale/ipc';
import { useApp } from '../state/app-state';
import { useAimedDrop } from '../lib/aimed-drop';
import { navFromEvent } from '../lib/nav';
import { useNewNote } from '../lib/new-note';
import { PageHeader } from '../components/PageHeader';
import { NoteList } from './NoteList';
import { MeetingWeek } from './MeetingWeek';
import { TicketBoard } from './TicketBoard';
import { ScopedAskComposer } from '../components/ScopedAskComposer';
import { SelectionBar } from '../components/SelectionBar';
import { TagChip } from '../components/TagChip';
import { monthBucket, refDate } from '../lib/contexts';
import { selectionKeyDown, useSelection } from '../lib/selection';

type GroupBy = 'date' | 'none';
/** The spatial layout a folder offers besides the flat list, if any. */
type AltLayout = 'week' | 'board';
type FolderView = AltLayout | 'list';

/** Meetings read temporally (a week calendar); tickets read by flight (a board).
 *  Everything else is a list. The alt layout is the folder's default. */
function altLayoutFor(dir: string): AltLayout | null {
  if (dir === 'meetings') return 'week';
  if (dir === 'tickets') return 'board';
  return null;
}

const VIEW_KEY = (dir: string) => `qale.folder-view.${dir}`;

function storedView(dir: string, alt: AltLayout | null): FolderView {
  if (!alt) return 'list';
  return localStorage.getItem(VIEW_KEY(dir)) === 'list' ? 'list' : alt;
}

/** What an empty folder means — teach the mechanism, don't just say "nothing". */
const EMPTY_TEACH: Partial<Record<NoteType, string>> = {
  source:
    'No sources yet. Dumped raw material (article links, screenshots, pasted threads) lands here, never edited, only analyzed.',
  meeting: 'No meetings yet. Drop a transcript (or paste one with ⇧⌘N) and it gets filed here.',
  decision:
    'No decisions yet. Approve a decision card from a meeting and the spine starts here, and superseded ones keep their place in the chain.',
  insight:
    'No insights yet. Claims the agent extracts from meetings land here, each citing its evidence.',
  customer: 'No customers yet. They appear as meetings and insights start naming them.',
  theme:
    'No themes yet. Run Synthesis over a few interviews and the patterns worth solving land here.',
  person:
    'No people yet. Stakeholders appear here with what they care about and what they were last told.',
  skill: 'No skills yet. Session playbooks, the written instructions the agent follows, live here.',
  // Mirrors, in the mirror voice: the folder holds copies, the real items live
  // in Jira and Confluence. The edit rule waits for the note page, where it
  // answers a question the reader is actually asking.
  ticket:
    'No mirrors yet. Jira issues the agent tracks appear here, and the board fills as sessions link work to your meetings and decisions.',
  wikipage:
    'No mirrors yet. Confluence pages the agent tracks appear here, ready for your updates to land on.',
  note: 'No notes yet. Start one with ⌘N; captures that are not typed records land here too.',
};

/**
 * Lifecycle values worth a facet chip, in chip order. A folder holds one note
 * type, so a folder only ever shows one lifecycle: a decision's `standing`, a
 * customer's `relationship`, a source's `processing`. The chip reads as the
 * value's own label, never the raw token.
 */
const LIFECYCLE_ORDER = [
  'new',
  'processed',
  'active',
  'stale',
  'superseded',
  'prospect',
  'churned',
  'exploring',
  'committed',
  'watching',
  'wont-do',
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
 * Instant filter, facet chips, and month grouping. Every note appears once:
 * a topic is a chip you filter by, never a section, because a note carrying
 * two tags would otherwise show up twice. Docked Ask composer stays scoped
 * to the folder.
 */
export function FolderView({ dir }: { dir: string }) {
  const { tree, openMemory } = useApp();
  const { create, busy: creating } = useNewNote();
  // Some folders default to a spatial layout (week calendar, ticket board),
  // with the flat list one click away.
  const altLayout = altLayoutFor(dir);
  const [view, setViewState] = useState<FolderView>(() => storedView(dir, altLayout));
  const setView = (v: FolderView) => {
    setViewState(v);
    localStorage.setItem(VIEW_KEY(dir), v);
  };
  const [filter, setFilter] = useState('');
  const [contextFacet, setContextFacet] = useState<string | null>(null);
  // Decisions default to the live spine — superseded ones are one click away.
  const [lifecycleFacet, setLifecycleFacet] = useState<string | null>(
    dir === 'decisions' ? 'active' : null,
  );
  const [groupBy, setGroupBy] = useState<GroupBy>('date');
  const filterRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const group = tree?.groups.find((g) => g.dir === dir);
  const notes = useMemo(() => (group?.notes ?? []).filter((n) => !isFolderIndex(n.path)), [group]);

  const allTags = useMemo(() => {
    const freq = new Map<string, number>();
    for (const n of notes) for (const t of n.tags ?? []) freq.set(t, (freq.get(t) ?? 0) + 1);
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([t]) => t);
  }, [notes]);

  const lifecycles = useMemo(() => {
    const present = new Set(notes.map((n) => n.lifecycle).filter((v): v is string => !!v));
    return LIFECYCLE_ORDER.filter((v) => present.has(v));
  }, [notes]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return notes
      .filter((n) => {
        if (contextFacet && !n.tags?.includes(contextFacet)) return false;
        if (lifecycleFacet && n.lifecycle !== lifecycleFacet) return false;
        if (!q) return true;
        const hay = `${n.title} ${n.summary} ${(n.tags ?? []).join(' ')}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => refDate(b).getTime() - refDate(a).getTime());
  }, [notes, filter, contextFacet, lifecycleFacet]);

  const sections = useMemo((): {
    key: string;
    heading?: { label: string };
    rows: NoteRefDTO[];
  }[] => {
    if (groupBy === 'none') return [{ key: 'all', rows: filtered }];
    const buckets = new Map<string, NoteRefDTO[]>();
    for (const n of filtered) {
      const b = monthBucket(n);
      buckets.set(b, [...(buckets.get(b) ?? []), n]);
    }
    return [...buckets.entries()].map(([label, rows]) => ({
      key: label,
      heading: { label },
      rows,
    }));
  }, [groupBy, filtered]);

  // Selection follows the filter: what is on screen is what can be acted on,
  // so narrowing the page (or emptying it) takes the hidden rows with it.
  const ordered = useMemo(() => filtered.map((n) => n.path), [filtered]);
  const selection = useSelection(ordered);

  const filtersActive = filter.trim() !== '' || contextFacet !== null || lifecycleFacet !== null;
  const emptyTeach = group ? (EMPTY_TEACH[group.type] ?? 'Nothing here yet.') : 'Nothing here yet.';

  const clearFilters = () => {
    setFilter('');
    setContextFacet(null);
    setLifecycleFacet(null);
    filterRef.current?.focus();
  };

  const altMode = altLayout !== null && view === altLayout && notes.length > 0;

  // Dropping on a shelf says where it goes, so the agent never has to ask.
  const aimed = useAimedDrop({ kind: 'folder', dir });

  // The same "+" the Memory shelf offers, on the page the shelf opens: someone
  // browsing themes who wants one more should not have to walk back up to
  // Memory to start it. Only the four types a person authors get it — the rest
  // arrive as material or as a card to approve (see HAND_CREATABLE_TYPES).
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

  const viewToggle = altLayout && notes.length > 0 && (
    <div
      className="flex items-center rounded-lg bg-muted p-0.5"
      role="group"
      aria-label={`${dir} view`}
    >
      {([altLayout, 'list'] as const).map((v) => (
        <button
          key={v}
          className={`rounded-md px-2 py-0.5 text-xs font-medium capitalize transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
            view === v
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setView(v)}
          aria-pressed={view === v}
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
        // Esc drops the selection, ⌘A takes the whole filtered list.
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
        crumbs={[{ label: 'Memory', onClick: (e) => openMemory(navFromEvent(e)) }]}
        label={dir}
        labelClassName="capitalize"
        meta={!altMode && filtersActive ? `${filtered.length} of ${notes.length}` : notes.length}
      >
        {newAction}
      </PageHeader>

      {altMode && altLayout === 'week' && (
        <MeetingWeek
          notes={notes}
          allTags={allTags}
          contextFacet={contextFacet}
          onToggleContext={(t) => setContextFacet((c) => (c === t ? null : t))}
          toolbarLead={viewToggle}
        />
      )}

      {altMode && altLayout === 'board' && (
        <TicketBoard
          notes={notes}
          allTags={allTags}
          contextFacet={contextFacet}
          onToggleContext={(t) => setContextFacet((c) => (c === t ? null : t))}
          toolbarLead={viewToggle}
        />
      )}

      {!altMode && notes.length > 0 && (
        <div className="shrink-0 border-b border-border/70 px-4 py-2">
          <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-x-3 gap-y-1.5">
            {viewToggle}
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
                placeholder={`Filter ${dir}…  ( / )`}
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                aria-label={`Filter ${dir}`}
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

            {(allTags.length > 0 || lifecycles.length > 0) && (
              <div className="flex flex-wrap items-center gap-1">
                {allTags.map((t) => (
                  <TagChip
                    key={t}
                    tag={t}
                    active={contextFacet === t}
                    onToggle={() => setContextFacet((c) => (c === t ? null : t))}
                  />
                ))}
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

            <div
              className="ml-auto flex items-center rounded-lg bg-muted p-0.5"
              role="group"
              aria-label="Group by"
            >
              {(['date', 'none'] as const).map((g) => (
                <button
                  key={g}
                  className={`rounded-md px-2 py-0.5 text-xs font-medium capitalize transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
                    groupBy === g
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setGroupBy(g)}
                  aria-pressed={groupBy === g}
                >
                  {g === 'none' ? 'flat' : g}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {!altMode && <SelectionBar selection={selection} total={filtered.length} />}

      {!altMode && (
        <div ref={listRef} className="flex-1 overflow-y-auto px-8 py-3">
          <div className="mx-auto w-full max-w-2xl">
            {notes.length === 0 ? (
              <div className="px-1 py-2">
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
            ) : filtered.length === 0 ? (
              <div className="px-1 py-4 text-sm text-muted-foreground">
                <p>
                  No {dir} match{filter.trim() ? ` “${filter.trim()}”` : ' these filters'}. ⌘K
                  searches the whole workspace.
                </p>
                <Button variant="outline" size="sm" className="mt-2" onClick={clearFilters}>
                  Clear filters
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {sections.map((s) => (
                  <section key={s.key}>
                    {s.heading && (
                      <div className="mb-0.5 flex items-baseline gap-2 px-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          {s.heading.label}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {s.rows.length}
                        </span>
                      </div>
                    )}
                    <NoteList
                      rows={s.rows}
                      empty=""
                      omitTag={contextFacet ?? undefined}
                      selection={selection}
                    />
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <ScopedAskComposer
        scope={{ kind: 'folder', label: dir }}
        sessionTitle={`Ask · ${dir}`}
        scopePrefix={`Scoped to the ${dir} folder.`}
      />
    </div>
  );
}
