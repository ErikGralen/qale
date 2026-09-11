import { normalizeLinkTarget, readAppliedReceipt, titleFromSlug } from '@qale/domain';
import { landedWrite } from './receipt-block';
import { isToolPart, toolInputOf, toolNameOf, type AnyPart } from './turn-parts';

/**
 * What the folded work trail says about one turn (docs/chat-order.md).
 *
 * The trail is provenance, not a second receipt. A step that already has a
 * surface of its own on screen is left out of it: a write that landed draws as
 * a row under the trail, a proposal draws as a card at the foot of the session,
 * a draft draws as its own panel. Saying the same write twice made the trail
 * read as the place where things happen, which it is not.
 *
 * What is left is the work nothing else shows: the thinking, the reads, the
 * searches, the odd step in between, and anything that failed. A failure has no
 * row anywhere, so it always stays here.
 *
 * The drawing lives in SessionView. This file is the words, kept apart so they
 * can be read and tested without React.
 */

/** A step the agent gave up on. The bridge turns pi's `isError` result into a
 *  `tool-output-error` chunk, which useChat lands on the part as that state plus
 *  an `errorText`; either one is enough to call it failed. */
export function isFailedStep(part: AnyPart): boolean {
  return part.state === 'output-error' || part.errorText !== undefined;
}

/** Steps that look for something rather than hand back one page. */
const SEARCHES = new Set([
  'search_vault',
  'vault_grep',
  'vault_backlinks',
  'vault_list',
  // An outline is orientation, not content: it hands back a heading tree, and
  // the note itself only counts as read once a vault_read returns some of it.
  'vault_outline',
]);

/**
 * Whether a step draws in the trail.
 *
 * A write that landed, a proposal, and a draft all draw somewhere else, so they
 * are left out. A failed step of any kind stays, because nothing else on screen
 * says it happened.
 */
export function showsInTrail(part: AnyPart): boolean {
  if (part.type === 'reasoning') return (part.text ?? '').trim() !== '';
  if (!isToolPart(part)) return false;
  if (isFailedStep(part)) return true;
  if (landedWrite(part)) return false;
  const name = toolNameOf(part);
  // A proposal waits as a card and then reads back as a line in the review; a
  // draft is its own panel. Both keep their own place in the chat.
  return !name.startsWith('propose_') && !name.startsWith('draft_');
}

/** The parts of one trail that draw, in the order they happened. */
export function trailSteps(parts: readonly AnyPart[]): AnyPart[] {
  return parts.filter(showsInTrail);
}

/** How many steps in one trail failed. */
export function failedSteps(parts: readonly AnyPart[]): number {
  return parts.filter((part) => isToolPart(part) && isFailedStep(part)).length;
}

const WIKILINK = /\[\[([^\]]+)\]\]/g;
const TICKET_KEY = /^[A-Z][A-Z0-9]*-\d+$/;

/**
 * A label with its `[[wikilinks]]` read the way the rest of the app reads them.
 *
 * A trail label is plain text in a one-line row, so a raw link leaks the file
 * layout into a sentence ("waiting on [[people/marcus-holm]]"). The title is
 * what the PM knows the page by, and a ticket key is already its own name.
 */
export function stripLinks(text: string): string {
  return text.replace(WIKILINK, (_all, inner: string) => {
    const { target, alias } = normalizeLinkTarget(inner);
    if (alias) return alias;
    const name = target.split('/').pop() ?? target;
    return TICKET_KEY.test(name) ? name : titleFromSlug(target);
  });
}

/**
 * Past tenses that don't take the -ed → -ing rule, plus the vague fallback:
 * "Tried a step" says more than "Tried working" would.
 */
const GERUNDS: Record<string, string> = {
  Read: 'reading',
  Wrote: 'writing',
  Ran: 'running',
  Worked: 'a step',
};

/**
 * The third tense. A failed step reads "Tried reading", never "Read", so a run
 * that tried three times and gave up can't be mistaken for a run that did three
 * things. Derived from the past-tense verb rather than a third column in the
 * table below, so a new tool still only needs one entry.
 */
export function triedVerb(verb: string): string {
  const [head = '', ...rest] = verb.split(' ');
  const gerund =
    GERUNDS[head] ?? (head.endsWith('ed') ? `${head.slice(0, -2)}ing` : head).toLowerCase();
  return ['Tried', gerund, ...rest].join(' ');
}

/** One step in the expanded trail: a past-tense verb, the thing it acted on,
 *  and the page behind it when there is one to open. */
export interface StepLabel {
  verb: string;
  detail?: string;
  /** The note the detail names, for the chip that opens it. */
  path?: string;
}

/** Past-tense verb + the thing it acted on, for one step in the expanded trail. */
export function stepLabel(part: AnyPart): StepLabel {
  const label = doneLabel(part);
  const detail = label.detail ? stripLinks(label.detail) : undefined;
  const verb = isFailedStep(part) ? triedVerb(label.verb) : label.verb;
  return { ...label, verb, ...(detail ? { detail } : {}) };
}

/**
 * The write that applied on its own, if this step was one.
 *
 * A landed write leaves the trail (see {@link showsInTrail}), so this is only
 * reached by a step the trail still draws. It stays because a result filed
 * before the rows existed can still carry the prose.
 */
function appliedLabel(part: AnyPart): StepLabel | null {
  if (isFailedStep(part) || typeof part.output !== 'string') return null;
  const receipt = readAppliedReceipt(part.output);
  if (!receipt) return null;
  return receipt.detail ? { verb: receipt.verb, detail: receipt.detail } : { verb: receipt.verb };
}

/** The verb table: one entry per tool, past tense, plain and sentence case. */
function doneLabel(part: AnyPart): StepLabel {
  const name = toolNameOf(part);
  const input = toolInputOf(part);
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined);
  switch (name) {
    case 'vault_read':
      // The note it read, by name. The trail is provenance the PM reads, so a
      // path here would be the one place in the app that still spells storage.
      return page('Read', str('path'));
    case 'vault_outline':
      return page('Skimmed', str('path'));
    case 'search_vault':
      return { verb: 'Searched', detail: str('query') && `“${str('query')}”` };
    case 'vault_grep':
      return { verb: 'Scanned for', detail: str('pattern') && `“${str('pattern')}”` };
    case 'vault_backlinks':
      return page('Followed links to', str('path'));
    case 'vault_list':
      return {
        verb: 'Listed notes',
        detail: [str('type'), str('lifecycle')].filter(Boolean).join('/') || undefined,
      };
    case 'jira_search':
      return { verb: 'Searched Jira', detail: str('jql') ?? str('query') };
    case 'jira_get_issue':
      return { verb: 'Read Jira issue', detail: str('key') ?? str('issueKey') };
    case 'confluence_search':
      return { verb: 'Searched Confluence', detail: str('query') ?? str('cql') };
    case 'confluence_get_page':
      return { verb: 'Read Confluence page', detail: str('title') ?? str('id') };
    case 'use_skill':
      return { verb: 'Loaded skill', detail: str('name') };
    case 'spawn':
      return { verb: 'Split the work up' };
    case 'ask_user': {
      const questions = Array.isArray(input.questions)
        ? (input.questions as { header?: string }[])
        : [];
      return {
        verb: 'Raised a question',
        detail:
          questions
            .map((q) => q.header)
            .filter(Boolean)
            .join(', ') || undefined,
      };
    }
    case 'get_voice':
      return { verb: 'Read a voice', detail: str('name') };
    // Only ever seen here when the call had nothing to show (still streaming,
    // or malformed) — a usable one renders as its own panel in the chat.
    case 'draft_text':
      return { verb: 'Wrote a draft', detail: str('title') };
    // Only ever visible on a session a person started, where the tool is a
    // no-op: a scheduled run that ends quietly leaves no session to open.
    case 'end_quietly':
      return { verb: 'Asked to end quietly' };
    case 'file_source': {
      const files = Array.isArray(input.files) ? (input.files as string[]) : [];
      const what = str('as') === 'meeting' ? 'the recording' : 'the source';
      return {
        verb: `Filed ${what}`,
        detail: files.length > 1 ? `${files.length} files` : undefined,
      };
    }
    case 'refile_source':
      return page('Refiled', str('path'));
    case 'check_claims': {
      const claims = Array.isArray(input.claims) ? input.claims.length : 0;
      return { verb: 'Checked claims', detail: claims > 0 ? `${claims}` : undefined };
    }
    case 'ask_codebase':
      return { verb: 'Asked the codebase', detail: str('question') };
    case 'track_external':
      return { verb: 'Started tracking', detail: str('external_id') };
    case 'follow_container':
      return {
        verb: input.follow === false ? 'Left unfollowed' : 'Started following',
        detail: str('container_id'),
      };
    case 'record_deferral':
      return { verb: 'Noted what was left for later' };
    case 'withdraw_proposal':
      return { verb: 'Withdrew a card', detail: str('reason') };
    case 'files_write':
    case 'write_result':
      return { verb: 'Wrote', detail: str('path') };
    case 'files_edit':
      return { verb: 'Edited', detail: str('path') };
    case 'files_read':
      return { verb: 'Read session file', detail: str('path') };
    case 'files_list':
      return { verb: 'Listed session files' };
    // The write tools name no system: the handler resolves the provider from
    // the container or the mirror (PD-9).
    case 'draft_ticket':
      return { verb: 'Drafted a ticket', detail: str('title') };
    case 'draft_ticket_comment':
      return { verb: 'Drafted a comment', detail: str('ticket') };
    case 'draft_page_update':
      return { verb: 'Drafted a page update', detail: str('page') };
    // Retired tool names, kept for replay: sessions filed before the write tools
    // went provider-blind still carry these calls, and the trail is what the PM
    // reads back months later.
    case 'draft_jira_issue':
      return { verb: 'Drafted a ticket', detail: str('summary') };
    case 'draft_jira_comment':
      return { verb: 'Drafted a comment', detail: str('issueKey') };
    case 'draft_confluence_update':
      return { verb: 'Drafted a page update', detail: str('pageId') };
    // Retired tool. Kept for replay only: transcripts filed before checkpoints
    // were removed still contain these calls, and an old session must not
    // render a raw tool name.
    case 'advance_checkpoint':
      return { verb: 'Moved to the next step' };
    default:
      if (name.startsWith('propose_')) {
        // Most writes land without a card now, so the step says what happened
        // rather than what was asked for.
        const landed = appliedLabel(part);
        if (landed) return landed;
        return {
          verb: `Proposed a ${name.slice(8).replace(/_/g, ' ')}`,
          detail: str('title') ?? (str('path') && titleFromSlug(str('path')!)),
          ...(str('path') ? { path: str('path')! } : {}),
        };
      }
      if (name.startsWith('draft_'))
        return {
          verb: `Drafted a ${name.slice(6).replace(/_/g, ' ')}`,
          // A message draft carries a `subject` rather than a title (SK-7), and
          // it may be revising a card it already made.
          detail: str('title') ?? str('subject') ?? str('summary'),
        };
      // A tool shipped without an entry above. Vague beats wrong: the PM should
      // never be shown a raw tool name (`draft_calendar_rsvp`), and a machine
      // name in the detail slot would be the same leak by another door.
      return { verb: 'Worked' };
  }
}

/** A step that acted on one note: the note by name, and the path behind it. */
function page(verb: string, path: string | undefined): StepLabel {
  if (!path) return { verb };
  return { verb, detail: titleFromSlug(path), path };
}

/** Present-tense label for the step currently running, shown on the collapsed row. */
export function liveLabel(part: AnyPart | undefined): string {
  if (!part || part.type === 'reasoning') return 'Thinking…';
  const name = toolNameOf(part);
  const input = toolInputOf(part);
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined);
  switch (name) {
    case 'vault_read':
      return str('path') ? `Reading ${titleFromSlug(str('path')!)}` : 'Reading the memory…';
    case 'vault_outline':
      return str('path') ? `Skimming ${titleFromSlug(str('path')!)}` : 'Skimming the memory…';
    case 'search_vault':
      return str('query') ? `Searching “${str('query')}”` : 'Searching the memory…';
    case 'vault_grep':
      return str('pattern') ? `Scanning for “${str('pattern')}”` : 'Scanning the memory…';
    case 'vault_backlinks':
      return str('path') ? `Following links to ${titleFromSlug(str('path')!)}` : 'Following links…';
    case 'vault_list':
      return 'Listing notes…';
    case 'draft_text':
      return 'Writing a draft…';
    case 'spawn':
      return 'Splitting the work up…';
    case 'ask_user':
      return 'Waiting on your answer…';
    case 'files_write':
    case 'files_edit':
    case 'write_result':
      return str('path') ? `Writing ${str('path')}` : 'Writing a session file…';
    case 'files_read':
    case 'files_list':
      return 'Reading its own notes…';
    case 'jira_search':
    case 'jira_get_issue':
      return 'Checking Jira…';
    case 'confluence_search':
    case 'confluence_get_page':
      return 'Checking Confluence…';
    default:
      if (name.startsWith('propose_') || name.startsWith('draft_')) return 'Drafting a proposal…';
      return 'Working…';
  }
}

/** Seconds as the PM would say them: `8s`, `47s`, `2m 5s`. */
export function humanSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** What one settled trail did, counted. */
interface TrailWork {
  /** Notes read, by title, first read first, each counted once. */
  notes: string[];
  /** Jira issues read, by key. */
  tickets: string[];
  /** Confluence pages read, by title or id. */
  pages: string[];
  /** Searches of the memory. */
  searches: number;
  /** The connected systems it searched, in the order it touched them. */
  checked: string[];
  /** Everything else, one short verb each, in order and without repeats. */
  others: string[];
  thought: boolean;
}

function countWork(parts: readonly AnyPart[]): TrailWork {
  const work: TrailWork = {
    notes: [],
    tickets: [],
    pages: [],
    searches: 0,
    checked: [],
    others: [],
    thought: false,
  };
  const add = (list: string[], value: string) => {
    if (!list.includes(value)) list.push(value);
  };
  for (const part of parts) {
    if (part.type === 'reasoning') {
      if ((part.text ?? '').trim()) work.thought = true;
      continue;
    }
    // A failure says nothing about what the run found. The failed count beside
    // the summary is the whole of what it gets.
    if (!isToolPart(part) || isFailedStep(part) || !showsInTrail(part)) continue;
    const name = toolNameOf(part);
    const input = toolInputOf(part);
    const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined);
    if (name === 'vault_read') add(work.notes, titleFromSlug(str('path') ?? 'a note'));
    else if (name === 'jira_get_issue')
      add(work.tickets, str('key') ?? str('issueKey') ?? 'a ticket');
    else if (name === 'confluence_get_page') add(work.pages, str('title') ?? str('id') ?? 'a page');
    else if (name === 'jira_search') add(work.checked, 'Jira');
    else if (name === 'confluence_search') add(work.checked, 'Confluence');
    else if (SEARCHES.has(name)) work.searches += 1;
    else {
      const other = otherVerb(part);
      if (other) add(work.others, other);
    }
  }
  return work;
}

/** One step that is none of the above, in the fewest words that are still true.
 *  A tool with no entry in the verb table has no words, so it stays out of the
 *  line: "did something else" told the PM nothing and read as a placeholder. */
function otherVerb(part: AnyPart): string | null {
  const { verb } = doneLabel(part);
  return verb === 'Worked' ? null : verb.toLowerCase();
}

/** "one and two", "one, two and three". */
function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** A handful of things by name, a crowd by number. Two names still read as
 *  names; three start to read as a list nobody asked for. */
function namedOrCounted(items: readonly string[], noun: string): string {
  if (items.length <= 2) return andList(items);
  return `${items.length} ${noun}s`;
}

/** "once" reads as a correction, so one search is just "searched". */
function times(count: number): string {
  if (count === 1) return 'searched';
  if (count === 2) return 'searched twice';
  return `searched ${count} times`;
}

/**
 * What the collapsed trail row says once the run has settled.
 *
 * It is a short sentence about what happened, not a noun with counts after it.
 * The clauses come in the order the PM cares about them: what it read, what it
 * checked outside the workspace, what it searched for, anything else, and how
 * long it took. A trail with nothing but thinking in it says so.
 */
export function trailSummary(parts: readonly AnyPart[], clock: string | null): string {
  const work = countWork(parts);
  const clauses: string[] = [];
  const reads = [
    work.notes.length > 0 ? namedOrCounted(work.notes, 'note') : '',
    work.tickets.length > 0 ? namedOrCounted(work.tickets, 'ticket') : '',
    work.pages.length > 0 ? namedOrCounted(work.pages, 'page') : '',
  ].filter(Boolean);
  if (reads.length > 0) clauses.push(`read ${andList(reads)}`);
  if (work.checked.length > 0) clauses.push(`checked ${andList(work.checked)}`);
  if (work.searches > 0) clauses.push(times(work.searches));
  // Three unnamed steps in a row is a list, and the expanded trail is where a
  // list belongs.
  if (work.others.length > 2) clauses.push(`${work.others[0]} and more`);
  else clauses.push(...work.others);
  // Nothing but thinking, or nothing but failures: the row still has to say
  // what the last few seconds were, and it reads as one sentence rather than
  // as a bare word with a number after it.
  if (clauses.length === 0) {
    const bare = work.thought ? 'Thought' : 'Worked';
    return clock ? `${bare} for ${clock}` : bare;
  }
  const said = clauses.map((c, i) => (i === 0 ? c.charAt(0).toUpperCase() + c.slice(1) : c));
  // The clock is the last thing in the row, because it is the one thing the PM
  // was watching a second ago and the first they stop caring about.
  if (clock) said.push(clock);
  return said.join(' · ');
}
