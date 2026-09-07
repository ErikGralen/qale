/**
 * The write policy: how much of the PM's attention one write is worth
 * (docs/easier-tickets.md E-3, docs/background-system.md ticket 2).
 *
 * Every write the agent makes used to cost a card, and a card costs a reading, a
 * judgement and a click. An ordinary week ran to an estimated 30 to 70 of them,
 * so the queue stopped being a review and became a chore. The fix is not fewer
 * writes. It is grading each write by the damage it can do, in ONE place, and
 * asking only where the answer matters.
 *
 * Three answers:
 * - `silent`  applies on the spot. Nothing enters the queue. An Activity row is
 *             the receipt, and the chat says one quiet line.
 * - `grouped` still asks, but belongs in a card with its siblings rather than in
 *             one of its own. Workstream B1 builds that card; until it exists a
 *             grouped write behaves exactly like `ask`.
 * - `ask`     one card, on its own, every time.
 *
 * Place is the first axis. The workspace has two of them and they are not the
 * same kind of thing. `notes/` is Documents, the folder the PM writes in. The
 * rest is Memory, what Qale knows and keeps for them. A page the agent files for
 * itself costs the PM nothing; a page in their own folder is a page they did not
 * put there.
 *
 * Nothing here is new data. A proposal already carries its kind, the note type it
 * writes, the file it aims at, and whether the PM asked for it.
 */

import { isVoicePath } from '../notes/slug.js';

export const WRITE_DISPOSITIONS = ['silent', 'grouped', 'ask'] as const;
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
   * goes is part of what the write does: `notes/` is the PM's own Documents
   * folder, and the rest of the workspace is the memory the agent keeps.
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
  return facts.noteType === 'todo';
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
 * rewrites. Writing one is Qale taking notes, not Qale changing something the
 * PM wrote, and the file itself is the record the PM reads and edits.
 */
export function isStyleFile(path: string | null | undefined): boolean {
  if (!path) return false;
  return (STYLE_FILES as readonly string[]).includes(path) || isVoicePath(path);
}

/**
 * The folder behind the Documents screen. It holds what the PM writes: scratch
 * notes, briefs, PRDs, specs (E-14). Everything else in the workspace is the
 * memory, which the agent keeps for them.
 */
export const USER_DOCUMENTS_DIR = 'notes/';

/** Does this write land in the PM's own Documents folder? */
function inDocuments(facts: WriteFacts): boolean {
  return (facts.targetPath ?? '').startsWith(USER_DOCUMENTS_DIR);
}

/**
 * The machinery exception, stated once (docs/background-system.md ticket 2).
 *
 * A derived label is not authorship. `summary`, `summary_at`, `summary_of`,
 * `purpose_of`, and the fields the normalizer fills (`type` from the folder,
 * `captured` from the file date) all restate what the file and its folder
 * already say. Nobody reads them as a claim. So the maintenance passes write
 * them straight to the file, everywhere, Documents included, with no card. The
 * git commit is the receipt and history is the revert.
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
 * Does a maintenance pass write this field on its own, in either place? Such a
 * field goes straight to the file and never becomes a card.
 */
export function isMachineryField(field: string): boolean {
  return (
    (DERIVED_LABEL_FIELDS as readonly string[]).includes(field) ||
    (QALE_OWNED_FIELDS as readonly string[]).includes(field)
  );
}

/**
 * The rules that hold in both places. First rule that matches wins.
 *
 * 1. Outbound goes to Jira, Confluence or a calendar, and the code has no
 *    compensating action for a send. It always asks, one card per send, and it
 *    never groups (E-7).
 * 2. A delete takes something away, and there is no undelete either.
 * 3. A todo is a promise, and a promise is the PM's word to somebody. Creating
 *    one, closing one or moving its date all ask.
 * 4. Qale's own notes on how the PM works land without a card
 *    (docs/learning-how-you-work.md, ticket 5): the Jira and Confluence files
 *    written from their own tickets and pages, and a voice rewritten after a
 *    style pick. The file is the record, it is linked in the chat, and Activity
 *    keeps the row. A rule the PM stated into one of them still takes rule 5's
 *    reason, because "you said so" is the truer sentence there.
 * 5. A standing rule the PM stated is remembered without a card. The chat says
 *    "Added to rules" and Activity keeps the row (E-8). Any other rule file the
 *    agent wrote on its own asks: a new skill is a whole file nobody watched
 *    being made.
 * 6. What the PM asked for in the chat applies on the spot. The card was asking
 *    them to confirm their own instruction (E-4).
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
  if (isStyleFile(facts.targetPath) && !facts.asked) {
    return {
      disposition: 'silent',
      reason: "Qale's own notes about how you work, and the file is the record.",
    };
  }
  if (isRuleFile(facts)) {
    return facts.asked
      ? { disposition: 'silent', reason: 'You said it should hold from now on.' }
      : {
          disposition: 'ask',
          reason: 'This changes how the agent works, and you did not ask for it.',
        };
  }
  if (facts.asked) {
    return { disposition: 'silent', reason: 'You asked for this in the chat.' };
  }
  return null;
}

/**
 * Documents, the PM's own folder. Nothing else lands. Whatever it is, it asks
 * (E-14). Derived labels are the one exception, and they never come through here
 * (see {@link DERIVED_LABEL_FIELDS}).
 */
function rulingInDocuments(): WriteRuling {
  return { disposition: 'ask', reason: 'Documents is your folder, so you say what goes in it.' };
}

/**
 * Memory, what Qale keeps for the PM.
 *
 * 1. A new page, or text added at the end of one, applies silently. Both add;
 *    neither rewrites what is already there (E-5).
 * 2. A patch over existing text, and a decision, still need a human. They belong
 *    in one grouped card per intent (E-6, B1's work).
 * 3. A kind nobody has graded yet asks.
 */
function rulingInMemory(facts: WriteFacts): WriteRuling {
  if (facts.kind === 'note') {
    return { disposition: 'silent', reason: 'A new page takes nothing away.' };
  }
  if (facts.kind === 'update' && facts.appendOnly) {
    return { disposition: 'silent', reason: 'It adds at the end and rewrites nothing.' };
  }
  if (facts.kind === 'update') {
    return { disposition: 'grouped', reason: 'It rewrites text the page already has.' };
  }
  if (facts.kind === 'decision') {
    return { disposition: 'grouped', reason: 'A decision is yours to make.' };
  }
  // A kind nobody has graded yet. Asking is the answer that cannot surprise
  // anyone, so a new card kind starts there and is graded on purpose.
  return { disposition: 'ask', reason: 'This kind of write always asks.' };
}

/**
 * What happens to one write. The rules that hold everywhere run first, then the
 * place decides the rest.
 */
export function writePolicy(facts: WriteFacts): WriteRuling {
  const everywhere = rulingEverywhere(facts);
  if (everywhere) return everywhere;
  return inDocuments(facts) ? rulingInDocuments() : rulingInMemory(facts);
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

/** The policy for one place, ready to render. */
export interface WritePolicyPlace {
  /** Which place. For keys and tests, never shown. */
  place: 'documents' | 'memory';
  /** The heading a person reads. */
  title: string;
  rows: WritePolicyRow[];
}

/** A page in the PM's Documents folder, for asking the policy about that place. */
const A_DOCUMENT = `${USER_DOCUMENTS_DIR}pricing-brief.md`;

/** A page in Memory, for the same question. */
const A_MEMORY_PAGE = 'research/pricing.md';

/**
 * The writes the screen explains, in the order it lists them. Each one is a real
 * set of facts, so the answer beside it comes from the policy and not from a
 * copy of it.
 *
 * A write with a `targetPath` of its own lands in that file wherever the place
 * is, so it is listed under Memory only: the style files and the voices live
 * there, and asking the policy about `notes/` for them would be a question
 * nobody asks.
 */
const EXPLAINED_WRITES: readonly {
  what: string;
  facts: Omit<WriteFacts, 'targetPath'> & { targetPath?: string };
}[] = [
  {
    what: 'Anything sent to Jira, Confluence or the calendar',
    facts: { kind: 'outbound' },
  },
  { what: 'Deleting a page', facts: { kind: 'delete' } },
  {
    what: 'A promise you owe somebody, made or changed',
    facts: { kind: 'note', noteType: 'todo' },
  },
  {
    what: 'A rule you stated in the chat',
    facts: { kind: 'update', noteType: 'skill', appendOnly: true, asked: true },
  },
  {
    what: 'A rule Qale wrote up on its own',
    facts: { kind: 'note', noteType: 'skill' },
  },
  {
    what: 'The notes Qale keeps on how you write tickets, pages and updates',
    facts: { kind: 'note', noteType: 'skill', targetPath: STYLE_FILES[0] },
  },
  {
    what: 'A page or an edit you asked for in the chat',
    facts: { kind: 'note', asked: true },
  },
  { what: 'A new page Qale writes on its own', facts: { kind: 'note' } },
  {
    what: 'Text Qale adds at the end of a page',
    facts: { kind: 'update', appendOnly: true },
  },
  { what: 'An edit over text a page already has', facts: { kind: 'update' } },
  { what: 'A decision written down', facts: { kind: 'decision' } },
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
 * straight to the file, in both places. See {@link DERIVED_LABEL_FIELDS}.
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
 * The policy as two readable lists, one per place, for the Settings section that
 * says what Qale does on its own (docs/background-system.md ticket 6).
 *
 * Every row asks {@link writePolicy} the question it stands for, so the screen
 * cannot drift from the rule. The two label rows are the stated exception: no
 * pass consults the policy, so their sentences are written here in the same
 * voice.
 */
export function describeWritePolicy(): WritePolicyPlace[] {
  const rowsFor = (place: WritePolicyPlace['place'], targetPath: string): WritePolicyRow[] => [
    ...EXPLAINED_WRITES.filter(({ facts }) => place === 'memory' || !facts.targetPath).map(
      ({ what, facts }) => {
        const { disposition, reason } = writePolicy({
          ...facts,
          targetPath: facts.targetPath ?? targetPath,
        });
        return { what, disposition, reason };
      },
    ),
    ...MACHINERY_ROWS.map((row) => ({ ...row })),
  ];
  return [
    { place: 'documents', title: 'In your documents', rows: rowsFor('documents', A_DOCUMENT) },
    { place: 'memory', title: 'In its memory', rows: rowsFor('memory', A_MEMORY_PAGE) },
  ];
}
