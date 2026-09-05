/**
 * The local replay server (docs/demo-mode.md DM-3..6). Speaks the Anthropic
 * Messages API on 127.0.0.1 so the demo build's model calls never leave the
 * machine. Every pi `Model` gets its `baseUrl` pointed here, and nothing in
 * `packages/agent` knows the difference.
 *
 * Two modes. **Replay** answers from the recordings and never touches the
 * network. **Record** (dev only, with a real key) forwards to Anthropic and
 * saves what comes back.
 *
 * The key is ignored: whatever the app holds, this server answers.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { providerModels } from '@qale/domain';
import { assistantCount, flattenSystem, matchRequest } from './replay-matcher.js';
import { shiftResponseDates } from './replay-dates.js';
import {
  BUILT_IN_FALLBACK,
  loadFallback,
  loadRecordings,
  type LoadedRecording,
  type Recording,
  type WireMessage,
  type WireResponse,
} from './replay-recordings.js';
import { formatEvent, replayEvents } from './replay-sse.js';
import { forwardAndRecord, Recorder } from './replay-recorder.js';

export interface ReplayServerOptions {
  /** `replay` answers from the recordings; `record` forwards upstream and saves. */
  mode: 'replay' | 'record';
  /** Folder of recording JSON files (committed under `demo/recordings/`). */
  recordingsDir: string;
  /** Days to slide recorded date tokens by at replay (today − anchor). */
  dateOffsetDays: number;
  /** Record mode only: the real key to forward with. */
  upstreamApiKey?: string;
  /** Record mode only. Default `https://api.anthropic.com`. */
  upstreamBaseUrl?: string;
  pacing?: { firstTurnDelayMs?: number; turnDelayMs?: number; charsPerSecond?: number };
}

export interface ReplayServer {
  /** `http://127.0.0.1:<port>`, to become every pi Model's `baseUrl`. */
  baseUrl: string;
  close(): Promise<void>;
  /** Forget per-run state (conversation cursors). Recordings stay loaded. */
  reset(): void;
}

/**
 * How long the answer takes to arrive. A recorded turn that lands in 30 ms
 * looks fake, so the first turn of a conversation waits the way a real one
 * does, later turns wait less, and text arrives at reading speed. The
 * recordings carry no timing of their own.
 */
export const DEFAULT_PACING = {
  firstTurnDelayMs: 5000,
  turnDelayMs: 1200,
  charsPerSecond: 400,
} as const;

/** What `GET /v1/models` answers, so a key check passes without the network. */
const MODEL_IDS = [
  ...providerModels('anthropic').map((m) => m.id),
  // The cheap model the claim lookup and the summary pass pin themselves to.
  // Keep in step with CLAIM_MATCH_MODEL in packages/agent/src/claims.ts.
  'claude-haiku-4-5-20251001',
];

export async function startReplayServer(opts: ReplayServerOptions): Promise<ReplayServer> {
  const pacing = { ...DEFAULT_PACING, ...(opts.pacing ?? {}) };
  const recorder = new Recorder(opts.recordingsDir);
  let recordings: LoadedRecording[] = [];
  let fallback: Recording | null = null;

  const load = (): void => {
    recordings = loadRecordings(opts.recordingsDir);
    fallback = loadFallback(opts.recordingsDir);
  };
  load();

  const server = createServer((req, res) => {
    void route(req, res).catch((err) => {
      console.error('[qale] the replay server failed on a request:', err);
      send(res, 500, { type: 'error', error: { type: 'api_error', message: String(err) } });
    });
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '/').split('?')[0];
    if (req.method === 'GET' && path === '/v1/models') {
      send(res, 200, modelList());
      return;
    }
    if (req.method === 'POST' && path === '/v1/messages') {
      const body = await readBody(req);
      if (opts.mode === 'record') {
        await forwardAndRecord({
          upstreamBaseUrl: opts.upstreamBaseUrl ?? 'https://api.anthropic.com',
          apiKey: opts.upstreamApiKey ?? '',
          headers: req.headers,
          body,
          res,
          recorder,
        });
        return;
      }
      await answer(body, res);
      return;
    }
    send(res, 404, { type: 'error', error: { type: 'not_found_error', message: path } });
  }

  /** One recorded turn, dated for today, paced, on the wire. */
  async function answer(body: string, res: ServerResponse): Promise<void> {
    const request = JSON.parse(body) as {
      system?: unknown;
      messages?: WireMessage[];
      model?: string;
      stream?: boolean;
    };
    const messages = request.messages ?? [];
    const turnIndex = assistantCount(messages);
    const match = matchRequest({ system: flattenSystem(request.system), messages }, recordings);
    const recorded = match?.turn.response ?? fallbackResponse(fallback, request.model);
    const response = shiftResponseDates(recorded, opts.dateOffsetDays);
    const leadMs = turnIndex === 0 ? pacing.firstTurnDelayMs : pacing.turnDelayMs;

    if (!request.stream) {
      await wait(leadMs);
      send(res, 200, response);
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    for (const event of replayEvents(response, {
      leadMs,
      charsPerSecond: pacing.charsPerSecond,
    })) {
      // The PM stopped the run, or closed the app. Stop writing into a socket
      // that is gone rather than reporting it as a failed request.
      if (res.destroyed) return;
      await wait(event.pauseMs);
      if (res.destroyed) return;
      res.write(formatEvent(event));
    }
    res.end();
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => closeServer(server),
    // Nothing is held between turns: the turn to serve is read off the request.
    // So a reset is a re-read, which is what makes a hand edit show up without
    // a relaunch.
    reset: load,
  };
}

/** The answer for a request nothing matched (DM-6). */
function fallbackResponse(fallback: Recording | null, model: string | undefined): WireResponse {
  const recorded = fallback?.turns[0]?.response;
  if (recorded) return recorded;
  return {
    id: 'msg_demo_fallback',
    type: 'message',
    role: 'assistant',
    model: model ?? 'claude-opus-5',
    content: [{ type: 'text', text: BUILT_IN_FALLBACK }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

function modelList(): Record<string, unknown> {
  const data = MODEL_IDS.map((id) => ({
    type: 'model',
    id,
    display_name: id,
    created_at: '2026-01-01T00:00:00Z',
  }));
  return {
    data,
    has_more: false,
    first_id: data[0]?.id ?? null,
    last_id: data[data.length - 1]?.id ?? null,
  };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
