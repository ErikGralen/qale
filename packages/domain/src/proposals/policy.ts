/**
 * The write policy: which writes wait for the PM (docs/review-rework.md RR-1).
 *
 * The workspace has two spheres. One is the PM's: their documents (`notes/`),
 * their todos and their meetings. A write there waits for them. So does
 * anything sent out of the workspace, and so does a delete, wherever it points.
 * The other sphere is Qale's memory: decisions, insights, research, about,
 * customers, people, sources, and Qale's own skill and agent files. A write
 * there lands as it is written. Git commits it, Activity keeps the row, and one
 * press puts it back.
 *
 * Two answers:
 * - `silent` applies on the spot. Nothing enters the queue. An Activity row is
 *            the receipt, and the chat says one quiet line.
 * - `ask`    one card, every time.
 *
 * The sidebar draws the same line: `surfaceForType` in the desktop app sends a
 * meeting, a note and a todo to rails of their own. One predicate says what is
 * the PM's, and the two screens read the same one.
 *
 * Nothing here is new data. A proposal already carries its kind, the note type
 * it writes, the file it aims at, and whether the PM asked for it.
 */

import { isVoicePath } from '../notes/slug.js';

/** The two answers the policy gives. */
export const WRITE_DISPOSITIONS = ['silent', 'ask'] as const;
export type WriteDisposition = (typeof WRITE_DISPOSITIONS)[number];

/** What the policy reads. All of it is already on the proposal. */
export interface WriteFacts {
  /** note / update / decision / outbound / delete. */
  kind: string;
  /**
   * The `type` of the note this write lands in: the frontmatter type for a new
   * note, the target note's own type for an update. Undefined when nothing
   * knows it, which reads as an ordinary note.
   */
  noteType?: string | undefined;
  /** The PM asked for this in the conversation, so the card would be asking them
   *  to confirm their own instruction. */
  asked?: boolean | undefined;
  /**
   * The file this write lands in, e.g. `notes/q3-priorities.md`. Where a page
   * goes is part of what the write does: `notes/`, `todos/` and `meetings/` are
   * the PM's, and the rest of the workspace is the memory Qale keeps.
   */
  targetPath?: string | undefined;
  /**
   * The update only adds text at the end. It rewrites nothing the note already
   * says, it re-places against the note as it currently reads, and it refuses a
   * duplicate, so the risky part is handled before the policy is consulted.
   */
  appendOnly?: boolean | undefined;
}

/** The ruling, plus why, in the words a person could read. */
export interface WriteRuling {
  disposition: WriteDisposition;
  /** One short sentence: why this write gets this answer. */
  reason: string;
}

/** A commitment ledger entry. Creating one, or changing one, is the PM's word. */
function isTodo(facts: WriteFacts): boolean {
  return facts.noteType === 'todo' || (facts.targetPath ?? '').startsWith('todos/');
}

/** A file that says how the app behaves: a skill, an agent, the house rules. */
function isRuleFile(facts: WriteFacts): boolean {
  return facts.noteType === 'skill' || facts.noteType === 'agent';
}

/**
 * The two files Qale writes from the PM's own tickets and pages
 * (docs/learning-how-you-work.md, ticket 5): how they write tickets, how they
 * write pages. Named here rather than imported from `@qale/sessions`, because
 * the domain depends on nothing. The names are the outbound provider ids this
 * package already owns, so a third file would be added in both places.
 */
export const STYLE_FILES = ['skills/jira/SKILL.md', 'skills/confluence/SKILL.md'] as const;

/**
 * A file Qale keeps its own notes on how the PM works in: one of
 * {@link STYLE_FILES}, or a voice (`voices/exec.md`), which a style pick
 * rewrites. Every one of them sits in Qale's memory, so the policy needs no
 * branch for them. The write path reads this to say what a write TAUGHT Qale on
 * the Activity row: on any other note, "learned" would call a plain edit a
 * lesson.
 */
export function isStyleFile(path: string | null | undefined): boolean {
  if (!path) return false;
  return (STYLE_FILES as readonly string[]).includes(path) || isVoicePath(path);
}

/**
 * The folder behind the Documents screen. It holds what the PM writes: scratch
 * notes, briefs, PRDs, specs (E-14).
 */
export const USER_DOCUMENTS_DIR = 'notes/';

/**
 * The folders that are the PM's. Documents is one of three: a todo is a promise
 * they made, and a meeting page is the record of a room they sat in. The
 * sidebar gives each of them its own rail.
 */
export const USERS_SPHERE_DIRS = [USER_DOCUMENTS_DIR, 'todos/', 'meetings/'] as const;

/** The note types that are the PM's, wherever the file happens to sit. */
export const USERS_SPHERE_TYPES = ['note', 'todo', 'meeting'] as const;

/**
 * Is this write the PM's side of the workspace? The one predicate the policy
 * and the sidebar both stand on. The folder answers it, and so does the type,
 * because a todo proposed before its file exists carries only the type.
 */
export function isUsersSphere(facts: WriteFacts): boolean {
  const path = facts.targetPath ?? '';
  if (USERS_SPHERE_DIRS.some((dir) => path.startsWith(dir))) return true;
  return (USERS_SPHERE_TYPES as readonly string[]).includes(facts.noteType ?? '');
}

/**
 * The machinery exception, stated once (docs/background-system.md ticket 2).
 *
 * A derived label is not authorship. `summary`, `summary_at`, `summary_of`,
 * `purpose_of`, and the fields the normalizer fills (`type` from the folder,
 * `captured` from the file date) all restate what the file and its folder
 * already say. Nobody reads them as a claim. So the maintenance passes write
 * them straight to the file, in both spheres, with no card. The git commit is
 * the receipt and history is the revert.
 *
 * `tags` are Qale's too (docs/background-system.md ticket 3). The PM reads them
 * and never edits them, so the same pass writes them the same silent way. A tag
 * files a page; it says nothing the page does not.
 *
 * These fields never reach {@link writePolicy}, because a pass is not a proposal.
 * This list is here so the exception has a footprint in the policy and not only
 * in prose. Which tier each field belongs to is stated in
 * `apps/desktop/src/renderer/src/state/properties-schema.ts` (`owner`), and the
 * passes keep their own lists pointing back at it. The domain must not import a
 * renderer module, so this stays a pointer.
 */
export const DERIVED_LABEL_FIELDS = [
  'summary',
  'summary_at',
  'summary_of',
  'purpose_of',
  'type',
  'captured',
] as const;

/** Fields Qale owns and fills for the PM to read. See {@link DERIVED_LABEL_FIELDS}. */
export const QALE_OWNED_FIELDS = ['tags'] as const;

/**
 * Does a maintenance pass write this field on its own, in either sphere? Such a
 * field goes straight to the file and never becomes a card.
 */
export function isMachineryField(field: string): boolean {
  return (
    (DERIVED_LABEL_FIELDS as readonly string[]).includes(field) ||
    (QALE_OWNED_FIELDS as readonly string[]).includes(field)
  );
}

/**
 * The rules that hold in both spheres. First rule that matches wins.
 *
 * 1. Outbound goes to Jira, Confluence or a calendar, and the code has no
 *    compensating action for a send. It always asks, one card per send (E-7).
 * 2. A delete takes something away, and there is no undelete either.
 * 3. A todo is a promise, and a promise is the PM's word to somebody. It asks
 *    whoever asked for it: making one, closing one and moving its date.
 * 4. A skill or an agent file is how Qale works, which is Qale's memory, so it
 *    lands as it is written. The file is the record: the PM reads it on the
 *    Skills page and changes it there. A rule the PM stated takes its own
 *    reason, because "you said so" is the truer sentence for it.
 * 5. What the PM asked for in the chat applies on the spot, in either sphere.
 *    The card was asking them to confirm their own instruction (E-4).
 */
function rulingEverywhere(facts: WriteFacts): WriteRuling | null {
  if (facts.kind === 'outbound') {
    return {
      disposition: 'ask',
      reason: 'Nothing sent to another system can be taken back.',
    };
  }
  if (facts.kind === 'delete') {
    return { disposition: 'ask', reason: 'A deleted page cannot be put back.' };
  }
  if (isTodo(facts)) {
    return { disposition: 'ask', reason: 'A promise is your word, so you decide it.' };
  }
  if (isRuleFile(facts)) {
    return facts.asked
      ? { disposition: 'silent', reason: 'You said it should hold from now on.' }
      : {
          disposition: 'silent',
          reason: 'How Qale works is written in the file, and you can change it there.',
        };
  }
  if (facts.asked) {
    return { disposition: 'silent', reason: 'You asked for this in the chat.' };
  }
  return null;
}

/**
 * Qale's memory: everything outside the PM's own folders. A page Qale files for
 * itself costs the PM nothing to have, git commits it, and Activity puts it
 * back. So it lands, whatever the write does to it.
 *
 * A decision lands too. The spine is append-only: a wrong decision is never
 * edited, it is superseded by the next one, so a card buys nothing.
 *
 * A kind nobody has graded yet asks. Asking is the answer that cannot surprise
 * anyone, so a new card kind starts there and is graded on purpose.
 */
function rulingInMemory(facts: WriteFacts): WriteRuling {
  if (facts.kind === 'note') {
    return { disposition: 'silent', reason: 'A new page takes nothing away.' };
  }
  if (facts.kind === 'update' && facts.appendOnly) {
    return { disposition: 'silent', reason: 'It adds at the end and rewrites nothing.' };
  }
  if (facts.kind === 'update') {
    return {
      disposition: 'silent',
      reason: 'Qale keeps its own memory, and one press puts any change back.',
    };
  }
  if (facts.kind === 'decision') {
    return {
      disposition: 'silent',
      reason: "A decision is Qale's record. A wrong one is superseded by the next.",
    };
  }
  return { disposition: 'ask', reason: 'This kind of write always asks.' };
}

/**
 * What happens to one write. The rules that hold everywhere run first, then the
 * sphere decides the rest.
 */
export function writePolicy(facts: WriteFacts): WriteRuling {
  const everywhere = rulingEverywhere(facts);
  if (everywhere) return everywhere;
  if (isUsersSphere(facts)) {
    return {
      disposition: 'ask',
      reason: 'This side of the workspace is yours, so you say what goes in it.',
    };
  }
  return rulingInMemory(facts);
}

/** Shorthand: does this write land without a card? */
export function appliesSilently(facts: WriteFacts): boolean {
  return writePolicy(facts).disposition === 'silent';
}

/** One line of the policy, as a person reads it. */
export interface WritePolicyRow {
  /** The write, in plain words. */
  what: string;
  disposition: WriteDisposition;
  /** The policy's own sentence for why. */
  reason: string;
}

/** The policy for one sphere, ready to render. */
export interface WritePolicyPlace {
  /** Which sphere. For keys and tests, never shown. */
  place: 'yours' | 'memory';
  /** The heading a person reads. */
  title: string;
  rows: WritePolicyRow[];
}

/**
 * The writes the screen explains, one sphere at a time, in the order it lists
 * them. Each row is a real set of facts, so the answer beside it comes from the
 * policy and not from a copy of it.
 */
interface ExplainedWrite {
  what: string;
  facts: WriteFacts;
}

/** The PM's sphere: their folders, plus the two things that ask anywhere. */
const YOURS: readonly ExplainedWrite[] = [
  {
    what: 'A document, a to-do or a meeting page',
    facts: { kind: 'note', targetPath: 'notes/pricing-brief.md' },
  },
  {
    what: 'An edit to one of them, a to-do closed or moved included',
    facts: { kind: 'update', noteType: 'todo', targetPath: 'todos/2026-09-07-send-the-dates.md' },
  },
  {
    what: 'Anything sent to Jira, Confluence or the calendar',
    facts: { kind: 'outbound' },
  },
  { what: 'Deleting a page, wherever it sits', facts: { kind: 'delete' } },
  {
    what: 'A page or an edit you asked for in the chat',
    facts: { kind: 'note', asked: true, targetPath: 'notes/pricing-brief.md' },
  },
];

/** Qale's memory: what it keeps for the PM, and its own files. */
const MEMORY: readonly ExplainedWrite[] = [
  {
    what: 'A new page: an insight, a customer, a person, a research or about page',
    facts: { kind: 'note', targetPath: 'research/pricing.md' },
  },
  {
    what: 'An edit to a page Qale keeps',
    facts: { kind: 'update', targetPath: 'research/pricing.md' },
  },
  {
    what: 'A decision written down',
    facts: { kind: 'decision', targetPath: 'decisions/adopt-workos.md' },
  },
  {
    what: "Qale's own skill and agent files, and the notes it keeps on how you write",
    facts: { kind: 'update', noteType: 'skill', targetPath: STYLE_FILES[0] },
  },
  {
    what: 'A rule you stated in the chat',
    facts: {
      kind: 'update',
      noteType: 'skill',
      appendOnly: true,
      asked: true,
      targetPath: 'skills/house-rules/SKILL.md',
    },
  },
];

/**
 * Why a derived label needs no card. The Settings section says this, and so
 * does the Activity row the summary pass leaves, so it is written once here.
 */
export const DERIVED_LABEL_REASON = 'A label for finding the page, never a claim.';

/** Why a tag needs no card. Same two readers as {@link DERIVED_LABEL_REASON}. */
export const TAG_REASON = 'A tag files the page, so it says nothing new.';

/**
 * The two rows the policy never sees. A maintenance pass writes these fields
 * straight to the file, in both spheres. See {@link DERIVED_LABEL_FIELDS}.
 */
const MACHINERY_ROWS: readonly WritePolicyRow[] = [
  {
    what: 'The summary line and the other labels Qale fills in',
    disposition: 'silent',
    reason: DERIVED_LABEL_REASON,
  },
  {
    what: 'The tags on a page',
    disposition: 'silent',
    reason: TAG_REASON,
  },
];

/**
 * The policy as two readable lists, one per sphere, for the Settings section
 * that says what Qale does on its own (docs/background-system.md ticket 6).
 *
 * Every row asks {@link writePolicy} the question it stands for, so the screen
 * cannot drift from the rule. The two label rows are the stated exception: no
 * pass consults the policy, so their sentences are written here in the same
 * voice.
 */
export function describeWritePolicy(): WritePolicyPlace[] {
  const rowsFor = (writes: readonly ExplainedWrite[]): WritePolicyRow[] => [
    ...writes.map(({ what, facts }) => {
      const { disposition, reason } = writePolicy(facts);
      return { what, disposition, reason };
    }),
    ...MACHINERY_ROWS.map((row) => ({ ...row })),
  ];
  return [
    { place: 'yours', title: 'Your documents, to-dos and meetings', rows: rowsFor(YOURS) },
    { place: 'memory', title: "Qale's memory", rows: rowsFor(MEMORY) },
  ];
}
