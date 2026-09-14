import { useCallback, useState } from 'react';
import type { ArrivalItemInputDTO } from '@qale/ipc';
import { itemsFromFiles } from './attachments';
import { pathForFile } from './ipc';

/**
 * The one drop-zone style in the app: a page that will take what you are
 * dragging says so by tinting itself, nothing moves, and no overlay covers what
 * is underneath. Folder pages, note pages, the calendar, Home and a session all
 * wear the same one.
 */
export const DROP_OVER = 'bg-brand/5 ring-1 ring-brand/40 ring-inset';

/**
 * A page that claims its own file drops.
 *
 * The Shell catches every drop nobody else claims; this stops propagation from
 * the first dragenter, so the page that claims a drop is the only one that
 * handles it and the Shell's own "Drop anything" overlay stays down.
 *
 * Pass `null` for `onFiles` and the page claims nothing, which is how a surface
 * that is not ready yet (a session with no id) hands the drop back to the Shell.
 */
export function useFileDrop(onFiles: ((items: ArrivalItemInputDTO[]) => void) | null): {
  over: boolean;
  handlers: {
    onDragEnter: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
} {
  const [over, setOver] = useState(false);

  const drop = useCallback(
    async (e: React.DragEvent) => {
      if (!onFiles || e.dataTransfer.files.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(false);
      onFiles(await itemsFromFiles(Array.from(e.dataTransfer.files), pathForFile));
    },
    [onFiles],
  );

  const claim = (e: React.DragEvent): boolean => {
    if (!onFiles || !e.dataTransfer.types.includes('Files')) return false;
    e.preventDefault();
    e.stopPropagation();
    return true;
  };

  return {
    over: over && !!onFiles,
    handlers: {
      onDragEnter: (e) => {
        if (claim(e)) setOver(true);
      },
      onDragOver: (e) => {
        if (claim(e)) setOver(true);
      },
      onDragLeave: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (e) => void drop(e),
    },
  };
}
