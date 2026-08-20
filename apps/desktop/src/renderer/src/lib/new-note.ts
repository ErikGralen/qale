import { useCallback, useState } from 'react';
import { noteTypeLabel, type HandCreatableType } from '@qale/domain';
import { useApp } from '../state/app-state';
import { useToast } from '../components/toast';
import type { NavOpts } from './nav';

/**
 * Start a page of a chosen type and land in it — the "+" on a Memory shelf and
 * the one in the sidebar both run this.
 *
 * No naming step on the way in. A skill has to be named up front because its
 * folder is the address every stored session cites; a note's filename is
 * disposable, so the page opens "Untitled" with the cursor already in the title
 * (NoteView autofocuses it on an empty page) and the rename moves the file
 * while nothing links there yet. One click, and you are typing.
 */
export function useNewNote(): {
  create: (type: HandCreatableType, nav?: NavOpts) => Promise<void>;
  busy: boolean;
} {
  const { createNote, openDoc } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const create = useCallback(
    async (type: HandCreatableType, nav?: NavOpts) => {
      if (busy) return;
      setBusy(true);
      try {
        const note = await createNote(type);
        await openDoc(note.path, nav);
      } catch (err) {
        toast(
          `${noteTypeLabel(type)} not created: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, createNote, openDoc, toast],
  );

  return { create, busy };
}
