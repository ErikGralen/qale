import type { SearchHit } from '@pm/domain';
import type { UseCaseContext } from '../ports.js';

/** Full-text search over the vault index (FTS5). Powers ⌘K and search_vault. */
export function searchNotes(ctx: UseCaseContext, query: string, limit = 20): SearchHit[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return ctx.index.search(trimmed, limit);
}
