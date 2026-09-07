import { noteTypeLabel } from '@qale/domain';
import { CornerDownRight } from 'lucide-react';
import type { NoteRefDTO } from '@qale/ipc';
import { useApp } from '../state/app-state';
import { navFromEvent } from '../lib/nav';
import { refSlug } from '../lib/frontmatter';
import { formatRefDate } from '../lib/contexts';
import { FileList } from '../components/FileList';
import { FileRow } from '../components/FileRow';
import type { Selection } from '../lib/selection';

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
 * The one thing that gets a second line: what this decision replaced.
 *
 * Only decisions carry a chain, and the decision spine being readable in-list
 * is something this app built on purpose. Every other row stays one line.
 */
export function SupersedesChain({ slug }: { slug: string }) {
  const { openDoc, tree } = useApp();
  const chainNote = noteBySlug(tree, slug);
  return (
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
        <span className="truncate">{slug}</span>
      )}
    </div>
  );
}

/**
 * Shared note listing — smart views, folder browse pages, context pages.
 *
 * It draws the one file row (see {@link FileRow}), and it holds only what those
 * pages put in the rail: the type when the page mixes types, a lifecycle word,
 * and the note's own reference date. A decision also gets its supersedes chain
 * as a second line.
 *
 * Rows carry no tags. The agent files a note into its contexts and a chip on
 * every line only taught that vocabulary back at the PO; the tags are on the
 * note, in the Details fold, where they can be read and nobody is asked to keep
 * them true.
 *
 * There is no summary line either. A browse page is for *finding*, and a
 * one-line fragment cut mid-sentence never finished a thought. The summary is
 * still searched by the page filter, and it rides the row as its tooltip.
 *
 * With a `selection` the rows pick the way they pick everywhere else: a click
 * picks the row, a double click opens it. One model on every list, so the
 * gesture a PM learns on one page is the gesture on all of them.
 *
 * Organising (right-click, drag, rename in place) is not here. It belongs to
 * one page, Documents, where the folders are the user's own.
 */
export function NoteList({
  rows,
  empty,
  label,
  showType = false,
  selection,
}: {
  rows: NoteRefDTO[];
  empty: string;
  /** What a screen reader calls this run of rows. A page that draws several
   *  names each one, so the two are told apart. */
  label: string;
  showType?: boolean;
  /** Makes the rows selectable. Every row shown here must be in its ordering. */
  selection?: Selection;
}) {
  if (rows.length === 0) return <p className="px-1 py-2 text-sm text-muted-foreground">{empty}</p>;

  return (
    <FileList label={label} multiselectable={selection !== undefined}>
      {rows.map((n) => {
        const chain = n.supersedes ? refSlug(n.supersedes) : null;
        return (
          <FileRow
            key={n.path}
            note={n}
            selection={selection}
            subline={chain ? <SupersedesChain slug={chain} /> : undefined}
            // The rail: one line tall, on the title's line, never wider than
            // what it holds. The date is the note's own reference date, never
            // the file's mtime — a decision's date is what a person means by
            // "when".
            meta={
              <div className="flex h-5 shrink-0 items-center gap-1.5">
                {showType && (
                  <span className="text-xs text-muted-foreground">{noteTypeLabel(n.type)}</span>
                )}
                {n.lifecycle === 'superseded' && (
                  <span className="text-xs text-muted-foreground">superseded</span>
                )}
                {n.eventStatus === 'cancelled' && (
                  <span className="text-xs text-muted-foreground">cancelled</span>
                )}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatRefDate(n)}
                </span>
              </div>
            }
          />
        );
      })}
    </FileList>
  );
}
