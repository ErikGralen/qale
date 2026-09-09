/**
 * Record mode (docs/demo-mode.md DM-3): dev only, with a real key. Every
 * request is forwarded to Anthropic verbatim and the bytes come back to the app
 * untouched, so the run behaves exactly as it does without the demo build. In
 * parallel the answer is reassembled from the stream and appended to the
 * recording for that conversation.
 *
 * Nothing about a key is written down. The recorded request side is the system
 * prompt, the messages, the tool NAMES and the model, which is what the matcher
 * reads and a person edits.
 */
import type { IncomingHttpHeaders, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  assistantCount,
  prefixLength,
  recordedMessages,
  recordingKey,
  saveRecording,
  userSide,
  type ContentBlock,
  type LoadedRecording,
  type RecordedRequest,
  type WireMessage,
  type WireResponse,
} from './replay-recordings.js';

/** The request side of a turn, taken off the wire. */
export function recordedRequest(body: Record<string, unknown>): RecordedRequest {
  const tools = Array.isArray(body.tools)
    ? body.tools.map((t) => String((t as { name?: unknown }).name ?? '')).filter(Boolean)
    : undefined;
  return {
    system: systemText(body.system),
    messages: (body.messages ?? []) as WireMessage[],
    ...(tools && tools.length > 0 ? { tools } : {}),
    model: String(body.model ?? ''),
  };
}

function systemText(system: unknown): string {
  if (typeof system === 'string') return system;
  if (Array.isArray(system))
    return system
      .map((b) => (typeof b === 'string' ? b : String((b as { text?: unknown }).text ?? '')))
      .join('\n');
  return '';
}

/**
 * Rebuilds the Message from the SSE events as they stream past. Same rules the
 * SDK follows: the skeleton comes from `message_start`, blocks accumulate their
 * deltas, and `message_delta` carries the stop reason and the output usage.
 */
export class SseAssembler {
  private pending = '';
  private message: WireResponse | null = null;
  private readonly blocks: ContentBlock[] = [];
  private readonly json: string[] = [];

  /** Feed the raw bytes as they arrive. Partial lines are held over. */
  push(chunk: string): void {
    this.pending += chunk;
    const lines = this.pending.split('\n');
    this.pending = lines.pop() ?? '';
    for (const line of lines) this.line(line);
  }

  /** The finished Message, or null when the stream carried none. */
  result(): WireResponse | null {
    if (!this.message) return null;
    const content = this.blocks.map((block, i) => {
      if (block.type !== 'tool_use') return block;
      const raw = this.json[i] ?? '';
      return { ...block, input: raw ? safeJson(raw) : (block.input ?? {}) };
    });
    return { ...this.message, content };
  }

  private line(line: string): void {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return;
    }
    this.event(event);
  }

  private event(event: Record<string, unknown>): void {
    const index = typeof event.index === 'number' ? event.index : 0;
    switch (event.type) {
      case 'message_start': {
        const message = event.message as WireResponse | undefined;
        if (message) this.message = { ...message, content: [] };
        return;
      }
      case 'content_block_start': {
        this.blocks[index] = { ...((event.content_block ?? {}) as ContentBlock) };
        this.json[index] = '';
        return;
      }
      case 'content_block_delta': {
        this.delta(index, (event.delta ?? {}) as Record<string, unknown>);
        return;
      }
      case 'message_delta': {
        const delta = (event.delta ?? {}) as Record<string, unknown>;
        const usage = event.usage as Record<string, unknown> | undefined;
        if (!this.message) return;
        this.message = {
          ...this.message,
          stop_reason: (delta.stop_reason as string | null) ?? this.message.stop_reason,
          stop_sequence: (delta.stop_sequence as string | null) ?? this.message.stop_sequence,
          usage: { ...this.message.usage, ...(usage ?? {}) },
        };
        return;
      }
      default:
        return;
    }
  }

  private delta(index: number, delta: Record<string, unknown>): void {
    const block = this.blocks[index];
    if (!block) return;
    if (delta.type === 'text_delta')
      block.text = `${String(block.text ?? '')}${String(delta.text ?? '')}`;
    if (delta.type === 'thinking_delta')
      block.thinking = `${String(block.thinking ?? '')}${String(delta.thinking ?? '')}`;
    if (delta.type === 'signature_delta') block.signature = String(delta.signature ?? '');
    if (delta.type === 'input_json_delta')
      this.json[index] = `${this.json[index] ?? ''}${String(delta.partial_json ?? '')}`;
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * The recordings this run has written. A turn joins the conversation whose user
 * side it continues; a first turn that continues nothing starts a file.
 */
export class Recorder {
  private readonly written: LoadedRecording[] = [];

  /** `offsetDays` is stamped on each file so replay can slide by the difference. */
  constructor(
    private readonly dir: string,
    private readonly offsetDays = 0,
  ) {}

  /** Files touched this run, for a test or a log line. */
  files(): string[] {
    return this.written.map((w) => w.file);
  }

  append(request: RecordedRequest, response: WireResponse): string {
    const turnIndex = assistantCount(request.messages);
    // A first turn has one user message to compare, and two conversations that
    // open the same way (two drops both start "1 source just landed") would
    // agree on it. So a first turn never joins a file: it starts one, and the
    // conversations part ways from the first tool result on.
    const home = turnIndex === 0 ? null : this.home(request, turnIndex);
    if (home) {
      home.recording.turns[turnIndex] = { request, response };
      // A redone turn ends the old branch: whatever followed it is stale.
      home.recording.turns.length = turnIndex + 1;
      saveRecording(home.file, home.recording);
      return home.file;
    }
    if (turnIndex > 0)
      console.error('[qale] recorded a mid-conversation turn with no home, starting a file');
    const asked = userSide(request.messages);
    const key = recordingKey(asked[0]?.text ?? 'turn');
    const loaded: LoadedRecording = {
      file: this.freshFile(key),
      recording: { version: 1, key, offsetDays: this.offsetDays, turns: [{ request, response }] },
    };
    this.written.push(loaded);
    saveRecording(loaded.file, loaded.recording);
    return loaded.file;
  }

  /**
   * A path no recording holds yet. Two conversations with the same opening line
   * share a key, and the second must not overwrite the first, on disk or in
   * this run: it gets `-2`, then `-3`.
   */
  private freshFile(key: string): string {
    const taken = new Set(this.written.map((w) => w.file));
    let candidate = join(this.dir, `${key}.json`);
    for (let n = 2; taken.has(candidate) || existsSync(candidate); n++) {
      candidate = join(this.dir, `${key}-${n}.json`);
    }
    return candidate;
  }

  /**
   * The conversation this turn belongs to: the one whose user side agrees with
   * this request everywhere the two overlap, longest first. A single divergence
   * means a different conversation, even when the opening line is the same.
   */
  private home(request: RecordedRequest, turnIndex: number): LoadedRecording | null {
    const asked = userSide(request.messages);
    let best: { loaded: LoadedRecording; prefix: number } | null = null;
    for (const loaded of this.written) {
      if (loaded.recording.turns.length < turnIndex) continue;
      const theirs = userSide(recordedMessages(loaded));
      const prefix = prefixLength(asked, theirs);
      if (prefix === 0 || prefix < Math.min(asked.length, theirs.length)) continue;
      if (!best || prefix > best.prefix) best = { loaded, prefix };
    }
    return best?.loaded ?? null;
  }
}

/** What a forwarded request needs to reach Anthropic and come back recorded. */
export interface ForwardOptions {
  /** Where the real API lives, e.g. `https://api.anthropic.com`. */
  upstreamBaseUrl: string;
  /** The real key. Forwarded, never written to a recording. */
  apiKey: string;
  /** The client's own headers, for the version and beta flags it asked for. */
  headers: IncomingHttpHeaders;
  /** The request body, byte for byte as the app sent it. */
  body: string;
  res: ServerResponse;
  recorder: Recorder;
}

/**
 * Forward one request and keep what comes back. The client gets the upstream
 * bytes unchanged, so a record run is a normal run with a longer path.
 */
export async function forwardAndRecord(opts: ForwardOptions): Promise<void> {
  const { res, headers } = opts;
  const url = `${opts.upstreamBaseUrl.replace(/\/+$/, '')}/v1/messages`;
  const version = String(headers['anthropic-version'] ?? '2023-06-01');
  const beta = headers['anthropic-beta'];
  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: String(headers.accept ?? 'application/json'),
      'anthropic-version': version,
      'x-api-key': opts.apiKey,
      ...(beta ? { 'anthropic-beta': String(beta) } : {}),
    },
    body: opts.body,
  });
  res.writeHead(upstream.status, {
    'content-type': upstream.headers.get('content-type') ?? 'application/json',
    'cache-control': 'no-cache',
  });

  const request = recordedRequest(JSON.parse(opts.body) as Record<string, unknown>);
  const stream = upstream.headers.get('content-type')?.includes('text/event-stream') ?? false;
  if (!upstream.ok || !stream || !upstream.body) {
    const text = await upstream.text();
    res.end(text);
    if (upstream.ok) keep(opts.recorder, request, safeJson(text) as WireResponse);
    return;
  }

  const assembler = new SseAssembler();
  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    res.write(Buffer.from(value));
    assembler.push(decoder.decode(value, { stream: true }));
  }
  res.end();
  const message = assembler.result();
  if (message) keep(opts.recorder, request, message);
}

function keep(recorder: Recorder, request: RecordedRequest, response: WireResponse): void {
  if (!response || typeof response !== 'object' || !Array.isArray(response.content)) return;
  try {
    recorder.append(request, response);
  } catch (err) {
    console.error('[qale] could not save a recorded turn:', err);
  }
}
