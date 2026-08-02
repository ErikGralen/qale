import { Braces, File, FileText, Table2, type LucideIcon } from 'lucide-react';

/** Session working files (Sessions v2) — the small facts both readers of them
 *  (the right rail's preview and the full-width tab) agree on. */

export function isMarkdownFile(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
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
