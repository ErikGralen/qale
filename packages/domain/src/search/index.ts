import type { NoteType } from '../notes/frontmatter.js';

/**
 * Search domain shapes. The FTS/vector implementation lives in infra (@qale/vault);
 * these are the shared result contracts.
 */
export interface SearchHit {
  path: string;
  slug: string;
  type: NoteType;
  title: string;
  summary: string;
  snippet: string;
  score: number;
}

export interface SearchQuery {
  query: string;
  limit: number;
  types?: NoteType[];
}
