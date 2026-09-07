import { useState, type ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from '@qale/ui';
import { ChevronRight, Folder, Pencil, Trash2, type LucideIcon } from 'lucide-react';
import { navFromEvent, type NavOpts } from '../lib/nav';
import { InlineRename } from '../components/InlineRename';
import { INDENT, META_COL } from '../components/FileRow';
import { DROP_ZONE_CLASS, type AttachRef } from '../lib/dnd';
import type { DocumentFolder } from '../lib/documents';

/** How many things a folder holds, with the unit. A bare number on a row of
 *  mixed things says nothing about what it counts, and a Memory shelf counts
 *  decisions where Documents counts documents.
 *
 *  `plural` is only for a noun that does not take an s. "12 persons" is why it
 *  is here. */
export function countLabel(count: number, noun = 'document', plural = `${noun}s`): string {
  if (count === 0) return 'empty';
  return `${count} ${count === 1 ? noun : plural}`;
}

/**
 * A folder in the list, by the same Finder rules the files follow: a click
 * picks it, a double-click (or ↵) goes into it, and the chevron opens it in
 * place without leaving this level.
 *
 * The row reads as a container: the chevron and a glyph on the left, the
 * recursive count in the right-hand rail with its unit. The glyph is the folder
 * one unless the page hands over another: a Memory shelf wears the glyph of the
 * type it holds, which is the same glyph the sidebar and the tab strip use.
 *
 * Everything past the chevron, the name and the count is optional, because a
 * page that does not own its structure has none of it. Right-click renames it
 * in place or deletes it, and with neither callback there is no menu at all. A
 * folder that still holds files cannot be deleted, and the menu says so rather
 * than failing after the click: emptying it is the PM's decision, one file at a
 * time.
 *
 * Files dropped on the row go into the folder, on a page that has a drop ref to
 * give it.
 */
export function FolderListRow({
  folder,
  count,
  noun,
  plural,
  meta,
  icon: Icon = Folder,
  depth,
  open,
  picked,
  renaming = false,
  onToggle,
  onPick,
  onOpen,
  onStartRename,
  onRename,
  onDoneRename,
  onDelete,
  dropRef,
  dropOver = false,
}: {
  folder: DocumentFolder;
  count: number;
  /** What the count counts. "document" unless the page says otherwise. */
  noun?: string;
  /** Several of them, when the noun does not take an s. */
  plural?: string;
  /** What sits in the rail before the count. Nothing on most pages. */
  meta?: ReactNode;
  /** The glyph. The folder one unless the page holds one kind of thing. */
  icon?: LucideIcon;
  /** 0 at the level the page is standing in. */
  depth: number;
  open: boolean;
  picked: boolean;
  renaming?: boolean;
  onToggle: () => void;
  /** A plain click. It carries the event, so a page where a click opens the
   *  folder can read the modifiers out of it. */
  onPick: (e: React.MouseEvent) => void;
  onOpen: (nav: NavOpts) => void;
  onStartRename?: () => void;
  onRename?: (name: string) => void;
  onDoneRename?: () => void;
  onDelete?: () => void;
  dropRef?: AttachRef;
  dropOver?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const pad = { paddingLeft: `${1 + depth * INDENT}rem` };
  const label = countLabel(count, noun, plural);
  const row = (
    <li
      ref={dropRef}
      role="none"
      className={`relative ${dropOver ? DROP_ZONE_CLASS : picked ? 'bg-brand/8' : 'hover:bg-accent/40'}`}
    >
      {renaming && onRename ? (
        <div className="flex h-7 w-full items-center gap-2 pr-6" style={pad}>
          <span className="size-5 shrink-0" aria-hidden />
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <InlineRename
            value={folder.name}
            label={`Rename ${folder.name}`}
            className="w-full max-w-xs rounded-md border border-border bg-background px-1.5 py-0.5 text-dense font-medium focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onCommit={onRename}
            onDone={() => onDoneRename?.()}
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
              onPick(e);
            }}
            onDoubleClick={(e) => onOpen(e.metaKey || e.ctrlKey ? { newTab: true } : {})}
            onAuxClick={(e) => e.button === 1 && onOpen(navFromEvent(e))}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              e.stopPropagation();
              onOpen(e.metaKey || e.ctrlKey ? { newTab: true, foreground: true } : {});
            }}
            aria-label={`${folder.name}, ${label}`}
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
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-dense font-medium">{folder.name}</span>
            {meta}
            <span className={`${META_COL} text-xs text-muted-foreground`}>{label}</span>
          </div>
        </>
      )}
    </li>
  );

  // No rename and no delete is a page that does not own this structure. It gets
  // the row and no menu, rather than a menu with nothing in it.
  if (!onStartRename && !onDelete) return row;

  return (
    <ContextMenu
      onOpenChange={(menuOpen) => {
        if (!menuOpen) setConfirming(false);
      }}
    >
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {confirming && onDelete ? (
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
            {onStartRename && (
              <ContextMenuItem onSelect={onStartRename}>
                <Pencil className="size-4 text-muted-foreground" aria-hidden />
                Rename folder
              </ContextMenuItem>
            )}
            {onDelete && (
              <>
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
                    Empty it first: {label} inside.
                  </ContextMenuLabel>
                )}
              </>
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
export function NewFolderRow({
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
