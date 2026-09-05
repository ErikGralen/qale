import { noteTypeLabel } from '@qale/domain';
import { Check, CornerDownRight } from 'lucide-react';
import type { NoteRefDTO } from '@qale/ipc';
import { useApp } from '../state/app-state';
import { navFromEvent } from '../lib/nav';
import { formatRefDate } from '../lib/contexts';
import { moveRowFocus } from '../lib/row-focus';
import type { Selection } from '../lib/selection';

/** "[[decisions/foo]]" → "decisions/foo" (null for external refs). */
function refSlug(ref: string): string | null {
  const m = /^\[\[([^\]]+)\]\]$/.exec(ref.trim());
  return m?.[1] ?? null;
}

/**
 * The note behind a supersedes ref, so a row can show a title and not a slug.
 *
 * Few rows have a chain, but every row would pay for the lookup if each one
 * walked the tree. The index is built once per tree and thrown away with it.
 */
const slugIndex = new WeakMap<object, Map<string, NoteRefDTO>>();

function noteBySlug(tree: { groups: { notes: NoteRefDTO[] }[] } | null, slug: string) {
  if (!tree) return undefined;
  let index = slugIndex.get(tree);
  if (!index) {
    index = new Map<string, NoteRefDTO>();
    for (const g of tree.groups) for (const n of g.notes) index.set(n.slug, n);
    slugIndex.set(tree, index);
  }
  return index.get(slug);
}

/**
 * One note, as a row: the title on its own line, the metadata in a fixed rail
 * on the right.
 *
 * The checkbox model lives here and nowhere else: a click opens, the checkbox
 * selects. Documents draws its own row instead (see {@link DocumentRow}),
 * because there the row IS the selection.
 */
function NoteRow({
  note: n,
  showType = false,
  selection,
}: {
  note: NoteRefDTO;
  showType?: boolean;
  /** Makes the row selectable. It must be in the selection's ordering. */
  selection?: Selection;
}) {
  const { openDoc, tree } = useApp();

  const superseded = n.lifecycle === 'superseded';
  // A cancelled synced meeting stays visible (its notes may matter) but reads
  // as struck history, not an upcoming commitment.
  const cancelled = n.eventStatus === 'cancelled';
  const chain = n.supersedes ? refSlug(n.supersedes) : null;
  const chainNote = chain ? noteBySlug(tree, chain) : undefined;
  const picked = selection?.isSelected(n.path) ?? false;

  return (
    <li
      className={`group relative ${picked ? 'bg-brand/8' : 'hover:bg-accent/40'} ${superseded || cancelled ? 'opacity-65' : ''}`}
    >
      <button
        data-note-row
        className="absolute inset-0 w-full cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-none"
        onClick={(e) => {
          // Shift on an armed list extends the range. ⌘⇧click keeps its
          // browser meaning (open in a focused new tab), so it is checked
          // first and never gets read as a selection gesture.
          if (selection?.active && e.shiftKey && !e.metaKey && !e.ctrlKey) {
            selection.toggle(n.path, { range: true });
            return;
          }
          void openDoc(n.path, navFromEvent(e));
        }}
        onAuxClick={(e) => e.button === 1 && void openDoc(n.path, navFromEvent(e))}
        aria-label={n.title}
        // The summary left the row, so it waits here: one hover, no cost to
        // the line. (`aria-label` still names the row.)
        title={n.summary || undefined}
      />
      <div className="pointer-events-none relative flex items-start gap-2 py-2 pr-2 pl-2">
        {selection && (
          <span className="pointer-events-auto flex h-5 shrink-0 items-center">
            <button
              role="checkbox"
              aria-checked={picked}
              aria-label={`Select ${n.title}`}
              title={picked ? 'Deselect (⇧ picks a range)' : 'Select (⇧ picks a range)'}
              className={`flex size-4 items-center justify-center rounded-[4px] border transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
                picked
                  ? 'border-brand bg-brand text-brand-foreground'
                  : 'border-input bg-card hover:border-brand'
              } ${picked || selection.active ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`}
              onClick={(e) => {
                e.stopPropagation();
                selection.toggle(n.path, { range: e.shiftKey });
              }}
            >
              {picked && <Check className="size-3" aria-hidden />}
            </button>
          </span>
        )}
        {/* The title. It wraps to a second line rather than truncate: a
            decision's title is a whole sentence, and half of one is not
            something you can recognise at a glance. */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={`line-clamp-2 text-sm font-medium text-pretty ${cancelled ? 'line-through' : ''}`}
          >
            {n.title}
          </span>
          {chain && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <CornerDownRight className="size-3 shrink-0" aria-hidden />
              <span>supersedes</span>
              {chainNote ? (
                <button
                  className="pointer-events-auto truncate font-medium text-foreground/80 hover:text-brand focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  onClick={(e) => void openDoc(chainNote.path, navFromEvent(e))}
                >
                  {chainNote.title}
                </button>
              ) : (
                <span className="truncate">{chain}</span>
              )}
            </div>
          )}
        </div>

        {/* The metadata rail: one line tall, on the title's first line, never
            wider than what it holds. */}
        <div className="flex h-5 shrink-0 items-center gap-1.5">
          {showType && (
            <span className="text-xs text-muted-foreground">{noteTypeLabel(n.type)}</span>
          )}
          {superseded && <span className="text-xs text-muted-foreground">superseded</span>}
          {cancelled && <span className="text-xs text-muted-foreground">cancelled</span>}
          <span className="text-xs text-muted-foreground tabular-nums">{formatRefDate(n)}</span>
        </div>
      </div>
    </li>
  );
}

/**
 * Shared note listing — smart views, folder browse pages, context pages.
 * Dense rows on hairline separators (cards were the clutter): the title is the
 * row, and it gets the whole line. Everything else (the date, a state word) is
 * metadata that sits in a fixed rail on the right and never takes width from
 * the title. Decisions show their supersedes-chain so the spine is readable
 * in-list.
 *
 * Rows carry no tags. The agent files a note into its contexts and a chip on
 * every line only taught that vocabulary back at the PO; the tags are on the
 * note, in the Details fold, where they can be read and nobody is asked to keep
 * them true.
 *
 * There is no summary line. A browse page is for *finding*, and a one-line
 * fragment cut mid-sentence never finished a thought — it only halved the
 * number of titles in view. The summary is still searched by the page filter,
 * and it rides the row as its tooltip.
 *
 * Rows use the stretched-button pattern: the row is one big button, chips and
 * chain links float above it and stay independently clickable.
 *
 * With a `selection` the rows grow a checkbox, which is the ONLY thing that
 * selects: a plain click still opens the note, selection or not, so the page
 * never turns into a mode where clicking does something else than it did a
 * second ago. Shift is the one shortcut on the row itself, and only once
 * something is selected — there is a range to extend by then.
 *
 * Organising (right-click, drag, rename in place) is not here. It belongs to
 * one page, Documents, where the folders are the user's own, and it lives on
 * that page's own row.
 */
export function NoteList({
  rows,
  empty,
  showType = false,
  selection,
}: {
  rows: NoteRefDTO[];
  empty: string;
  showType?: boolean;
  /** Makes the rows selectable. Every row shown here must be in its ordering. */
  selection?: Selection;
}) {
  if (rows.length === 0) return <p className="px-1 py-2 text-sm text-muted-foreground">{empty}</p>;

  return (
    <ul
      className="flex flex-col divide-y divide-border/70"
      onKeyDown={(e) => {
        moveRowFocus(e);
      }}
    >
      {rows.map((n) => (
        <NoteRow key={n.path} note={n} showType={showType} selection={selection} />
      ))}
    </ul>
  );
}
