import { Fragment, useCallback, useMemo, useState } from 'react';
import { dirForType, isFolderIndex, layerForType } from '@qale/domain';
import { Button } from '@qale/ui';
import { FileUp, Library } from 'lucide-react';
import type { NoteRefDTO, NoteType, VaultTreeGroupDTO } from '@qale/ipc';
import { useApp } from '../state/app-state';
import { MEMORY_SHELVES } from '../lib/nav';
import { requestCapture } from '../lib/capture-event';
import { PageHeader } from '../components/PageHeader';
import { FileList } from '../components/FileList';
import { FileRow, META_COL } from '../components/FileRow';
import { SelectionBar } from '../components/SelectionBar';
import { FolderListRow } from './FolderListRow';
import { formatRefDate, refDate } from '../lib/contexts';
import { toggleExpanded } from '../lib/files';
import { moveRowFocus } from '../lib/row-focus';
import { noteTypeIcon } from '../lib/note-icons';
import { unprocessedSourceCount } from '../lib/note-status';
import { selectionKeyDown, useSelection } from '../lib/selection';

/**
 * What a shelf counts, singular and plural. A bare number says nothing, and
 * "12 documents" is wrong on every shelf here. Four of the seven take an s;
 * "people", "research pages" and "about pages" are why the pair is written out.
 */
const SHELF_NOUN: Record<string, [string, string]> = {
  about: ['about page', 'about pages'],
  source: ['source', 'sources'],
  decision: ['decision', 'decisions'],
  insight: ['insight', 'insights'],
  research: ['research page', 'research pages'],
  customer: ['customer', 'customers'],
  person: ['person', 'people'],
};

/** The shelf name, as a title. The folder is `decisions`; the shelf is
 *  "Decisions", the same word the context pages use. */
function shelfName(dir: string): string {
  return dir.charAt(0).toUpperCase() + dir.slice(1);
}

/**
 * Day one, before anything is filed. The shelves alone cannot say how anything
 * gets onto them, so one sentence and one button do. It drops away as soon as
 * the page holds something.
 */
function FirstRun() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-8 pt-10 pb-8">
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
 * one shelf per type, in a flat list. About is first: what is true about you
 * and the company is the background everything else is read against
 * (docs/learning-how-you-work.md, ticket 16).
 *
 * It is the same tree Documents is, and for the same reason: this page was
 * always a folder list, so it now reads like one. One `role="tree"` at full
 * pane width, one row per shelf, the count in the right-hand rail. The chevron
 * opens a shelf in place and lists its notes newest first by their own
 * reference date. Which shelves are open rides the tab's history entry, so it
 * survives a tab switch and the back arrow.
 *
 * A shelf has no context menu. Qale files these notes, so a shelf is not a
 * folder anyone can rename or throw away, and no `+` appears anywhere on this
 * page: a decision is recorded by telling Qale, and customers and people arrive
 * with the meetings they are in (docs/memory-placement.md). The one hand-made
 * page left starts from the shelf's own folder page.
 *
 * The rows pick the way every other list picks (see {@link FileRow}): a click
 * takes a row, a double click or ↵ opens it. A shelf row picks too, but it
 * stays out of the note selection, because nothing a batch does applies to a
 * shelf. Picking a shelf drops the notes, and picking a note drops the shelf,
 * so only one thing is ever lit. What a batch can do here is delete: these
 * types do not pin (docs/memory-placement.md), so the bar offers the one action
 * that is real.
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
export function MemoryView({
  viewKey,
  expanded: expandedKeys,
}: {
  /** The history entry this page is. What is expanded rides on it. */
  viewKey: string;
  expanded?: string[];
}) {
  const { tree, openFolder, setExpanded } = useApp();
  // The picked shelf row. A shelf is not in the note selection (nothing the
  // selection bar does applies to one), but a click still has to land somewhere
  // visible, so the row wears the same ink wash a picked note does.
  const [pickedShelf, setPickedShelf] = useState<string | null>(null);

  const byType = useMemo(() => {
    const m = new Map<NoteType, VaultTreeGroupDTO>();
    for (const g of tree?.groups ?? []) m.set(g.type, g);
    return m;
  }, [tree]);

  // Every shelf renders, empty or not — synthesized when the workspace holds
  // none of that type yet.
  const groupFor = useCallback(
    (t: NoteType): VaultTreeGroupDTO =>
      byType.get(t) ?? { dir: dirForType(t), type: t, layer: layerForType(t), notes: [] },
    [byType],
  );

  // What each shelf shows when it opens: its own notes, newest first by the
  // note's own reference date, never the file's mtime. A decision's date is
  // what a person means by "when". Index files are navigation, never rows.
  const shelves = useMemo(
    () =>
      MEMORY_SHELVES.map((type) => {
        const group = groupFor(type);
        const notes: NoteRefDTO[] = group.notes
          .filter((n) => !isFolderIndex(n.path))
          .sort((a, b) => refDate(b).getTime() - refDate(a).getTime());
        return { type, dir: group.dir, notes };
      }),
    [groupFor],
  );

  const expanded = useMemo(() => new Set(expandedKeys ?? []), [expandedKeys]);
  const toggleShelf = useCallback(
    (dir: string) => setExpanded(viewKey, toggleExpanded(expandedKeys ?? [], dir)),
    [expandedKeys, setExpanded, viewKey],
  );

  // Selection covers every note on the screen, in the order the eye reads them,
  // so a shift-range picks up what it sweeps over. A shut shelf holds nothing
  // the PM can see, so its notes stay out and the hook prunes them from the
  // selection on its own.
  const ordered = useMemo(
    () =>
      shelves.flatMap((shelf) => (expanded.has(shelf.dir) ? shelf.notes.map((n) => n.path) : [])),
    [shelves, expanded],
  );
  const selection = useSelection(ordered);

  const pickShelf = (dir: string) => {
    selection.clear();
    setPickedShelf(dir);
  };

  // What the shelves add up to. The header does not print it — every shelf
  // carries its own count in the rail, and a page total on top of seven shelf
  // totals is a number nobody asked for. This one only decides whether the page
  // is empty enough to need the invitation.
  const total = shelves.reduce((sum, s) => sum + s.notes.length, 0);
  // The same number the Memory row in the rail prints, from the same selector,
  // so the row and the shelf can never disagree.
  const unprocessed = unprocessedSourceCount(tree);

  /**
   * The keys on the tree, the same ones Documents uses. Right opens the focused
   * shelf in place, left shuts it. Up and down are the list's own, and ↵ is the
   * row's.
   */
  const onTreeKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!moveRowFocus(e)) return;
      const el = document.activeElement as HTMLElement | null;
      const path = el?.dataset.docPath;
      const shelf = el?.dataset.folderKey;
      if (path) {
        if (e.shiftKey) selection.extend(path);
        else {
          selection.only(path);
          setPickedShelf(null);
        }
      } else if (shelf !== undefined && !e.shiftKey) {
        // A shelf has nothing to add to a note selection, so landing on one
        // ends it rather than pretending it is still going.
        pickShelf(shelf);
      }
      return;
    }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const key = (document.activeElement as HTMLElement | null)?.dataset.folderKey;
    if (!key) return;
    e.preventDefault();
    const open = expanded.has(key);
    if (e.key === 'ArrowRight' ? !open : open) toggleShelf(key);
  };

  return (
    <div
      className="flex h-full flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setPickedShelf(null);
        selectionKeyDown(e, selection);
      }}
    >
      <PageHeader icon={Library} label="Memory" selecting={selection.count > 0}>
        <SelectionBar selection={selection} total={ordered.length} noun="note" />
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* An empty page gets the invitation above the shelves, not instead of
            them: the whole ceiling is visible from the first launch. */}
        {total === 0 && <FirstRun />}
        <FileList label="Memory" multiselectable onKeyDown={onTreeKeyDown}>
          {shelves.map((shelf) => {
            const [noun, plural] = SHELF_NOUN[shelf.type] ?? ['page', 'pages'];
            const open = expanded.has(shelf.dir);
            return (
              <Fragment key={shelf.type}>
                <FolderListRow
                  folder={{ key: shelf.dir, name: shelfName(shelf.dir), depth: 0 }}
                  count={shelf.notes.length}
                  noun={noun}
                  plural={plural}
                  icon={noteTypeIcon(shelf.type)}
                  depth={0}
                  open={open}
                  picked={pickedShelf === shelf.dir}
                  onToggle={() => toggleShelf(shelf.dir)}
                  onPick={() => pickShelf(shelf.dir)}
                  onOpen={(nav) => openFolder(shelf.dir, nav)}
                  meta={
                    // What on this shelf is waiting for the PO, beside the
                    // count it qualifies.
                    shelf.type === 'source' && unprocessed > 0 ? (
                      <span className="text-xs font-medium text-warning">
                        {unprocessed} unprocessed
                      </span>
                    ) : undefined
                  }
                />
                {open &&
                  shelf.notes.map((n) => (
                    <FileRow
                      key={n.path}
                      note={n}
                      // The tree row: it sits one level in, under its shelf,
                      // and it is a treeitem like every other row here.
                      depth={1}
                      selection={selection}
                      onFocusRow={() => setPickedShelf(null)}
                      meta={
                        <span className={`${META_COL} text-xs text-muted-foreground tabular-nums`}>
                          {formatRefDate(n)}
                        </span>
                      }
                    />
                  ))}
              </Fragment>
            );
          })}
        </FileList>
      </div>
    </div>
  );
}
