import { useCallback, useEffect, useMemo, useState } from 'react';
import { isFolderIndex } from '@qale/domain';
import { Button } from '@qale/ui';
import { Files, FolderPlus, Plus } from 'lucide-react';
import type { NoteRefDTO } from '@qale/ipc';
import type { PageCrumb } from '../components/PageHeader';
import { useApp } from '../state/app-state';
import { invoke } from '../lib/ipc';
import { navFromEvent } from '../lib/nav';
import { useNewNote } from '../lib/new-note';
import { HeaderAction, PageHeader } from '../components/PageHeader';
import { FileList } from '../components/FileList';
import { FileRow, META_COL, formatMtime } from '../components/FileRow';
import { SortRail, type SortColumn } from '../components/SortRail';
import { FolderListRow, NewFolderRow } from './FolderListRow';
import { ScopedAskComposer } from '../components/ScopedAskComposer';
import { SelectionBar } from '../components/SelectionBar';
import { UndoStrip, useUndoOffer } from '../components/UndoStrip';
import { useToast } from '../components/toast';
import { DROP_ZONE_CLASS, useFolderDropZones } from '../lib/dnd';
import {
  DEFAULT_SORT,
  DOCUMENT_SORT_KEYS,
  docCount,
  documentFolder,
  documentFolders,
  folderMtimes,
  isDocument,
  sortDocuments,
  sortFolders,
  toggleExpanded,
  visibleRows,
  type DocumentSort,
  type DocumentSortKey,
} from '../lib/documents';
import { readListSort, writeListSort } from '../lib/list-sort';
import { deleteDoc, moveDocs } from '../lib/move-documents';
import { moveRowFocus } from '../lib/row-focus';
import { selectionKeyDown, useSelection } from '../lib/selection';

/** What went wrong, in the words the main process used. */
function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** ⌥⌘N, from the app's key handler to whichever Documents tab is in front. */
export const NEW_FOLDER_EVENT = 'qale:new-folder';

/** What this page is called where its sort pick is kept between launches. */
const SORT_SURFACE = 'documents';

/** The name of a folder key, for a sentence. '' is the top level. */
function folderLabel(key: string): string {
  return key ? key.slice(key.lastIndexOf('/') + 1) : 'Documents';
}

/** The two columns, and how each one opens: names from A, dates from the
 *  newest. */
const COLUMNS: SortColumn<DocumentSortKey>[] = [
  {
    key: 'name',
    label: 'Name',
    openDir: 'asc',
    ariaLabel: (s) => `Sort by name, ${s.key === 'name' && s.dir === 'asc' ? 'Z to A' : 'A to Z'}`,
  },
  {
    key: 'modified',
    label: 'Modified',
    openDir: 'desc',
    ariaLabel: (s) =>
      `Sort by modified, ${s.key === 'modified' && s.dir === 'desc' ? 'oldest first' : 'newest first'}`,
  },
];

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
 * The rows behave like a file manager's, which is the point (see {@link
 * FileRow} for the whole mouse and key vocabulary): a click picks a row,
 * ⌘click adds one, ⇧click takes a range, and a double-click or ↵ opens the
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
 * does not file into this folder on its own (the write policy makes a new page
 * under `notes/` draw a card, whether the PM asked for it or not, and a rewrite
 * of what they typed too, see `writePolicy`).
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
  const { tree, renameNote, deleteNotes, openDocuments, setExpanded } = useApp();
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
  const [sort, setSort] = useState<DocumentSort>(
    () => readListSort(SORT_SURFACE, DEFAULT_SORT, DOCUMENT_SORT_KEYS) as DocumentSort,
  );

  const expanded = useMemo(() => new Set(expandedKeys ?? []), [expandedKeys]);

  const group = tree?.groups.find((g) => g.dir === 'notes');
  // Every path under notes/ feeds folder derivation. The folder index rows are
  // in here on purpose: they are what makes an empty folder visible.
  const allPaths = useMemo(
    () => (group?.notes ?? []).filter((n) => isDocument(n.path)).map((n) => n.path),
    [group],
  );
  // The documents, by path. Index files are out from here on: they are
  // navigation, never rows.
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

  const pickSort = (next: DocumentSort) => {
    setSort(next);
    writeListSort(SORT_SURFACE, next);
  };

  const toggleFolder = useCallback(
    (key: string) => setExpanded(viewKey, toggleExpanded(expandedKeys ?? [], key)),
    [expandedKeys, setExpanded, viewKey],
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

  /** File documents somewhere else. The undo strip is the page's, so the write
   *  is handed what it needs to draw one. */
  const move = (paths: string[], target: string) =>
    moveDocs(paths, target, {
      targetLabel: folderLabel(target),
      titleOf: (path) => notes.find((n) => n.path === path)?.title,
      toast,
      offerUndo,
    });

  // The selection bar's move. It empties the bar and follows the documents, so
  // the PM ends up looking at where they just put them.
  const moveSelected = async (target: string) => {
    const { paths } = selection;
    selection.clear();
    await move(paths, target);
    openDocuments(target);
  };

  // A drag ended on a folder. The documents go, the picks go with them, and the
  // page stays where it is: dropping something into a folder in Finder does not
  // open that folder either.
  const dropDocs = async (paths: string[], target: string) => {
    selection.clear();
    await move(paths, target);
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
      await move(paths, made.folder);
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

  const empty = folders.length === 0 && notes.length === 0;

  return (
    <div
      className="flex h-full flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setPickedFolder(null);
        selectionKeyDown(e, selection);
      }}
    >
      <PageHeader
        icon={Files}
        crumbs={crumbs}
        label={selected ? folderLabel(selected) : 'Documents'}
        selecting={selection.count > 0}
      >
        {/* One cluster, two jobs. While a batch is ticked, the batch owns it:
            "New document" is not what you are doing with six rows in hand. */}
        {selection.count > 0 ? (
          <SelectionBar
            selection={selection}
            total={ordered.length}
            noun="document"
            moveTo={{
              folders,
              current: selected,
              onMove: (target) => void moveSelected(target),
              onCreateAndMove: (folderName) => void createFolderAndMove(folderName),
            }}
          />
        ) : (
          <>
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
          </>
        )}
      </PageHeader>

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
            <SortRail sort={sort} columns={COLUMNS} onSort={pickSort} />
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
              <FileList label="Documents" multiselectable onKeyDown={onTreeKeyDown}>
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
                    <FileRow
                      key={row.note.path}
                      note={row.note}
                      depth={row.depth}
                      selection={selection}
                      // A picked row drags the whole picked set; an unpicked row
                      // drags itself.
                      draggable={
                        selection.isSelected(row.note.path) ? selection.paths : [row.note.path]
                      }
                      onFocusRow={() => setPickedFolder(null)}
                      meta={
                        <span className={`${META_COL} text-xs text-muted-foreground tabular-nums`}>
                          {formatMtime(row.note.mtime)}
                        </span>
                      }
                      actions={{
                        openInNewTab: true,
                        moveTo: {
                          folders,
                          // Where this document sits, which may be deeper than
                          // the level the page is on. "Move to" greys out the
                          // folder it is already in, never the one you are
                          // standing in.
                          current: documentFolder(row.note.path),
                          onMove: (note, target) => void move([note.path], target),
                        },
                        onRename: (note, title) => {
                          // A refused rename (a name already taken) leaves the
                          // row as it was; the toast is the only thing that
                          // says it did not happen.
                          void renameNote(note.path, title).catch((err) =>
                            toast(`Not renamed: ${reason(err)}`),
                          );
                        },
                        onDelete: (note) => void deleteDoc(note, { deleteNotes, toast, offerUndo }),
                      }}
                    />
                  ),
                )}
              </FileList>
            )}
          </>
        )}
      </div>

      <UndoStrip offer={undoable} onUndo={runUndo} className="mx-4 mb-1" />

      <ScopedAskComposer
        flat
        scope={{
          kind: 'folder',
          label: selected ? folderLabel(selected) : 'Documents',
          filter: { folder: selected },
        }}
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
