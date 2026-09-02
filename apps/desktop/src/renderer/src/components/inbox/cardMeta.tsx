import {
  BookMarked,
  BookOpen,
  FileText,
  GitCommitHorizontal,
  Lightbulb,
  ListChecks,
  Mic,
  Pencil,
  Ticket,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  bareRef,
  isNewSkill,
  nounForDir,
  proposalHeadline,
  titleForRef,
  titleFromSlug,
  typeForDir,
} from '@qale/domain';
import type { OutboundPayloadDTO, ProposalDTO } from '@qale/ipc';
import { isExternalRef } from '../../lib/connections';
import { NOTE_TYPE_ICON, noteTypeIcon } from '../../lib/note-icons';
import { outboundAct, outboundReceipt, providerLabel } from './shared';

// Both read a note reference the way the whole app reads one. They live in the
// domain now; the Inbox keeps reading them from here.
export { bareRef, titleForRef };

/**
 * Turns a raw proposal into the one thing the PO reads to decide: a
 * plain-language line saying what the app will do, plus the pieces the card
 * draws around it (the glyph, the note chip, the name a create card files
 * under). No paths, slugs, or jargon.
 *
 * The app composes that line, it does not ask for one. No `propose_*` tool takes
 * a headline except `propose_instruction`, so on every other card the composed
 * line is what the PO reads. The dense rationale stays the expandable "why",
 * never the scannable line.
 */
export interface CardHeadline {
  Icon: LucideIcon;
  /** The scannable sentence — wraps, never truncates. */
  headline: string;
  /** Short human noun for the kind (aria + the "why" prompt), e.g. "decision". */
  kind: string;
  /** Whether the agent wrote the headline itself. Only a standing instruction
   *  does; every other card carries the composed line. */
  authored: boolean;
  /** Lead verb for update cards, so the note reference can render distinctly. */
  verb: string;
  /** The existing note an update touches — rendered as a distinct, openable chip. */
  note?: { title: string; path: string };
  /**
   * The note a create card would write, named so the card says where the change
   * lands. "New note: <a paragraph-long summary>" said what the note would SAY
   * and never what it would be called, and a create card has no openable chip to
   * fall back on: the file does not exist until the PO approves. Absent when the
   * headline already carries the name, so the card never says it twice.
   */
  creates?: { title: string; path: string };
  /** Human title of the note this decision replaces, when superseding. */
  replaces?: string;
  /** New title an update applies on approval — shown so a rename is never silent. */
  retitle?: string;
}

const dirOf = (path?: string | null): string => (path ? (path.split('/')[0] ?? '') : '');

/** The file a card writes to — `targetPath` where there is one, else the path
 *  the payload files at (a note card carries only the latter). */
function targetOf(p: ProposalDTO): string {
  return p.targetPath ?? (p.payload as { path?: string }).path ?? '';
}

/**
 * A standing instruction: a rule the PO taught the app, landing in a skill or
 * agent file rather than in their memory. It arrives as an ordinary `update`
 * (a bullet appended to Standing instructions, or to Your rules in the house
 * rules) or, where no house-rules file exists yet, as the `note` that creates
 * `skills/house-rules/SKILL.md` — the same rule either way, so the card must
 * not read differently depending on which.
 *
 * The headline says the rule itself; this is here for the glyph and the rank,
 * which the domain vocabulary knows nothing about.
 */
function isInstruction(p: ProposalDTO): boolean {
  const dir = dirOf(targetOf(p));
  return (dir === 'skills' || dir === 'agents') && !isSkill(p);
}

/** A card that writes a whole new skill (`propose_skill`) rather than a rule
 *  into one. It lands in the same folder, so the domain tells them apart and
 *  the Inbox asks it the same question. */
function isSkill(p: ProposalDTO): boolean {
  return isNewSkill(p.kind, targetOf(p));
}

/** The note-type glyph for an evidence ref — derived from its dir segment, so a
 *  "Based on" chip tells you at a glance whether it points at a decision, a
 *  meeting, a customer. External refs carry their own kind: a wiki page is a
 *  book, a ticket is a ticket — typing a Confluence page as a ticket told the
 *  PO the wrong thing about the source they were trusting. */
export function iconForRef(ref: string): LucideIcon {
  const bare = bareRef(ref);
  if (bare.startsWith('wikipages/')) return BookOpen;
  if (isExternalRef(bare)) return Ticket;
  const type = typeForDir(bare.split('/')[0] ?? '');
  return type ? noteTypeIcon(type) : FileText;
}

function frontmatter(p: ProposalDTO): Record<string, unknown> {
  return (p.payload as { frontmatter?: Record<string, unknown> }).frontmatter ?? {};
}

/** An authored title/summary from the payload, when the note carries one. Only
 *  the receipt needs it now; the headline reads the frontmatter in the domain. */
function payloadTitle(p: ProposalDTO): string {
  const fm = frontmatter(p);
  const title = fm['title'] ?? fm['summary'];
  return typeof title === 'string' && title.trim() ? title.trim() : '';
}

/** The card's line, composed from what the card already carries: the path, the
 *  frontmatter, and the text an update adds. Same vocabulary as the effect line
 *  and the receipt, so one card never says two things. */
function composedHeadline(p: ProposalDTO): string {
  const payload = p.payload as { append?: string; body?: string };
  return proposalHeadline({
    kind: p.kind,
    targetPath: targetOf(p),
    frontmatter: frontmatter(p),
    append: payload.append,
    body: payload.body,
    outbound: p.kind === 'outbound' ? (p.payload as OutboundPayloadDTO) : undefined,
  });
}

function iconFor(p: ProposalDTO): LucideIcon {
  // An outbound card wears its action's glyph, not a blanket paper plane —
  // the same one the approve button carries, so the card reads as one act.
  if (p.kind === 'outbound') return outboundAct(p.payload as OutboundPayloadDTO).Icon;
  // The one card that takes a page away wears the one glyph nothing else uses,
  // so it can never be mistaken for the edit it sits next to in the queue.
  if (p.kind === 'delete') return Trash2;
  // A new skill wears the glyph every skill wears, in the sidebar and on the
  // Skills page. The card is the file, so it should look like the file.
  if (isSkill(p)) return NOTE_TYPE_ICON.skill;
  // A rule for the house, not a note in the memory — so neither the generic
  // pencil an update wears nor a note-type glyph. The open book is the wiki
  // page's already, so a rule takes the marked one.
  if (isInstruction(p)) return BookMarked;
  if (p.kind === 'decision') return GitCommitHorizontal;
  if (p.kind === 'update') return dirOf(p.targetPath) === 'todos' ? ListChecks : Pencil;
  const type =
    typeof frontmatter(p)['type'] === 'string' ? (frontmatter(p)['type'] as string) : 'note';
  if (type === 'insight') return Lightbulb;
  if (type === 'customer' || type === 'person') return Users;
  if (type === 'todo') return ListChecks;
  if (type === 'meeting') return Mic;
  return FileText;
}

function kindNoun(p: ProposalDTO): string {
  if (p.kind === 'outbound') return providerLabel(p.payload as OutboundPayloadDTO);
  if (p.kind === 'delete') return 'deletion';
  if (isSkill(p)) return 'skill';
  if (isInstruction(p)) return 'standing instruction';
  if (p.kind === 'decision') return 'decision';
  if (p.kind === 'update') return nounForDir(dirOf(p.targetPath)).replace(/^(a|an|the) /, '');
  const type =
    typeof frontmatter(p)['type'] === 'string' ? (frontmatter(p)['type'] as string) : 'note';
  return type;
}

export function cardHeadline(p: ProposalDTO): CardHeadline {
  const supersedes = (p.payload as { supersedes?: string }).supersedes;
  const authored = !!p.headline?.trim();
  const base = {
    Icon: iconFor(p),
    kind: kindNoun(p),
    authored,
    replaces: supersedes ? titleForRef(supersedes) : undefined,
  };

  // A deletion reads like an update — verb plus the page as an openable chip —
  // because the PO has to be able to go and look at what is about to go before
  // they agree to lose it.
  if (p.kind === 'delete') {
    const path = targetOf(p);
    const title = titleForRef(path) || 'this note';
    return {
      ...base,
      verb: 'Delete',
      headline: p.headline?.trim() || `Delete ${title}`,
      note: path ? { title, path } : undefined,
    };
  }

  // A standing instruction says itself in full ("Remember this: …"), so the
  // headline is the whole sentence and never "Update <file>" — the rule is the
  // subject, the file it lands in is only where. Once the agent has authored
  // the sentence, that file rides along as the quiet chip below it; an update
  // with no authored headline would otherwise render as verb + chip and drop
  // the rule entirely.
  if (isInstruction(p)) {
    const path = targetOf(p);
    return {
      ...base,
      verb: '',
      headline: p.headline?.trim() || composedHeadline(p),
      note:
        authored && p.kind === 'update' && path ? { title: titleForRef(path), path } : undefined,
    };
  }

  // An update touches an existing note. The note is the subject — render it as a
  // distinct, openable chip so "Update <note>" never reads as one run of words.
  if (p.kind === 'update') {
    const path = targetOf(p);
    const title = titleForRef(path) || 'this note';
    const rawRetitle = (p.payload as { title?: unknown }).title;
    return {
      ...base,
      verb: 'Update',
      headline: p.headline?.trim() || `Update ${title}`,
      note: path ? { title, path } : undefined,
      retitle: typeof rawRetitle === 'string' && rawRetitle.trim() ? rawRetitle.trim() : undefined,
    };
  }

  // Everything left creates something: a note, a decision, or (outbound) a
  // record somewhere else, which has no vault path and names its target in its
  // own head line.
  const headline = p.headline?.trim() || composedHeadline(p);
  const path = p.kind === 'note' || p.kind === 'decision' ? targetOf(p) : '';
  const created = titleForRef(path);
  return {
    ...base,
    verb: '',
    headline,
    creates:
      created && !headline.toLowerCase().includes(created.toLowerCase())
        ? { title: created, path }
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// The receipt: the same card, in the past tense (docs/closing-beat.md)
// ---------------------------------------------------------------------------

/** What one approved card did. The card says what will happen; this says what
 *  happened, in the same nouns. */
export interface ReceiptEntry {
  id: string;
  /** The one verb for what landed. */
  verb: 'Created' | 'Updated' | 'Decided' | 'Sent' | 'Deleted';
  /** The note it touched, when it touched one. It is the receipt's link. */
  note?: { title: string; path: string };
  /** Outbound only: the sentence for what left the workspace. */
  sent?: string;
  /** A deletion only: the name of the page that is gone. Its own field rather
   *  than a note, because there is nothing left to open. */
  gone?: string;
}

/** One accepted card, in the past tense. An outbound card touches nothing in
 *  the vault, so it carries its own sentence instead of a note to open. */
export function receiptEntry(p: ProposalDTO): ReceiptEntry {
  if (p.kind === 'outbound') {
    return { id: p.id, verb: 'Sent', sent: outboundReceipt(p.payload as OutboundPayloadDTO) };
  }
  const path = targetOf(p);
  const title = titleForRef(path) || payloadTitle(p) || 'a note';
  const verb =
    p.kind === 'update'
      ? 'Updated'
      : p.kind === 'decision'
        ? 'Decided'
        : p.kind === 'delete'
          ? 'Deleted'
          : 'Created';
  // A deleted page has no page to open, so the receipt says its name and stops
  // there. A link to a file that is gone is a dead end wearing a link's clothes.
  if (p.kind === 'delete') return { id: p.id, verb, gone: title };
  return { id: p.id, verb, note: path ? { title, path } : undefined };
}

/** What a set of judged cards adds up to. */
export interface Receipt {
  accepted: number;
  rejected: number;
  /** One line per accepted card, oldest first: the order they were proposed in. */
  entries: ReceiptEntry[];
}

/**
 * The receipt for cards the PO has already judged. Accepted and rejected both
 * count in the tally; only accepted ones set anything in motion, so only they
 * get a consequence line. Anything withdrawn or gone stale was never a decision
 * of theirs and is left out of both.
 */
export function receiptOf(resolved: readonly ProposalDTO[]): Receipt {
  const judged = [...resolved]
    .filter((p) => p.status === 'accepted' || p.status === 'rejected')
    .sort((a, b) => a.created - b.created);
  return {
    accepted: judged.filter((p) => p.status === 'accepted').length,
    rejected: judged.filter((p) => p.status === 'rejected').length,
    entries: judged.filter((p) => p.status === 'accepted').map(receiptEntry),
  };
}

/** What an empty Inbox is this time: the moment, or the state. */
export type ClearedState =
  /** They just judged something, so the page reports it. */
  | { mode: 'receipt' }
  /** Nothing happened here this sitting. `explain` is true only until the PO
   *  has ever judged a card, and then never again. */
  | { mode: 'quiet'; explain: boolean };

/**
 * Which of the two an empty Inbox shows (docs/closing-beat.md). "You just
 * cleared it" is a moment and earns the receipt; "it is empty" is a state and
 * stays near silent. The old zero said both at once, to everybody, forever.
 */
export function clearedInbox(
  receipt: { accepted: number; rejected: number },
  judgedBefore: boolean,
): ClearedState {
  if (receipt.accepted + receipt.rejected > 0) return { mode: 'receipt' };
  return { mode: 'quiet', explain: !judgedBefore };
}

/** The receipt's head line: what the PO just did, in the buttons' own words. */
export function receiptSummary(receipt: { accepted: number; rejected: number }): string {
  const { accepted, rejected } = receipt;
  if (rejected === 0) return `Approved ${accepted}`;
  if (accepted === 0) return `Discarded ${rejected}`;
  return `Approved ${accepted}, discarded ${rejected}`;
}

/**
 * The provenance line — "from your <meeting>" — pulled from the card's evidence
 * or target. Present ⇒ the change is sourced; absent (or `inference`) ⇒ the
 * quietest-looking claim is the one to double-check, so the card flags it.
 */
export function sourceHint(p: ProposalDTO): string | null {
  const refs = [...p.evidence.map((e) => e.ref), p.targetPath ?? '']
    .map((r) => r.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0]!.trim())
    .filter(Boolean);
  const meeting = refs.find((r) => r.startsWith('meetings/') || r.startsWith('sources/'));
  return meeting ? titleFromSlug(meeting) : null;
}

/**
 * Narrative order for a meeting review — stakes descending: the meeting summary
 * sets context, decisions are highest-stakes, then insights/todos; mechanical
 * hub/ledger updates are housekeeping; outbound (externally visible) is always
 * its own last decision. Shared by the Inbox and the in-session review so both
 * read the same way.
 */
export function cardRank(p: ProposalDTO): number {
  if (p.kind === 'outbound') return 4;
  // Never housekeeping. Everything in that fold collapses to a one-line row
  // labelled "glance and go", and a page being removed is the one change in the
  // queue that nobody should approve at a glance.
  if (p.kind === 'delete') return 2;
  // A rule changes how every session behaves from here on, so it never folds
  // into the housekeeping tail. It also must not read louder or quieter
  // depending on whether the rules file happened to exist yet (update vs note).
  if (isInstruction(p)) return 2;
  if (p.kind === 'update') return p.targetPath?.startsWith('meetings/') ? 0 : 3;
  if (p.kind === 'decision') return 1;
  // The meeting itself, proposed whole. Same place in the story as a summary
  // patched onto an existing page: it is the context everything below it needs.
  if (p.kind === 'note' && dirOf(p.targetPath) === 'meetings') return 0;
  return 2;
}

export const HOUSEKEEPING_RANK = 3;

export function orderCards(cards: ProposalDTO[]): ProposalDTO[] {
  return [...cards].sort((a, b) => cardRank(a) - cardRank(b) || a.created - b.created);
}

/** Drop a leading YAML frontmatter block so the preview renders as clean prose. */
export { stripFrontmatter } from '../../lib/frontmatter';
