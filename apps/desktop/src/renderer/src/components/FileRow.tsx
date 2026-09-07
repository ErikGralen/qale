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
  type LucideIcon,
} from 'lucide-react';
import type { NoteRefDTO } from '@qale/ipc';
import { useApp } from '../state/app-state';
import { navFromEvent, type NavOpts } from '../lib/nav';
import { InlineRename } from './InlineRename';
import { useDraggableDocuments } from '../lib/dnd';
import type { DocumentFolder } from '../lib/documents';
import type { Selection } from '../lib/selection';

/**
 * One file, as a row. Every list in the app draws this one (docs/file-lists.md).
 *
 * The row is one line: a glyph, the title, and a rail of columns on the right.
 * The title truncates rather than wraps. That reverses what the note list used
 * to do, and the reason is the ask: a dense one-line row is what makes a page
 * read like a file list, doubling the rows in view is worth more on a browse
 * page than the tail of a long title, and the full title is still the row's
 * tooltip and its accessible name. The one thing that gets a second line is a
 * `subline`, and only a decision's supersedes chain has one.
 *
 * ONE PICK MODEL, on every page. The row IS the selection: a click picks it, a
 * double click opens it. The app had two models for a while, a checkbox on most
 * pages and the Finder row on Documents, and the split was the problem. A PM who
 * learns the gesture on one list now keeps it on all of them. The mouse
 * vocabulary, decided once:
 *
 *   click            pick this row, and only this row
 *   ⌘click           add this row to the selection, or take it out
 *   ⇧click           pick the anchor's row through this one
 *   double-click     open the document
 *   ⌘⇧click          open in a new tab, in front
 *   middle-click     open in a new tab, behind
 *   ⌘double-click    open in a new tab
 *
 * ⌘click had to give up "new tab" for "toggle". ⌘⇧click and middle-click keep
 * it, so no gesture lost its meaning without another one taking it over. The
 * keys match: ↵ opens, ⌘↵ opens in a new tab, and the arrows are the list's
 * (see {@link FileList}).
 *
 * A row with no `selection` has nothing to pick, so there a plain click just
 * opens. Several pages list rows that way and never select anything.
 *
 * Rows use the stretched-button pattern: the row is one big button, and the
 * rename input and anything in a subline float above it and keep their own
 * clicks.
 */

/** How far one level indents the rows under it, in rem. */
export const INDENT = 1.25;

/**
 * A file row's extra indent: the chevron column a folder row wears, which a
 * file has nothing to put in. It is what makes a file's glyph sit at exactly
 * the same x as a sibling folder's, so the two read as two kinds.
 */
export const DOC_INDENT = INDENT + 0.5;

/** The width one column in the right-hand rail holds, wide enough for
 *  "12 documents". */
export const META_COL = 'w-28 shrink-0 text-right';

/** The same width in the sort rail, where the label is a button and has to sit
 *  hard against the column's right edge. */
export const META_COL_HEAD = 'w-28 shrink-0 flex justify-end';

/**
 * Where a title starts, on any row in the app: past the row padding and the
 * glyph, at depth 0. A file row and a folder row land on the same 4.25rem, so
 * the two kinds read as one column of names. A heading over the list lines up
 * with it (see {@link ListSection}), so a section label and the titles under it
 * read as one table.
 */
export const TITLE_GUTTER = 'pl-17';

/** The date under a Modified column. The file's own time, never a frontmatter
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

/**
 * What a right-click can do to one row.
 *
 * Every entry is optional, and the menu draws only what it was given: a mirror
 * row can open and copy, a document row can also move, rename and delete. A row
 * with no `actions` at all has no menu. The row draws the menu and owns the
 * rename input; the page owns the writing. Every callback may fail, and the page
 * is the one that says so.
 */
export interface FileRowActions {
  /** "Open in new tab", into a background tab. */
  openInNewTab?: boolean;
  moveTo?: {
    /** Every folder the row can move to, parent before child. */
    folders: DocumentFolder[];
    /** The folder this row sits in. It shows greyed: you are here. */
    current: string;
    /** '' is the top level (Documents). */
    onMove: (note: NoteRefDTO, folder: string) => void;
  };
  /** The new title, trimmed and different from the old one. */
  onRename?: (note: NoteRefDTO, title: string) => void;
  onDelete?: (note: NoteRefDTO) => void;
  /** Menu items only one kind of row has, e.g. "Open in Jira". They sit under
   *  "Open in new tab", with the other ways of reaching the same thing. */
  extra?: ReactNode;
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
  /** The documents this row drags. Null for a row that is not a drag source. */
  paths: string[] | null;
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
    // The row's button carries the treeitem role, so the `li` carries none.
    <li ref={attach} role="none" className={`${className} ${dragging ? 'opacity-40' : ''}`}>
      {children}
    </li>
  );
}

export function FileRow({
  note: n,
  selection,
  depth = 0,
  meta,
  subline,
  actions,
  draggable = null,
  onFocusRow,
  icon: Icon = FileText,
}: {
  note: NoteRefDTO;
  /** Makes the row selectable. It must be in the selection's ordering. Without
   *  one a click just opens the note. */
  selection?: Selection;
  /** The indent, 0 at the level the page is standing in. */
  depth?: number;
  /** The right-hand rail, laid out by the caller against {@link META_COL}. */
  meta?: ReactNode;
  /** A second line under the title. Drawn only when there is one. */
  subline?: ReactNode;
  /** The context menu. Absent on a page that organises nothing. */
  actions?: FileRowActions;
  /** The paths this row drags. Null (or absent) is not a drag source. */
  draggable?: string[] | null;
  /** The row took the pointer. Documents drops any picked folder. */
  onFocusRow?: () => void;
  icon?: LucideIcon;
}) {
  const { openDoc } = useApp();
  // Renaming outlives the menu (the menu closes as the input opens); the
  // delete confirm lives inside the menu and dies with it.
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const picked = selection?.isSelected(n.path) ?? false;
  const open = (nav?: NavOpts) => void openDoc(n.path, nav);

  // A note the workspace has moved past. Both words come off the note itself,
  // so the row reads as history wherever it is drawn: a superseded decision, a
  // cancelled meeting whose notes may still matter.
  const superseded = n.lifecycle === 'superseded';
  const cancelled = n.eventStatus === 'cancelled';

  const onClick = (e: React.MouseEvent) => {
    onFocusRow?.();
    const mod = e.metaKey || e.ctrlKey;
    // Nothing to select: the click is a plain navigation, modifiers and all.
    if (!selection) return open(navFromEvent(e));
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

  // A file has no chevron, so it pays for the column a folder row wears. That
  // is what puts the two glyphs at the same x.
  const pad = 1 + DOC_INDENT + depth * INDENT;

  const row = (
    <RowShell
      paths={draggable}
      className={`group relative ${picked ? 'bg-brand/8' : 'hover:bg-accent/40'} ${
        superseded || cancelled ? 'opacity-65' : ''
      }`}
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
          // The summary rides the row as its tooltip: one hover, no cost to the
          // line. The title stands in when there is no summary, because a
          // truncated title has to be readable in full somewhere.
          title={n.summary || n.title}
        />
      )}
      <div
        className={`pointer-events-none relative flex gap-2 pr-6 ${
          subline ? 'items-start py-1.5' : 'h-7 items-center'
        }`}
        style={{ paddingLeft: `${pad}rem` }}
      >
        {/* The glyph sits in a line-high box, so it stays on the title's first
            line when a subline pushes the row taller. */}
        <span className="flex h-5 shrink-0 items-center">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
        </span>
        {renaming && actions?.onRename ? (
          <span className="pointer-events-auto min-w-0 flex-1">
            <InlineRename
              value={n.title}
              label={`Rename ${n.title}`}
              className="w-full max-w-sm rounded-md border border-border bg-background px-1.5 py-0.5 text-dense focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onCommit={(title) => actions.onRename?.(n, title)}
              onDone={() => setRenaming(false)}
            />
          </span>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className={`truncate text-dense ${cancelled ? 'line-through' : ''}`}>
              {n.title}
            </span>
            {subline}
          </div>
        )}
        {meta}
      </div>
    </RowShell>
  );

  // A menu with nothing in it is worse than no menu: the right-click looks
  // broken. So the row only becomes a trigger once it has something to offer.
  const hasMenu = Boolean(
    actions &&
    (actions.openInNewTab ||
      actions.moveTo ||
      actions.onRename ||
      actions.onDelete ||
      actions.extra),
  );
  if (!actions || !hasMenu) return row;

  return (
    <ContextMenu
      onOpenChange={(menuOpen) => {
        if (!menuOpen) setConfirming(false);
      }}
    >
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {confirming && actions.onDelete ? (
          <>
            {/* The same question and the same red as the selection bar and the
                document page: it is the same act, one document at a time. */}
            <ContextMenuLabel>Delete this document?</ContextMenuLabel>
            <ContextMenuItem variant="destructive" onSelect={() => actions.onDelete?.(n)}>
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
            {actions.openInNewTab && (
              <ContextMenuItem onSelect={() => open({ newTab: true })}>
                <SquareArrowOutUpRight className="size-4 text-muted-foreground" aria-hidden />
                Open in new tab
              </ContextMenuItem>
            )}
            {actions.extra}
            {actions.moveTo && (
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <FolderInput className="size-4 text-muted-foreground" aria-hidden />
                  Move to
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="max-h-80 w-56 overflow-y-auto">
                  <ContextMenuItem
                    disabled={actions.moveTo.current === ''}
                    onSelect={() => actions.moveTo?.onMove(n, '')}
                  >
                    <Inbox className="size-4 text-muted-foreground" aria-hidden />
                    <span className="truncate font-medium">Documents</span>
                  </ContextMenuItem>
                  {actions.moveTo.folders.map((f) => (
                    <ContextMenuItem
                      key={f.key}
                      disabled={f.key === actions.moveTo?.current}
                      onSelect={() => actions.moveTo?.onMove(n, f.key)}
                    >
                      {/* The indent is what keeps the parent-child shape
                          readable in a flat list of rows. */}
                      <span
                        className="shrink-0"
                        style={{ width: `${f.depth * 12}px` }}
                        aria-hidden
                      />
                      <Folder className="size-4 text-muted-foreground" aria-hidden />
                      <span className="truncate">{f.name}</span>
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}
            {actions.onRename && (
              <ContextMenuItem onSelect={() => setRenaming(true)}>
                <Pencil className="size-4 text-muted-foreground" aria-hidden />
                Rename
              </ContextMenuItem>
            )}
            {actions.onDelete && (
              <>
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
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
