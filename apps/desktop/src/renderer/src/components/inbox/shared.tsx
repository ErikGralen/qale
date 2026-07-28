import type { ReactNode } from 'react';
import type { OutboundPayloadDTO } from '@pm/ipc';
import { normalizeLinkTarget } from '@pm/domain';
import { invoke } from '../../lib/ipc';
import { isExternalRef } from '../../lib/connections';
import { ExternalRefChip } from '../ExternalRef';

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
      isExternalRef(target) ? (
        <ExternalRefChip key={match.index} target={target} alias={alias} onOpen={onOpen} />
      ) : (
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
        </button>
      ),
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

/** Proper names for the providers we ship; an unknown provider (a future
 *  connector) degrades to a capitalized word instead of an inbox code change. */
const PROVIDER_LABEL: Record<string, string> = { jira: 'Jira', confluence: 'Confluence', message: 'Message' };

/** Human name of where an outbound card goes — never the raw provider id. */
export function providerLabel(ob: OutboundPayloadDTO): string {
  const provider = ob.provider ?? ob.system;
  // A message goes to a person, not a system — name the audience when known.
  if (provider === 'message') return ob.audience ?? 'the recipient';
  if (!provider) return ob.audience ?? 'the recipient';
  return PROVIDER_LABEL[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

/**
 * The outbound target as the PO says it: "Comment on PAY-142", "File a ticket
 * in PAY", "Update a page". The reference itself renders as a live chip in the
 * card (see CardItem's target line); this string is the plain-text fallback for
 * headlines and aria labels.
 */
export function outboundTarget(ob: OutboundPayloadDTO): string {
  switch (ob.action) {
    case 'comment_ticket':
      return ob.issueKey ? `Comment on ${ob.issueKey}` : 'Comment on a ticket';
    case 'create_ticket':
      return `File a ${ob.issueType?.toLowerCase() ?? 'ticket'}${ob.projectKey ? ` in ${ob.projectKey}` : ''}`;
    case 'update_page':
      return 'Update a page';
    default:
      return `Send an update${ob.audience ? ` to ${ob.audience}` : ''}`;
  }
}
