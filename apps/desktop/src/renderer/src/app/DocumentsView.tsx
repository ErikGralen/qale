import { useCallback, useEffect, useMemo, useState } from 'react';
import { isFolderIndex } from '@qale/domain';
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from '@qale/ui';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Files,
  Folder,
  FolderPlus,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import type { NoteRefDTO } from '@qale/ipc';
import type { PageCrumb } from '../components/PageHeader';
import { useApp } from '../state/app-state';
import { invoke } from '../lib/ipc';
import { navFromEvent } from '../lib/nav';
import { useNewNote } from '../lib/new-note';
import { InlineRename } from '../components/InlineRename';
import { HeaderAction, PageHeader } from '../components/PageHeader';
import { DocumentRow, INDENT, MODIFIED_COL } from './DocumentRow';
import { ScopedAskComposer } from '../components/ScopedAskComposer';
import { SelectionBar } from '../components/SelectionBar';
import { UndoStrip, useUndoOffer } from '../components/UndoStrip';
import { useToast } from '../components/toast';
import { DROP_ZONE_CLASS, useFolderDropZones, type AttachRef } from '../lib/dnd';
import {
  docCount,
  documentFolder,
  documentFolders,
  folderMtimes,
  isDocument,
  nextDocumentSort,
  parseDocumentSort,
  sortDocuments,
  sortFolders,
  toggleExpanded,
  visibleRows,
  type DocumentFolder,
  type DocumentSort,
  type DocumentSortKey,
} from '../lib/documents';
import { moveRowFocus } from '../lib/row-focus';
import { selectionKeyDown, useSelection } from '../lib/selection';

/** What went wrong, in the words the main process used. */
function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** ⌥⌘N, from the app's key handler to whichever Documents tab is in front. */
export const NEW_FOLDER_EVENT = 'qale:new-folder';

/** Where the sort pick is kept between launches. */
const SORT_KEY = 'qale.documents.sort';

/** How many documents a folder holds, with the unit. A bare number on a row of
 *  mixed things says nothing about what it counts. */
function countLabel(count: number): string {
  if (count === 0) return 'empty';
  return `${count} ${count === 1 ? 'document' : 'documents'}`;
}

/** The name of a folder key, for a sentence. '' is the top level. */
function folderLabel(key: string): string {
  return key ? key.slice(key.lastIndexOf('/') + 1) : 'Documents';
}

/**
 * The column rail over the list: what the two columns hold, and the two ways to
 * order them.
 *
 * It is the Finder's header, and it does the Finder's one job: click a column
 * to sort by it, click it again to turn it around. There is no third column and
 * no menu; a browse page with two facts per row needs two controls.
 */
function SortRail({
  sort,
  onSort,
}: {
  sort: DocumentSort;
  onSort: (key: DocumentSortKey) => void;
}) {
  const column = (key: DocumentSortKey, label: string) => {
    const active = sort.key === key;
    const Chevron = sort.dir === 'asc' ? ChevronUp : ChevronDown;
    return (
      <button
        className={`flex h-6 items-center gap-1 rounded px-1 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
          active ? 'text-foreground' : ''
        }`}
        aria-label={
          key === 'name'
            ? `Sort by name, ${sort.key === 'name' && sort.dir === 'asc' ? 'Z to A' : 'A to Z'}`
            : `Sort by modified, ${sort.key === 'modified' && sort.dir === 'desc' ? 'oldest first' : 'newest first'}`
        }
        onClick={() => onSort(key)}
      >
        {label}
        {active && <Chevron className="size-3" aria-hidden />}
      </button>
    );
  };
  return (
    <div className="sticky top-0 z-10 flex h-7 items-center border-b border-border bg-background pr-6 pl-4 text-xs font-medium text-muted-foreground">
      {column('name', 'Name')}
      <span className="flex-1" />
      <span className={`${MODIFIED_COL} flex justify-end`}>{column('modified', 'Modified')}</span>
    </div>
  );
}

/**
 * A folder in the list, by the same Finder rules the documents follow: a click
 * picks it, a double-click (or ↵) goes into it, and the chevron opens it in
 * place without leaving this level.
 *
 * The row reads as a container: the chevron and the folder glyph on the left,
 * the recursive document count under the Modified column with its unit.
 *
 * Right-click renames it in place or deletes it. A folder that still holds
 * documents cannot be deleted, and the menu says so rather than failing after
 * the click: emptying it is the PM's decision, one document at a time.
 *
 * Documents dropped on the row go into the folder.
 */
function FolderListRow({
  folder,
  count,
  depth,
  open,
  picked,
  renaming,
  onToggle,
  onPick,
  onOpen,
  onStartRename,
  onRename,
  onDoneRename,
  onDelete,
  dropRef,
  dropOver,
}: {
  folder: DocumentFolder;
  count: number;
  /** 0 at the level the page is standing in. */
  depth: number;
  open: boolean;
  picked: boolean;
  renaming: boolean;
  onToggle: () => void;
  onPick: () => void;
  onOpen: (nav: ReturnType<typeof navFromEvent>) => void;
  onStartRename: () => void;
  onRename: (name: string) => void;
  onDoneRename: () => void;
  onDelete: () => void;
  dropRef: AttachRef;
  dropOver: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const pad = { paddingLeft: `${1 + depth * INDENT}rem` };
  const row = (
    <li
      ref={dropRef}
      role="none"
      className={`relative ${dropOver ? DROP_ZONE_CLASS : picked ? 'bg-brand/8' : 'hover:bg-accent/40'}`}
    >
      {renaming ? (
        <div className="flex h-7 w-full items-center gap-2 pr-6" style={pad}>
          <span className="size-5 shrink-0" aria-hidden />
          <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <InlineRename
            value={folder.name}
            label={`Rename ${folder.name}`}
            className="w-full max-w-xs rounded-md border border-border bg-background px-1.5 py-0.5 text-dense font-medium focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onCommit={onRename}
            onDone={onDoneRename}
          />
        </div>
      ) : (
        <>
          {/* The stretched button: the row picks the folder, and a double-click
              goes into it. The chevron floats above it and keeps its own
              click. */}
          <button
            data-note-row
            data-folder-key={folder.key}
            role="treeitem"
            aria-level={depth + 1}
            aria-selected={picked}
            aria-expanded={open}
            className="absolute inset-0 w-full cursor-default focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-none"
            onClick={(e) => {
              // ⌘⇧click still opens a tab (middle-click does too, on auxclick). A
              // plain ⌘click is a selection gesture here, so it only picks.
              if ((e.metaKey || e.ctrlKey) && e.shiftKey)
                return onOpen({ newTab: true, foreground: true });
              onPick();
            }}
            onDoubleClick={(e) => onOpen(e.metaKey || e.ctrlKey ? { newTab: true } : {})}
            onAuxClick={(e) => e.button === 1 && onOpen(navFromEvent(e))}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              e.stopPropagation();
              onOpen(e.metaKey || e.ctrlKey ? { newTab: true, foreground: true } : {});
            }}
            aria-label={`${folder.name}, ${countLabel(count)}`}
            title={`Open ${folder.name}`}
          />
          <div
            className="pointer-events-none relative flex h-7 items-center gap-2 pr-6"
            style={pad}
          >
            <button
              className="pointer-events-auto flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              aria-label={open ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
            >
              <ChevronRight
                className={`size-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
                aria-hidden
              />
            </button>
            <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-dense font-medium">{folder.name}</span>
            <span className={`${MODIFIED_COL} text-xs text-muted-foreground`}>
              {countLabel(count)}
            </span>
          </div>
        </>
      )}
    </li>
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
            <ContextMenuLabel>Delete this folder?</ContextMenuLabel>
            <ContextMenuItem variant="destructive" onSelect={onDelete}>
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
            <ContextMenuItem onSelect={onStartRename}>
              <Pencil className="size-4 text-muted-foreground" aria-hidden />
              Rename folder
            </ContextMenuItem>
            <ContextMenuItem
              variant="destructive"
              disabled={count > 0}
              onSelect={(e) => {
                // Keep the menu open: the question is asked here.
                e.preventDefault();
                setConfirming(true);
              }}
            >
              <Trash2 className="size-4" aria-hidden /> Delete folder
            </ContextMenuItem>
            {/* A disabled row takes no hover, so the reason is written out
                rather than left in a tooltip nobody can reach. */}
            {count > 0 && (
              <ContextMenuLabel className="font-normal">
                Empty it first: {countLabel(count)} inside.
              </ContextMenuLabel>
            )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * The row a new folder is born on: a folder line with its name already in an
 * input, the way the Finder makes one. Enter keeps the name, Escape takes the
 * row away again. No dialog, because there is nothing to decide but the name.
 */
function NewFolderRow({
  onCreate,
  onCancel,
}: {
  onCreate: (name: string) => void;
  onCancel: () => void;
}) {
  return (
    <li role="none" className="relative bg-brand/8">
      <div className="flex h-7 w-full items-center gap-2 pr-6 pl-4">
        <span className="size-5 shrink-0" aria-hidden />
        <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <InlineRename
          value="untitled folder"
          label="Name the new folder"
          commitUnchanged
          className="w-full max-w-xs rounded-md border border-border bg-background px-1.5 py-0.5 text-dense font-medium focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onCommit={onCreate}
          onDone={onCancel}
        />
      </div>
    </li>
  );
}

/**
 * Documents — the pages the PM writes: scratch notes, briefs, PRDs, specs.
 *
 * The one place in the app where the user's own structure counts. Folders are
 * real, persistent folders under `notes/`: one exists when its `index.md` stub
 * does or a document is in it, so "New folder" makes one that stays empty until
 * something arrives.
 *
 * One list carries the whole page, the Finder way: full pane width, one row per
 * line at 13px, folders above documents at every level. Two columns and two
 * controls: Name and Modified, each a sort you can turn around, and the pick is
 * remembered. Modified is the file's own time, never a frontmatter date.
 *
 * The rows behave like a file manager's, which is the point (see
 * {@link DocumentRow} for the whole mouse and key vocabulary): a click picks a
 * row, ⌘click adds one, ⇧click takes a range, and a double-click or ↵ opens the
 * document or goes into the folder. A folder's chevron opens it in place
 * instead, one level deeper and by the same rule. Breadcrumbs go back up. There
 * is no flat all-documents dump; search covers cross-folder finding.
 *
 * The level and what is expanded are both the tab's, not this component's. They
 * arrive as props and every move between levels calls `openDocuments`. So each
 * folder you enter is a history entry, the tab's back and forward arrows walk
 * the levels, and an expanded folder is still expanded when you come back.
 *
 * Organising is where you expect it. Right-click a row: open in a new tab, move
 * it to another folder, rename it in place, delete it. Right-click a folder to
 * rename or delete it, and a folder with documents in it says so instead of
 * letting the delete fail. Pick several rows and the selection bar moves them
 * all at once, into a folder it can also make on the way. Or drag them: onto
 * any folder row on screen, onto a breadcrumb. A drop files the documents and
 * leaves you where you are. A move and a delete both leave a six-second Undo.
 *
 * The tree hands this view a synthetic row for every folder's `index.md`. Those
 * rows are what make an empty folder visible, so they feed folder derivation —
 * and nothing else. They never show as list rows, are never selectable, and
 * never count.
 *
 * The agent is a guest here. It answers from the composer at the bottom; it
 * does not file into this folder on its own (the write policy makes any unasked
 * write under `notes/` draw a card, see `writePolicy`).
 */
export function DocumentsView({
  viewKey,
  folder,
  expanded: expandedKeys,
}: {
  /** The history entry this page is. What is expanded rides on it. */
  viewKey: string;
  folder: string;
  expanded?: string[];
}) {
  const { tree, renameNote, deleteNotes, openDocuments, setDocumentsExpanded } = useApp();
  const { create, busy: creating } = useNewNote();
  const toast = useToast();
  const { offer: undoable, offerUndo, runUndo } = useUndoOffer();
  const [making, setMaking] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  // The picked folder row. Folders are not in the document selection (nothing
  // the selection bar does applies to one), but a click still has to land
  // somewhere visible, so the row wears the same ink wash a picked document
  // does.
  const [pickedFolder, setPickedFolder] = useState<string | null>(null);
  const [sort, setSort] = useState<DocumentSort>(() => {
    try {
      return parseDocumentSort(localStorage.getItem(SORT_KEY));
    } catch {
      return parseDocumentSort(null);
    }
  });

  const expanded = useMemo(() => new Set(expandedKeys ?? []), [expandedKeys]);

  const group = tree?.groups.find((g) => g.dir === 'notes');
  // Every path under notes/ feeds folder derivation. The folder index rows are
  // in here on purpose: they are what makes an empty folder visible.
  const allPaths = useMemo(
    () => (group?.notes ?? []).filter((n) => isDocument(n.path)).map((n) => n.path),
    [group],
  );
  // The documents. By path, not by type: the understanding notes are notes too,
  // and they are the agent's, not the PM's. Index files are out from here on —
  // they are navigation, never rows.
  const notes = useMemo(
    () => (group?.notes ?? []).filter((n) => isDocument(n.path) && !isFolderIndex(n.path)),
    [group],
  );

  const folders = useMemo(() => documentFolders(allPaths), [allPaths]);

  // The current level. A level that stops existing (renamed, deleted from
  // another tab) renders as the top rather than as a page nobody can leave.
  // This only changes what is drawn: it never navigates, because history is the
  // record of where the PM went and data arriving must not rewrite it. It also
  // covers the gap after "New folder", when the tab already points at the new
  // key and the workspace has not yet said the index file landed.
  const selected = folder && folders.some((f) => f.key === folder) ? folder : '';

  // Both lists sorted before the tree filters them, because `visibleRows` only
  // filters: the order it is handed is the order every level shows.
  const times = useMemo(() => folderMtimes(notes), [notes]);
  const sortedNotes = useMemo((): NoteRefDTO[] => sortDocuments(notes, sort), [notes, sort]);
  const treeFolders = useMemo(() => sortFolders(folders, sort, times), [folders, sort, times]);
  const rows = useMemo(
    () => visibleRows(treeFolders, sortedNotes, selected, expanded),
    [treeFolders, sortedNotes, selected, expanded],
  );

  // Selection covers every document on the screen, in the order the eye reads
  // them, so a shift-range picks up what it sweeps over.
  const ordered = useMemo(
    () => rows.flatMap((r) => (r.kind === 'doc' ? [r.note.path] : [])),
    [rows],
  );
  const selection = useSelection(ordered);

  const pickSort = (key: DocumentSortKey) => {
    const next = nextDocumentSort(sort, key);
    setSort(next);
    try {
      localStorage.setItem(SORT_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota */
    }
  };

  const toggleFolder = useCallback(
    (key: string) => setDocumentsExpanded(viewKey, toggleExpanded(expandedKeys ?? [], key)),
    [expandedKeys, setDocumentsExpanded, viewKey],
  );

  const pickFolder = (key: string) => {
    selection.clear();
    setPickedFolder(key);
  };

  /**
   * The keys on the tree, the Finder's own. Up and down walk every row and take
   * the selection with them; ⇧ with them stretches the range instead. Right
   * opens the focused folder in place, left shuts it. ↵ is the row's, and the
   * row handles it.
   */
  const onTreeKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!moveRowFocus(e)) return;
      const el = document.activeElement as HTMLElement | null;
      const path = el?.dataset.docPath;
      const key = el?.dataset.folderKey;
      if (path) {
        if (e.shiftKey) selection.extend(path);
        else {
          selection.only(path);
          setPickedFolder(null);
        }
      } else if (key !== undefined && !e.shiftKey) {
        // A folder has nothing to add to a document selection, so landing on
        // one ends it rather than pretending it is still going.
        pickFolder(key);
      }
      return;
    }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const key = (document.activeElement as HTMLElement | null)?.dataset.folderKey;
    if (!key) return;
    e.preventDefault();
    const open = expanded.has(key);
    if (e.key === 'ArrowRight' ? !open : open) toggleFolder(key);
  };

  // Every folder on the screen is a place to drop documents: the rows in the
  // tree and the crumbs. One hook holds them all, and each row asks for its own
  // by folder key.
  const { zone, isOver } = useFolderDropZones((paths, target) => void dropDocs(paths, target));

  // Dragging documents onto a crumb files them one level up (or all the way
  // up). The current folder is never a crumb, so a crumb always takes the drop.
  const crumbs = useMemo((): PageCrumb[] | undefined => {
    if (!selected) return undefined;
    const parts = selected.split('/');
    const crumb = (label: string, key: string): PageCrumb => ({
      label,
      onClick: () => openDocuments(key),
      ref: zone(`crumb:${key}`, key),
      className: isOver(`crumb:${key}`) ? DROP_ZONE_CLASS : undefined,
    });
    return [
      crumb('Documents', ''),
      ...parts.slice(0, -1).map((part, i) => crumb(part, parts.slice(0, i + 1).join('/'))),
    ];
  }, [selected, zone, isOver, openDocuments]);

  const newDocument = (nav?: ReturnType<typeof navFromEvent>) =>
    void create('note', nav, selected || undefined);

  const newFolder = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || making) return;
    setMaking(true);
    try {
      await invoke['folder:create']({ folder: selected ? `${selected}/${trimmed}` : trimmed });
    } catch (err) {
      toast(`Folder not created: ${reason(err)}`);
    } finally {
      setMaking(false);
    }
  };

  // ⌥⌘N reaches this page through the window, the way ⇧⌘N reaches the capture
  // tray: the key handler lives in App and must not know what a folder is.
  const [naming, setNaming] = useState(false);
  useEffect(() => {
    const open = () => setNaming(true);
    window.addEventListener(NEW_FOLDER_EVENT, open);
    return () => window.removeEventListener(NEW_FOLDER_EVENT, open);
  }, []);

  /**
   * Move documents into `target`, one file at a time. A move can be refused
   * per file (a name already taken in that folder), so the ones that go, go:
   * the toast names how many stayed and why the first one did.
   *
   * It answers with where each document that moved came from, which is the
   * whole of the undo.
   */
  const moveDocs = async (paths: string[], target: string) => {
    const moved: { path: string; folder: string }[] = [];
    const failed: string[] = [];
    let first = '';
    for (const path of paths) {
      const from = documentFolder(path);
      try {
        const note = await invoke['note:move']({ path, folder: target });
        moved.push({ path: note.path, folder: from });
      } catch (err) {
        failed.push(path);
        if (!first) first = reason(err);
      }
    }
    if (failed.length > 0)
      toast(
        `${failed.length} of ${paths.length} ${paths.length === 1 ? 'document' : 'documents'} did not move: ${first}`,
      );
    if (moved.length > 0) {
      const one = notes.find((n) => n.path === paths[0]);
      offerUndo({
        label: 'Moved',
        title: moved.length === 1 ? (one?.title ?? countLabel(1)) : countLabel(moved.length),
        suffix: `to ${folderLabel(target)}`,
        // Each document goes back to its own folder, not to one shared one:
        // a selection can be swept up from several levels at once.
        undo: () => {
          for (const m of moved) void invoke['note:move']({ path: m.path, folder: m.folder });
        },
      });
    }
  };

  // The selection bar's move. It empties the bar and follows the documents, so
  // the PM ends up looking at where they just put them.
  const moveSelected = async (target: string) => {
    const { paths } = selection;
    selection.clear();
    await moveDocs(paths, target);
    openDocuments(target);
  };

  // A drag ended on a folder. The documents go, the picks go with them, and the
  // page stays where it is: dropping something into a folder in Finder does not
  // open that folder either.
  const dropDocs = async (paths: string[], target: string) => {
    selection.clear();
    await moveDocs(paths, target);
  };

  // "New folder: <typed>" in the picker. The folder is made first, at this
  // level, so it survives even if every move is then refused.
  const createFolderAndMove = async (folderName: string) => {
    const { paths } = selection;
    try {
      const made = await invoke['folder:create']({
        folder: selected ? `${selected}/${folderName}` : folderName,
      });
      selection.clear();
      await moveDocs(paths, made.folder);
      openDocuments(made.folder);
    } catch (err) {
      toast(`Folder not created: ${reason(err)}`);
    }
  };

  const renameFolder = async (key: string, folderName: string) => {
    try {
      const renamed = await invoke['folder:rename']({ folder: key, name: folderName });
      // Follow it, if what moved is the level we are standing in or above it.
      if (selected === key || selected.startsWith(`${key}/`))
        openDocuments(renamed.folder + selected.slice(key.length));
    } catch (err) {
      toast(`Folder not renamed: ${reason(err)}`);
    }
  };

  const deleteFolder = async (key: string) => {
    try {
      await invoke['folder:delete']({ folder: key });
      // The level under our feet is gone: step up rather than stand on it.
      if (selected === key || selected.startsWith(`${key}/`))
        openDocuments(key.slice(0, Math.max(0, key.lastIndexOf('/'))));
    } catch (err) {
      toast(`Folder not deleted: ${reason(err)}`);
    }
  };

  /**
   * Delete one document, and offer the way back.
   *
   * The undo is the app's one undo (`history:revert`), aimed at the commit the
   * delete just wrote. A workspace with no git keeps no commits, so there is
   * nothing to offer there and the row simply goes.
   */
  const deleteDoc = async (note: NoteRefDTO) => {
    const { failed } = await deleteNotes([note.path]);
    if (failed.length > 0) {
      toast('That document could not be deleted.');
      return;
    }
    const history = await invoke['note:history'](note.path).catch(() => []);
    const hash = history[0]?.hash;
    if (!hash) return;
    offerUndo({
      label: 'Deleted',
      title: note.title,
      undo: () => {
        void invoke['history:revert']({ path: note.path, hash }).catch((err) =>
          toast(`Not put back: ${reason(err)}`),
        );
      },
    });
  };

  const empty = folders.length === 0 && notes.length === 0;

  return (
    <div
      className="flex h-full flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setPickedFolder(null);
        selectionKeyDown(e, selection, { alwaysSelectAll: true });
      }}
    >
      <PageHeader
        icon={Files}
        crumbs={crumbs}
        label={selected ? folderLabel(selected) : 'Documents'}
      >
        <HeaderAction
          icon={FolderPlus}
          label="New folder"
          title="New folder (⌥⌘N)"
          onClick={() => setNaming(true)}
        />
        <Button
          size="sm"
          disabled={creating}
          onClick={(e) => newDocument(navFromEvent(e))}
          title="New document (⌘N): a blank page in this folder, named as you type"
        >
          <Plus className="size-3.5" /> New document
        </Button>
      </PageHeader>

      <SelectionBar
        selection={selection}
        total={ordered.length}
        noun="document"
        wide
        moveTo={{
          folders,
          current: selected,
          onMove: (target) => void moveSelected(target),
          onCreateAndMove: (folderName) => void createFolderAndMove(folderName),
        }}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {empty && !naming ? (
          <div className="px-4 py-3">
            <p className="text-sm text-muted-foreground">
              Nothing written yet. This is where you write: scratch notes, briefs, specs. Only you
              write here, and Qale helps when you ask it to.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              disabled={creating}
              onClick={(e) => newDocument(navFromEvent(e))}
            >
              <Plus className="size-3.5" /> New document
            </Button>
          </div>
        ) : (
          <>
            <SortRail sort={sort} onSort={pickSort} />
            {rows.length === 0 && !naming ? (
              <div className="px-4 py-3">
                <p className="text-sm text-muted-foreground">Nothing in this folder yet.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Drag documents here, or right-click a document to move it.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  disabled={creating}
                  onClick={(e) => newDocument(navFromEvent(e))}
                >
                  <Plus className="size-3.5" /> New document
                </Button>
              </div>
            ) : (
              /* One list, folders and documents together. One focus order, one
                 selection order, and both are what the eye sees. */
              <ul
                role="tree"
                aria-label="Documents"
                aria-multiselectable
                className="flex flex-col divide-y divide-border/70"
                onKeyDown={onTreeKeyDown}
              >
                {naming && (
                  <NewFolderRow
                    onCreate={(name) => void newFolder(name)}
                    onCancel={() => setNaming(false)}
                  />
                )}
                {rows.map((row) =>
                  row.kind === 'folder' ? (
                    <FolderListRow
                      key={`folder:${row.folder.key}`}
                      folder={row.folder}
                      count={docCount(allPaths, row.folder.key)}
                      depth={row.depth}
                      open={expanded.has(row.folder.key)}
                      picked={pickedFolder === row.folder.key}
                      renaming={renamingFolder === row.folder.key}
                      onToggle={() => toggleFolder(row.folder.key)}
                      onPick={() => pickFolder(row.folder.key)}
                      onOpen={(nav) => openDocuments(row.folder.key, nav)}
                      onStartRename={() => setRenamingFolder(row.folder.key)}
                      onRename={(folderName) => void renameFolder(row.folder.key, folderName)}
                      onDoneRename={() => setRenamingFolder(null)}
                      onDelete={() => void deleteFolder(row.folder.key)}
                      dropRef={zone(`list:${row.folder.key}`, row.folder.key)}
                      dropOver={isOver(`list:${row.folder.key}`)}
                    />
                  ) : (
                    <DocumentRow
                      key={row.note.path}
                      note={row.note}
                      depth={row.depth}
                      selection={selection}
                      onFocusRow={() => setPickedFolder(null)}
                      actions={{
                        folders,
                        // Where this document sits, which may be deeper than
                        // the level the page is on. "Move to" greys out the
                        // folder it is already in, never the one you are
                        // standing in.
                        current: documentFolder(row.note.path),
                        onMove: (note, target) => void moveDocs([note.path], target),
                        onRename: (note, title) => {
                          // A refused rename (a name already taken) leaves the
                          // row as it was; the toast is the only thing that
                          // says it did not happen.
                          void renameNote(note.path, title).catch((err) =>
                            toast(`Not renamed: ${reason(err)}`),
                          );
                        },
                        onDelete: (note) => void deleteDoc(note),
                      }}
                    />
                  ),
                )}
              </ul>
            )}
          </>
        )}
      </div>

      <UndoStrip offer={undoable} onUndo={runUndo} className="mx-4 mb-1" />

      <ScopedAskComposer
        flat
        scope={{ kind: 'folder', label: selected ? folderLabel(selected) : 'Documents' }}
        sessionTitle={`Ask · ${selected || 'documents'}`}
        scopePrefix={
          selected
            ? `Scoped to the documents in notes/${selected}.`
            : 'Scoped to the documents the PM writes (the notes folder).'
        }
      />
    </div>
  );
}
