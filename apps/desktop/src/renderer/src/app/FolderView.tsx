import { useMemo, useRef, useState } from 'react';
import { Button } from '@pm/ui';
import { AlertTriangle, Folder, Search, Sparkles, X } from 'lucide-react';
import type { NoteRefDTO, NoteType } from '@pm/ipc';
import { useApp } from '../state/app-state';
import { NoteList } from './NoteList';
import { TagChip } from '../components/TagChip';
import { monthBucket, refDate } from '../lib/contexts';

type GroupBy = 'context' | 'date' | 'none';

/** What an empty folder means — teach the mechanism, don't just say "nothing". */
const EMPTY_TEACH: Partial<Record<NoteType, string>> = {
  source: 'No sources yet. Dumped raw material — article links, screenshots, pasted threads — lands here, never edited, only analyzed.',
  meeting: 'No meetings yet. Drop a transcript (or paste one with ⇧⌘N) and After-Meeting files it here.',
  decision:
    'No decisions yet. Approve a decision card from a meeting and the spine starts here — superseded ones keep their place in the chain.',
  insight: 'No insights yet. Claims the agent extracts from meetings land here, each citing its evidence.',
  customer: 'No customers yet. They appear as meetings and insights start naming them.',
  problem: 'No problems yet. Durable problem statements accrete here as evidence builds.',
  release: 'No releases yet. Planned and shipped releases are tracked here.',
  person: 'No people yet. Stakeholders appear here with what they care about and what they were last told.',
  skill: 'No skills yet. Session playbooks — markdown files the agent follows — live here.',
  note: 'No notes yet. Start one with ⌘N; captures that are not typed records land here too.',
};

/** Statuses worth a facet chip, per folder (frontmatter `status` values). */
const STATUS_ORDER = ['new', 'processed', 'active', 'stale', 'superseded', 'planned', 'shipped', 'prospect', 'churned'];

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
    tone === 'warning' ? 'bg-warning/15 text-warning ring-1 ring-warning/40' : 'bg-foreground/85 text-background';
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
 * Instant filter, facet chips, and grouping by context by default, so the
 * page reads the way the PO thinks: pricing things together, auth things
 * together. Docked Ask composer stays scoped to the folder.
 */
export function FolderView({ dir }: { dir: string }) {
  const { tree, openSession } = useApp();
  const [ask, setAsk] = useState('');
  const [filter, setFilter] = useState('');
  const [contextFacet, setContextFacet] = useState<string | null>(null);
  // Decisions default to the live spine — superseded ones are one click away.
  const [statusFacet, setStatusFacet] = useState<string | null>(dir === 'decisions' ? 'active' : null);
  const [chosenGroupBy, setChosenGroupBy] = useState<GroupBy | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const group = tree?.groups.find((g) => g.dir === dir);
  const notes = useMemo(() => (group?.notes ?? []).filter((n) => !n.path.endsWith('/index.md')), [group]);

  const allTags = useMemo(() => {
    const freq = new Map<string, number>();
    for (const n of notes) for (const t of n.tags ?? []) freq.set(t, (freq.get(t) ?? 0) + 1);
    return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  }, [notes]);

  const statuses = useMemo(() => {
    const present = new Set(notes.map((n) => n.status).filter((s): s is string => !!s));
    return STATUS_ORDER.filter((s) => present.has(s));
  }, [notes]);

  // Group by context when the folder has any; meetings and untagged folders read by date.
  const groupBy: GroupBy = chosenGroupBy ?? (allTags.length > 0 ? 'context' : 'date');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return notes
      .filter((n) => {
        if (contextFacet && !n.tags?.includes(contextFacet)) return false;
        if (statusFacet && n.status !== statusFacet) return false;
        if (!q) return true;
        const hay = `${n.title} ${n.summary} ${(n.tags ?? []).join(' ')}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => refDate(b).getTime() - refDate(a).getTime());
  }, [notes, filter, contextFacet, statusFacet]);

  const sections = useMemo((): { key: string; heading?: { tag?: string; label: string }; rows: NoteRefDTO[] }[] => {
    if (groupBy === 'none' || (groupBy === 'context' && contextFacet)) {
      return [{ key: 'all', rows: filtered }];
    }
    if (groupBy === 'date') {
      const buckets = new Map<string, NoteRefDTO[]>();
      for (const n of filtered) {
        const b = monthBucket(n);
        buckets.set(b, [...(buckets.get(b) ?? []), n]);
      }
      return [...buckets.entries()].map(([label, rows]) => ({ key: label, heading: { label }, rows }));
    }
    // context: a note under every context it carries — this is a browse surface, not an inventory.
    const out: { key: string; heading?: { tag?: string; label: string }; rows: NoteRefDTO[] }[] = [];
    for (const tag of allTags) {
      const rows = filtered.filter((n) => n.tags?.includes(tag));
      if (rows.length > 0) out.push({ key: tag, heading: { tag, label: tag }, rows });
    }
    const untagged = filtered.filter((n) => !n.tags || n.tags.length === 0);
    if (untagged.length > 0) out.push({ key: '·untagged', heading: { label: 'untagged' }, rows: untagged });
    return out;
  }, [groupBy, contextFacet, filtered, allTags]);

  const filtersActive = filter.trim() !== '' || contextFacet !== null || statusFacet !== null;
  const emptyTeach = group ? (EMPTY_TEACH[group.type] ?? `No notes in ${dir}/ yet.`) : `No notes in ${dir}/ yet.`;

  const clearFilters = () => {
    setFilter('');
    setContextFacet(null);
    setStatusFacet(null);
    filterRef.current?.focus();
  };

  const runAsk = () => {
    const q = ask.trim();
    if (!q) return;
    setAsk('');
    openSession('ask', {
      title: `Ask · ${dir}`,
      initialPrompt: `Scoped to the ${dir}/ folder. ${q}`,
    });
  };

  return (
    <div
      className="flex h-full flex-col"
      onKeyDown={(e) => {
        // `/` focuses the filter from anywhere on the page (not while typing).
        const t = e.target as HTMLElement;
        if (e.key === '/' && t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') {
          e.preventDefault();
          filterRef.current?.focus();
        }
      }}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-5 text-sm font-medium text-muted-foreground">
        <Folder className="size-4" /> <span className="capitalize">{dir}</span>
        <span className="text-xs tabular-nums">
          {filtersActive ? `· ${filtered.length} of ${notes.length}` : `· ${notes.length}`}
        </span>
      </div>

      {notes.length > 0 && (
        <div className="shrink-0 border-b border-border/70 px-5 py-2">
          <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-x-3 gap-y-1.5">
            <div className="flex h-7 min-w-40 flex-1 items-center gap-1.5 rounded-lg border border-border bg-card px-2 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
              <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <input
                ref={filterRef}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setFilter('');
                  else if (e.key === 'ArrowDown') {
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

            {(allTags.length > 0 || statuses.length > 0) && (
              <div className="flex flex-wrap items-center gap-1">
                {allTags.map((t) => (
                  <TagChip
                    key={t}
                    tag={t}
                    active={contextFacet === t}
                    onToggle={() => setContextFacet((c) => (c === t ? null : t))}
                  />
                ))}
                {statuses.map((s) => (
                  <FacetChip
                    key={s}
                    label={s}
                    active={statusFacet === s}
                    onToggle={() => setStatusFacet((c) => (c === s ? null : s))}
                  />
                ))}
              </div>
            )}

            <div className="ml-auto flex items-center rounded-lg bg-muted p-0.5" role="group" aria-label="Group by">
              {(['context', 'date', 'none'] as const).map((g) => (
                <button
                  key={g}
                  className={`rounded-md px-2 py-0.5 text-xs font-medium capitalize transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
                    groupBy === g ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setChosenGroupBy(g)}
                  aria-pressed={groupBy === g}
                >
                  {g === 'none' ? 'flat' : g}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto px-8 py-3">
        <div className="mx-auto w-full max-w-2xl">
          {notes.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">{emptyTeach}</p>
          ) : filtered.length === 0 ? (
            <div className="px-1 py-4 text-sm text-muted-foreground">
              <p>
                No {dir} match{filter.trim() ? ` “${filter.trim()}”` : ' these filters'} — ⌘K searches the whole
                workspace.
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
                      {s.heading.tag ? (
                        <TagChip tag={s.heading.tag} />
                      ) : (
                        <span className="text-xs font-medium text-muted-foreground">{s.heading.label}</span>
                      )}
                      <span className="text-xs text-muted-foreground tabular-nums">{s.rows.length}</span>
                    </div>
                  )}
                  <NoteList rows={s.rows} empty="" omitTag={s.heading?.tag ?? contextFacet ?? undefined} />
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 px-6 pb-5">
        <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-xl border border-border bg-card p-2 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
          <Sparkles className="mb-1.5 ml-1 size-4 shrink-0 text-brand" />
          <textarea
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                runAsk();
              }
            }}
            placeholder={`Ask about ${dir}…`}
            rows={1}
            className="max-h-40 flex-1 resize-none bg-transparent px-1 py-1 text-[15px] outline-none"
          />
          <Button size="sm" onClick={runAsk} disabled={!ask.trim()}>
            Ask
          </Button>
        </div>
      </div>
    </div>
  );
}
