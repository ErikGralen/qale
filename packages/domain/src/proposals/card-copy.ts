import { refToSlug } from '../notes/decisions.js';
import { dirForType } from '../notes/frontmatter.js';
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
 * what the app does ("Write up", "Add a page for"), and the effect line names
 * where it lands and what does NOT happen.
 *
 * That second clause is rationed. It appears only for the kinds with a
 * real-world twin (a meeting, a person, a customer, a commitment someone else
 * owes). On every card it would be boilerplate the reader learns to skip, and a
 * warning nobody reads protects nobody.
 */

const quote = (s: string): string => `“${s}”`;

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

/** dir segment (plural) → singular noun for the fallback "Update <noun>". */
const NOUN_FOR_DIR: Record<string, string> = {
  meetings: 'the meeting notes',
  decisions: 'a decision',
  insights: 'an insight',
  research: 'a research page',
  about: 'an about page',
  customers: 'a customer',
  people: 'a person',
  sources: 'a source',
  notes: 'a document',
  todos: 'a to-do',
};

/** What an update card calls the page it touches when it has no title to use.
 *  A folder with no noun of its own falls back to the word every effect line
 *  here already uses for a file in the workspace. */
export function nounForDir(dir: string): string {
  return NOUN_FOR_DIR[dir] ?? 'a page';
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
  if (fmString(fm, 'type') !== 'todo') return null;
  const owner = fmString(fm, 'owner');
  if (!owner) return null;
  // Either a "[[people/…]]" ref or a bare name — both read as a person here.
  return titleForRef(owner) || null;
}

/** The meeting day as a person says it: "4 Aug". Undefined when the frontmatter
 *  carries no date, or one that will not parse. */
function meetingDay(fm?: Record<string, unknown>): string | undefined {
  const stamp = parseEventStamp(fmString(fm, 'date'));
  return stamp ? formatStamp(stamp) : undefined;
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
 * What approving a vault card DOES, and where it lands. The counterpart to
 * `outboundEffect`, which owns the cards that leave the machine: this one
 * returns undefined for those so the two can never both speak.
 *
 * Every line names the destination folder. An unmarked card makes no claim, and
 * a reader with no claim in front of them supplies the worst one.
 */
export function vaultEffect(input: VaultEffectInput): string | undefined {
  if (input.kind === 'outbound') return undefined;

  const target = input.targetPath ?? '';
  const fm = input.frontmatter;

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
  // workspace", which is the headline with fewer facts in it. Every other kind
  // names a folder the page lands in, or a consequence the reader can't see.
  if (input.kind === 'update') return undefined;

  // What it supersedes is deliberately NOT said here. The card already carries a
  // "Replaces <title>" chip under the headline, and the sentence said the same
  // fact a second time, two lines apart.
  if (input.kind === 'decision') {
    return 'Records the decision in Decisions. Nothing is announced.';
  }

  const type = noteType(fm);
  if (type === 'meeting') {
    return 'Creates a page in Meetings. It records a meeting that already happened; nothing is booked.';
  }
  if (type === 'person') return 'Creates a page in People. Nobody is contacted.';
  if (type === 'customer') return 'Creates a page in Customers. Nobody is contacted.';
  if (type === 'todo') {
    const owner = todoOwnerName(fm);
    return owner
      ? `Adds ${quote(`waiting on ${owner}`)} to your ledger. ${owner} is not told.`
      : 'Adds a to-do to your list.';
  }
  const dir = dirOf(target);
  // The folder's own display name, so the line points at a shelf the PO can go
  // and open. No path at all ⇒ no folder to name, and the sentence stops early.
  return dir ? `Creates a page in ${folderLabel(dir)}.` : 'Creates a page in your workspace.';
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
