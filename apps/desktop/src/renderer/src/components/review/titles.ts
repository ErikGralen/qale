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

/**
 * The names of a set of pages, for a surface that draws many rows at once (the
 * receipt in the chat). One state for the set, because a hook per row is not a
 * thing a list can do.
 */
export function useNoteNames(refs: readonly string[]): Map<string, NoteName> {
  // The set as one string: a fresh array every render must not re-run the read.
  const key = refs.join('\n');
  const [names, setNames] = useState<Map<string, NoteName>>(new Map());
  useEffect(() => {
    const list = key ? key.split('\n') : [];
    if (list.length === 0) {
      setNames(new Map());
      return;
    }
    let alive = true;
    void Promise.all(list.map(async (ref) => [ref, await noteName(ref)] as const)).then((pairs) => {
      if (!alive) return;
      setNames(new Map(pairs.filter((pair): pair is [string, NoteName] => pair[1] !== null)));
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return names;
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
