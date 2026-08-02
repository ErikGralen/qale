import {
  BookOpen,
  FileText,
  GitCommitHorizontal,
  Lightbulb,
  ListChecks,
  Pencil,
  Ticket,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { titleFromSlug, typeForDir } from '@pm/domain';
import type { OutboundPayloadDTO, ProposalDTO } from '@pm/ipc';
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

const dirOf = (path?: string | null): string => (path ? path.split('/')[0] ?? '' : '');

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

function iconFor(p: ProposalDTO): LucideIcon {
  // An outbound card wears its action's glyph, not a blanket paper plane —
  // the same one the approve button carries, so the card reads as one act.
  if (p.kind === 'outbound') return outboundAct(p.payload as OutboundPayloadDTO).Icon;
  if (p.kind === 'decision') return GitCommitHorizontal;
  if (p.kind === 'update') return dirOf(p.targetPath) === 'todos' ? ListChecks : Pencil;
  const type = typeof frontmatter(p)['type'] === 'string' ? (frontmatter(p)['type'] as string) : 'note';
  if (type === 'insight') return Lightbulb;
  if (type === 'customer' || type === 'person') return Users;
  if (type === 'todo') return ListChecks;
  return FileText;
}

function kindNoun(p: ProposalDTO): string {
  if (p.kind === 'outbound') {
    const ob = p.payload as OutboundPayloadDTO;
    return (ob.provider ?? ob.system) === 'message' ? 'message' : providerLabel(ob);
  }
  if (p.kind === 'decision') return 'decision';
  if (p.kind === 'update') return NOUN_FOR_DIR[dirOf(p.targetPath)]?.replace(/^(a|an|the) /, '') ?? 'note';
  const type = typeof frontmatter(p)['type'] === 'string' ? (frontmatter(p)['type'] as string) : 'note';
  return type;
}

/** Mechanical fallback headline — only used when the agent didn't author one. */
function fallbackHeadline(p: ProposalDTO): string {
  const target = p.targetPath ?? (p.payload as { path?: string }).path ?? '';

  if (p.kind === 'outbound') {
    const ob = p.payload as OutboundPayloadDTO;
    if ((ob.provider ?? ob.system) === 'message') return `Send update — ${ob.title || ob.audience || 'stakeholders'}`;
    // "Comment on PAY-142 — Nordkap confirms go-live" / "File a ticket in PAY — SCIM group-mapping"
    return ob.title ? `${outboundTarget(ob)} — ${ob.title}` : outboundTarget(ob);
  }

  if (p.kind === 'decision') {
    return `Decided: ${payloadTitle(p) || titleForRef(target)}`;
  }

  if (p.kind === 'note') {
    const type = typeof frontmatter(p)['type'] === 'string' ? (frontmatter(p)['type'] as string) : 'note';
    const subject = payloadTitle(p) || titleForRef(target);
    if (type === 'insight') return `Learned: ${subject}`;
    if (type === 'todo') return `To do: ${subject}`;
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

  // An update touches an existing note. The note is the subject — render it as a
  // distinct, openable chip so "Update <note>" never reads as one run of words.
  if (p.kind === 'update') {
    const path = p.targetPath ?? (p.payload as { path?: string }).path ?? '';
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

  return { ...base, verb: '', headline: p.headline?.trim() || fallbackHeadline(p) };
}

/**
 * The provenance line — "from your <meeting>" — pulled from the card's evidence
 * or target. Present ⇒ the change is sourced; absent (or `inference`) ⇒ the
 * quietest-looking claim is the one to double-check, so the card flags it.
 */
export function sourceHint(p: ProposalDTO): string | null {
  const refs = [
    ...p.evidence.map((e) => e.ref),
    p.targetPath ?? '',
  ]
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
  if (p.kind === 'update') return p.targetPath?.startsWith('meetings/') ? 0 : 3;
  if (p.kind === 'decision') return 1;
  return 2;
}

export const HOUSEKEEPING_RANK = 3;

export function orderCards(cards: ProposalDTO[]): ProposalDTO[] {
  return [...cards].sort((a, b) => cardRank(a) - cardRank(b) || a.created - b.created);
}

/** Drop a leading YAML frontmatter block so the preview renders as clean prose. */
export { stripFrontmatter } from '../../lib/frontmatter';
