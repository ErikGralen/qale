/**
 * A recording becomes a script (docs/plan-demo-replay.md, section 4.7).
 *
 * `pnpm demo:draft` runs this over one or more recordings from the same
 * scenario and writes a `Scenario` a person edits from there. Every
 * multi-turn session recording becomes one `Conversation`; the single-turn
 * cheap calls (naming, a claim lookup, a document summary, a folder purpose)
 * are never scripted as turns. A claim or summary recording instead feeds
 * `lookups`, and naming is skipped, because the script says its own title.
 *
 * What the converter throws away on purpose: thinking blocks (never
 * replayed), read tools (the fast-ingest goal in section 4.6, where a script
 * should not pay for the exploration a real run already did), and
 * `check_claims` (its own cost is 4 to 8 model calls). What it keeps no
 * matter what: `get_voice`, because a draft tool call the session never read
 * a voice for is refused by the real tools (`tools.ts:2881, 2918`), and every
 * write.
 *
 * Dates: a recording is dated on the day it was made (`offsetDays` from the
 * anchor). A script is anchor-dated, so every date the recording carries is
 * un-slid by that same number before it is written out. A date inside a path
 * or a wikilink is different: most of those names are permanent (a decision
 * from the seed), and un-sliding them would rename a page that never moves.
 * The ones that are not permanent are pages the demo itself writes fresh
 * each run (a calendar mirror for this week's meeting, a `sources/` page
 * `file_source` just created), and those need a template so the script keeps
 * working on a different demo day. The signal this module uses to tell them
 * apart is recency: a path dated within `MIRROR_WINDOW_DAYS` of the record
 * day reads as "this week's", so it is templated; a path dated further back
 * reads as a standing part of the seed, so it is left exactly as recorded.
 */
import { CHECK_CLAIMS_TOOL_NAME, CHILD_PREAMBLE, WITHDRAW_TOOL_NAME, stripCardState } from '@qale/agent';
import { parseKickoff } from '@qale/sessions';
import { cheapKind } from './cheap-answers.js';
import { shiftDay, shiftDatesInText } from './replay-dates.js';
import type { ContentBlock, Recording, WireMessage } from './replay-recordings.js';
import type { Conversation, Scenario, Trigger, Turn } from './scenario.js';

/** A tool call the session made and never has to run again to draft from. */
const ASK_USER_TOOL_NAME = 'ask_user';

/** Dropped unless `keepReads`. Read tools carry no state a script cannot recreate cheaply. */
const READ_TOOL_NAMES = new Set([
  'vault_read',
  'vault_list',
  'vault_grep',
  'search_vault',
  'vault_backlinks',
  'files_list',
  'files_read',
]);
const READ_TOOL_PREFIXES = ['jira_', 'confluence_', 'calendar_'];

function isReadTool(name: string): boolean {
  return READ_TOOL_NAMES.has(name) || READ_TOOL_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * How close to the record day a path's date has to be to read as "this
 * week's" rather than a standing part of the seed. Wide enough to catch a
 * meeting mirror dated a day or two back, narrow enough that a decision from
 * months before the record day is left alone.
 */
const MIRROR_WINDOW_DAYS = 14;

export interface DraftOptions {
  /** Every recording drawn on for this scenario: sessions, claims, summaries. */
  recordings: Recording[];
  scenarioId: string;
  /** Scenario title. Defaults to the scenario id; the author names it properly. */
  title?: string;
  /** Keep read tools in the script instead of dropping them. */
  keepReads?: boolean;
  /** Keep `check_claims` calls in the script instead of dropping them. */
  keepClaims?: boolean;
  /** The anchor date `vault-dev/` calls "today" (`ANCHOR` in `@qale/domain/demo`). */
  anchor: string;
}

export interface DraftResult {
  scenario: Scenario;
  /** Things the draft could not make stable on its own; the author decides each. */
  flags: string[];
}

const TODO_DO = 'TODO: say what the presenter does to start this scenario.';

export function draftScenario(opts: DraftOptions): DraftResult {
  const flags: string[] = [];
  const conversations: Conversation[] = [];
  const claims: Record<string, string> = {};
  const summaries: Record<string, string> = {};

  for (const recording of opts.recordings) {
    const first = recording.turns[0];
    if (!first) continue;
    const offsetDays = recording.offsetDays ?? 0;
    const kind = cheapKind(first.request.system);
    if (kind === 'claim') {
      addClaim(claims, first, offsetDays, opts.anchor);
      continue;
    }
    if (kind === 'summary' || kind === 'folder') {
      addSummary(summaries, first, offsetDays, opts.anchor);
      continue;
    }
    if (kind === 'naming') continue; // the script's own `title` answers this; nothing to draft.

    conversations.push(
      buildConversation(recording, offsetDays, opts, conversations.length, flags),
    );
  }

  const scenario: Scenario = {
    version: 1,
    id: opts.scenarioId,
    title: opts.title?.trim() || opts.scenarioId,
    do: TODO_DO,
    draft: true,
    ...(Object.keys(claims).length || Object.keys(summaries).length
      ? { lookups: { ...(Object.keys(claims).length ? { claims } : {}), ...(Object.keys(summaries).length ? { summaries } : {}) } }
      : {}),
    conversations,
  };
  if (opts.recordings.length && conversations.length === 0)
    flags.push('none of the recordings given had more than one turn, so there is nothing to draft as a conversation');
  flags.push(`do: ${TODO_DO}`);
  return { scenario, flags };
}

// ---------------------------------------------------------------------------
// Claims and summaries
// ---------------------------------------------------------------------------

function addClaim(
  claims: Record<string, string>,
  turn: Recording['turns'][number],
  offsetDays: number,
  anchor: string,
): void {
  const user = typedText(turn.request.messages.find((m) => m.role === 'user'));
  const claimText = /^Claim: (.*)$/m.exec(user)?.[1]?.trim();
  const answer = textOf(turn.response.content);
  if (!claimText || !answer) return;
  claims[claimText] = unslideText(answer, offsetDays, anchor);
}

function addSummary(
  summaries: Record<string, string>,
  turn: Recording['turns'][number],
  offsetDays: number,
  anchor: string,
): void {
  const user = typedText(turn.request.messages.find((m) => m.role === 'user'));
  const origin = /<<<\s*EXTERNAL_MATERIAL\b[^\n]*origin="([^"\n]*)"/.exec(user)?.[1];
  const answer = textOf(turn.response.content);
  if (!origin || !answer) return;
  summaries[unslideText(origin, offsetDays, anchor)] = unslideText(answer, offsetDays, anchor);
}

// ---------------------------------------------------------------------------
// Sessions -> conversations
// ---------------------------------------------------------------------------

function buildConversation(
  recording: Recording,
  offsetDays: number,
  opts: DraftOptions,
  index: number,
  flags: string[],
): Conversation {
  const firstMessage = recording.turns[0]?.request.messages.find((m) => m.role === 'user');
  const firstText = stripCardState(typedText(firstMessage)).trim();
  const system = recording.turns[0]?.request.system ?? '';
  const trigger = triggerFor(firstText, system);
  const id = `c${index + 1}`;
  const label = `conversation "${id}" (from ${recording.key})`;

  const turns: Turn[] = [];
  recording.turns.forEach((recordedTurn, turnIndex) => {
    const blocks = recordedTurn.response.content;
    const text = blocks
      .filter((b): b is ContentBlock & { type: 'text'; text: string } => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n\n');
    const toolBlocks = blocks.filter(
      (b): b is ContentBlock & { type: 'tool_use'; name: string; input: Record<string, unknown> } =>
        b.type === 'tool_use' && typeof b.name === 'string',
    );
    const tools = toolBlocks.filter((tool) => {
      if (isReadTool(tool.name)) return !!opts.keepReads;
      if (tool.name === CHECK_CLAIMS_TOOL_NAME) return !!opts.keepClaims;
      return true;
    });

    flagTool(tools, label, turnIndex, flags);
    flagToolResultDependency(recordedTurn.request.messages, tools, label, turnIndex, flags);

    const draftText = text ? unslideText(text, offsetDays, opts.anchor) : undefined;
    const draftTools = tools.map((tool) => ({
      name: tool.name,
      input: unslideDeep(tool.input, offsetDays, opts.anchor) as Record<string, unknown>,
    }));

    if (!draftText && draftTools.length === 0) return; // empty after filtering: merges into the next turn.

    const turn: Turn = {};
    if (draftText) {
      const lines = draftText.split('\n');
      turn.text = lines.length > 1 ? lines : draftText;
    }
    if (draftTools.length > 0) turn.tools = draftTools;
    turns.push(turn);
  });

  if (turns.length === 0) {
    flags.push(`${label}: every turn was a read or a thought; nothing left to script`);
    turns.push({ text: 'TODO: nothing survived the draft. Write this turn by hand.' });
  } else {
    const last = turns[turns.length - 1]!;
    if (!last.text && last.tools?.length) flags.push(`${label}: ends on a tool call, not text. Add a closing line`);
  }

  return { id, trigger, title: titleFor(trigger, firstText), turns };
}

function titleFor(trigger: Trigger, firstText: string): string {
  if (trigger.kind === 'skill' && trigger.skill)
    return trigger.skill.charAt(0).toUpperCase() + trigger.skill.slice(1);
  if (trigger.kind === 'child') return 'Child session';
  const words = firstText.replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
  return words || 'Untitled';
}

function triggerFor(firstText: string, system: string): Trigger {
  const kickoff = parseKickoff(firstText);
  if (kickoff) return { kind: 'skill', skill: kickoff.skill };
  if (system.startsWith(firstLine(CHILD_PREAMBLE))) return { kind: 'child' };
  return { kind: 'typed' };
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

const PROPOSAL_ID = /\bp_[a-z0-9_]+\b/gi;

function flagTool(
  tools: readonly { name: string; input: Record<string, unknown> }[],
  label: string,
  turnIndex: number,
  flags: string[],
): void {
  for (const tool of tools) {
    const at = `${label} turn ${turnIndex} (${tool.name})`;
    const dump = JSON.stringify(tool.input);
    const ids = dump.match(PROPOSAL_ID);
    if (ids) flags.push(`${at}: carries a proposal id (${ids.join(', ')}). A script can't reproduce one, so hand-edit or drop it`);
    if (tool.name === WITHDRAW_TOOL_NAME)
      flags.push(`${at}: withdraws a proposal. That only made sense as the model correcting itself; a script has nothing to correct`);
    if (tool.name === ASK_USER_TOOL_NAME)
      flags.push(`${at}: asks the PM. The next turn has to read well for every option, so check it`);
    for (const [key, id] of pageIdLike(tool.input))
      flags.push(`${at}: "${key}" looks like a Jira or Confluence page id (${id}), which is not stable across environments. Hand-edit or drop it`);
  }
}

/** Fields that look like a raw connector id rather than a vault path or a ticket key. */
function pageIdLike(input: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = [];
  const walk = (value: unknown, key: string): void => {
    if (typeof value === 'string' || typeof value === 'number') {
      const asString = String(value);
      if (/^(pageid|issueid)$/i.test(key) || (key.toLowerCase() === 'id' && /^\d{4,}$/.test(asString)))
        out.push([key, asString]);
    } else if (Array.isArray(value)) {
      value.forEach((v) => walk(v, key));
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, k);
    }
  };
  for (const [k, v] of Object.entries(input)) walk(v, k);
  return out;
}

/** Interesting tokens minted by a tool result: proposal ids, hashes, long ids, but not ticket keys. */
const RESULT_TOKEN = /\bp_[a-z0-9_]+\b|\b[0-9a-f]{7,40}\b|\b\d{6,}\b/gi;

function flagToolResultDependency(
  incoming: readonly WireMessage[],
  tools: readonly { name: string; input: Record<string, unknown> }[],
  label: string,
  turnIndex: number,
  flags: string[],
): void {
  if (tools.length === 0) return;
  const last = [...incoming].reverse().find((m) => m.role === 'user');
  const resultText = last ? toolResultText(last) : '';
  const tokens = new Set(resultText.match(RESULT_TOKEN) ?? []);
  if (tokens.size === 0) return;
  const outgoing = JSON.stringify(tools.map((t) => t.input));
  for (const token of tokens) {
    if (outgoing.includes(token))
      flags.push(
        `${label} turn ${turnIndex}: reuses "${token}" from the previous tool result. That value only exists because this run happened; a script can't count on it`,
      );
  }
}

function toolResultText(message: WireMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((b) => b.type === 'tool_result')
    .map((b) => textOf(Array.isArray(b.content) ? b.content : [b.content ?? '']))
    .join('\n');
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** A run of slug characters holding a date: a path or a wikilink target, never prose. */
const SLUG_WITH_DATE = /[\w.-]*\/[\w./-]*\d{4}-\d{2}-\d{2}[\w./-]*|\d{4}-\d{2}-\d{2}[\w-]*\.\w+/g;
const WIKILINK = /\[\[[^\]]+\]\]/g;
const DATE = /\d{4}-\d{2}-\d{2}/;
const MARK = '';

/** The whole string un-slid: paths and wikilinks templated or left, everything else un-slid plainly. */
export function unslideText(text: string, offsetDays: number, anchor: string): string {
  if (offsetDays === 0) return text;
  const held: string[] = [];
  const hide = (m: string): string => {
    held.push(rewritePathDate(m, offsetDays, anchor));
    return `${MARK}${held.length - 1}${MARK}`;
  };
  const masked = text.replace(WIKILINK, hide).replace(SLUG_WITH_DATE, hide);
  const unslid = shiftDatesInText(masked, -offsetDays);
  return unslid.replace(new RegExp(`${MARK}(\\d+)${MARK}`, 'g'), (_, i: string) => held[Number(i)] ?? '');
}

/** The same, walked through anything JSON can hold (a tool call's input). */
export function unslideDeep<T>(value: T, offsetDays: number, anchor: string): T {
  if (typeof value === 'string') return unslideText(value, offsetDays, anchor) as T;
  if (Array.isArray(value)) return value.map((v) => unslideDeep(v, offsetDays, anchor)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) out[key] = unslideDeep(v, offsetDays, anchor);
    return out as T;
  }
  return value;
}

/**
 * One path or wikilink match: a date within `MIRROR_WINDOW_DAYS` of the
 * record day is this week's, so it becomes `{{today}}` or `{{date:X}}`; an
 * older date is a standing seed page and is left exactly as recorded.
 */
function rewritePathDate(match: string, offsetDays: number, anchor: string): string {
  const date = DATE.exec(match)?.[0];
  if (!date) return match;
  const recordDay = shiftDay(anchor, offsetDays);
  if (daysBetween(date, recordDay) > MIRROR_WINDOW_DAYS) return match;
  const unslid = shiftDay(date, -offsetDays);
  const template = unslid === anchor ? '{{today}}' : `{{date:${unslid}}}`;
  return match.replace(date, template);
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

// ---------------------------------------------------------------------------
// Small text helpers
// ---------------------------------------------------------------------------

function typedText(message: WireMessage | undefined): string {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

function textOf(blocks: unknown): string {
  if (typeof blocks === 'string') return blocks;
  if (Array.isArray(blocks)) return blocks.map((b) => textOf(b)).join('\n');
  if (!blocks || typeof blocks !== 'object') return '';
  const b = blocks as ContentBlock;
  if (typeof b.text === 'string') return b.text;
  if (b.content !== undefined) return textOf(b.content);
  return '';
}

function firstLine(text: string): string {
  return text.split('\n')[0] ?? '';
}
