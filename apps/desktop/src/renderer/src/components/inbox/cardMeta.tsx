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
  Users,
  type LucideIcon,
} from 'lucide-react';
import { titleFromSlug, typeForDir } from '@qale/domain';
import type { OutboundPayloadDTO, ProposalDTO } from '@qale/ipc';
import { isExternalRef } from '../../lib/connections';
import { noteTypeIcon } from '../../lib/note-icons';
import { outboundAct, outboundTarget, providerLabel } from './shared';

/**
 * Turns a raw proposal into the one thing the PO reads to decide: a plain-language
 * headline of what changed in their product memory — a full sentence, no paths,
 * slugs, or jargon. The agent authors it (`proposal.headline`); everything below
 * is the mechanical fallback for older cards. The dense rationale becomes the
 * expandable "why", never the scannable line.
 */
export interface CardHeadline {
  Icon: LucideIcon;
  /** The scannable sentence — wraps, never truncates. */
  headline: string;
  /** Short human noun for the kind (aria + the "why" prompt), e.g. "decision". */
  kind: string;
  /** Whether the agent authored the headline (vs. a mechanical fallback). */
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

/** dir segment (plural) → singular noun for the fallback "Update <noun>". */
const NOUN_FOR_DIR: Record<string, string> = {
  meetings: 'the meeting notes',
  decisions: 'a decision',
  insights: 'an insight',
  themes: 'a theme',
  customers: 'a customer',
  people: 'a person',
  sources: 'a source',
  notes: 'a note',
  todos: 'a to-do',
};

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
 */
function isInstruction(p: ProposalDTO): boolean {
  const dir = dirOf(targetOf(p));
  return dir === 'skills' || dir === 'agents';
}

/** The rule such a card teaches, best-effort: the last bullet of the appended
 *  text, or of the body a new rules file is filed with. */
function instructionRule(p: ProposalDTO): string {
  const payload = p.payload as { append?: string; body?: string };
  const lines = (payload.append ?? payload.body ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '));
  return lines.at(-1)?.slice(2).trim() ?? '';
}

/** Strip wikilink brackets + alias, hand back the bare target slug/ref. */
export function bareRef(ref: string): string {
  return ref.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0]!.trim();
}

/** Human title from a note path/slug: drops the dir + date prefix, de-slugs the rest. */
export function titleForRef(ref?: string | null): string {
  if (!ref) return '';
  return titleFromSlug(bareRef(ref));
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

/** An authored title/summary from the payload, when the note carries one. */
function payloadTitle(p: ProposalDTO): string {
  const fm = frontmatter(p);
  const title = fm['title'] ?? fm['summary'];
  return typeof title === 'string' && title.trim() ? title.trim() : '';
}

/** An explicit `title` from the payload — the name as written, diacritics intact. */
function payloadName(p: ProposalDTO): string {
  const title = frontmatter(p)['title'];
  return typeof title === 'string' && title.trim() ? title.trim() : '';
}

/** Note types whose subject is a proper name rather than a claim. */
const NAMED_TYPES = new Set(['person', 'customer']);

/**
 * Whose commitment a todo card tracks: the other person's name when they owe it,
 * null when it's the PO's own. The ledger already splits these into lanes, but
 * the card that files them read the same either way — "To do: Send Erik the
 * draft" over a line Daniel spoke, which is the opposite of what it says.
 */
export function todoOwner(p: ProposalDTO): string | null {
  const fm = frontmatter(p);
  if (fm['type'] !== 'todo') return null;
  const owner = fm['owner'];
  if (typeof owner !== 'string' || !owner.trim()) return null;
  // Either a "[[people/…]]" ref or a bare name — both read as a person here.
  return titleForRef(owner.trim()) || null;
}

function iconFor(p: ProposalDTO): LucideIcon {
  // An outbound card wears its action's glyph, not a blanket paper plane —
  // the same one the approve button carries, so the card reads as one act.
  if (p.kind === 'outbound') return outboundAct(p.payload as OutboundPayloadDTO).Icon;
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
  if (isInstruction(p)) return 'standing instruction';
  if (p.kind === 'decision') return 'decision';
  if (p.kind === 'update')
    return NOUN_FOR_DIR[dirOf(p.targetPath)]?.replace(/^(a|an|the) /, '') ?? 'note';
  const type =
    typeof frontmatter(p)['type'] === 'string' ? (frontmatter(p)['type'] as string) : 'note';
  return type;
}

/** Mechanical fallback headline — only used when the agent didn't author one. */
function fallbackHeadline(p: ProposalDTO): string {
  const target = targetOf(p);

  // The rule in the PO's own words, since a card saying "Update Your rules"
  // never says which rule it is. Nothing to quote ⇒ say the plain thing.
  if (isInstruction(p)) {
    const rule = instructionRule(p);
    return rule ? `Remember this: ${rule}` : 'A new standing instruction';
  }

  // "Comment on PAY-142" / "File a ticket in PAY: SCIM group-mapping" / "Add
  // “Erik x Daniel: sync” to your calendar" — outboundTarget already folds the
  // title in where the act has one, so appending it here doubled it.
  if (p.kind === 'outbound') return outboundTarget(p.payload as OutboundPayloadDTO);

  if (p.kind === 'decision') {
    return `Decided: ${payloadTitle(p) || titleForRef(target)}`;
  }

  if (p.kind === 'note') {
    const type =
      typeof frontmatter(p)['type'] === 'string' ? (frontmatter(p)['type'] as string) : 'note';
    const subject = payloadTitle(p) || titleForRef(target);
    if (type === 'insight') return `Learned: ${subject}`;
    // "To do" is the PO's own; someone else's commitment leads with who owes
    // it, in the ledger's own words, so the two never look like one another.
    if (type === 'todo') {
      const owner = todoOwner(p);
      return owner ? `Waiting on ${owner}: ${subject}` : `To do: ${subject}`;
    }
    // A person or a customer is a name, not a claim. Their summary describes
    // them ("Product owner, first real user"), so leading with it leaves the
    // card never saying who it is about. Their file IS their name; an explicit
    // `title` wins where it exists, since the slug folds away diacritics.
    if (NAMED_TYPES.has(type))
      return `New ${type}: ${payloadName(p) || titleForRef(target) || subject}`;
    return `New ${type}: ${subject}`;
  }

  // update
  const noun = NOUN_FOR_DIR[dirOf(target)] ?? 'a note';
  const title = titleForRef(target);
  return title ? `Update ${title}` : `Update ${noun}`;
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
      headline: p.headline?.trim() || fallbackHeadline(p),
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
  const headline = p.headline?.trim() || fallbackHeadline(p);
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
