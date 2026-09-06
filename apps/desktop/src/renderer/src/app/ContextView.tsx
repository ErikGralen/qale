import { useMemo } from 'react';
import { Hash } from 'lucide-react';
import { dirForType, noteTypeLabel } from '@qale/domain';
import type { NoteRefDTO, NoteType } from '@qale/ipc';
import { useApp } from '../state/app-state';
import { NoteList } from './NoteList';
import { ListSection } from '../components/ListSection';
import { PageHeader } from '../components/PageHeader';
import { ScopedAskComposer } from '../components/ScopedAskComposer';
import { SelectionBar } from '../components/SelectionBar';
import { notesInContext, refDate, SPINE_ORDER } from '../lib/contexts';
import { selectionKeyDown, useSelection } from '../lib/selection';

/**
 * Section labels in spine order — how a context page reads. Only the content
 * types get one: sessions and skills are chrome, never sections here.
 */
const SECTION_LABEL: Partial<Record<NoteType, string>> = {
  decision: 'Decisions',
  research: 'Research',
  insight: 'Insights',
  todo: 'Todos',
  customer: 'Customers',
  person: 'People',
  meeting: 'Meetings',
  note: `${noteTypeLabel('note')}s`,
  source: 'Sources',
  // Mirrors read as the system they copy ("Jira mirrors"), not as a shelf of
  // the memory — one vocabulary, from @qale/domain.
  ticket: `${noteTypeLabel('ticket')}s`,
  wikipage: `${noteTypeLabel('wikipage')}s`,
};

/** Long sections truncate to this; the folder browse page has the full list. */
const SECTION_LIMIT = 8;

/**
 * A context page — everything the memory holds about one project, product, or
 * area, across note types. Reads in spine order: what we decided, what we're
 * working on, what we learned, what shipped, then the surrounding cast. This
 * is the page behind every #chip in the app.
 */
export function ContextView({ tag }: { tag: string }) {
  const { tree, openFolder } = useApp();

  const notes = useMemo(() => notesInContext(tree, tag), [tree, tag]);

  const sections = useMemo(() => {
    const byType = new Map<NoteType, NoteRefDTO[]>();
    for (const n of notes) byType.set(n.type, [...(byType.get(n.type) ?? []), n]);
    return SPINE_ORDER.filter((t) => byType.has(t)).map((t) => {
      const rows = (byType.get(t) ?? []).sort(
        (a, b) => refDate(b).getTime() - refDate(a).getTime(),
      );
      return { type: t, rows, shown: rows.slice(0, SECTION_LIMIT) };
    });
  }, [notes]);

  // Selection runs across the sections, in reading order, and only over rows
  // the page actually shows: a truncated section's tail belongs to the folder
  // page, and a batch must never reach further than the eye can check.
  const ordered = useMemo(() => sections.flatMap((s) => s.shown.map((n) => n.path)), [sections]);
  const selection = useSelection(ordered);

  return (
    // The rows ARE the selection here, so ⌘A belongs to the list whether or not
    // something is picked already. Escape drops the selection, in the same
    // helper.
    <div
      className="flex h-full flex-col"
      onKeyDown={(e) => void selectionKeyDown(e, selection)}
    >
      <PageHeader
        icon={Hash}
        iconClassName="text-brand"
        label={tag}
        meta={notes.length}
        selecting={selection.count > 0}
      >
        <SelectionBar selection={selection} total={ordered.length} />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-8 py-4">
        <div className="mx-auto w-full max-w-2xl">
          {notes.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">
              Nothing tagged #{tag} yet. Qale suggests tags when it files something: approve a
              proposal that carries this tag and this page fills up.
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              {sections.map((s) => {
                // The on-disk folder, not the display label — 'wiki pages' opens nothing.
                const dirName = dirForType(s.type);
                const label = SECTION_LABEL[s.type] ?? dirName;
                const truncated = s.rows.length > s.shown.length;
                return (
                  <ListSection key={s.type} label={label} count={s.rows.length}>
                    <NoteList rows={s.shown} empty="" label={label} selection={selection} />
                    {truncated && (
                      <button
                        className="mt-1 rounded px-2 text-xs font-medium text-brand hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                        onClick={() => openFolder(dirName)}
                      >
                        See all {s.rows.length} {label.toLowerCase()} →
                      </button>
                    )}
                  </ListSection>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ScopedAskComposer
        scope={{ kind: 'context', label: tag, filter: { tags: [tag] } }}
        sessionTitle={`Ask · #${tag}`}
        scopePrefix={`Scoped to notes tagged "${tag}".`}
      />
    </div>
  );
}
