/**
 * A recorded answer, turned back into the stream the Anthropic SDK expects
 * (docs/demo-mode.md DM-5). pi always asks for `stream: true`, so this is the
 * path every real turn takes.
 *
 * The event order is the API's own: `message_start`, then per block a
 * `content_block_start`, its deltas and a `content_block_stop`, then
 * `message_delta` with the stop reason and the output usage, then
 * `message_stop`.
 *
 * Pacing lives here too. A recording carries no timing, so the delay is
 * computed: a lead before the first byte, then text at a readable rate. Each
 * event says how long to wait BEFORE it is written, which keeps the server a
 * loop over a list.
 */
import type { ContentBlock, WireResponse } from './replay-recordings.js';

export interface ReplayEvent {
  event: string;
  data: Record<string, unknown>;
  /** Milliseconds to wait before writing this event. */
  pauseMs: number;
}

export interface PacingOptions {
  /** Before the first byte of the answer: the turn's pause. */
  leadMs: number;
  /** How fast text arrives. Tool calls are not paced: they emit whole. */
  charsPerSecond: number;
  /**
   * How much each text delta's pause may vary, as a fraction: 0.25 is ±25%.
   * A metronome does not look like a model. Default none.
   */
  jitter?: number;
  /** The randomness behind the jitter, 0 to 1. `Math.random` unless a test says otherwise. */
  random?: () => number;
}

/** How much text goes in one delta. Small enough to look typed, big enough to be cheap. */
export const CHUNK_CHARS = 24;

/** The whole stream for one recorded answer, in order. */
export function replayEvents(message: WireResponse, pacing: PacingOptions): ReplayEvent[] {
  const events: ReplayEvent[] = [];
  events.push({
    event: 'message_start',
    pauseMs: pacing.leadMs,
    data: {
      type: 'message_start',
      message: { ...message, content: [], stop_reason: null, stop_sequence: null },
    },
  });
  message.content.forEach((block, index) => {
    events.push({
      event: 'content_block_start',
      pauseMs: 0,
      data: { type: 'content_block_start', index, content_block: emptyBlock(block) },
    });
    for (const delta of blockDeltas(block, index, pacing)) events.push(delta);
    events.push({
      event: 'content_block_stop',
      pauseMs: 0,
      data: { type: 'content_block_stop', index },
    });
  });
  events.push({
    event: 'message_delta',
    pauseMs: 0,
    data: {
      type: 'message_delta',
      delta: { stop_reason: message.stop_reason, stop_sequence: message.stop_sequence },
      usage: message.usage,
    },
  });
  events.push({ event: 'message_stop', pauseMs: 0, data: { type: 'message_stop' } });
  return events;
}

/** One event on the wire. */
export function formatEvent(event: ReplayEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/** The block as it starts: the shape, with the content it accumulates emptied. */
function emptyBlock(block: ContentBlock): ContentBlock {
  if (block.type === 'text') return { type: 'text', text: '' };
  if (block.type === 'thinking') return { type: 'thinking', thinking: '', signature: '' };
  if (block.type === 'tool_use')
    return { type: 'tool_use', id: block.id, name: block.name, input: {} };
  return block;
}

function blockDeltas(block: ContentBlock, index: number, pacing: PacingOptions): ReplayEvent[] {
  if (block.type === 'text' && typeof block.text === 'string')
    return chunk(block.text).map((text) => ({
      event: 'content_block_delta',
      pauseMs: pauseFor(text, pacing),
      data: { type: 'content_block_delta', index, delta: { type: 'text_delta', text } },
    }));
  if (block.type === 'thinking' && typeof block.thinking === 'string') {
    const out: ReplayEvent[] = chunk(block.thinking).map((thinking) => ({
      event: 'content_block_delta',
      pauseMs: pauseFor(thinking, pacing),
      data: { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking } },
    }));
    out.push({
      event: 'content_block_delta',
      pauseMs: 0,
      data: {
        type: 'content_block_delta',
        index,
        delta: { type: 'signature_delta', signature: String(block.signature ?? '') },
      },
    });
    return out;
  }
  if (block.type === 'tool_use')
    return [
      {
        event: 'content_block_delta',
        pauseMs: 0,
        data: {
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input ?? {}) },
        },
      },
    ];
  return [];
}

function chunk(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_CHARS) out.push(text.slice(i, i + CHUNK_CHARS));
  return out;
}

/** The pause before one text delta: its length at the rate, moved by the jitter. */
function pauseFor(text: string, pacing: PacingOptions): number {
  if (pacing.charsPerSecond <= 0) return 0;
  const base = (text.length / pacing.charsPerSecond) * 1000;
  const jitter = pacing.jitter ?? 0;
  const random = pacing.random ?? Math.random;
  const factor = jitter > 0 ? 1 + jitter * (2 * random() - 1) : 1;
  return Math.round(base * factor);
}
