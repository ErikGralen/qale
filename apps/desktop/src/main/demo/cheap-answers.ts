/**
 * Rule answers for the single-turn cheap calls (docs/plan-demo-replay.md,
 * section 4.4, step 1). Naming a session, matching a claim, summarising a
 * document and stating a folder's purpose each go to the model as one user
 * message under a fixed system prompt. The prompt says which job it is, and a
 * rule answers it: a scenario supplies the answers that matter through its
 * `lookups`, and everything else gets a default the parser accepts and that
 * files quietly.
 *
 * The prompts are imported from `@qale/agent`, never copied, so a change to
 * the words on `main` is a change here too.
 */
import {
  FOLDER_PURPOSE_SYSTEM_PROMPT,
  MATCH_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  namingSystemPrompt,
} from '@qale/agent';

export type CheapKind = 'naming' | 'claim' | 'summary' | 'folder';

/** What a scenario supplies. Both tables arrive with templates already resolved. */
export interface CheapLookups {
  claims: Record<string, string>;
  summaries: Record<string, string>;
}

export interface CheapContext {
  lookups: CheapLookups;
  /** The bound conversation's title for a typed first message, or undefined. */
  titleFor(firstMessage: string): string | undefined;
}

/** The first line of each prompt. The naming prompt varies by language after its first line. */
const FIRST_LINES: readonly [CheapKind, string][] = [
  ['naming', firstLine(namingSystemPrompt())],
  ['claim', firstLine(MATCH_SYSTEM_PROMPT)],
  ['summary', firstLine(SUMMARY_SYSTEM_PROMPT)],
  ['folder', firstLine(FOLDER_PURPOSE_SYSTEM_PROMPT)],
];

/** The summary length the pass accepts. Kept in step with `acceptSummary`. */
const SUMMARY_MAX = 160;

/** The verdict for a claim no scenario names: filed quietly, no question. */
export const NEW_CLAIM = 'NEW | - | -';

/** Which cheap job a system prompt is, or null when it is a session. */
export function cheapKind(system: string): CheapKind | null {
  const head = firstLine(system);
  if (!head) return null;
  return FIRST_LINES.find(([, line]) => head === line)?.[0] ?? null;
}

/** The one line (or two, for a tagged summary) the caller's parser reads. */
export function cheapAnswer(kind: CheapKind, user: string, ctx: CheapContext): string {
  switch (kind) {
    case 'naming':
      return nameFor(user, ctx);
    case 'claim':
      return claimFor(user, ctx.lookups.claims);
    case 'summary':
      return summaryFor(user, ctx.lookups.summaries);
    case 'folder':
      return purposeFor(user, ctx.lookups.summaries);
  }
}

/**
 * The naming call (`naming.ts`). A typed session carries `First message:` and
 * the bound conversation's title answers it. A kickoff carries the skill's
 * title and the pages it ran on instead, and nothing in that text identifies
 * the conversation, so the page wins, then the skill, which is the name the
 * runtime's own heuristic gives it.
 */
function nameFor(user: string, ctx: CheapContext): string {
  const first = /First message:\n([\s\S]*)$/.exec(user)?.[1]?.trim();
  if (first) return ctx.titleFor(first) ?? firstWords(first, 6);
  const target = /It was pointed at: (.+?)\.?\s*$/m.exec(user)?.[1]?.trim();
  if (target && !target.includes(', ')) return target;
  const skill = /started with the "([^"]+)" skill/.exec(user)?.[1]?.trim();
  return skill ?? firstWords(user, 6);
}

/** The claim lookup (`claims.ts`): the scenario's line for a claim it names, else NEW. */
function claimFor(user: string, claims: Record<string, string>): string {
  const claim = (/^Claim: (.*)$/m.exec(user)?.[1] ?? '').trim();
  const squashed = squash(claim);
  for (const [prefix, line] of Object.entries(claims)) {
    if (squashed.startsWith(squash(prefix))) return line;
  }
  return NEW_CLAIM;
}

/**
 * The summary pass (`summaries.ts`): the scenario's line for the document at
 * `origin=`, else the document's own first sentence. Tags are asked for by
 * name in the user text and answered with none.
 */
function summaryFor(user: string, summaries: Record<string, string>): string {
  const summary = summaries[originOf(user)] ?? firstSentence(materialOf(user));
  const wantsTags = /^Summarise this document and tag it\./.test(user);
  return wantsTags ? `${summary}\ntags: none` : summary;
}

/**
 * The folder purpose: the scenario's line, else one built from the folder's
 * title. `acceptPurpose` refuses a colon, so the default carries none.
 */
function purposeFor(user: string, summaries: Record<string, string>): string {
  const scripted = summaries[originOf(user)];
  if (scripted) return scripted;
  const title = /^Folder: (.*)$/m.exec(materialOf(user))?.[1]?.trim() || 'this folder';
  return `The documents kept under ${title}.`;
}

function originOf(user: string): string {
  return /<<<\s*EXTERNAL_MATERIAL\b[^\n]*origin="([^"\n]*)"/.exec(user)?.[1] ?? '';
}

/** What is between the two envelope markers, or the whole text when there is no envelope. */
function materialOf(user: string): string {
  const m = /<<<\s*EXTERNAL_MATERIAL\b[^\n]*>>>\r?\n([\s\S]*?)\r?\n?<<<\s*END_EXTERNAL_MATERIAL\b/.exec(
    user,
  );
  return m?.[1] ?? user;
}

/**
 * The first sentence of the body, under the length the pass accepts. The
 * `Title:` line and every heading are skipped: the summary is what the
 * document says, not its name. Markdown marks and wikilink brackets are
 * dropped so the line reads as prose.
 */
function firstSentence(material: string): string {
  const body = material
    .replace(/^Title: .*$/m, '')
    .replace(/^#+\s.*$/gm, '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) =>
      alias ?? target.split('/').pop() ?? target,
    )
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!body) return 'A document with no text yet.';
  const sentence = /^(.*?[.!?])(?:\s|$)/.exec(body)?.[1] ?? body;
  return cut(sentence, SUMMARY_MAX);
}

function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const short = text.slice(0, max - 1);
  const atSpace = short.lastIndexOf(' ');
  return `${(atSpace > max / 2 ? short.slice(0, atSpace) : short).trim()}…`;
}

function firstWords(text: string, count: number): string {
  return squash(text).split(' ').slice(0, count).join(' ');
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? '';
}
