/**
 * The write policy: which writes wait for the PM (docs/fewer-approvals.md FA-1).
 *
 * The rule is what a write DOES, not where the file sits. Four things wait: a
 * send out of the workspace, a delete, a rewrite of prose the PM typed, and
 * anything Qale had to assume. Everything else lands as it is written: a
 * meeting page from a transcript, a todo, text added at the end, a new
 * document, and all of Qale's memory. Git commits every landed write, Activity
 * keeps the row, and one press puts it back.
 *
 * The policy used to decide by folder, and asked for every write in the PM's
 * three folders. That made the PM confirm their own words: a card asking
 * whether they really said the thing the transcript has them saying.
 *
 * Two answers:
 * - `silent` applies on the spot. Nothing enters the queue. An Activity row is
 *            the receipt, and the chat says one quiet line.
 * - `ask`    one card, every time.
 *
 * The sidebar still draws the folder line: `surfaceForType` in the desktop app
 * sends a meeting, a note and a todo to rails of their own, and reads
 * {@link isUsersSphere} for it.
 *
 * Nothing here is new data. A proposal already carries its kind, the note type
 * it writes, the file it aims at, whether the PM asked for it, and what its
 * change does to the body.
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
   * The file this write lands in, e.g. `notes/q3-priorities.md`. The policy
   * reads it for the todo rule and for the sidebar predicate; what the write
   * does to the body is the question the folder used to stand in for.
   */
  targetPath?: string | undefined;
  /**
   * The update only adds text at the end. It rewrites nothing the note already
   * says, it re-places against the note as it currently reads, and it refuses a
   * duplicate, so the risky part is handled before the policy is consulted.
   */
  appendOnly?: boolean | undefined;
  /**
   * The update patches prose the PM typed: a patch into a document body
   * (`notes/`), or into the `## Notes` section of a meeting page. Undo makes a
   * wrong rewording recoverable, not noticeable, and a change to their own
   * words is the one edit a quick read misses. `fileProposal` works this out
   * from the change and the note it lands in.
   */
  rewritesUserText?: boolean | undefined;
  /**
   * The rationale says "Assumed:". An unattended run that has spent its two
   * questions picks the most reasonable option and labels it that way
   * (`UNATTENDED_RULES` in the agent prompts). The rationale dies with the
   * card, so the PM only ever sees the assumption if the write waits.
   */
  assumed?: boolean | undefined;
}

/** The ruling, plus why, in the words a person could read. */
export interface WriteRuling {
  disposition: WriteDisposition;
  /** One short sentence: why this write gets this answer. */
  reason: string;
}

/** A commitment ledger entry: a promise the PM made, or one they are waiting on. */
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
 * Is this write the PM's side of the workspace? The folder answers it, and so
 * does the type, because a todo proposed before its file exists carries only
 * the type.
 *
 * `writePolicy` stopped asking it in FA-1, because where a page sits says
 * nothing about what a write to it does. It stays exported for the sidebar,
 * which draws the same folder line (`surfaceForType` in the desktop app), and
 * for anything else that needs the three folders named in one place.
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
 * Why a send waits. Written down once, because two pieces of code say it: the
 * rule below, and the guard in `fileProposal` that refuses to apply a send even
 * when the rule somehow answers otherwise.
 */
export const SEND_WAITS_REASON = 'Nothing sent to another system can be taken back.';

/**
 * Why a write that came off a card needed no card: it had one, and the PM said
 * yes. The Activity row wants a reason like every other row, and this is the
 * one that is true for an approved write (docs/receipt-redesign.md RC-4).
 */
export const APPROVED_REASON = 'You approved it.';

/**
 * The four writes that wait, wherever they point. First rule that matches wins.
 *
 * 1. A send goes to Jira, Confluence, a calendar or mail, and the code has no
 *    compensating action for it. One card per send, every time (E-7). No flag
 *    and no other rule can reach past this one: `fileProposal` refuses the
 *    silent branch for a send as well, so two pieces of code have to be wrong
 *    before something leaves on its own.
 * 2. A delete takes a page away. Git can put the file back, but the links to it
 *    break the moment it goes, and one quiet line in the chat is too little for
 *    that.
 * 3. Qale assumed something. An unattended run out of questions picks an option
 *    and writes "Assumed:" in the rationale, and the rationale is only read on
 *    a card.
 * 4. The write rewrites prose the PM typed. What they asked for in the chat is
 *    the one exception: they said to change it, so a card would ask them to
 *    confirm their own instruction (E-4).
 */
function rulingThatWaits(facts: WriteFacts): WriteRuling | null {
  if (facts.kind === 'outbound') {
    return { disposition: 'ask', reason: SEND_WAITS_REASON };
  }
  if (facts.kind === 'delete') {
    return { disposition: 'ask', reason: 'A deleted page cannot be put back.' };
  }
  if (facts.assumed) {
    return { disposition: 'ask', reason: 'Qale assumed something here, so it waits for you.' };
  }
  if (facts.rewritesUserText && !facts.asked) {
    return { disposition: 'ask', reason: 'This rewrites what you wrote, so you see it first.' };
  }
  return null;
}

/**
 * Everything else lands. Git commits it, Activity keeps the row, and one press
 * puts it back, so a write that adds costs the PM nothing to have.
 *
 * A skill or an agent file is how Qale works, and the file is the record: the
 * PM reads it on the Skills page and changes it there. A rule they stated takes
 * its own reason, because "you said so" is the truer sentence for it.
 *
 * A todo lands too. The ledger is a list Qale keeps for the PM, nothing leaves
 * the machine, and nobody else sees it.
 *
 * A decision is append-only: a wrong one is never edited, it is superseded by
 * the next, so a card buys nothing.
 *
 * A kind nobody has graded yet asks. Asking is the answer that cannot surprise
 * anyone, so a new card kind starts there and is graded on purpose.
 */
function rulingThatLands(facts: WriteFacts): WriteRuling {
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
  if (isTodo(facts)) {
    return { disposition: 'silent', reason: 'Your list stays on your machine, for you to read.' };
  }
  if (facts.kind === 'note') {
    return { disposition: 'silent', reason: 'A new page takes nothing away.' };
  }
  if (facts.kind === 'update' && facts.appendOnly) {
    return { disposition: 'silent', reason: 'It adds at the end and rewrites nothing.' };
  }
  if (facts.kind === 'update') {
    return {
      disposition: 'silent',
      reason: 'It rewrites nothing you wrote, and one press puts it back.',
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

/** What happens to one write. What waits is asked first, and the rest lands. */
export function writePolicy(facts: WriteFacts): WriteRuling {
  return rulingThatWaits(facts) ?? rulingThatLands(facts);
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

/** One half of the policy, ready to render. */
export interface WritePolicyPlace {
  /** Which answer this block holds. For keys and tests, never shown. */
  place: 'lands' | 'waits';
  /** The heading a person reads. */
  title: string;
  rows: WritePolicyRow[];
}

/**
 * The writes the screen explains, in the order it lists them. Each row is a
 * real set of facts, so the answer beside it comes from the policy and not from
 * a copy of it.
 */
interface ExplainedWrite {
  what: string;
  facts: WriteFacts;
}

/** What applies on the spot. The part nobody would guess, so it comes first. */
const LANDS: readonly ExplainedWrite[] = [
  {
    what: 'A meeting page written up from a transcript',
    facts: { kind: 'note', noteType: 'meeting', targetPath: 'meetings/2026-09-04-nordkap.md' },
  },
  {
    what: 'A to-do, yours or one you are waiting on',
    facts: { kind: 'note', noteType: 'todo', targetPath: 'todos/2026-09-07-send-the-dates.md' },
  },
  {
    what: 'A to-do closed, or moved to another day',
    facts: { kind: 'update', noteType: 'todo', targetPath: 'todos/2026-09-07-send-the-dates.md' },
  },
  {
    what: 'A new document',
    facts: { kind: 'note', targetPath: 'notes/pricing-brief.md' },
  },
  {
    what: 'Text added at the end of a document or a meeting page',
    facts: { kind: 'update', appendOnly: true, targetPath: 'notes/rollout-runbook.md' },
  },
  {
    what: 'A new page Qale keeps: an insight, a customer, a person, a research or about page',
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

/** What comes to you as a card first. */
const WAITS: readonly ExplainedWrite[] = [
  {
    what: 'Anything sent to Jira, Confluence or the calendar',
    facts: { kind: 'outbound' },
  },
  { what: 'Deleting a page, wherever it sits', facts: { kind: 'delete' } },
  {
    what: 'A rewrite of something you wrote, in a document or in your meeting notes',
    facts: { kind: 'update', rewritesUserText: true, targetPath: 'notes/rollout-runbook.md' },
  },
  {
    what: 'Anything Qale had to assume, because it could not ask you',
    facts: { kind: 'update', assumed: true, targetPath: 'research/pricing.md' },
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
 * straight to the file, wherever it sits. See {@link DERIVED_LABEL_FIELDS}.
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
 * The policy as two readable lists, one per answer, for the Settings section
 * that says what Qale does on its own (docs/background-system.md ticket 6).
 *
 * Every row asks {@link writePolicy} the question it stands for, so the screen
 * cannot drift from the rule. The two label rows are the stated exception: no
 * pass consults the policy, so their sentences are written here in the same
 * voice. They land, so they sit on the first list.
 */
export function describeWritePolicy(): WritePolicyPlace[] {
  const rowsFor = (writes: readonly ExplainedWrite[]): WritePolicyRow[] =>
    writes.map(({ what, facts }) => {
      const { disposition, reason } = writePolicy(facts);
      return { what, disposition, reason };
    });
  return [
    {
      place: 'lands',
      title: 'What lands',
      rows: [...rowsFor(LANDS), ...MACHINERY_ROWS.map((row) => ({ ...row }))],
    },
    { place: 'waits', title: 'What waits for you', rows: rowsFor(WAITS) },
  ];
}
