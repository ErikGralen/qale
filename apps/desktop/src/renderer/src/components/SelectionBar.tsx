import { useState } from 'react';
import { FolderInput, Pin, PinOff, Trash2, X } from 'lucide-react';
import { typeForDir } from '@qale/domain';
import { Button, Spinner } from '@qale/ui';
import { useApp } from '../state/app-state';
import { isPinnable } from '../lib/note-status';
import { useToast } from './toast';
import { FolderPickerMenu } from './FolderPickerMenu';
import type { DocumentFolder } from '../lib/documents';
import type { Selection } from '../lib/selection';

/** Where a ticked batch can go, when the page has folders to put it in. */
export interface SelectionMoveTo {
  /** Every folder under `notes/`, parent before child. */
  folders: DocumentFolder[];
  /** The folder these documents sit in. Shown, greyed: you are here. */
  current: string;
  /** '' is the top level (Documents). */
  onMove: (folder: string) => void;
  /** Make a folder by that name at this level, then move the batch into it. */
  onCreateAndMove?: (name: string) => void;
}

/**
 * What a selection can have done to it. This goes in the page header's right
 * cluster, in place of the view's own actions, for as long as a row is ticked.
 *
 * It used to be a strip of its own under the header. That strip pushed the
 * whole list down the moment you clicked a row, and pulled it back up when you
 * cleared, so the thing you were aiming at moved twice per click. The header
 * already has the room, so the selection borrows it: the row count and the
 * actions sit after a vertical rule, the header wears a light ink wash while
 * the selection lasts, and nothing below moves.
 *
 * The actions are the ones that are the same job repeated: pin a batch to the
 * rail, file a batch into a folder, throw a batch away. Anything that needs
 * judgment per note (approving, superseding, retitling) stays on the note page
 * where the judgment is made. Nothing here writes a note's body.
 *
 * "Move to" shows only where folders mean something, which is Documents. Every
 * other page passes no `moveTo` and keeps the two buttons it had.
 *
 * There is no bulk Tag. Tags are the agent's filing now (E-15), and this
 * popover was the last place a person was asked to keep them true — it even
 * invented new contexts from whatever was typed into it.
 *
 * Delete confirms in place, in the same words and the same red as the note
 * page's own delete, because it is the same act at scale.
 */
export function SelectionBar({
  selection,
  total,
  noun = 'note',
  moveTo,
}: {
  selection: Selection;
  total: number;
  /**
   * What the rows are called, singular. The page owns the word: Documents says
   * "document", every other page keeps "note". The plural is this plus an s.
   * The header says only "6 selected" — the ticked rows are in plain sight —
   * so the word is here for the tooltips, the confirm and the toast.
   */
  noun?: string;
  /** Adds a "Move to" button. Left out, nothing changes. */
  moveTo?: SelectionMoveTo;
}) {
  const { favorites, toggleFavorite, deleteNotes } = useApp();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const { paths, count } = selection;
  const allPinned = count > 0 && paths.every((p) => favorites.includes(p));
  const nouns = count === 1 ? noun : `${noun}s`;
  // The button says one thing, so it only shows when it can do that one thing
  // to every row taken. A research page, a person or a meeting cannot be pinned at all
  // (docs/memory-placement.md), and a control that does nothing is worse than
  // no control.
  const pinnable = paths.every((p) => {
    const kind = typeForDir(p.split('/')[0] ?? '');
    return !kind || isPinnable(kind);
  });

  if (count === 0) return null;

  const pin = () => {
    // Uniform, not per-row: the button says one thing, so it does one thing to
    // every selected note. Rows already in that state are left alone.
    for (const p of paths) if (favorites.includes(p) === allPinned) toggleFavorite(p);
  };

  const remove = async () => {
    setBusy(true);
    const { failed } = await deleteNotes(paths);
    setBusy(false);
    setConfirmDelete(false);
    if (failed.length > 0)
      toast(`${failed.length} of ${count} ${nouns} could not be deleted: ${failed.join(', ')}`);
  };

  return (
    <>
      <Rule />
      {/* Announced, not just drawn: the count changes under the keyboard as
          often as under the pointer, and a shift-range is the one gesture
          where you cannot see everything you just took. */}
      <span className="text-xs font-medium tabular-nums" aria-live="polite">
        {count} selected
        {busy && <Spinner className="ml-1.5 inline size-3 align-[-2px]" />}
      </span>
      {!selection.all && (
        <button
          className="rounded px-1 text-xs font-medium text-brand hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={selection.selectAll}
        >
          Select all {total}
        </button>
      )}
      <Rule />

      {confirmDelete ? (
        <>
          <span className="text-xs text-muted-foreground">
            Delete {count} {nouns}?
          </span>
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => void remove()}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <div className="flex items-center gap-0.5">
          {pinnable && (
            <BarAction
              icon={allPinned ? PinOff : Pin}
              label={allPinned ? 'Unpin' : 'Pin'}
              title={
                allPinned
                  ? `Take these ${count} off the sidebar`
                  : `Keep these ${count} on the sidebar`
              }
              onClick={pin}
              disabled={busy}
            />
          )}
          {moveTo && (
            <FolderPickerMenu
              folders={moveTo.folders}
              exclude={[moveTo.current]}
              onPick={(folder) => moveTo.onMove(folder)}
              onCreate={moveTo.onCreateAndMove}
              open={picking}
              onOpenChange={setPicking}
            >
              {/* The picker anchors to its own button, so this one is written
                  out rather than made by BarAction: a trigger needs the ref. */}
              <button
                className={barActionClass()}
                disabled={busy}
                title={`Move these ${count} ${nouns} to another folder`}
              >
                <FolderInput className="size-3.5" aria-hidden />
                Move to
              </button>
            </FolderPickerMenu>
          )}
          <BarAction
            icon={Trash2}
            label="Delete"
            title={`Delete ${count} ${nouns}`}
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
            danger
          />
          {/* Glyph only: Esc does the same thing, and the header has to hold
              the location as well as this. */}
          <BarAction
            icon={X}
            title="Clear the selection (Esc)"
            onClick={selection.clear}
            disabled={busy}
          />
        </div>
      )}
    </>
  );
}

/** The hairline that keeps the selection apart from the location it sits beside. */
function Rule() {
  return <span className="h-4 w-px shrink-0 bg-border" aria-hidden />;
}

/** How every button in the strip looks. `danger` turns the hover red. */
function barActionClass(danger?: boolean): string {
  return `flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 ${
    danger
      ? 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
  }`;
}

function BarAction({
  icon: Icon,
  label,
  title,
  onClick,
  disabled,
  danger,
}: {
  icon: typeof Pin;
  /** Left out for a glyph-only button: `title` is then the accessible name. */
  label?: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      className={barActionClass(danger)}
      onClick={onClick}
      disabled={disabled}
      title={title}
      {...(label ? {} : { 'aria-label': title })}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}
