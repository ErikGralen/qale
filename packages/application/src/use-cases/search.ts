import { isReservedFile, type SearchHit } from '@qale/domain';
import type { UseCaseContext } from '../ports.js';

/** Full-text search over the vault index (FTS5). Powers ⌘K and search_vault. */
export function searchNotes(ctx: UseCaseContext, query: string, limit = 20): SearchHit[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  // Reserved orientation files (index.md/log.md) aren't concept notes and are
  // excluded from search-as-a-note (§3.1) — belt-and-suspenders, since they are
  // no longer indexed, this also guards any legacy row still in FTS.
  return ctx.index.search(trimmed, limit).filter((h) => !isReservedFile(h.path));
}
