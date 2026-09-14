import { APPLIED_VERBS, titleForRef, type AppliedVerb } from './card-copy.js';
import { isStyleFile } from './policy.js';

/**
 * The receipt for a write nobody was asked about (docs/easier-tickets.md E-9).
 *
 * Silence is only earned if it is visible afterwards. Every write the policy
 * lets through without a card leaves one row here: first person, past tense,
 * what changed, where, when, and enough to put it back.
 *
 * The shape is fixed here, in the domain, because three sides read it: the store
 * that keeps it (`@qale/vault`), the view that lists it (workstream B2) and the
 * revert path that undoes it (workstream A1).
 */

/** What the agent did, in one word. */
export const ACTIVITY_ACTIONS = [
  'created',
  'updated',
  'remembered',
  'deleted',
  /** A maintenance pass put a retrieval label on a page: a summary, tags, or both. */
  'labelled',
  /**
   * Qale worked out how the PM works and wrote it down: a voice, the Jira or
   * Confluence file, the "What you want from Qale" list, or a rule it took from
   * a draft the PM corrected (docs/learning-how-you-work.md ticket 12).
   *
   * Apart from 'remembered', which is a rule the PM stated in the chat. The
   * difference is who said it: 'remembered' repeats the PM, 'learned' is Qale's
   * own reading of their work, so it is the one the PM may want to correct.
   */
  'learned',
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

/** How a row is put back. */
export type ActivityUndo =
  /** The file did not exist before, so putting it back means removing it. */
  | 'delete'
  /** The file existed, so putting it back means its previous contents. */
  | 'restore';

/**
 * Everything needed to undo one row.
 *
 * `commit` is the vault commit the write landed in, read straight after it, so
 * the previous contents are its parent's. Null when the workspace is not a git
 * repo, which is the one case a row cannot promise a revert (E-1 makes that case
 * rare; it never makes it impossible).
 */
export interface ActivityRevert {
  commit: string | null;
  undo: ActivityUndo;
}

/** One thing the agent did on its own. */
export interface ActivityRecord {
  id: string;
  /**
   * The proposal this applied. Its payload is still the record of what changed.
   * Null when no proposal made the write: a maintenance pass writes retrieval
   * labels straight to the file, so there is no card behind the row.
   */
  proposalId: string | null;
  action: ActivityAction;
  /** First person, past tense, one line: "I created the Nordkap SSO write-up." */
  line: string;
  /** Why it needed no card, in the policy's words. */
  reason: string;
  /** The note it wrote, as a vault path. Null when nothing landed in the vault. */
  path: string | null;
  /**
   * The session that did it, so the row can open the chat it came from. Null
   * when a maintenance pass wrote it, because no chat was running.
   */
  sessionId: string | null;
  /** The skill in force when it happened. */
  skill: string | null;
  /** When, in unix ms. */
  at: number;
  revert: ActivityRevert;
  /** Set once the row has been put back, so it is not offered twice. */
  reverted: number | null;
}

/** What a new row carries. The store mints the id and stamps the time. */
export type CreateActivityInput = Omit<ActivityRecord, 'id' | 'at' | 'reverted'>;

/**
 * Where Qale learned something goes on the record.
 *
 * A caller that knows the write taught Qale something says so here, and the row
 * is a 'learned' one whatever the path says. The three callers are the first
 * read of Jira or Confluence, the style the PM picked, and the correction router
 * turning a corrected draft into a rule.
 */
export interface LearnedSource {
  /** What Qale now knows, one sentence: "Exec updates: one paragraph, result first." */
  what?: string;
  /** Where it came from: "the style you copied on 5 September". */
  from: string;
}

/** What the line is written from. All of it is on the proposal already. */
export interface ActivityLineInput {
  kind: string;
  targetPath?: string | null;
  frontmatter?: Record<string, unknown>;
  /** An update's appended text, or a new file's body, for reading a rule back. */
  append?: string;
  body?: string;
  /** Set when the caller knows this write taught Qale how the PM works. */
  learned?: LearnedSource;
}

/** The title a payload calls itself, or the file's name as a fallback. */
function subjectOf(input: ActivityLineInput): string {
  const fm = input.frontmatter ?? {};
  const title = typeof fm['title'] === 'string' ? fm['title'].trim() : '';
  const summary = typeof fm['summary'] === 'string' ? fm['summary'].trim() : '';
  return title || summary || titleForRef(input.targetPath) || 'a page';
}

/** A file that says how the app behaves. Rules land in these and nowhere else. */
function isRuleFile(path: string | null | undefined): boolean {
  return !!path && (path.startsWith('skills/') || path.startsWith('agents/'));
}

/**
 * The heading the "What you want from Qale" list sits under, in the house rules.
 *
 * One string, exported, because three sides have to agree on it: the shipped
 * house rules that carry the section, the tool that adds and removes a line, and
 * this file, which reads an appended bullet back to say what kind of write it
 * was.
 */
export const WANT_LIST_HEADING = '## What you want from Qale';

/**
 * Does this appended text put its last bullet under the given heading?
 *
 * A rule appended to a section that is not last carries the heading with it, so
 * the text says where it lands. A whole file written at once carries the heading
 * too, but with other headings after it, and there the bullet lands somewhere
 * else. The last heading in the text is the one the bullet is under.
 */
function landsUnder(text: string | undefined, heading: string): boolean {
  if (!text) return false;
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? '').trim();
    if (!/^#{1,6}\s/.test(line)) continue;
    return line === heading;
  }
  return false;
}

/**
 * A write that taught Qale how the PM works: into a style file (a voice, the
 * Jira or Confluence file) or into the "What you want from Qale" list. The
 * write policy owns which files those are, so both sides read one list.
 */
function isLearnedWrite(input: ActivityLineInput): boolean {
  if (isStyleFile(input.targetPath)) return true;
  return landsUnder(input.append ?? input.body, WANT_LIST_HEADING);
}

/**
 * The rule a standing instruction added, read back out of the text it appends.
 * `propose_instruction` always writes it as the last bullet, so the last bullet
 * is the rule.
 */
export function ruleFromText(text: string | undefined): string {
  if (!text) return '';
  const bullets = text
    .split('\n')
    .map((line) => /^\s*-\s+(.*\S)\s*$/.exec(line)?.[1])
    .filter((r): r is string => !!r);
  return bullets.at(-1) ?? '';
}

/** What one write did, in one word. */
export function activityAction(input: ActivityLineInput): ActivityAction {
  if (input.kind === 'delete') return 'deleted';
  // What Qale worked out, before what the PM said: a rule bullet in the Jira
  // file is Qale reading their tickets, not the PM stating a rule.
  if (input.learned || isLearnedWrite(input)) return 'learned';
  if (isRuleFile(input.targetPath) && ruleFromText(input.append ?? input.body)) return 'remembered';
  return input.kind === 'update' ? 'updated' : 'created';
}

/** The opener on a learned row, so the PM reads it as an answer and not a report. */
const GOT_IT = 'Got it.';

/**
 * The row's sentence with its opener taken off, for a list that already says
 * these are things Qale learned. The Skills page shows this under each file.
 *
 * A rule the PM stated opens the same way in its own words, so it is trimmed
 * here too: both kinds of row end up as the thing itself.
 */
export function learnedSummary(line: string): string {
  const rest = line.startsWith(GOT_IT) ? line.slice(GOT_IT.length) : line;
  return rest.replace(/^\s*I remembered a rule:\s*/, '').trim();
}

/** What one learned write says, in the words the chat says back to the PM. */
function learnedLine(input: ActivityLineInput): string {
  const said = input.learned?.what?.trim() || ruleFromText(input.append ?? input.body);
  const detail = said || `I wrote it down in ${subjectOf(input)}`;
  return `${GOT_IT} ${/[.!?]$/.test(detail) ? detail : `${detail}.`}`;
}

/**
 * The Activity row's own sentence. First person and past tense, because the row
 * is the agent reporting what it did, not a card asking for anything.
 */
export function activityLine(input: ActivityLineInput): string {
  const subject = subjectOf(input);
  switch (activityAction(input)) {
    case 'deleted':
      return `I deleted ${subject}.`;
    case 'learned':
      return learnedLine(input);
    case 'remembered':
      return `I remembered a rule: ${ruleFromText(input.append ?? input.body)}`;
    case 'updated':
      return `I updated ${subject}.`;
    default:
      return input.kind === 'decision'
        ? `I recorded a decision: ${subject}.`
        : `I created ${subject}.`;
  }
}

/** One thing Qale learned, and the file it went into. */
export interface LearnedWrite extends LearnedSource {
  /** The file it was written into, as a vault path. */
  path: string;
  /** What Qale now knows, one sentence. */
  what: string;
  /** The session that learned it, when a chat was running. */
  sessionId?: string | null;
  /** The skill in force at the time. */
  skill?: string | null;
  /** The card it applied, when a card was filed for it. */
  proposalId?: string | null;
}

/**
 * The Activity row for something Qale learned about how the PM works
 * (docs/learning-how-you-work.md ticket 12).
 *
 * One function, so the three callers say it the same way: the first read of
 * Jira or Confluence, the style the PM picked, and a line added to or taken off
 * the "What you want from Qale" list. Feed it straight to `recordActivityRow`,
 * which stamps the commit the write landed in:
 *
 *     await recordActivityRow(ctx, learnedRow({ ... }), 'restore');
 *
 * The line is what the chat says back to the PM, word for word, so the receipt
 * and the row can never say two different things about one write.
 */
export function learnedRow(input: LearnedWrite): Omit<CreateActivityInput, 'revert'> {
  return {
    proposalId: input.proposalId ?? null,
    action: 'learned',
    line: learnedLine({ kind: 'update', targetPath: input.path, learned: input }),
    reason: `from ${input.from}`,
    path: input.path,
    sessionId: input.sessionId ?? null,
    skill: input.skill ?? null,
  };
}

/** What one pass wrote on one page. */
export interface LabelLineInput {
  /** The page's title, as the row names it. */
  title: string;
  /** The summary line the pass wrote, or null when it wrote none. */
  summary: string | null;
  /** The tags the pass wrote. Empty when it wrote none. */
  tags: readonly string[];
}

/**
 * The Activity row for a retrieval label. Same voice as {@link activityLine}:
 * first person, past tense, one line.
 *
 * Tags are named, a summary is not. A tag is one word the PM can weigh at a
 * glance, and it is what decides whether the page is found. The summary line is
 * a sentence, and the page itself says it better than a receipt can.
 */
export function labelLine(input: LabelLineInput): string {
  const tags = input.tags.filter((t) => t.trim().length > 0);
  const count = tags.length === 1 ? 'a tag' : `${tags.length} tags`;
  if (input.summary && tags.length > 0) {
    return `I added a summary and ${count} to ${input.title}: ${tags.join(', ')}.`;
  }
  if (input.summary) return `I added a summary to ${input.title}.`;
  return `I tagged ${input.title}: ${tags.join(', ')}.`;
}

/**
 * The quiet line the chat shows for a write that applied on its own.
 *
 * It rides back to the model as the tool's own result, which is also what the
 * session view reads it out of. One string, written once, so the trail and the
 * model can never say two different things about the same write.
 */
const APPLIED_VERB: Record<ActivityAction, string> = {
  created: 'Created',
  updated: 'Updated',
  remembered: 'Added to rules',
  deleted: 'Deleted',
  labelled: 'Labelled',
  learned: 'Learned',
};

const APPLIED_TAG = 'Applied:';

/** The first line of what a silently applied write reports back. */
export function appliedReceipt(action: ActivityAction, subject: string): string {
  const detail = subject.replace(/\s+/g, ' ').trim();
  return `${APPLIED_TAG} ${APPLIED_VERB[action]}${detail ? ` ${detail}` : ''}`;
}

/**
 * The row the chat draws for a write that landed (docs/fewer-approvals.md FA-4).
 *
 * The prose above says what happened, for the model. This says the same write in
 * fields, for the receipt block: the page to open, the way back, and the change
 * in one line. Both ride in one tool result, so the chat and the model can never
 * describe one write two ways.
 */
export interface AppliedRow {
  /** The Activity row to undo. Absent when the workspace kept no history. */
  activityId?: string;
  /** The card the write applied, so the row can draw its diff. */
  proposalId?: string;
  /** The note it wrote. */
  path?: string;
  /** The note's own title, as the row names it. */
  title?: string;
  /** New, Changed, Done, Removed, Sent, or one of the three to-do words. */
  verb: AppliedVerb;
  /** What changed, in one line: "summary, 3 next steps". */
  change?: string;
}

/**
 * The machine-readable half of a landed receipt, on its own last line.
 *
 * It says so in its own words rather than in a rule somewhere else, because the
 * model reads this line before it reads anything about it.
 */
const ROW_OPEN = '<!-- qale:landed (for the app, not for you) ';
const ROW_CLOSE = ' -->';

/** That line, for a tool result to append. Empty for a write that landed
 *  nothing a row could point at. */
export function appliedRowLine(row: AppliedRow | undefined): string {
  if (!row) return '';
  const packed: Record<string, unknown> = { verb: row.verb };
  if (row.activityId) packed['activityId'] = row.activityId;
  if (row.proposalId) packed['proposalId'] = row.proposalId;
  if (row.path) packed['path'] = row.path;
  if (row.title) packed['title'] = row.title;
  if (row.change) packed['change'] = row.change;
  return `${ROW_OPEN}${JSON.stringify(packed)}${ROW_CLOSE}`;
}

/** Read that line back. Null for a result written before FA-4, which is why a
 *  row from an old session shows with no way back. */
function readAppliedRow(output: string): AppliedRow | null {
  const start = output.lastIndexOf(ROW_OPEN);
  if (start === -1) return null;
  const end = output.indexOf(ROW_CLOSE, start);
  if (end === -1) return null;
  try {
    const parsed: unknown = JSON.parse(output.slice(start + ROW_OPEN.length, end));
    if (!parsed || typeof parsed !== 'object') return null;
    const row = parsed as AppliedRow;
    return APPLIED_VERBS.includes(row.verb) ? row : null;
  } catch {
    return null;
  }
}

/** What one tool result says about a write that landed. */
export interface AppliedReceipt {
  /** The prose verb from the first line: "Created", "Added to rules". */
  verb: string;
  /** What the prose names after the verb. */
  detail?: string;
  /** The fields the receipt block draws. Absent on a result from before FA-4. */
  row?: AppliedRow;
}

/**
 * Read a landed write back out of a tool result, for the receipt block in the
 * chat. Null when the write is still waiting on the PM, which is every other
 * case.
 */
export function readAppliedReceipt(output: string | undefined): AppliedReceipt | null {
  if (!output) return null;
  const first = output.split('\n')[0] ?? '';
  if (!first.startsWith(APPLIED_TAG)) return null;
  const rest = first.slice(APPLIED_TAG.length).trim().replace(/\.$/, '');
  const verb = (Object.values(APPLIED_VERB) as string[]).find(
    (v) => rest === v || rest.startsWith(`${v} `),
  );
  if (!verb) return null;
  const detail = rest.slice(verb.length).trim();
  const row = readAppliedRow(output);
  return { verb, ...(detail ? { detail } : {}), ...(row ? { row } : {}) };
}
