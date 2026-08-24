import { Braces, File, FileText, Table2, type LucideIcon } from 'lucide-react';
import type { AskRequestDTO } from '@qale/ipc';
import { useApp } from '../state/app-state';

/** Session working files (Sessions v2) — the small facts both readers of them
 *  (the right rail's preview and the full-width tab) agree on. */

export function isMarkdownFile(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

/**
 * The comment request parked on this exact file, if there is one
 * (docs/brainstorm-skill.md). A session parks on one thing at a time, so this
 * is a lookup rather than a search.
 *
 * Both readers ask, and they do different things with the answer: the tab draws
 * a box at every slot, the rail draws each question as a row that opens the tab.
 * The rail stays read-only on purpose. It is a column beside a running
 * conversation, roughly a third of the window, and a round is prose with the
 * questions set into it: the one shape that cannot be answered in a strip.
 */
export function usePendingComments(sessionId: string, path: string): AskRequestDTO | null {
  const { askRequests } = useApp();
  const request = askRequests[sessionId];
  return request?.comments?.path === path ? request : null;
}

/** The one file this session is parked on, if any. The rail marks that row, so
 *  the file that is waiting is findable before it is opened. */
export function usePendingCommentsPath(sessionId: string): string | null {
  const { askRequests } = useApp();
  return askRequests[sessionId]?.comments?.path ?? null;
}

/** Human byte size — a size, not a precision instrument. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** The file's kind at a glance. Working material never gets a note-type icon —
 *  that vocabulary belongs to the memory. */
export function fileIconFor(path: string): LucideIcon {
  if (isMarkdownFile(path)) return FileText;
  if (/\.jsonl?$/i.test(path)) return Braces;
  if (/\.(csv|tsv)$/i.test(path)) return Table2;
  return File;
}
