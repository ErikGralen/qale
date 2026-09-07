import {
  BookMarked,
  BookOpen,
  CalendarClock,
  FileText,
  Ticket,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import {
  bareRef,
  cardTargetTitle,
  groupByTarget,
  isNewSkill,
  newPageFacts,
  proposalHeadline,
  proposalLeadIn,
  type NewPageFacts,
  titleForRef,
  typeForDir,
  type HeadlineInput,
  type TargetCard,
} from '@qale/domain';
import type { NoteType, OutboundPayloadDTO, ProposalDTO } from '@qale/ipc';
import { isExternalRef } from '../../lib/connections';
import { NOTE_TYPE_ICON, noteTypeIcon } from '../../lib/note-icons';
import { outboundReceipt } from './shared';

// Both read a note reference the way the whole app reads one. They live in the
// domain now; the card surfaces keep reading them from here.
export { bareRef, titleForRef };

/**
 * Turns a raw proposal into the one thing the PO reads to decide: a
 * plain-language line saying what the app will do, plus the pieces the card
 * draws around it (the glyph, the note chip, what a decision replaces). No
 * paths, slugs, or jargon, and nothing about filing.
 *
 * The app composes that line, it does not ask for one. No `propose_*` tool takes
 * a headline except `propose_instruction`, so on every other card the composed
 * line is what the PO reads. The dense rationale stays the expandable "why",
 * never the scannable line.
 */
export interface CardHeadline {
  Icon: LucideIcon;
  /** The scannable sentence — wraps, never truncates. It says what approving
   *  does, so the row keeps it for the reader who opens the detail, and for
   *  anyone reading the row through a screen reader. */
  headline: string;
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
 *  the review asks it the same question. */
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
  return proposalHeadline(headlineInput(p));
}

/** What the domain's card copy reads off a proposal: the same fields for the
 *  headline and for the lead-in, so the two can never disagree. */
function headlineInput(p: ProposalDTO): HeadlineInput {
  const payload = p.payload as {
    append?: string;
    body?: string;
    patch?: { search: string; replace: string }[];
  };
  return {
    kind: p.kind,
    targetPath: targetOf(p),
    frontmatter: frontmatter(p),
    append: payload.append,
    body: payload.body,
    patch: payload.patch,
    outbound: p.kind === 'outbound' ? (p.payload as OutboundPayloadDTO) : undefined,
  };
}

/**
 * The small line over a row's title: the act and the kind of thing, "New to-do",
 * "Update document". The title alone read as the act ("File the missing story"
 * looked like approving the filing), so the row says what approving does first.
 */
export function cardLeadIn(p: ProposalDTO): string {
  return proposalLeadIn(headlineInput(p));
}

/**
 * The glyph on the row: what KIND OF THING is about to change. A to-do wears the
 * to-do glyph whether the card makes one or edits one, so the row is read the
 * same way every time. It used to wear the act instead, a pencil for every
 * update, so two changes to one to-do looked like two different subjects.
 */
function iconFor(p: ProposalDTO): LucideIcon {
  // A send names the item it touches in the system it lives in. The ink arrow
  // beside this says it leaves the workspace.
  if (p.kind === 'outbound') {
    const ob = p.payload as OutboundPayloadDTO;
    if (ob.action === 'update_page') return NOTE_TYPE_ICON.wikipage;
    if (ob.action?.endsWith('_event')) return CalendarClock;
    return NOTE_TYPE_ICON.ticket;
  }
  // The one card that takes a page away wears the one glyph nothing else uses,
  // so it can never be mistaken for the edit it sits next to in the queue.
  if (p.kind === 'delete') return Trash2;
  // A new skill wears the glyph every skill wears, in the sidebar and on the
  // Skills page. The card is the file, so it should look like the file.
  if (isSkill(p)) return NOTE_TYPE_ICON.skill;
  // A rule for the house, not a note in the memory — so neither a note-type
  // glyph nor the open book, which is the wiki page's already.
  if (isInstruction(p)) return BookMarked;
  // The folder says the type for anything that already exists; a new page says
  // it in its own frontmatter.
  const type =
    typeForDir(dirOf(targetOf(p))) ??
    (typeof frontmatter(p)['type'] === 'string' ? (frontmatter(p)['type'] as NoteType) : null);
  return type ? noteTypeIcon(type) : FileText;
}

export function cardHeadline(p: ProposalDTO): CardHeadline {
  const supersedes = (p.payload as { supersedes?: string }).supersedes;
  const rawRetitle = p.kind === 'update' ? (p.payload as { title?: unknown }).title : undefined;
  return {
    Icon: iconFor(p),
    headline: p.headline?.trim() || composedHeadline(p),
    replaces: supersedes ? titleForRef(supersedes) : undefined,
    retitle: typeof rawRetitle === 'string' && rawRetitle.trim() ? rawRetitle.trim() : undefined,
  };
}

/**
 * The name the row leads with: the page's own title. `knownTitle` is what the
 * workspace holds for the file, looked up by the row (see `titles.ts`); without
 * it the card falls back to what it carries.
 */
export function cardTitle(p: ProposalDTO, knownTitle?: string | null): string {
  return cardTargetTitle({
    kind: p.kind,
    targetPath: targetOf(p),
    frontmatter: frontmatter(p),
    knownTitle,
    });
}

/**
 * The change a card that creates a page makes, in parts: who owes a to-do and
 * when it is due, when a meeting was and how many sat in it, then the first line
 * of what the page says, marked when it is a quote. Composed in the domain, so
 * the row and the receipt say the same thing.
 */
export function cardFacts(p: ProposalDTO): NewPageFacts {
  return newPageFacts({
    kind: p.kind,
    frontmatter: frontmatter(p),
    body: (p.payload as { body?: string }).body,
  });
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

/**
 * The one decision behind a set of cards that are all consequences of it: a
 * decision changed, and several notes still point at the old plan. True only
 * when every card is an update citing the SAME decision, which is what a
 * librarian sweep produces and what an ordinary pile of cards never does.
 */
export function groupCause(cards: ProposalDTO[]): string | null {
  if (cards.length === 0 || !cards.every((c) => c.kind === 'update')) return null;
  const cause = cards[0]!.evidence
    .map((e) => bareRef(e.ref))
    .find((r) => r.startsWith('decisions/'));
  if (!cause) return null;
  return cards.every((c) => c.evidence.some((e) => bareRef(e.ref) === cause)) ? cause : null;
}

/** The cause behind a sweep: one decision changed and N notes still cite the old
 *  one. Stated as the PO thinks it, cause first, effect second. */
export function causeSentence(cause: string, n: number): string {
  const notes = `${n} note${n === 1 ? '' : 's'}`;
  const point = n === 1 ? 'points' : 'point';
  return `Because you decided “${titleForRef(cause)}”, ${notes} still ${point} at the old plan`;
}

/** The receipt's head line: what the PO just did, in the buttons' own words. */
export function receiptSummary(receipt: { accepted: number; rejected: number }): string {
  const { accepted, rejected } = receipt;
  if (rejected === 0) return `Approved ${accepted}`;
  if (accepted === 0) return `Discarded ${rejected}`;
  return `Approved ${accepted}, discarded ${rejected}`;
}

/**
 * Where a card was read out of: the meeting or the material behind it. The batch
 * says this once, in its heading, instead of every row repeating it. Nine cards
 * from one transcript said "from Steering H2 Priorities" nine times.
 */
export function sourceRefOf(p: ProposalDTO): string {
  const refs = [...p.evidence.map((e) => e.ref), p.targetPath ?? ''].map(bareRef).filter(Boolean);
  return refs.find((r) => r.startsWith('meetings/') || r.startsWith('sources/')) ?? '';
}

/** The one source behind a whole batch, or null when they came from more than
 *  one, or when any card came from none. A heading that names a source every
 *  card does not share is a heading that lies about one of them. */
export function batchSource(cards: readonly ProposalDTO[]): string | null {
  if (cards.length === 0) return null;
  const refs = new Set(cards.map(sourceRefOf));
  const only = [...refs][0];
  return refs.size === 1 && only ? only : null;
}

/**
 * The heading over a batch: what is waiting, and what the Approve all button
 * will not touch. A send is its own decision and never rides along in a batch,
 * so it is counted apart rather than left to explain why "9 changes" sits above
 * a button that says 7.
 */
export function batchCount(changes: number, sends: number): string {
  const c = `${changes} change${changes === 1 ? '' : 's'}`;
  const s = `${sends} send${sends === 1 ? '' : 's'}`;
  if (sends === 0) return c;
  if (changes === 0) return s;
  return `${c} and ${s}`;
}

/**
 * A card as the grouper reads it. The DTO carries every fact the grouping rests
 * on; this only reshapes them.
 */
export function targetCard(p: ProposalDTO): TargetCard {
  return {
    id: p.id,
    kind: p.kind,
    targetPath: p.targetPath,
    payload: p.payload as TargetCard['payload'],
  };
}

/**
 * A batch's cards, grouped by the thing each one changes, in the order the cards
 * were given. Two changes to one to-do are one group; every other card is a
 * group of one and draws as an ordinary row.
 */
export function cardGroups(cards: ProposalDTO[]): { key: string; cards: ProposalDTO[] }[] {
  const byId = new Map(cards.map((p) => [p.id, p]));
  return groupByTarget(cards.map(targetCard)).map((group) => ({
    key: group.key,
    cards: group.cards.map((c) => byId.get(c.id)!),
  }));
}

/**
 * The order a batch reads in: the meeting page sets the context, then the
 * promises made in it, then the documents, then what is taken away, and last
 * what leaves the workspace. Nothing folds; every card is one row.
 */
export function cardRank(p: ProposalDTO): number {
  if (p.kind === 'outbound') return 5;
  if (p.kind === 'delete') return 4;
  const dir = dirOf(targetOf(p));
  if (dir === 'meetings') return 0;
  if (dir === 'todos') return 1;
  if (dir === 'notes') return 2;
  return 3;
}

export function orderCards(cards: ProposalDTO[]): ProposalDTO[] {
  return [...cards].sort((a, b) => cardRank(a) - cardRank(b) || a.created - b.created);
}

/** Drop a leading YAML frontmatter block so the preview renders as clean prose. */
export { stripFrontmatter } from '../../lib/frontmatter';
