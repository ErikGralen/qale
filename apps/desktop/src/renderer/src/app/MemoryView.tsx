import { useMemo } from 'react';
import { dirForType, isFolderIndex, layerForType } from '@qale/domain';
import { Button } from '@qale/ui';
import { ChevronRight, FileUp, Library } from 'lucide-react';
import type { NoteType, VaultTreeGroupDTO } from '@qale/ipc';
import { useApp } from '../state/app-state';
import { MEMORY_SHELVES, navFromEvent } from '../lib/nav';
import { requestCapture } from '../lib/capture-event';
import { PageHeader } from '../components/PageHeader';
import { noteTypeIcon } from '../lib/note-icons';
import { unprocessedSourceCount } from '../lib/note-status';

/**
 * What each shelf holds, in the words a person would use. One clause is the
 * budget: note titles here read as bloat, and the row truncates anyway.
 */
const TYPE_DESC: Partial<Record<NoteType, string>> = {
  decision: 'What was decided, and what each call replaced.',
  theme: 'Problems worth solving, and the evidence behind them.',
  source: 'What you dropped in: transcripts, articles, files. Kept as they came.',
  insight: 'One claim per page, each with the quote it came from.',
  customer: 'The accounts Qale knows about.',
  person: 'The people you work with: what they care about, what they were last told.',
};

/**
 * One shelf: what it holds, how much, and anything on it waiting for the PO.
 *
 * No "+" anywhere on this page. A decision is recorded by telling Qale, and
 * customers and people arrive with the meetings they are in
 * (docs/memory-placement.md). The one hand-made page left starts from the
 * shelf's own folder page.
 */
function ShelfRow({ group, attention }: { group: VaultTreeGroupDTO; attention?: string | null }) {
  const { openFolder } = useApp();
  const notes = useMemo(() => group.notes.filter((n) => !isFolderIndex(n.path)), [group]);
  const Icon = noteTypeIcon(group.type);
  return (
    <li className="flex items-center gap-0.5">
      <button
        className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-150 hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={(e) => openFolder(group.dir, navFromEvent(e))}
        title={`Browse all ${group.dir}`}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="text-sm font-medium capitalize">{group.dir}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{notes.length}</span>
            {attention && <span className="text-xs font-medium text-warning">{attention}</span>}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {TYPE_DESC[group.type] ?? `No ${group.dir} yet.`}
          </span>
        </span>
        <ChevronRight
          className="size-3.5 shrink-0 text-muted-foreground/0 transition-colors duration-150 group-hover:text-muted-foreground/60"
          aria-hidden
        />
      </button>
    </li>
  );
}

/**
 * Day one, before anything is filed. The shelves alone cannot say how anything
 * gets onto them, so one sentence and one button do. It drops away as soon as
 * the page holds something.
 */
function FirstRun() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 pt-10">
      <h1 className="font-serif text-2xl font-semibold tracking-tight text-balance">
        Nothing here yet.
      </h1>
      <p className="text-sm text-muted-foreground">
        Give Qale a meeting recording, an article, or any file. It reads what you give it and keeps
        what matters on the shelves below, with a link back to where it came from.
      </p>
      <div>
        <Button size="sm" onClick={() => requestCapture()}>
          <FileUp className="size-3.5" /> Add something
        </Button>
      </div>
    </div>
  );
}

/**
 * The one door to what Qale knows, with the types kept apart behind it (E-16):
 * one shelf per type, in a flat list. Each row says what the shelf holds, how
 * much, and anything on it waiting for the PO — never individual note titles,
 * which read as inventory bloat. Week 6 reads fuller than week 1 through the
 * counts, not through rows that appear out of nowhere.
 *
 * Every shelf renders from day one, empty or not: this page is the map of what
 * the workspace can hold, so nothing is drip-fed. The rail stays small a
 * different way: Memory is one quiet row in the footer, and nothing pins under
 * it (docs/memory-placement.md).
 *
 * Meetings and notes are not here. A meeting belongs to the Calendar and a note
 * to Documents, and a type with two homes is a type the user has to guess
 * about. People are a shelf rather than a rail row (E-17): a person page earns
 * its keep, a People directory does not.
 *
 * Sessions are deliberately absent too: a session receipt is a record the user
 * never authors, and it already has a home in the Sessions rail. It stays
 * addressable ([[sessions/…]] links resolve, backlinks work) without costing
 * a shelf here.
 *
 * Tickets and wiki pages are not here either. Qale copies them and never writes
 * them, so they belong to the system they came from.
 */
export function MemoryView() {
  const { tree } = useApp();
  const byType = useMemo(() => {
    const m = new Map<NoteType, VaultTreeGroupDTO>();
    for (const g of tree?.groups ?? []) m.set(g.type, g);
    return m;
  }, [tree]);
  // Every shelf renders, empty or not — synthesized when the workspace holds
  // none of that type yet.
  const groupFor = (t: NoteType): VaultTreeGroupDTO =>
    byType.get(t) ?? { dir: dirForType(t), type: t, layer: layerForType(t), notes: [] };

  // The header count has to match what the shelves add up to, so it is summed
  // over exactly the shelves this page shows. Meetings, notes and todos live on
  // their own rails and are counted there, and a mirror belongs to the system it
  // came from.
  const total = MEMORY_SHELVES.reduce(
    (sum, t) => sum + groupFor(t).notes.filter((n) => !isFolderIndex(n.path)).length,
    0,
  );
  // The same number the Memory row in the rail prints, from the same selector,
  // so the row and the shelf can never disagree.
  const unprocessed = unprocessedSourceCount(tree);

  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={Library} label="Memory" meta={total} />

      <div className="flex-1 overflow-y-auto px-8 py-4">
        <div className="mx-auto w-full max-w-2xl">
          {/* An empty page gets the invitation above the shelves, not instead of
              them: the whole ceiling is visible from the first launch. */}
          {total === 0 && <FirstRun />}
          <ul className={`flex flex-col gap-0.5 ${total === 0 ? 'mt-8' : ''}`}>
            {MEMORY_SHELVES.map((t) => (
              <ShelfRow
                key={t}
                group={groupFor(t)}
                attention={
                  t === 'source' && unprocessed > 0 ? `${unprocessed} unprocessed` : undefined
                }
              />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
