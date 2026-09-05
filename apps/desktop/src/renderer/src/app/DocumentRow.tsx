import { useCallback, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@qale/ui';
import {
  FileText,
  Folder,
  FolderInput,
  Inbox,
  Pencil,
  SquareArrowOutUpRight,
  Trash2,
} from 'lucide-react';
import type { NoteRefDTO } from '@qale/ipc';
import { useApp } from '../state/app-state';
import { navFromEvent, type NavOpts } from '../lib/nav';
import { InlineRename } from '../components/InlineRename';
import { useDraggableDocuments } from '../lib/dnd';
import type { DocumentFolder } from '../lib/documents';
import type { Selection } from '../lib/selection';

/**
 * The Documents row, and the Finder model it obeys.
 *
 * Every other list in the app selects with a checkbox, so a click always opens.
 * Here the row IS the selection, the way a file manager does it, because here
 * the PM is organising and not reading. The mouse vocabulary, decided once:
 *
 *   click            pick this row, and only this row
 *   ⌘click           add this row to the selection, or take it out
 *   ⇧click           pick the anchor's row through this one
 *   double-click     open the document (a folder: go into it)
 *   ⌘⇧click          open in a new tab, in front
 *   middle-click     open in a new tab, behind
 *   ⌘double-click    open in a new tab
 *
 * ⌘click had to give up "new tab" for "toggle", which is the one place this
 * page departs from the rest of the app. ⌘⇧click and middle-click keep it, so
 * no gesture lost its meaning without another one taking it over.
 *
 * The keys match: ↵ opens, ⌘↵ opens in a new tab, and the arrows are the
 * page's (see DocumentsView).
 */

/** How far one level indents the rows under it, in rem. */
export const INDENT = 1.25;

/**
 * A document row's extra indent: the chevron column a folder row wears, which a
 * document has nothing to put in. It is what makes a document's glyph sit at
 * exactly the same x as a sibling folder's, so the two read as two kinds.
 */
export const DOC_INDENT = INDENT + 0.5;

/** What a right-click can do to one row (docs/documents-folders.md DF-4).
 *
 * The row draws the menu and owns the rename input; the page owns the writing.
 * Every callback may fail, and the page is the one that says so. */
export interface DocumentRowActions {
  /** Every folder under `notes/`, parent before child, for "Move to". */
  folders: DocumentFolder[];
  /** The folder this row sits in. It shows in "Move to", greyed: you are here. */
  current: string;
  /** '' is the top level (Documents). */
  onMove: (note: NoteRefDTO, folder: string) => void;
  /** The new title, trimmed and different from the old one. */
  onRename: (note: NoteRefDTO, title: string) => void;
  onDelete: (note: NoteRefDTO) => void;
}

/**
 * One row's `li`, and the reason it is a component: a row can be a drag source,
 * and the hook that makes it one cannot run inside the map.
 *
 * The `ref` is the context menu's, which the row hands down when it is a menu
 * trigger; it rides along with the drag ref.
 */
function RowShell({
  paths,
  className,
  children,
  ref,
}: {
  /** The documents this row drags. */
  paths: string[];
  className: string;
  children: ReactNode;
  ref?: Ref<HTMLLIElement>;
}) {
  const { ref: dragRef, dragging } = useDraggableDocuments(paths);
  const attach = useCallback(
    (el: HTMLLIElement | null) => {
      dragRef(el);
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    },
    [dragRef, ref],
  );
  return (
    <li ref={attach} role="none" className={`${className} ${dragging ? 'opacity-40' : ''}`}>
      {children}
    </li>
  );
}

/** The date under the Modified column. The file's own time, never a frontmatter
 *  date: a column called Modified has to say when the file changed. */
const DATE_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const DATE_FMT_YEAR = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

export function formatMtime(mtime: number, now = new Date()): string {
  const d = new Date(mtime);
  return d.getFullYear() === now.getFullYear() ? DATE_FMT.format(d) : DATE_FMT_YEAR.format(d);
}

/** The width the Modified column holds, wide enough for "12 documents". */
export const MODIFIED_COL = 'w-28 shrink-0 text-right';

/**
 * One document: a glyph, the title on one line, the modified date on the right.
 *
 * The title truncates rather than wraps. This is a file list at 13px, and a
 * second line here costs half the rows in view; the full title is the row's
 * tooltip and its accessible name.
 */
export function DocumentRow({
  note: n,
  depth,
  selection,
  actions,
  onFocusRow,
}: {
  note: NoteRefDTO;
  /** 0 at the level the page is standing in. */
  depth: number;
  selection: Selection;
  actions: DocumentRowActions;
  /** The row took the pointer. The page drops any picked folder. */
  onFocusRow: () => void;
}) {
  const { openDoc } = useApp();
  // Renaming outlives the menu (the menu closes as the input opens); the
  // delete confirm lives inside the menu and dies with it.
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const picked = selection.isSelected(n.path);
  const open = (nav?: NavOpts) => void openDoc(n.path, nav);

  // A picked row drags the whole picked set; an unpicked row drags itself.
  const dragPaths = picked ? selection.paths : [n.path];

  const onClick = (e: React.MouseEvent) => {
    onFocusRow();
    const mod = e.metaKey || e.ctrlKey;
    // The new-tab gestures are read first, so neither can be mistaken for a
    // selection gesture.
    if (mod && e.shiftKey) return open({ newTab: true, foreground: true });
    if (mod) return selection.toggle(n.path);
    if (e.shiftKey) return selection.extend(n.path);
    selection.only(n.path);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'Enter') return;
    // The row is a button, so Enter would fire a click and pick the row again.
    // Opening is what ↵ means on a file list, so the click is stopped here.
    e.preventDefault();
    e.stopPropagation();
    open(e.metaKey || e.ctrlKey ? { newTab: true, foreground: true } : undefined);
  };

  const row = (
    <RowShell
      paths={dragPaths}
      className={`group relative ${picked ? 'bg-brand/8' : 'hover:bg-accent/40'}`}
    >
      {/* While the title is an input, the row's own click target stands down:
          one click has to land in the input, not pick the row. */}
      {!renaming && (
        <button
          data-note-row
          data-doc-path={n.path}
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={picked}
          className="absolute inset-0 w-full cursor-default focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-none"
          onClick={onClick}
          onDoubleClick={(e) => open(e.metaKey || e.ctrlKey ? { newTab: true } : undefined)}
          onAuxClick={(e) => e.button === 1 && open(navFromEvent(e))}
          onKeyDown={onKeyDown}
          aria-label={n.title}
          title={n.summary || n.title}
        />
      )}
      <div
        className="pointer-events-none relative flex h-7 items-center gap-2 pr-6"
        style={{ paddingLeft: `${1 + depth * INDENT + DOC_INDENT}rem` }}
      >
        <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        {renaming ? (
          <span className="pointer-events-auto min-w-0 flex-1">
            <InlineRename
              value={n.title}
              label={`Rename ${n.title}`}
              className="w-full max-w-sm rounded-md border border-border bg-background px-1.5 py-0.5 text-dense focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onCommit={(title) => actions.onRename(n, title)}
              onDone={() => setRenaming(false)}
            />
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-dense">{n.title}</span>
        )}
        <span className={`${MODIFIED_COL} text-xs text-muted-foreground tabular-nums`}>
          {formatMtime(n.mtime)}
        </span>
      </div>
    </RowShell>
  );

  return (
    <ContextMenu
      onOpenChange={(menuOpen) => {
        if (!menuOpen) setConfirming(false);
      }}
    >
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {confirming ? (
          <>
            {/* The same question and the same red as the selection bar and the
                document page: it is the same act, one document at a time. */}
            <ContextMenuLabel>Delete this document?</ContextMenuLabel>
            <ContextMenuItem variant="destructive" onSelect={() => actions.onDelete(n)}>
              <Trash2 className="size-4" aria-hidden /> Delete
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setConfirming(false);
              }}
            >
              Cancel
            </ContextMenuItem>
          </>
        ) : (
          <>
            {/* A background tab, the same as middle-click on the row: the list
                you are reading stays in front. */}
            <ContextMenuItem onSelect={() => open({ newTab: true })}>
              <SquareArrowOutUpRight className="size-4 text-muted-foreground" aria-hidden />
              Open in new tab
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <FolderInput className="size-4 text-muted-foreground" aria-hidden />
                Move to
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="max-h-80 w-56 overflow-y-auto">
                <ContextMenuItem
                  disabled={actions.current === ''}
                  onSelect={() => actions.onMove(n, '')}
                >
                  <Inbox className="size-4 text-muted-foreground" aria-hidden />
                  <span className="truncate font-medium">Documents</span>
                </ContextMenuItem>
                {actions.folders.map((f) => (
                  <ContextMenuItem
                    key={f.key}
                    disabled={f.key === actions.current}
                    onSelect={() => actions.onMove(n, f.key)}
                  >
                    {/* The indent is what keeps the parent-child shape readable
                        in a flat list of rows. */}
                    <span className="shrink-0" style={{ width: `${f.depth * 12}px` }} aria-hidden />
                    <Folder className="size-4 text-muted-foreground" aria-hidden />
                    <span className="truncate">{f.name}</span>
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuItem onSelect={() => setRenaming(true)}>
              <Pencil className="size-4 text-muted-foreground" aria-hidden />
              Rename
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onSelect={(e) => {
                // Keep the menu open: the question is asked here.
                e.preventDefault();
                setConfirming(true);
              }}
            >
              <Trash2 className="size-4" aria-hidden /> Delete
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
