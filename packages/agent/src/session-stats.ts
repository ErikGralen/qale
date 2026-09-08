import { readFileSync } from 'node:fs';
import { parseSessionEntries, type FileEntry } from '@earendil-works/pi-coding-agent';

/**
 * Reads a pi session file and reports what a run cost: wall time, tokens,
 * thinking, and the gap between the model's own time and everything else.
 * Built for AS-1 in docs/agent-speed.md, the ticket that turns "the model
 * writes for nearly the whole run" from a belief into a number that later
 * changes to the agent can be checked against.
 *
 * `sessionStats` takes what pi's own session parser returns for a file: the
 * header plus every entry, in file order. It never throws on a truncated or
 * in-progress file. A run that is still going, or one that stopped mid-turn,
 * still produces every field below, just with fewer proposals or turns in
 * it.
 */

/**
 * Reads and parses one session file. pi-coding-agent declares
 * `loadEntriesFromFile(filePath)` for exactly this in
 * dist/core/session-manager.d.ts, but its package.json `exports` map only
 * publishes `.` and `./rpc-entry`, so that function never reaches an import
 * from outside the package. `parseSessionEntries(content)` does the same
 * parse (JSON.parse per line, a malformed line skipped rather than thrown
 * on), and it is exported from `.`, so this reads the file itself and hands
 * the text to pi's own parser rather than hand-rolling one.
 */
export function loadSessionEntries(filePath: string): FileEntry[] {
  return parseSessionEntries(readFileSync(filePath, 'utf8'));
}

/**
 * The fields this module reads off a message. A structural slice of pi-ai's
 * Message and Usage types, not an import of them: pi-ai sits two packages
 * upstream of `@qale/agent`, and `history.ts` picks the same slice for the
 * same reason. A hand-picked slice cannot drift the way a full re-export
 * would if that package's shape moves under it.
 */
interface StatsBlock {
  type: string;
  name?: string;
  id?: string;
}
interface StatsUsage {
  output: number;
  /** Thinking tokens. Already counted inside `output`, not on top of it. */
  reasoning?: number;
}
interface StatsMessage {
  role: string;
  content: string | StatsBlock[];
  usage?: StatsUsage;
  toolCallId?: string;
}

interface MessageEntry {
  timestamp: string;
  timestampMs: number;
  message: StatsMessage;
}

/** One assistant turn, in the order it happened. */
export interface TurnStat {
  /** 1-based position among assistant turns. */
  turn: number;
  timestamp: string;
  /** Time since the previous message entry (user reply, tool result, or the
   * session's first message): the model's own time for this turn. */
  durationSec: number;
  outputTokens: number;
  thinkingTokens: number;
  /** Output tokens over durationSec. 0 when durationSec is 0. */
  tokensPerSec: number;
  toolCalls: string[];
}

/** One `ask_user` call and, if it has come back, how long the answer took. */
export interface AskUserPark {
  timestamp: string;
  /** Seconds from the call to its answer. Null when the file ends before an
   * answer arrives: the run was still parked when this was read. */
  gapSec: number | null;
}

export interface SessionStats {
  /** True when the file holds no message entries at all. */
  empty: boolean;
  wallTimeSec: number;
  modelCalls: number;
  outputTokens: number;
  thinkingTokens: number;
  /** Thinking tokens as a percentage of output tokens. */
  thinkingPercent: number;
  /** Sum of every turn's durationSec: the model's own time for the run. */
  turnModelTimeSec: number;
  /** Wall time minus turnModelTimeSec. What nothing here can charge to a
   * model call: a git commit, a check_claims lookup, an ask_user park, the
   * time before the first message. Large means something outside the model
   * costs real time. */
  residualSec: number;
  /** residualSec as a percentage of wallTimeSec. */
  residualPercent: number;
  /** Every assistant turn, in order. Throughput here is per turn, not one
   * average across the run, because a single average would hide the slow
   * turns inside the fast ones. */
  turns: TurnStat[];
  /** The five slowest turns by durationSec. */
  slowestTurns: TurnStat[];
  /** Seconds from wall start to the first `propose_*` call. Null if the run
   * made none. */
  firstProposalSec: number | null;
  /** wallTimeSec minus firstProposalSec. Null if the run made no proposal. */
  timeAfterFirstProposalSec: number | null;
  /** `propose_*` call counts, keyed by the full tool name. */
  proposalCountsByKind: Record<string, number>;
  /** Every `ask_user` call the run made, and how long each took to answer. */
  askUserParks: AskUserPark[];
  /** Seconds from the first user message to the first assistant call: the
   * cost of everything `createSession` does before the model runs. Null if
   * the file has no user message followed by an assistant call. */
  setupSec: number | null;
}

/** A fresh empty result each call: the arrays and record inside must never be
 * a shared reference a caller could mutate across calls. */
function emptyStats(wallTimeSec = 0): SessionStats {
  return {
    empty: true,
    wallTimeSec,
    modelCalls: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    thinkingPercent: 0,
    turnModelTimeSec: 0,
    residualSec: 0,
    residualPercent: 0,
    turns: [],
    slowestTurns: [],
    firstProposalSec: null,
    timeAfterFirstProposalSec: null,
    proposalCountsByKind: {},
    askUserParks: [],
    setupSec: null,
  };
}

function toMs(timestamp: string): number {
  return Date.parse(timestamp);
}

export function sessionStats(entries: FileEntry[]): SessionStats {
  if (entries.length === 0) return emptyStats();

  // Every entry, the header included, carries an entry-level ISO timestamp
  // (SessionEntryBase.timestamp). That is the clock this module trusts. A
  // message also carries its own numeric `timestamp`, a different, provider
  // clock; on a date-shifted demo file it isn't even the same era, so it is
  // never read here.
  const allMs = entries.map((e) => toMs(e.timestamp)).filter((ms) => Number.isFinite(ms));
  if (allMs.length === 0) return emptyStats();
  const wallStartMs = Math.min(...allMs);
  const wallEndMs = Math.max(...allMs);
  const wallTimeSec = Math.max(0, (wallEndMs - wallStartMs) / 1000);

  // pi appends entries in order, so the file is already chronological.
  const messages: MessageEntry[] = [];
  for (const entry of entries) {
    if (entry.type !== 'message') continue;
    const ms = toMs(entry.timestamp);
    if (!Number.isFinite(ms)) continue;
    messages.push({
      timestamp: entry.timestamp,
      timestampMs: ms,
      message: entry.message as unknown as StatsMessage,
    });
  }
  if (messages.length === 0) return emptyStats(wallTimeSec);

  const turns: TurnStat[] = [];
  const toolResultTimestampMs = new Map<string, number>();
  const askUserCalls: { toolCallId: string; timestamp: string }[] = [];
  const proposalCountsByKind: Record<string, number> = {};
  let outputTokens = 0;
  let thinkingTokens = 0;
  let turnModelTimeSec = 0;
  let firstUserMs: number | null = null;
  let firstAssistantMs: number | null = null;
  let firstProposalMs: number | null = null;

  for (let i = 0; i < messages.length; i++) {
    const { message, timestamp, timestampMs } = messages[i]!;

    if (message.role === 'user') {
      if (firstUserMs === null) firstUserMs = timestampMs;
      continue;
    }

    if (message.role === 'toolResult') {
      if (message.toolCallId) toolResultTimestampMs.set(message.toolCallId, timestampMs);
      continue;
    }

    if (message.role !== 'assistant') continue;
    if (firstAssistantMs === null) firstAssistantMs = timestampMs;

    const blocks = Array.isArray(message.content) ? message.content : [];
    const toolCalls = blocks.filter((b) => b.type === 'toolCall' && b.name);
    const toolCallNames = toolCalls.map((b) => b.name!);

    for (const call of toolCalls) {
      if (call.name!.startsWith('propose_')) {
        proposalCountsByKind[call.name!] = (proposalCountsByKind[call.name!] ?? 0) + 1;
        if (firstProposalMs === null) firstProposalMs = timestampMs;
      }
      if (call.name === 'ask_user' && call.id) {
        askUserCalls.push({ toolCallId: call.id, timestamp });
      }
    }

    const prevMs = i > 0 ? messages[i - 1]!.timestampMs : timestampMs;
    const durationSec = Math.max(0, (timestampMs - prevMs) / 1000);
    const usage = message.usage ?? { output: 0 };
    const out = usage.output ?? 0;
    const think = usage.reasoning ?? 0;

    outputTokens += out;
    thinkingTokens += think;
    turnModelTimeSec += durationSec;

    turns.push({
      turn: turns.length + 1,
      timestamp,
      durationSec,
      outputTokens: out,
      thinkingTokens: think,
      tokensPerSec: durationSec > 0 ? out / durationSec : 0,
      toolCalls: toolCallNames,
    });
  }

  const residualSec = wallTimeSec - turnModelTimeSec;
  const residualPercent = wallTimeSec > 0 ? (residualSec / wallTimeSec) * 100 : 0;
  const thinkingPercent = outputTokens > 0 ? (thinkingTokens / outputTokens) * 100 : 0;
  const slowestTurns = [...turns].sort((a, b) => b.durationSec - a.durationSec).slice(0, 5);

  const firstProposalSec =
    firstProposalMs !== null ? Math.max(0, (firstProposalMs - wallStartMs) / 1000) : null;
  const timeAfterFirstProposalSec =
    firstProposalSec !== null ? Math.max(0, wallTimeSec - firstProposalSec) : null;

  const setupSec =
    firstUserMs !== null && firstAssistantMs !== null && firstAssistantMs >= firstUserMs
      ? (firstAssistantMs - firstUserMs) / 1000
      : null;

  const askUserParks: AskUserPark[] = askUserCalls.map((call) => {
    const resultMs = toolResultTimestampMs.get(call.toolCallId);
    const callMs = toMs(call.timestamp);
    return {
      timestamp: call.timestamp,
      gapSec: resultMs !== undefined ? Math.max(0, (resultMs - callMs) / 1000) : null,
    };
  });

  return {
    empty: false,
    wallTimeSec,
    modelCalls: turns.length,
    outputTokens,
    thinkingTokens,
    thinkingPercent,
    turnModelTimeSec,
    residualSec,
    residualPercent,
    turns,
    slowestTurns,
    firstProposalSec,
    timeAfterFirstProposalSec,
    proposalCountsByKind,
    askUserParks,
    setupSec,
  };
}
