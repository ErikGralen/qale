import { useEffect, useRef, type ReactNode } from 'react';
import {
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  Check,
  FilePen,
  MessageSquarePlus,
  TicketPlus,
  type LucideIcon,
} from 'lucide-react';
import type { OutboundPayloadDTO } from '@qale/ipc';
import { normalizeLinkTarget, outboundVerb } from '@qale/domain';
import { invoke } from '../../lib/ipc';
import { isExternalRef, providerLabelOf } from '../../lib/connections';
import { ExternalRefChip } from '../ExternalRef';

/**
 * Real focus for the queue's roving cursor. The review drives selection with an
 * index, but a painted ring is a lie to anyone not looking at it: a screen
 * reader announces nothing, and ⌫ acts on a row the AT never named. So the
 * selected row takes DOM focus too, and the ring is only ever a picture of
 * where focus actually is.
 *
 * Two guards keep that from being rude. Focus moves only while the queue
 * already holds it — arriving in a session must never yank the caret out of
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
 *  the row suppresses the browser's own outline and never paints two. It shows
 *  only for keyboard focus (:focus-visible): the roving cursor lands real DOM
 *  focus on the row, so a keyboard pass always sees its place, and a mouse
 *  click never paints a "selected" border on a card the PO is just reading.
 *
 *  `resting` is the hairline a row draws when it is nothing but itself. A row
 *  inside a group sits on the group's own surface, so it draws none: two
 *  hairlines a pixel apart read as a box inside a box. */
export function rowFocusClass(resting = true): string {
  return `outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/60 ${
    resting ? 'ring-1 ring-foreground/10' : ''
  }`;
}

/**
 * What to say when an accept is refused because the edit has nowhere to land.
 * The keyboard path can approve a card without ever opening it, so this is often
 * the only sentence about it the PM ever sees — it has to say what happened and
 * where the way out is (opening the card, which carries "Fix this").
 */
export function staleAcceptMessage(reason?: 'unanchored' | 'duplicate' | 'missing'): string {
  if (reason === 'missing')
    return 'The page this card is about is already gone, so nothing happened. Discard the card.';
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

/** Human name of where an outbound card goes — never the raw provider id. */
export function providerLabel(ob: OutboundPayloadDTO): string {
  const provider = ob.provider ?? ob.system;
  if (!provider) return ob.voice ?? 'the recipient';
  return providerLabelOf(provider);
}

/** The system's proper name, or null when the card names no provider at all. */
export function providerName(ob: OutboundPayloadDTO): string | null {
  const provider = ob.provider ?? ob.system;
  return provider ? providerLabelOf(provider) : null;
}

/**
 * What a card actually does, said once and reused everywhere it appears: the
 * approve button's verb and the glyph on the card. The verb comes from the
 * domain, where the rest of the card's words live, so the button and the
 * receipt can never drift apart. Only the glyph needs lucide, which is the one
 * reason this stays in the renderer.
 */
export interface OutboundAct {
  /** Completes "Approve & …" — an imperative the PO would say out loud. */
  verb: string;
  /** The same act in one word, for the row's approve control: "Post", "Update",
   *  "Reply". A page is updated in place, so calling that "Send" would invent a
   *  delivery that never happens. */
  word: string;
  /** The action's own glyph. A page edit is not a paper plane. */
  Icon: LucideIcon;
}

/** Every action in the payload schema has a glyph below. A payload naming an
 *  action this build does not know cannot be applied at all, so it falls back
 *  to the plain check and claims nothing. */
const ACTION_ICON: Record<string, LucideIcon> = {
  update_page: FilePen,
  comment_ticket: MessageSquarePlus,
  create_ticket: TicketPlus,
  create_event: CalendarPlus,
  update_event: CalendarClock,
  respond_to_event: CalendarCheck,
};

export function outboundAct(ob: OutboundPayloadDTO): OutboundAct {
  const verb = outboundVerb(ob.action);
  const first = verb.split(' ')[0] ?? verb;
  return {
    verb,
    word: first.charAt(0).toUpperCase() + first.slice(1),
    Icon: ACTION_ICON[ob.action] ?? Check,
  };
}

// The outbound sentences live with the rest of the card vocabulary now, so the
// review and the main process say the same thing. Re-exported here because every
// call site in the review already reads its card words from this file.
export { outboundReceipt, outboundTarget } from '@qale/domain';
