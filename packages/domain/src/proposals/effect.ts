import type { OutboundPayload } from './index.js';

/**
 * The effect line on an outbound card: one sentence pair saying what approving
 * DOES and who it reaches. `rationale` is the agent's "why"; this is the "what
 * will happen", and it is composed here from the payload plus facts the app
 * already holds — never authored by the model. That is the whole point: the
 * same card kind always says the same thing, in the same shape, and it is true.
 *
 * Two rules keep it from growing into a paragraph:
 *  - Nothing that would cost a request. Jira watcher counts and Confluence
 *    watcher counts are one API call per card, so the line names WHO is
 *    notified without counting them.
 *  - A missing fact shortens the sentence, it never pads it. No page title ⇒
 *    "the page", no attendees we can name ⇒ their address, no self identity ⇒
 *    no claim about who is outside the company.
 *
 * Vault-only cards (note/update/decision) get no line: the diff is the effect
 * and nothing leaves the machine.
 */
export interface OutboundEffectFacts {
  /**
   * Every address that means "me" (Settings → You plus the connected accounts).
   * Their domains are "your company" — the only basis we have for calling an
   * attendee external, so an empty list means we say nothing about it.
   */
  selfEmails?: readonly string[];
  /** Lower-cased email → the person's display name, for attendees with a page. */
  names?: ReadonlyMap<string, string>;
  /** Lower-cased external id (page id, event id) → the mirror note's title. */
  titles?: ReadonlyMap<string, string>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const lower = (s: string): string => s.trim().toLowerCase();
const quote = (s: string): string => `“${s}”`;

/** "a ticket" / "an epic" — the article the PO would say out loud. */
const article = (noun: string): string => (/^[aeiou]/i.test(noun) ? 'an' : 'a');

/** "Åsa", "Åsa and Johan", "Åsa, Johan and Marcus" — no serial comma. */
function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const domainOf = (email: string): string => lower(email).split('@')[1] ?? '';

/**
 * The event time as a person says it: "4 Aug, 15:00". Read off the literal
 * RFC3339 string rather than through a Date, because the offset in the payload
 * IS the intended local time — parsing it would re-render it in the app's zone
 * and quietly show a different hour than the one being approved.
 */
function formatWhen(iso: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso.trim());
  if (!m) return undefined;
  const month = MONTHS[Number(m[2]) - 1];
  const day = Number(m[3]);
  if (!month || !day) return undefined;
  return m[4] ? `${day} ${month}, ${m[4]}:${m[5]}` : `${day} ${month}`;
}

/**
 * Who a new event reaches, named. People with a page are their first name (how
 * the PO refers to them); everyone else is their address, which is the honest
 * form for someone the workspace has never heard of. Capped at three so the
 * line can't run away; the PO is deciding, not auditing.
 *
 * The external flag is the load-bearing part: an address at a domain that isn't
 * ours is exactly what a PO skims past. One outsider is marked in place, more
 * than one is counted at the end (marking each would triple the line).
 */
function guestList(attendees: readonly string[] | undefined, facts: OutboundEffectFacts): string | undefined {
  const mine = new Set((facts.selfEmails ?? []).map(lower));
  const ourDomains = new Set([...mine].map(domainOf).filter(Boolean));
  const guests = (attendees ?? []).map((a) => a.trim()).filter((a) => a.length > 0 && !mine.has(lower(a)));
  if (guests.length === 0) return undefined;

  const entries = guests.map((email) => ({
    label: facts.names?.get(lower(email))?.trim().split(/\s+/)[0] || email,
    // No self identity ⇒ no idea what "our domain" is ⇒ no claim either way.
    external: ourDomains.size > 0 && !ourDomains.has(domainOf(email)),
  }));
  const outside = entries.filter((e) => e.external).length;
  const shown = entries.slice(0, 3);
  const hidden = entries.length - shown.length;
  const inline = outside === 1 && shown.some((e) => e.external);

  const parts = shown.map((e) => (inline && e.external ? `${e.label} (outside your company)` : e.label));
  if (hidden > 0) parts.push(`${hidden} ${hidden === 1 ? 'other' : 'others'}`);
  const list = joinAnd(parts);
  return outside > 0 && !inline ? `${list} (${outside} outside your company)` : list;
}

/**
 * The card's effect line, or undefined when the payload says too little to make
 * a true one. Kept in the domain so every surface that shows a card shows the
 * same sentence.
 */
export function outboundEffect(p: OutboundPayload, facts: OutboundEffectFacts = {}): string | undefined {
  switch (p.action) {
    case 'create_ticket': {
      // A brand-new ticket has no watchers yet, and project notification
      // schemes are not something we can read cheaply, so the line stops here
      // rather than guessing at who hears about it.
      const kind = p.issueType?.trim().toLowerCase() || 'ticket';
      return p.projectKey
        ? `Creates ${article(kind)} ${kind} in ${p.projectKey}.`
        : `Creates ${article(kind)} ${kind}.`;
    }

    case 'comment_ticket':
      return p.issueKey
        ? `Posts a comment on ${p.issueKey}. Anyone watching the ticket is notified.`
        : 'Posts a comment on the ticket. Anyone watching it is notified.';

    case 'update_page': {
      // The mirror note's title beats the draft's own: it is what the page is
      // called upstream right now. Neither ⇒ "the page", never the raw id.
      const title = facts.titles?.get(lower(p.pageId ?? '')) ?? p.title?.trim();
      const target = title ? quote(title) : 'the page';
      const lead = p.patch ? `Edits ${target} in place` : `Adds a section to ${target}`;
      return `${lead}. Anyone watching ${title ? 'the page' : 'it'} is notified.`;
    }

    case 'send_message':
      // The one outbound card that goes nowhere: message drafts are filed in
      // the workspace (Slack/email are out of scope). Saying so is the point.
      return p.audience?.trim()
        ? `Saves the draft for ${p.audience.trim()} in your workspace. Nothing is sent.`
        : 'Saves the draft in your workspace. Nothing is sent.';

    case 'create_event': {
      // Guests land on the event but are NOT mailed: the connector writes with
      // sendUpdates=none so pm's approval stays the only outbound channel.
      const guests = guestList(p.attendees, facts);
      return guests
        ? `Creates the event for ${guests}. No invite email goes out.`
        : 'Creates the event on your calendar. Nobody else is invited.';
    }

    case 'update_event': {
      const title = facts.titles?.get(lower(p.eventId ?? ''));
      const target = title ? quote(title) : 'the event';
      const when = p.start ? formatWhen(p.start) : undefined;
      const rename = p.title?.trim();
      const lead = when
        ? `Moves ${target} to ${when}${rename ? ' and renames it' : ''}`
        : rename
          ? `Renames ${target} to ${quote(rename)}`
          : `Changes ${target}`;
      return `${lead}. Guests see the change, with no email.`;
    }

    case 'respond_to_event': {
      const answer = p.responseStatus === 'declined' ? 'no' : p.responseStatus === 'tentative' ? 'maybe' : 'yes';
      return `Replies ${answer} on your behalf. The organiser sees it on the event.`;
    }

    default:
      return undefined;
  }
}
