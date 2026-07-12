import { fileSlug } from '../notes/slug.js';
import { dirForType, type SignalFrontmatter, type SourceRef } from '../notes/frontmatter.js';

/**
 * Signal capture factory (PLAN §3.5). A freshly captured signal is always
 * `status: new` and records its provenance (both immutable thereafter — the raw
 * invariant). `summary` is required; if the user gives none we derive a first
 * line so the retrieval index is never empty.
 */
export interface DraftSignal {
  path: string;
  frontmatter: SignalFrontmatter;
  body: string;
}

export function draftSignal(args: {
  body: string;
  summary?: string;
  source?: SourceRef;
  /** ISO datetime; injected (domain is pure — no clock). */
  now: string;
}): DraftSignal {
  const summary = (args.summary ?? firstLine(args.body)).slice(0, 200) || 'captured signal';
  const date = args.now.slice(0, 10);
  const path = `${dirForType('signal')}/${fileSlug(summary, date)}.md`;
  return {
    path,
    frontmatter: {
      type: 'signal',
      summary,
      status: 'new',
      ...(args.source ? { source: args.source } : {}),
      captured: args.now,
    },
    body: args.body.trim(),
  };
}

function firstLine(text: string): string {
  const line = text.trim().split('\n', 1)[0] ?? '';
  return line.replace(/^#+\s*/, '').replace(/^>\s*/, '').trim();
}
