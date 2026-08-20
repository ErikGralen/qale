import { useEffect, useRef, type ReactNode } from 'react';
import {
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  FilePen,
  MessageSquarePlus,
  Send,
  TicketPlus,
  type LucideIcon,
} from 'lucide-react';
import type { OutboundPayloadDTO } from '@qale/ipc';
import { normalizeLinkTarget, rsvpAnswer } from '@qale/domain';
import { invoke } from '../../lib/ipc';
import { isExternalRef } from '../../lib/connections';
import { ExternalRefChip } from '../ExternalRef';

/**
 * Real focus for the queue's roving cursor. The Inbox drives selection with an
 * index, but a painted ring is a lie to anyone not looking at it: a screen
 * reader announces nothing, and ⌫ acts on a row the AT never named. So the
 * selected row takes DOM focus too, and the ring is only ever a picture of
 * where focus actually is.
 *
 * Two guards keep that from being rude. Focus moves only while the queue
 * already holds it — arriving in the Inbox must never yank the caret out of
 * whatever the PO was doing — and never out of a control inside the row, so
 * tabbing to a card's own button is not undone by the cursor catching up.
 */
export function useQueueFocus<T extends HTMLElement>(focused: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!focused || !el) return;
    el.scrollIntoView({ block: 'nearest' });
    const queue = el.closest('[data-queue]');
    const active = document.activeElement;
    if (queue?.contains(active) && !el.contains(active)) el.focus({ preventScroll: true });
  }, [focused]);
  return ref;
}

/** Shared shell classes for a queue row — the ring is the focus indicator, so
 *  the row suppresses the browser's own outline and never paints two. */
export function rowFocusClass(focused: boolean): string {
  return `outline-none ring-1 transition-shadow ${focused ? 'ring-2 ring-ring/60' : 'ring-foreground/10'}`;
}

/**
 * What to say when an accept is refused because the edit has nowhere to land.
 * The keyboard path can approve a card without ever opening it, so this is often
 * the only sentence about it the PM ever sees — it has to say what happened and
 * where the way out is (opening the card, which carries "Fix this").
 */
export function staleAcceptMessage(reason?: 'unanchored' | 'duplicate'): string {
  if (reason === 'duplicate')
    return 'What this adds is already in the note word for word, so nothing was written. Open it to see.';
  return "The text this edit was pointing at isn't in the note any more. Open it to send it back to be redone.";
}

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

/** Proper names for the providers we ship; an unknown provider (a future
 *  connector) degrades to a capitalized word instead of an inbox code change. */
const PROVIDER_LABEL: Record<string, string> = {
  jira: 'Jira',
  confluence: 'Confluence',
  message: 'Message',
  'google-calendar': 'Google Calendar',
};

/** Human name of where an outbound card goes — never the raw provider id. */
export function providerLabel(ob: OutboundPayloadDTO): string {
  const provider = ob.provider ?? ob.system;
  // A message goes to a person, not a system — name the audience when known.
  if (provider === 'message') return ob.audience ?? 'the recipient';
  if (!provider) return ob.audience ?? 'the recipient';
  return PROVIDER_LABEL[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** The system's proper name, or null when the card goes to a person rather
 *  than a system — "Send an update to Sara" has no product name in it. */
export function providerName(ob: OutboundPayloadDTO): string | null {
  const provider = ob.provider ?? ob.system;
  if (!provider || provider === 'message') return null;
  return PROVIDER_LABEL[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

/**
 * What a card actually does, said once and reused everywhere it appears: the
 * approve button's verb, the glyph on the card, and the receipt line after it
 * lands. Only a message is *sent* — an `update_page` rewrites a page that
 * already exists, and calling that "send" invents a delivery that never
 * happens while hiding the edit that does.
 */
export interface OutboundAct {
  /** Completes "Approve & …" — an imperative the PO would say out loud. */
  verb: string;
  /** The action's own glyph. A page edit is not a paper plane. */
  Icon: LucideIcon;
}

export function outboundAct(ob: OutboundPayloadDTO): OutboundAct {
  switch (ob.action) {
    case 'update_page':
      return { verb: 'update the page', Icon: FilePen };
    case 'comment_ticket':
      return { verb: 'post the comment', Icon: MessageSquarePlus };
    case 'create_ticket':
      return { verb: 'create the ticket', Icon: TicketPlus };
    case 'create_event':
      return { verb: 'create the event', Icon: CalendarPlus };
    case 'update_event':
      return { verb: 'change the event', Icon: CalendarClock };
    case 'respond_to_event':
      return { verb: 'reply', Icon: CalendarCheck };
    default:
      return { verb: 'send', Icon: Send };
  }
}

/**
 * The whole outbound act as the PO says it, in plain text: "Comment on PAY-142",
 * "File a ticket in PAY: SCIM group-mapping", "Add “Erik x Daniel: sync” to your
 * calendar". The reference itself renders as a live chip in the card (see
 * CardItem's target line); this string is the flat fallback for headlines and
 * aria labels, so it names the thing itself — a calendar event reading "Send an
 * update" told the PO about a delivery that never happens.
 */
export function outboundTarget(ob: OutboundPayloadDTO): string {
  const named = (s: string): string => `“${s}”`;
  switch (ob.action) {
    case 'comment_ticket':
      return ob.issueKey ? `Comment on ${ob.issueKey}` : 'Comment on a ticket';
    case 'create_ticket': {
      const file = `File a ${ob.issueType?.toLowerCase() ?? 'ticket'}${ob.projectKey ? ` in ${ob.projectKey}` : ''}`;
      return ob.title ? `${file}: ${ob.title}` : file;
    }
    case 'update_page':
      return ob.title ? `Update ${named(ob.title)}` : 'Update a page';
    case 'create_event':
      return `Add ${ob.title ? named(ob.title) : 'an event'} to your calendar`;
    case 'update_event':
      return ob.title ? `Change ${named(ob.title)}` : 'Change an event';
    case 'respond_to_event':
      return `Reply ${rsvpAnswer(ob.responseStatus)} to ${ob.title ? named(ob.title) : 'an invite'}`;
    default: {
      const send = `Send an update${ob.audience ? ` to ${ob.audience}` : ''}`;
      return ob.title ? `${send}: ${ob.title}` : send;
    }
  }
}

/**
 * The receipt line after a card lands — past tense, and naming the thing it
 * touched. "Update a page" told the PO nothing about which page just changed
 * under their name.
 */
export function outboundReceipt(ob: OutboundPayloadDTO): string {
  switch (ob.action) {
    case 'update_page':
      return `Updated ${ob.title ?? 'a page'}`;
    case 'comment_ticket':
      return `Commented on ${ob.issueKey ?? 'a ticket'}`;
    case 'create_ticket':
      return `Created a ${ob.issueType?.toLowerCase() ?? 'ticket'}${ob.projectKey ? ` in ${ob.projectKey}` : ''}`;
    case 'create_event':
      return `Added ${ob.title ?? 'an event'} to your calendar`;
    case 'update_event':
      return `Changed ${ob.title ?? 'an event'} in your calendar`;
    case 'respond_to_event':
      return `Replied ${rsvpAnswer(ob.responseStatus)} to ${ob.title ?? 'an invite'}`;
    default:
      return `Sent an update${ob.audience ? ` to ${ob.audience}` : ''}`;
  }
}
