import type { NoteRefDTO, NoteType, VaultTreeDTO } from '@qale/ipc';
import { isFolderIndex } from '@qale/domain';

/**
 * Contexts — curated tags (projects, products, areas) that cut across note
 * types. The vocabulary is whatever tags exist in frontmatter; the librarian
 * keeps it small by suggesting from the existing set (see @qale/agent prompts).
 */

/** Chrome types never participate in context navigation. */
const NON_CONTENT_TYPES: ReadonlySet<NoteType> = new Set(['session', 'skill', 'agent'] satisfies NoteType[]);

export interface ContextInfo {
  tag: string;
  count: number;
}

export function isContentNote(n: NoteRefDTO): boolean {
  return !NON_CONTENT_TYPES.has(n.type) && !isFolderIndex(n.path);
}

export function contentNotes(tree: VaultTreeDTO | null): NoteRefDTO[] {
  if (!tree) return [];
  return tree.groups.flatMap((g) => g.notes).filter(isContentNote);
}

/** All contexts in use, sorted by note count (descending), ties alphabetical. */
export function collectContexts(tree: VaultTreeDTO | null): ContextInfo[] {
  const map = new Map<string, ContextInfo>();
  for (const n of contentNotes(tree)) {
    for (const tag of n.tags ?? []) {
      let info = map.get(tag);
      if (!info) {
        info = { tag, count: 0 };
        map.set(tag, info);
      }
      info.count++;
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Notes carrying a context, across all content types. */
export function notesInContext(tree: VaultTreeDTO | null, tag: string): NoteRefDTO[] {
  return contentNotes(tree).filter((n) => n.tags?.includes(tag));
}

/**
 * The spine order — how a context page reads: what we decided, what we're
 * working on, what we learned, then the surrounding cast.
 */
export const SPINE_ORDER: readonly NoteType[] = [
  'decision',
  'theme',
  'insight',
  'todo',
  'customer',
  'person',
  'meeting',
  'note',
  'source',
];

/** Best display date for a ref: frontmatter date if present, else mtime. */
export function refDate(n: NoteRefDTO): Date {
  if (n.date) {
    const d = new Date(n.date);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(n.mtime);
}

const DATE_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const DATE_FMT_YEAR = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/** Compact date label: "Jun 24" this year, "Jun 24, 2025" otherwise. */
export function formatRefDate(n: NoteRefDTO, now = new Date()): string {
  const d = refDate(n);
  return d.getFullYear() === now.getFullYear() ? DATE_FMT.format(d) : DATE_FMT_YEAR.format(d);
}

const MONTH_FMT = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long' });

/** Month bucket label for group-by-date ("July 2026"). */
export function monthBucket(n: NoteRefDTO): string {
  return MONTH_FMT.format(refDate(n));
}
