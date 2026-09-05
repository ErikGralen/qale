/**
 * Which recorded turn answers this request (docs/demo-mode.md DM-4).
 *
 * Requests are never byte-identical between two runs: session ids, dates,
 * timestamps and byte counts all move. So the matcher normalises those away and
 * compares only the USER side of the conversation, message by message, from the
 * start. The recording with the longest matching prefix wins, the system prompt
 * breaks a tie, and the turn it answers with is the one at index = the number of
 * assistant messages the request already carries.
 *
 * Assistant messages are never compared. That is what makes a hand edit safe:
 * after somebody sharpens a recorded answer, the app sends the changed text
 * back in the next request, and the matcher still finds the conversation.
 */
import type {
  ContentBlock,
  LoadedRecording,
  RecordedTurn,
  WireMessage,
} from './replay-recordings.js';

/** What a request looks like once the server has read the body. */
export interface MatchRequest {
  system: string;
  messages: WireMessage[];
}

/** One user message, ready to compare. */
export interface UserTurn {
  /** The normalised text of everything the user side of this message carries. */
  text: string;
  /** True when a person typed it. False when it is only tool results. */
  typed: boolean;
}

export interface Match {
  loaded: LoadedRecording;
  turn: RecordedTurn;
  turnIndex: number;
  /** How many leading user messages matched. */
  prefix: number;
  /** How many user messages the request has. */
  userCount: number;
  /** 0 to 1, how alike the two system prompts are. The tiebreak. */
  systemScore: number;
}

/**
 * How much of the user side has to match before an answer is served.
 *
 * A typed message is the script: if the person types something the recording
 * does not have, we are off script and DM-6's fallback answers. Tool results
 * are machinery, and machinery drifts (a file count, an mtime, a line we do not
 * normalise), so a run may miss on one of those and still be the same
 * conversation. Half the user side has to line up, which is a low bar on
 * purpose: every typed message before the miss matched, and the alternative is
 * the fallback text in the middle of a walkthrough.
 */
export const MIN_PREFIX_RATIO = 0.5;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const TIMESTAMP = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g;
const DATE = /\d{4}-\d{2}-\d{2}/g;
const LONG_NUMBER = /\d{4,}/g;

/**
 * The text with everything that moves between runs replaced by a placeholder.
 * Order matters: a UUID holds digit runs, and a timestamp holds a date.
 */
export function normalise(text: string): string {
  return text
    .replace(UUID, '<uuid>')
    .replace(TIMESTAMP, '<ts>')
    .replace(DATE, '<date>')
    .replace(LONG_NUMBER, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The system prompt as one string, whether it came as text or as blocks. */
export function flattenSystem(system: unknown): string {
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) return system.map((b) => textOf(b)).join('\n');
  return '';
}

/** The user side of a conversation, normalised, in order. */
export function userSide(messages: readonly WireMessage[]): UserTurn[] {
  const out: UserTurn[] = [];
  for (const message of messages) {
    if (message.role !== 'user') continue;
    out.push({ text: normalise(userText(message)), typed: isTyped(message) });
  }
  return out;
}

/** How many assistant messages the request carries. That is the turn to serve. */
export function assistantCount(messages: readonly WireMessage[]): number {
  return messages.filter((m) => m.role === 'assistant').length;
}

/** How many leading user messages are the same text. Stops at the first miss. */
export function prefixLength(a: readonly UserTurn[], b: readonly UserTurn[]): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i]!.text === b[i]!.text) i += 1;
  return i;
}

/** 0 to 1: how much of the shorter system prompt the two share from the start. */
export function systemSimilarity(a: string, b: string): number {
  const x = normalise(a);
  const y = normalise(b);
  if (!x && !y) return 1;
  const longest = Math.max(x.length, y.length);
  if (longest === 0) return 1;
  const limit = Math.min(x.length, y.length);
  let i = 0;
  while (i < limit && x[i] === y[i]) i += 1;
  return i / longest;
}

/**
 * The turn to answer with, or null when nothing is close enough and the caller
 * should reach for the fallback.
 */
export function matchRequest(
  request: MatchRequest,
  recordings: readonly LoadedRecording[],
): Match | null {
  const asked = userSide(request.messages);
  const turnIndex = assistantCount(request.messages);
  let best: Match | null = null;
  for (const loaded of recordings) {
    const turn = loaded.recording.turns[turnIndex];
    if (!turn) continue;
    const theirs = userSide(recordedMessages(loaded));
    const prefix = prefixLength(asked, theirs);
    if (!closeEnough(asked, prefix)) continue;
    const systemScore = systemSimilarity(request.system, turn.request.system ?? '');
    const candidate: Match = {
      loaded,
      turn,
      turnIndex,
      prefix,
      userCount: asked.length,
      systemScore,
    };
    if (!best || better(candidate, best)) best = candidate;
  }
  return best;
}

/** The user side of a recording, taken from its last turn's request. */
export function recordedMessages(loaded: LoadedRecording): WireMessage[] {
  const turns = loaded.recording.turns;
  const last = turns[turns.length - 1];
  return last ? last.request.messages : [];
}

function better(a: Match, b: Match): boolean {
  if (a.prefix !== b.prefix) return a.prefix > b.prefix;
  return a.systemScore > b.systemScore;
}

function closeEnough(asked: readonly UserTurn[], prefix: number): boolean {
  if (prefix === 0) return false;
  if (prefix >= asked.length) return true;
  // The first message that did not match. A typed one means a new question.
  if (asked[prefix]!.typed) return false;
  return prefix / asked.length >= MIN_PREFIX_RATIO;
}

/** Did a person write any of this message, or is it only tool results? */
function isTyped(message: WireMessage): boolean {
  if (typeof message.content === 'string') return message.content.trim().length > 0;
  return message.content.some((b) => b.type === 'text' && typeof b.text === 'string');
}

/** Everything the user side of one message says: typed text and tool results. */
function userText(message: WireMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content.map((b) => textOf(b)).join('\n');
}

function textOf(block: unknown): string {
  if (typeof block === 'string') return block;
  if (Array.isArray(block)) return block.map((b) => textOf(b)).join('\n');
  if (!block || typeof block !== 'object') return '';
  const b = block as ContentBlock;
  if (typeof b.text === 'string') return b.text;
  if (b.content !== undefined) return textOf(b.content);
  return '';
}
