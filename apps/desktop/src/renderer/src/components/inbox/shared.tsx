import type { ReactNode } from 'react';
import type { OutboundPayloadDTO } from '@pm/ipc';
import { normalizeLinkTarget } from '@pm/domain';
import { invoke } from '../../lib/ipc';

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/**
 * Inline renderer for a short human sentence that may contain `[[wikilinks]]`
 * (e.g. a proposal's rationale). Each wikilink becomes a clickable link that
 * resolves and routes exactly like the read-view Markdown component — normalize
 * the raw target, resolve the slug to a note path over IPC, then open it. Plain
 * text passes through unchanged so the card's typography is preserved.
 */
export function WikiText({ text, onOpen }: { text: string; onOpen: (path: string) => void }) {
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((match = WIKILINK_RE.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const { target, alias } = normalizeLinkTarget(match[1] ?? '');
    nodes.push(
      <button
        key={match.index}
        className="text-brand hover:underline"
        onClick={async (e) => {
          e.stopPropagation();
          const path = await invoke['note:resolveLink'](target);
          if (path) onOpen(path);
        }}
      >
        {alias ?? target}
      </button>,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}

/** Strip `[[wikilink]]` syntax to its bare label — for non-interactive contexts
 *  (e.g. a truncated preview already wrapped in a button). */
export function stripWikilinks(text: string): string {
  return text.replace(WIKILINK_RE, (_full, inner: string) => {
    const { target, alias } = normalizeLinkTarget(inner);
    return alias ?? target;
  });
}

export const KIND_LABEL: Record<string, string> = { note: 'new note', decision: 'decision', update: 'update', outbound: 'outbound draft' };

export function outboundTarget(ob: OutboundPayloadDTO): string {
  const dest = ob.projectKey
    ? ` → ${ob.projectKey}`
    : ob.issueKey
      ? ` → ${ob.issueKey}`
      : ob.pageId
        ? ` → page ${ob.pageId}`
        : ob.audience
          ? ` → ${ob.audience}`
          : '';
  // "message · message → exec" reads as a stutter — collapse when they match.
  return ob.system === ob.action ? `${ob.system}${dest}` : `${ob.system} · ${ob.action}${dest}`;
}
