import { refToSlug } from '../notes/decisions.js';
import { dirForType, NOTE_TYPES, type NoteType } from '../notes/frontmatter.js';
import { titleFromSlug } from '../notes/slug.js';
import { formatStamp, parseEventStamp, rsvpAnswer } from './event-time.js';
// activity.ts imports titleForRef from here, so the two lean on each other.
// Both use the other's export inside a function only, never at load, which is
// what keeps the cycle harmless.
import { WANT_LIST_HEADING } from './activity.js';

/**
 * Every word on a proposal card except the agent's own rationale: the headline
 * the PO scans, the effect line under it, and the verbs the approve button and
 * the receipt use. All of it is composed here, never authored by the model, so
 * the same card kind always says the same thing and it is always true.
 *
 * Same two rules as effect.ts:
 *  - A missing fact shortens the sentence, it never pads it. No meeting date ⇒
 *    "Write up Nordkap QBR" and no trailing comma. No path ⇒ no folder name.
 *  - Nothing that would cost a lookup. Every line is built from the payload and
 *    the path, both of which the card already carries.
 *
 * The headline is verb-first for a reason. A noun phrase borrows its word from
 * the world of things that happen: "New meeting: Nordkap QBR" reads as an act
 * about to be booked, when the card only writes a page about a meeting that
 * already took place. "New customer" reads as a customer won. So the line names
 * what the app does ("Write up", "Add a page for").
 *
 * The effect line under it is rationed hard: it speaks only when a card does
 * something the lead-in and the title cannot already say (a delete, a new
 * skill, a standing instruction). For an ordinary new page, "Creates a page in
 * Meetings" only restated the lead-in in longer words, and the reader's eye
 * learned to skip it.
 */

/** Strip wikilink brackets, alias and anchor, hand back the bare slug. */
export function bareRef(ref: string): string {
  return refToSlug(ref) ?? '';
}

/** Human title from a note path or slug: drops the folder, the date prefix and
 *  the `.md`, then de-slugs what is left. */
export function titleForRef(ref?: string | null): string {
  if (!ref) return '';
  return titleFromSlug(bareRef(ref));
}

/** dir segment (plural) → the singular noun for one page in it. The one word the
 *  card uses for that kind of thing, in the lead-in and in every fallback. */
const NOUN_FOR_DIR: Record<string, string> = {
  meetings: 'meeting notes',
  decisions: 'decision',
  insights: 'insight',
  research: 'research page',
  about: 'about page',
  customers: 'customer',
  people: 'person',
  sources: 'source',
  notes: 'document',
  todos: 'to-do',
  skills: 'skill',
};

/** The bare noun for one page in a folder: "todos" → "to-do". A folder with no
 *  noun of its own falls back to the word every effect line here already uses
 *  for a file in the workspace. */
export function kindNoun(dir: string): string {
  return NOUN_FOR_DIR[dir] ?? 'page';
}

/** What an update card calls the page it touches when it has no title to use:
 *  the kind noun with its article, "a to-do", "the meeting notes". */
export function nounForDir(dir: string): string {
  const noun = kindNoun(dir);
  if (noun === 'meeting notes') return `the ${noun}`;
  return /^[aeiou]/i.test(noun) ? `an ${noun}` : `a ${noun}`;
}

/**
 * Filing: the frontmatter the app decides for itself (E-6).
 *
 * A card used to show these as changes the PM was signing off on — "Tags: empty
 * → nordkap, pricing" — on a field they cannot edit from the card, cannot see
 * anywhere else, and never chose the vocabulary for. That is what makes a
 * memory feel like a filing system somebody else expects you to keep. The app
 * decides all four; the card shows what the page will SAY.
 *
 * The card's evidence is a different thing and stays: it is what the claim
 * rests on, and the PM reads it to decide whether to believe the card.
 */
export const FILING_KEYS = ['type', 'tags', 'sources', 'path', 'slug'] as const;

/** Whether a frontmatter key is the app's filing rather than the PM's business. */
export function isFilingKey(key: string): boolean {
  return (FILING_KEYS as readonly string[]).includes(key);
}

const dirOf = (path?: string | null): string => (path ? (path.split('/')[0] ?? '') : '');

/** The folder as the app names it on screen: "insights" → "Insights". `notes` is
 *  the exception: the rail, the crumb and the type all call that folder
 *  Documents (docs/sidebar-ia.md, SB-3). */
const folderLabel = (dir: string): string =>
  dir === dirForType('note') ? 'Documents' : titleFromSlug(dir);

/** The fields the outbound strings read. The domain payload and the renderer's
 *  DTO both satisfy it, so this vocabulary needs no dependency on @qale/ipc. */
export interface OutboundCopyInput {
  action?: string;
  container?: string;
  issueType?: string;
  targetId?: string;
  title?: string;
  responseStatus?: string;
  labels?: string[];
  priority?: string;
  components?: string[];
  /** google-calendar: the event the card addresses. */
  eventId?: string;
  /** Where the item lives at the provider, stamped on the payload once the send
   *  landed. It is how a receipt line opens a ticket the workspace has not
   *  mirrored yet. */
  url?: string;
}

/**
 * The ticket fields a draft set beyond its summary and body: labels, priority,
 * components. They go on the card because they land in Jira under the PM's
 * name, and a label the team does not use is the kind of thing a person catches
 * in one glance and only in that glance. A field the draft left alone is not a
 * row: the card says what it does, not what it could have done.
 */
export function ticketFieldRows(ob: OutboundCopyInput): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const clean = (list?: string[]): string[] => (list ?? []).map((v) => v.trim()).filter(Boolean);
  const labels = clean(ob.labels);
  const components = clean(ob.components);
  if (labels.length) rows.push({ label: 'Labels', value: labels.join(', ') });
  if (ob.priority?.trim()) rows.push({ label: 'Priority', value: ob.priority.trim() });
  if (components.length) rows.push({ label: 'Components', value: components.join(', ') });
  return rows;
}

export interface HeadlineInput {
  kind: 'note' | 'update' | 'decision' | 'outbound' | 'delete';
  /** The file the card writes: `targetPath`, or the path inside the payload. */
  targetPath?: string | null;
  /** The note's frontmatter, when the payload carries one. */
  frontmatter?: Record<string, unknown>;
  /** An update's appended text, or a new file's body. A standing instruction is
   *  read back out of it, so the card says the rule and not just the file. */
  append?: string;
  body?: string;
  /** An update's search/replace blocks. A line on the "What you want from
   *  Qale" list is added or removed with one, so the card reads it back. */
  patch?: readonly { search: string; replace: string }[];
  /** For outbound: the parsed payload, so the line names its own target. */
  outbound?: OutboundCopyInput;
}

export interface VaultEffectInput {
  kind: 'note' | 'update' | 'decision' | 'outbound' | 'delete';
  targetPath?: string | null;
  frontmatter?: Record<string, unknown>;
  /** The same levers the headline reads, for the one effect line that
   *  depends on WHICH section of the house rules a card touches. */
  append?: string;
  body?: string;
  patch?: readonly { search: string; replace: string }[];
}

/** The name a skill or agent is filed under: `skills/jira/SKILL.md` → `jira`,
 *  and the legacy flat `skills/jira.md` → `jira` as well. */
const runnableName = (path: string): string =>
  (path.split('/')[1] ?? '').replace(/\.md$/i, '').toLowerCase();

/**
 * The files that hold RULES rather than work: the house rules and the two
 * conventions skills. `propose_instruction` writes one of them whole when the
 * workspace has none yet, so those `note` cards say the rule, exactly as the
 * `update` cards do.
 *
 * Named here rather than imported from the pack, because @qale/domain depends on
 * nothing. The conventions names are the outbound provider ids this package
 * already owns.
 */
const RULES_FILES = ['house-rules', 'jira', 'confluence'];

/**
 * A card that writes a NEW skill (`propose_skill`): the work of one session,
 * drafted so the next one runs the same way. It lands in `skills/` like a rule
 * file does, so the two are told apart by name, and this one is asked first:
 * a skill being written is not a rule being added to one.
 */
export function isNewSkill(kind: string, path?: string | null): boolean {
  const target = path ?? '';
  return (
    kind === 'note' && dirOf(target) === 'skills' && !RULES_FILES.includes(runnableName(target))
  );
}

/**
 * A standing instruction: a rule the PO taught the app, landing in a skill or
 * agent file rather than in their memory. It arrives as an ordinary `update`, or
 * as the `note` that creates the house-rules file where none exists yet. Same
 * rule either way, so the card must not read differently depending on which.
 */
const isInstruction = (kind: string, path: string): boolean => {
  const dir = dirOf(path);
  return (dir === 'skills' || dir === 'agents') && !isNewSkill(kind, path);
};

/**
 * The two conventions skills (docs/conventions.md): `skills/jira/SKILL.md` and
 * `skills/confluence/SKILL.md`. The card must not say what it says about the
 * house rules: a rule in one of these is read when something is drafted for that
 * system, not by every session.
 */
const conventionsSystem = (path: string): string => {
  const name = path.split('/')[0] === 'skills' ? runnableName(path) : '';
  return name === 'jira' || name === 'confluence' ? titleForRef(name) : '';
};

/**
 * What each conventions file is called on screen. Duplicated from the shipped
 * template's `title` (`JIRA_CONVENTIONS` in `@qale/sessions`), because the
 * domain imports nothing; the two have to move together.
 */
const CONVENTIONS_TITLES: Record<string, string> = {
  Jira: 'How you write tickets',
  Confluence: 'How you write pages',
};

/** The rule such a card teaches, best-effort: the last bullet of the appended
 *  text, or of the body a new rules file is filed with. */
function instructionRule(input: HeadlineInput): string {
  const lines = (input.append ?? input.body ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '));
  return lines.at(-1)?.slice(2).trim() ?? '';
}

/** The words of a heading line, whatever its level: "## Your rules" → "your rules". */
const headingWords = (line: string): string =>
  line
    .trim()
    .replace(/^#{1,6}\s+/, '')
    .trim()
    .toLowerCase();

const isHeading = (line: string): boolean => /^#{1,6}\s/.test(line.trim());

/** The bullets in a piece of text, in order, without their dashes. */
function bulletsIn(text: string): string[] {
  return text
    .split('\n')
    .map((line) => /^\s*[-*]\s+(.*\S)\s*$/.exec(line)?.[1] ?? '')
    .filter((line) => line.length > 0);
}

/** What one card does to the "What you want from Qale" list. */
export interface WantListChange {
  op: 'add' | 'remove';
  /** The line added or removed, in the PM's words. */
  line: string;
}

/**
 * Does this card add a line to, or take one off, the "What you want from Qale"
 * list in the house rules? Read back off the payload, so the card and the
 * telemetry event (docs/learning-how-you-work.md ticket 15) see the same thing.
 *
 * `propose_instruction` edits the list with one patch anchored on the whole
 * section, so the search opens with the list's heading and the replace holds
 * one bullet more or one fewer. A text appended under that heading is an add
 * too, for a file written by hand the same way.
 */
export function wantListChange(input: {
  append?: string;
  body?: string;
  patch?: readonly { search: string; replace: string }[];
}): WantListChange | null {
  const wanted = headingWords(WANT_LIST_HEADING);
  for (const block of input.patch ?? []) {
    const first = block.search.split('\n').find((line) => line.trim().length > 0) ?? '';
    if (!isHeading(first) || headingWords(first) !== wanted) continue;
    const before = bulletsIn(block.search);
    const after = bulletsIn(block.replace);
    const added = after.filter((line) => !before.includes(line));
    const removed = before.filter((line) => !after.includes(line));
    if (added.length > 0 && removed.length === 0) return { op: 'add', line: added.at(-1)! };
    if (removed.length > 0 && added.length === 0) return { op: 'remove', line: removed[0]! };
    return null;
  }
  const text = input.append ?? input.body ?? '';
  const last = text.split('\n').filter(isHeading).at(-1);
  if (!last || headingWords(last) !== wanted) return null;
  const line = bulletsIn(text).at(-1);
  return line ? { op: 'add', line } : null;
}

const fmString = (fm: Record<string, unknown> | undefined, key: string): string => {
  const value = fm?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
};

/** An authored title or summary from the payload, when the note carries one. */
const payloadTitle = (fm?: Record<string, unknown>): string =>
  fmString(fm, 'title') || fmString(fm, 'summary');

const noteType = (fm?: Record<string, unknown>): string => fmString(fm, 'type') || 'note';

/**
 * Whose commitment a todo card tracks: the other person's name when they owe it,
 * null when it is the PO's own. The ledger already splits these into lanes, and
 * a card that read the same either way said the opposite of what it meant.
 */
function todoOwnerName(fm?: Record<string, unknown>): string | null {
  const owner = todoOwnerRef(fm);
  if (!owner) return null;
  // Either a "[[people/…]]" ref or a bare name — both read as a person here.
  return titleForRef(owner) || null;
}

/** The owner as the file writes it: a "[[people/…]]" ref, alias and all, or a
 *  bare name. The facts line keeps the ref so the card can draw the person as
 *  the link the rest of the app draws; the flat sentences strip it. */
function todoOwnerRef(fm?: Record<string, unknown>): string | null {
  if (fmString(fm, 'type') !== 'todo') return null;
  return fmString(fm, 'owner') || null;
}

/** The meeting day as a person says it: "4 Aug". Undefined when the frontmatter
 *  carries no date, or one that will not parse. */
function meetingDay(fm?: Record<string, unknown>): string | undefined {
  const stamp = parseEventStamp(fmString(fm, 'date'));
  return stamp ? formatStamp(stamp) : undefined;
}

/**
 * A day field as a person says it: "2026-09-24" reads "24 Sep". Null for
 * anything that is not a whole day on its own, so a card never turns a version
 * number or a sentence into a date.
 */
export function dayLabel(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const stamp = parseEventStamp(value.trim());
  return stamp ? formatStamp(stamp) : null;
}

/**
 * The first line of what a new page says, with its markers taken off: a quote
 * marker, a bullet dash. A heading is skipped rather than read: "Summary" is
 * what the page calls the part, never what it says. Wikilinks are left as they
 * are, so the card can draw them as live references.
 */
function firstProseLine(body?: string): { line: string; quoted: boolean } {
  for (const raw of (body ?? '').split('\n')) {
    const trimmed = raw.trim();
    if (isHeading(trimmed)) continue;
    const quoted = trimmed.startsWith('>');
    const line = trimmed
      .replace(/^>\s*/, '')
      .replace(/^[-*+]\s+/, '')
      .trim();
    if (line) return { line, quoted };
  }
  return { line: '', quoted: false };
}

/** What a row needs to say about a page it is about to create. */
export interface NewPageFactsInput {
  kind: 'note' | 'update' | 'decision' | 'outbound' | 'delete';
  frontmatter?: Record<string, unknown>;
  body?: string;
}

/** The change a new page makes, in the two things the row draws apart. */
export interface NewPageFacts {
  /** The facts a person checks: who owes it and when, or when a meeting was.
   *  Drawn as one dotted line. A person keeps their `[[people/…]]` ref, so the
   *  row draws them as a link. */
  facts: string[];
  /** The first line of what the page says. Empty when the page says nothing,
   *  which is every meeting: the day is the fact, and the write-up is the page
   *  the card opens into. */
  line: string;
  /** True when the line is a quote the file carries as one: what someone said,
   *  as `propose_todo` writes a to-do's body. The row draws it as a citation. */
  quoted: boolean;
}

/**
 * The change a new page makes, in the facts a person checks before they approve
 * it: who owes a to-do and when it is due, or when a meeting was, then the
 * first line of what the page says.
 *
 * The parts are handed back separately so the card can draw the line, and a
 * missing fact drops a part rather than padding it. Same two rules as the
 * headline: nothing here costs a lookup, and nothing here is authored.
 *
 * The owner is said as "Waiting on", the ledger's own word, and the PO's own
 * to-do names nobody: the lead-in already said it is a to-do, and the row must
 * not print a name twice. A meeting card carries no first line at all: how many
 * sat in it and what the write-up says are both in the page, not on the row.
 */
export function newPageFacts(input: NewPageFactsInput): NewPageFacts {
  const fm = input.frontmatter;
  const facts: string[] = [];
  const type = noteType(fm);
  if (type === 'todo') {
    const owner = todoOwnerRef(fm);
    if (owner) facts.push(`Waiting on ${owner}`);
    const due = dayLabel(fmString(fm, 'due'));
    if (due) facts.push(`Due ${due}`);
  } else if (type === 'meeting') {
    const day = meetingDay(fm);
    if (day) facts.push(day);
    return { facts, line: '', quoted: false };
  }
  const { line, quoted } = firstProseLine(input.body);
  // Only a to-do's body is what someone said. Any other page's first line is
  // the page's own first sentence, whatever marker it wears.
  return { facts, line, quoted: quoted && type === 'todo' };
}

/**
 * The small line over the title that says, in two words, what approving does
 * and to what kind of thing: "New to-do", "Update document", "Delete decision".
 * The title under it is the page's own name, which on its own read as the act:
 * "File the missing story under SCH-231" looked like approving the filing.
 *
 * Same verbs as the receipt (Created / Updated / Deleted) in the present, and
 * the same kind nouns as every fallback here. A rule card keeps its own words,
 * because the rule is the thing and its file is not.
 */
export function proposalLeadIn(input: HeadlineInput): string {
  const target = input.targetPath ?? '';
  const dir = dirOf(target);
  if (input.kind === 'delete') return `Delete ${kindNoun(dir)}`;
  if (isNewSkill(input.kind, target)) return 'New skill';
  if (isInstruction(input.kind, target)) {
    const want = wantListChange(input);
    return want?.op === 'remove' ? 'Stop this' : 'Remember this';
  }
  if (input.kind === 'outbound') return outboundTarget(input.outbound ?? {});
  if (input.kind === 'decision') return 'New decision';
  if (input.kind === 'note') {
    // A new page says its kind in its own frontmatter; the folder is the
    // fallback for a page filed without one.
    const type = fmString(input.frontmatter, 'type');
    const known = (NOTE_TYPES as readonly string[]).includes(type);
    return `New ${kindNoun(known ? dirForType(type as NoteType) : dir)}`;
  }
  return `Update ${kindNoun(dir)}`;
}

/** What a row needs to name the thing that changes. */
export interface TargetTitleInput {
  kind: 'note' | 'update' | 'decision' | 'outbound' | 'delete';
  targetPath?: string | null;
  frontmatter?: Record<string, unknown>;
  /** The title the workspace holds for this file, when the file exists. */
  knownTitle?: string | null;
}

/**
 * The name a row leads with: the page's real title, never a prettified filename
 * (docs/review-rework.md). A page that already exists is named by the workspace,
 * so the caller looks that up and passes it in. A new page names itself, in the
 * payload, because nothing else knows it yet. The de-slugged filename is the
 * last resort, for a page nothing else can name.
 */
export function cardTargetTitle(input: TargetTitleInput): string {
  const target = input.targetPath ?? '';
  const known = input.knownTitle?.trim() ?? '';
  const filed = titleForRef(target);
  if (input.kind === 'update' || input.kind === 'delete') {
    return known || filed || nounForDir(dirOf(target));
  }
  return payloadTitle(input.frontmatter) || known || filed || nounForDir(dirOf(target));
}

// ---------------------------------------------------------------------------
// The landed row: the same write, after it happened (docs/fewer-approvals.md FA-4)
// ---------------------------------------------------------------------------

/**
 * The words a landed row leads with.
 *
 * A todo has three of its own, because a promise made in the PM's name is the
 * write they most want to catch, and "New" over a row said nothing about what
 * kind of thing was new (docs/receipt-redesign.md RC-2).
 */
export const APPLIED_VERBS = [
  'New',
  'Changed',
  'Done',
  'Removed',
  'New todo',
  'Todo changed',
  'Todo done',
  /** A card the PM approved that left the workspace. It writes no file, so it
   *  is the one row with nothing to open and no way back
   *  (docs/receipt-redesign.md RC-3). */
  'Sent',
] as const;
export type AppliedVerb = (typeof APPLIED_VERBS)[number];

/** What a row needs to say what one write did. */
export interface ChangeLineInput {
  kind: 'note' | 'update' | 'decision' | 'outbound' | 'delete';
  targetPath?: string | null;
  /** A new page's frontmatter, or the keys an update sets. */
  frontmatter?: Record<string, unknown>;
  /** The note's frontmatter before an update, so a field that moved says so. */
  before?: Record<string, unknown>;
  body?: string;
  append?: string;
  patch?: readonly { search: string; replace: string }[];
}

/** Whether a write is about a to-do. The folder decides, because an update's
 *  payload carries only the keys it sets and never the type. */
function isTodoWrite(input: ChangeLineInput): boolean {
  return dirOf(input.targetPath ?? '') === dirForType('todo');
}

/** Whether an update closes a to-do: the one edit that is neither new nor a
 *  plain change, and the one the PM most wants to see named. */
function closesTodo(input: ChangeLineInput): boolean {
  if (input.kind !== 'update') return false;
  if (!isTodoWrite(input)) return false;
  const commitment = fmString(input.frontmatter, 'commitment');
  return commitment === 'done' || commitment === 'dropped';
}

/**
 * The word a landed row leads with: New for a page that was not there, Changed
 * for an edit, Removed for a page that went, Sent for a card that left the
 * workspace, and one of the three to-do words for a promise, so the lead-in
 * names the kind.
 */
export function appliedVerb(input: ChangeLineInput): AppliedVerb {
  if (input.kind === 'outbound') return 'Sent';
  if (input.kind === 'delete') return 'Removed';
  if (isTodoWrite(input)) {
    if (closesTodo(input)) return 'Todo done';
    return input.kind === 'update' ? 'Todo changed' : 'New todo';
  }
  return input.kind === 'update' ? 'Changed' : 'New';
}

/** "one line", "3 lines". The count only appears when it is worth saying. */
const lineCount = (n: number): string => (n === 1 ? 'one line' : `${n} lines`);

/** The lines of a block that are real content: no blanks, no headings. */
const contentLines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isHeading(line));

/** A heading as the file writes it: the hashes off, the words as they stand.
 *  The section is the file's own name for that part, so the line keeps its
 *  capitals ("Entra" is a product, not a heading word). */
const headingText = (line: string): string =>
  line
    .trim()
    .replace(/^#{1,6}\s+/, '')
    .trim();

/** How deep a heading sits. 0 for a line that is not one. */
const headingLevel = (line: string): number => /^(#{1,6})\s/.exec(line.trim())?.[1]?.length ?? 0;

/**
 * The sections a piece of writing fills, named by their own headings:
 * "Summary, 3 Next steps". A section of bullets says how many; a section of
 * prose says only that it is there, because a count of paragraphs tells nobody
 * anything.
 *
 * A top-level heading is skipped: a page whose body opens with its own title is
 * not a page with a section called after itself.
 */
function sectionsIn(text: string): string[] {
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (headingLevel(line) < 2) continue;
    const heading = headingText(line);
    if (!heading) continue;
    let bullets = 0;
    let prose = 0;
    for (let j = i + 1; j < lines.length && !isHeading(lines[j]!); j++) {
      const body = lines[j]!.trim();
      if (!body) continue;
      if (/^[-*+]\s+/.test(body)) bullets++;
      else prose++;
    }
    if (bullets > 1) out.push(`${bullets} ${heading}`);
    else if (bullets + prose > 0) out.push(heading);
  }
  return out;
}

/** A day field said the way a person says a move: "12 to 24 Sep" keeps the
 *  month once when both days share it. */
function dayMove(before: unknown, after: unknown): string | null {
  const to = dayLabel(after);
  if (!to) return null;
  const from = dayLabel(before);
  if (!from) return `set to ${to}`;
  const month = to.slice(to.indexOf(' '));
  const short = from.endsWith(month) ? from.slice(0, from.length - month.length) : from;
  return `moved ${short} to ${to}`;
}

/** One field an update sets, said in the PM's words. Null for a field nobody
 *  reads (the filing keys) or a value too shapeless to print. */
function fieldPhrase(key: string, before: unknown, after: unknown): string | null {
  if (isFilingKey(key)) return null;
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  if (key === 'due') {
    const move = dayMove(before, after);
    return move ? `due ${move}` : null;
  }
  if (key === 'owner') {
    const who = titleForRef(typeof after === 'string' ? after : '');
    return who ? `waiting on ${who}` : null;
  }
  if (key === 'commitment' && after === 'done') return 'closed';
  if (key === 'commitment' && after === 'dropped') return 'dropped';
  if (typeof after === 'string' && after.trim() && after.trim().length <= 40) {
    return `${key.replace(/_/g, ' ')} now ${after.trim()}`;
  }
  if (typeof after === 'number' || typeof after === 'boolean') return `${key} now ${after}`;
  return null;
}

/** What one search/replace block did to the body. */
function patchPhrase(block: { search: string; replace: string }): string {
  const before = contentLines(block.search);
  const after = contentLines(block.replace);
  const added = after.filter((line) => !before.includes(line));
  const removed = before.filter((line) => !after.includes(line));
  // The heading the block is anchored on, when it is anchored on one: "one
  // line under Entra" says where to look, which a bare count never does.
  const head = block.search.split('\n').find(isHeading);
  const under = head ? ` under ${headingText(head)}` : '';
  if (added.length > 0 && removed.length === 0) return `${lineCount(added.length)}${under}`;
  if (removed.length > 0 && added.length === 0)
    return `${lineCount(removed.length)}${under} taken out`;
  return `${lineCount(Math.max(added.length, 1))}${under} rewritten`;
}

/** What an update did to the body, or an empty string when it touched none. */
function bodyPhrase(input: ChangeLineInput): string {
  const patch = input.patch ?? [];
  if (patch.length > 1) return `${patch.length} places changed`;
  if (patch.length === 1) return patchPhrase(patch[0]!);
  const append = input.append ?? '';
  if (!append.trim()) return '';
  const sections = sectionsIn(append);
  if (sections.length > 0) return sections.join(', ');
  return `${lineCount(contentLines(append).length)} added`;
}

/**
 * What one write changed, in one line: "summary, 3 next steps", "due moved 12 to
 * 24 Sep", "one line under Entra".
 *
 * The row above it already says the page and the act, so this says only the
 * thing neither of them can. Same two rules as the headline: nothing here is
 * authored by the model, and nothing here costs a lookup beyond the note's own
 * frontmatter as it read before the write.
 *
 * Empty is a real answer. A page that was removed, and a write whose whole story
 * is its title, both leave the line off rather than pad it.
 */
export function changeLine(input: ChangeLineInput): string {
  if (input.kind === 'delete' || input.kind === 'outbound') return '';
  const fm = input.frontmatter;

  if (input.kind === 'note' || input.kind === 'decision') {
    // A to-do says when. Not who: the title is the promise, the owner sits on
    // the todo itself, and on a receipt line the name was noise (Erik,
    // 2026-09-08). Whether Qale heard it or worked it out is the Todos view's
    // mark, for the same reason.
    if (noteType(fm) === 'todo' || isTodoWrite(input)) {
      const due = dayLabel(fmString(fm, 'due'));
      return due ? `due ${due}` : 'no date';
    }
    const sections = sectionsIn(input.body ?? '');
    if (sections.length > 0) return sections.join(', ');
    return firstProseLine(input.body).line;
  }

  // An update: what moved in the properties, then what moved in the body. Two
  // phrases is the ceiling: a third is a diff, and the diff is one click away.
  const fields: string[] = [];
  const todo = isTodoWrite(input);
  for (const [key, after] of Object.entries(fm ?? {})) {
    const phrase = fieldPhrase(key, input.before?.[key], after);
    if (phrase) fields.push(phrase);
  }
  const body = bodyPhrase(input);
  const parts = [...fields, ...(body ? [body] : [])];
  const moved =
    parts.length <= 2
      ? parts.join(', ')
      : `${parts.slice(0, 2).join(', ')}, and ${parts.length - 2} more`;
  if (!todo) return moved;
  // A to-do that closed says so and nothing else: the verb already says "done",
  // and "dropped" is the one case the word has to correct.
  if (closesTodo(input)) return fmString(fm, 'commitment') === 'dropped' ? 'dropped' : 'done';
  return moved;
}

/**
 * The verb-first line the PO reads to decide. Names what the app will do, so no
 * card can be mistaken for the real-world act its subject is named after.
 */
export function proposalHeadline(input: HeadlineInput): string {
  const target = input.targetPath ?? '';
  const fm = input.frontmatter;

  // Said first, and in one word, because it is the one card whose subject is
  // the file rather than anything written in it. It also has to beat the
  // instruction branch below: a rules file being removed must not read as a
  // rule being added.
  if (input.kind === 'delete') {
    const title = titleForRef(target);
    return title ? `Delete ${title}` : `Delete ${nounForDir(dirOf(target))}`;
  }

  // The work of a session, written down so the next one runs the same way. Said
  // before the rule branch below, which owns every other card in `skills/`.
  if (isNewSkill(input.kind, target)) {
    const subject = payloadTitle(fm) || titleForRef(target);
    return subject ? `Write a skill: ${subject}` : 'Write a skill';
  }

  // The rule in the PO's own words, since a card saying "Update Your rules"
  // never says which rule it is. Nothing to quote ⇒ say the plain thing.
  if (isInstruction(input.kind, target)) {
    // A line on the "What you want from Qale" list, in the PM's words. Taking
    // one off is the one rules card that ends something, so it says so.
    const want = wantListChange(input);
    if (want) return want.op === 'add' ? `Remember this: ${want.line}` : `Stop this: ${want.line}`;
    const rule = instructionRule(input);
    return rule ? `Remember this: ${rule}` : 'A new standing instruction';
  }

  // "Comment on PAY-142" / "File a ticket in PAY: SCIM group-mapping" — the
  // outbound line names its own target and already folds the title in.
  if (input.kind === 'outbound') return outboundTarget(input.outbound ?? {});

  if (input.kind === 'decision') {
    return `Decided: ${payloadTitle(fm) || titleForRef(target)}`;
  }

  if (input.kind === 'note') {
    const type = noteType(fm);
    const subject = payloadTitle(fm) || titleForRef(target);

    // The page records a meeting that already happened, so the line says the
    // act of writing it up. The day is what tells two Nordkap QBRs apart.
    if (type === 'meeting') {
      const day = meetingDay(fm);
      return day ? `Write up ${subject}, ${day}` : `Write up ${subject}`;
    }
    if (type === 'insight') return `Learned: ${subject}`;
    // "To do" is the PO's own; someone else's commitment leads with who owes
    // it, in the ledger's own words, so the two never look like one another.
    if (type === 'todo') {
      const owner = todoOwnerName(fm);
      return owner ? `Waiting on ${owner}: ${subject}` : `To do: ${subject}`;
    }
    // A person and a customer share one sentence on purpose. Both are a name,
    // not a claim, and both only get a page. The glyph and the effect line say
    // which folder. Their file IS their name; an explicit `title` wins where it
    // exists, since the slug folds away diacritics.
    if (type === 'person' || type === 'customer') {
      return `Add a page for ${fmString(fm, 'title') || titleForRef(target) || subject}`;
    }
    if (type === 'research') return `Record a research page: ${subject}`;
    if (type === 'about') return `Write down what is true: ${subject}`;
    return `Write a document: ${subject}`;
  }

  const title = titleForRef(target);
  return title ? `Update ${title}` : `Update ${nounForDir(dirOf(target))}`;
}

/**
 * What approving a vault card DOES, when that is worth a line the reader
 * cannot get anywhere else. The counterpart to `outboundEffect`, which owns
 * the cards that leave the machine: this one returns undefined for those so
 * the two can never both speak.
 *
 * A brand-new page says nothing here. Its lead-in ("New meeting", "New
 * customer") and its title already say what is being written and about what;
 * a line adding "Creates a page in Meetings, nothing is booked" only restated
 * that in longer words, and the eye learned to skip it. The same goes for a
 * decision: the headline already reads "Decided: …". What is still worth a
 * line is a change the page itself cannot show: a delete (the page is about to
 * be gone), a new skill (Qale will reach for it on its own), or a standing
 * instruction (which file the rule lands in, and when it gets read).
 */
export function vaultEffect(input: VaultEffectInput): string | undefined {
  if (input.kind === 'outbound') return undefined;

  const target = input.targetPath ?? '';

  // The only card that takes something away, so it is the only one whose effect
  // line names a folder losing a page rather than gaining one.
  if (input.kind === 'delete') {
    const dir = dirOf(target);
    return dir
      ? `Deletes the page from ${folderLabel(dir)}. Nothing else changes.`
      : 'Deletes the page from your workspace. Nothing else changes.';
  }

  // What a skill DOES after it lands is the one thing the file itself cannot
  // show the PO: nothing runs it on a clock, and nothing announces it.
  if (isNewSkill(input.kind, target)) {
    return 'Creates a skill in Skills. Qale reaches for it when this work comes up again.';
  }

  if (isInstruction(input.kind, target)) {
    const want = wantListChange(input);
    if (want) {
      return want.op === 'add'
        ? 'Adds to what you want from Qale. Every session reads the list before it starts.'
        : 'Removes from what you want from Qale. Nothing else changes.';
    }
    const system = conventionsSystem(target);
    if (system) {
      return `Adds the rule to ${CONVENTIONS_TITLES[system]}. Read whenever it drafts for ${system}.`;
    }
    const file = titleForRef(target) || 'your house rules';
    return `Adds the rule to ${file}. Every session reads it from now on.`;
  }

  // An update says nothing here on purpose. The headline is already "Update
  // <page>", with the page as an openable chip, and the diff under it is the
  // change itself. The sentence could only ever be "Edits a page in your
  // workspace", which is the headline with fewer facts in it.
  if (input.kind === 'update') return undefined;

  // Every other note, and a decision, say nothing here either: the lead-in and
  // the title already named the page and its kind, and the folder it lands in
  // is a fact the reader can see the moment the card opens the page.
  return undefined;
}

/**
 * The imperative that completes "Approve & …". Every action names its own act:
 * an `update_page` rewrites a page that already exists, and calling that "send"
 * would invent a delivery that never happens while hiding the edit that does.
 *
 * The default is for a payload naming an action this build does not know. Such a
 * card cannot be applied at all, so it says nothing about what would happen.
 */
export function outboundVerb(action: string | undefined): string {
  switch (action) {
    case 'update_page':
      return 'update the page';
    case 'comment_ticket':
      return 'post the comment';
    case 'create_ticket':
      return 'create the ticket';
    case 'create_event':
      return 'create the event';
    case 'update_event':
      return 'change the event';
    case 'respond_to_event':
      return 'reply';
    default:
      return 'apply it';
  }
}

/**
 * The whole outbound act as the PO says it, in plain text: "Comment on PAY-142",
 * "File a ticket in PAY: SCIM group-mapping", "Add “Erik x Daniel: sync” to your
 * calendar". The reference itself renders as a live chip in the card; this
 * string is the flat form for headlines and aria labels, so it names the thing
 * itself — a calendar event reading "Send an update" told the PO about a
 * delivery that never happens.
 */
export function outboundTarget(ob: OutboundCopyInput): string {
  const named = (s: string): string => `“${s}”`;
  switch (ob.action) {
    case 'comment_ticket':
      return ob.targetId ? `Comment on ${ob.targetId}` : 'Comment on a ticket';
    case 'create_ticket': {
      const file = `File a ${ob.issueType?.toLowerCase() ?? 'ticket'}${ob.container ? ` in ${ob.container}` : ''}`;
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
    default:
      return ob.title ? `Apply ${named(ob.title)}` : 'Apply this change';
  }
}

/**
 * The receipt line after a card lands — past tense, and naming the thing it
 * touched. "Update a page" told the PO nothing about which page just changed
 * under their name.
 */
export function outboundReceipt(ob: OutboundCopyInput): string {
  switch (ob.action) {
    case 'update_page':
      return `Updated ${ob.title ?? 'a page'}`;
    case 'comment_ticket':
      return `Commented on ${ob.targetId ?? 'a ticket'}`;
    case 'create_ticket':
      return `Created a ${ob.issueType?.toLowerCase() ?? 'ticket'}${ob.container ? ` in ${ob.container}` : ''}`;
    case 'create_event':
      return `Added ${ob.title ?? 'an event'} to your calendar`;
    case 'update_event':
      return `Changed ${ob.title ?? 'an event'} in your calendar`;
    case 'respond_to_event':
      return `Replied ${rsvpAnswer(ob.responseStatus)} to ${ob.title ?? 'an invite'}`;
    default:
      return `Applied ${ob.title ?? 'the change'}`;
  }
}

/**
 * One line on the green "Left your workspace" card, with the item split out of
 * the sentence so the card can draw it as a chip.
 *
 * Every line names a real thing and every line opens it. A sentence that says
 * "Created a task in Nordkap" tells the PM a ticket exists somewhere and gives
 * them no way to it, which is the one thing they want the second after they
 * approve a send. So the send stamps where it landed onto the card, and the
 * line reads act, item, tail: "Commented on [PAY-142]", "Created [PAY-171] in
 * Nordkap", "Added [Kickoff] to your calendar".
 *
 * A send whose item has no address keeps the whole sentence in `act` and draws
 * no chip. Cards accepted before the stamp existed take that path.
 */
export interface SentLine {
  /** The words before the item, or the whole sentence when there is no item. */
  act: string;
  /** The item, as a reference chip draws it: a ticket key, a page id, an event id. */
  item?: string;
  /** What to call the item until the workspace has its own copy. */
  name?: string;
  /** The item's address at the provider. */
  url?: string;
  /** The words after the item. */
  tail?: string;
}

export function sentLine(ob: OutboundCopyInput): SentLine {
  const url = ob.url?.trim() ? ob.url : undefined;
  const sentence = { act: outboundReceipt(ob) };
  const item = ob.targetId ?? ob.eventId;
  if (!item) return sentence;
  switch (ob.action) {
    case 'comment_ticket':
      return { act: 'Commented on', item, url };
    case 'update_page':
      return { act: 'Updated', item, name: ob.title, url };
    case 'create_ticket':
      return {
        act: 'Created',
        item,
        name: item,
        url,
        ...(ob.container ? { tail: `in ${ob.container}` } : {}),
      };
    case 'create_event':
      return { act: 'Added', item, name: ob.title, url, tail: 'to your calendar' };
    case 'update_event':
      return { act: 'Changed', item, name: ob.title, url, tail: 'in your calendar' };
    case 'respond_to_event':
      return { act: `Replied ${rsvpAnswer(ob.responseStatus)} to`, item, name: ob.title, url };
    default:
      return sentence;
  }
}
