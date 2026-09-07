import { useEffect, useState } from 'react';
import { invoke, onEvent } from '../../lib/ipc';

/**
 * What a page is really called (docs/review-rework.md RR-3).
 *
 * A card carries a path, and a path de-slugged reads "Update Tell Fjord Sports
 * Payroll Timeline" while the page itself is called "Tell Fjord Sports the
 * payroll timeline". The row names the page the way the page does, so it asks
 * the workspace.
 *
 * One lookup per file, shared by every row that names it, and dropped whenever
 * the vault changes. A rename must not leave the review saying the old name.
 */
export interface NoteName {
  title: string;
  path: string;
}

const cache = new Map<string, Promise<NoteName | null>>();

onEvent((event) => {
  if (event.channel === 'vault:changed') cache.clear();
});

async function lookup(ref: string): Promise<NoteName | null> {
  try {
    // A card carries a full path; evidence and sources carry a bare slug.
    const path = ref.endsWith('.md') ? ref : await invoke['note:resolveLink'](ref);
    if (!path) return null;
    const note = await invoke['note:get'](path);
    return note ? { title: note.title, path: note.path } : null;
  } catch {
    return null;
  }
}

/** The name of one page, looked up once. Null while it is being read, and for a
 *  file that does not exist yet (a card that creates one). */
export function noteName(ref: string): Promise<NoteName | null> {
  let hit = cache.get(ref);
  if (!hit) {
    hit = lookup(ref);
    cache.set(ref, hit);
  }
  return hit;
}

/** The name of one page, for a component that draws it. */
export function useNoteName(ref: string | null): NoteName | null {
  const [name, setName] = useState<NoteName | null>(null);
  useEffect(() => {
    if (!ref) {
      setName(null);
      return;
    }
    let alive = true;
    void noteName(ref).then((n) => alive && setName(n));
    return () => {
      alive = false;
    };
  }, [ref]);
  return name;
}
