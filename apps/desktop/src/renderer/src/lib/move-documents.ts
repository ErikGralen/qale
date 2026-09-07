import type { NoteRefDTO } from '@qale/ipc';
import type { UndoOffer } from '../components/UndoStrip';
import { invoke } from './ipc';
import { documentFolder } from './documents';

/**
 * Filing a document somewhere else, and taking it away, with the way back from
 * both.
 *
 * The rule these two keep: a write the PM made with one click can be undone
 * with one click, and it says so where the click happened. The page owns the
 * screen, so it hands in the toast and the undo offer; what happens to the
 * files is here.
 */

/** What went wrong, in the words the main process used. */
function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** "1 document", "3 documents". A bare number does not say what moved. */
function documents(count: number): string {
  return `${count} ${count === 1 ? 'document' : 'documents'}`;
}

/** What both writes need from the page that asked for them. */
interface Reporting {
  toast: (message: string) => void;
  /** Show the way back, for the six seconds it lasts. */
  offerUndo: (offer: UndoOffer) => void;
}

/**
 * Move documents into `target`, one file at a time. A move can be refused per
 * file (a name already taken in that folder), so the ones that go, go: the
 * toast names how many stayed and why the first one did.
 *
 * The undo puts each document back in its OWN folder, not in one shared one: a
 * selection can be swept up from several levels at once.
 */
export async function moveDocs(
  paths: string[],
  target: string,
  deps: Reporting & {
    /** What the target folder is called, for the undo strip. */
    targetLabel: string;
    /** The title of the document at this path, when the page knows it. */
    titleOf: (path: string) => string | undefined;
  },
): Promise<void> {
  // `from` is the path the document had BEFORE the move, which is the only
  // handle the page has on its title. Reading the title off `paths[0]` instead
  // names the wrong document whenever the first one is the one that stayed.
  const moved: { path: string; from: string; folder: string }[] = [];
  const failed: string[] = [];
  let first = '';
  for (const path of paths) {
    const folder = documentFolder(path);
    try {
      const note = await invoke['note:move']({ path, folder: target });
      moved.push({ path: note.path, from: path, folder });
    } catch (err) {
      failed.push(path);
      if (!first) first = reason(err);
    }
  }
  if (failed.length > 0)
    deps.toast(`${failed.length} of ${documents(paths.length)} did not move: ${first}`);
  const only = moved.length === 1 ? moved[0] : undefined;
  if (!only && moved.length === 0) return;
  deps.offerUndo({
    label: 'Moved',
    title: only ? (deps.titleOf(only.from) ?? documents(1)) : documents(moved.length),
    suffix: `to ${deps.targetLabel}`,
    undo: () => {
      for (const m of moved) void invoke['note:move']({ path: m.path, folder: m.folder });
    },
  });
}

/**
 * Delete one document, and offer the way back.
 *
 * The undo is the app's one undo (`history:revert`), aimed at the commit the
 * delete just wrote. A workspace with no git keeps no commits, so there is
 * nothing to offer there and the row simply goes.
 */
export async function deleteDoc(
  note: NoteRefDTO,
  deps: Reporting & {
    deleteNotes: (paths: string[]) => Promise<{ failed: string[] }>;
  },
): Promise<void> {
  const { failed } = await deps.deleteNotes([note.path]);
  if (failed.length > 0) {
    deps.toast('That document could not be deleted.');
    return;
  }
  const history = await invoke['note:history'](note.path).catch(() => []);
  const hash = history[0]?.hash;
  if (!hash) return;
  deps.offerUndo({
    label: 'Deleted',
    title: note.title,
    undo: () => {
      void invoke['history:revert']({ path: note.path, hash }).catch((err) =>
        deps.toast(`Not put back: ${reason(err)}`),
      );
    },
  });
}
