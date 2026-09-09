/**
 * The local replay server (docs/demo-mode.md DM-3, docs/plan-demo-replay.md).
 * Speaks the Anthropic Messages API on 127.0.0.1 so the demo build's model
 * calls never leave the machine. Every pi `Model` gets its `baseUrl` pointed
 * here, and nothing in `packages/agent` knows the difference.
 *
 * Two modes. **Replay** answers from the scenario scripts through the script
 * engine and never touches the network. **Record** (dev only, with a real key)
 * forwards to Anthropic and saves what comes back, as a draft for a script.
 *
 * The key is ignored: whatever the app holds, this server answers.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { providerModels } from '@qale/domain';
import { BUILT_IN_FALLBACK, loadFallback, type WireMessage } from './replay-recordings.js';
import { formatEvent, replayEvents } from './replay-sse.js';
import { forwardAndRecord, Recorder } from './replay-recorder.js';
import { loadScenarios, type ScenarioSummary } from './scenario.js';
import { flattenSystem, ScriptEngine } from './script-engine.js';

export interface ReplayServerOptions {
  /** `replay` answers from the scripts; `record` forwards upstream and saves. */
  mode: 'replay' | 'record';
  /** Folder of scenario scripts (committed under `demo/scenarios/`). */
  scenariosDir: string;
  /** Folder of recordings: `_fallback.json` is read from it, and record mode writes to it. */
  recordingsDir: string;
  /** Days between the anchor and today. Every date in a script slides by it. */
  dateOffsetDays: number;
  /** Record mode only: the real key to forward with. */
  upstreamApiKey?: string;
  /** Record mode only. Default `https://api.anthropic.com`. */
  upstreamBaseUrl?: string;
  pacing?: {
    charsPerSecond?: number;
    /** ±fraction per text delta. */
    jitter?: number;
    /** When given, every turn waits this long instead of its own pause. For the tests. */
    leadMs?: number;
  };
}

export interface ReplayServer {
  /** `http://127.0.0.1:<port>`, to become every pi Model's `baseUrl`. */
  baseUrl: string;
  close(): Promise<void>;
  /** Forget every binding, and re-read the scripts from disk. */
  reset(): void;
  /** The scenarios on disk, in id order, as the Settings page lists them. */
  scenarios(): ScenarioSummary[];
}

/**
 * How text arrives once a turn has started. The pause before a turn is the
 * script's own (`Turn.pause`, with the engine's defaults); this is only the
 * reading speed and how much it wobbles.
 */
export const DEFAULT_PACING = {
  charsPerSecond: 400,
  jitter: 0.25,
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
  const recorder = new Recorder(opts.recordingsDir, opts.dateOffsetDays);
  const engine = new ScriptEngine({
    offsetDays: opts.dateOffsetDays,
    fallbackText: fallbackText(opts.recordingsDir),
  });

  const load = (): void => {
    engine.load(loadScenarios(opts.scenariosDir));
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

  /** One scripted turn, dated for today, paced, on the wire. */
  async function answer(body: string, res: ServerResponse): Promise<void> {
    const request = JSON.parse(body) as {
      system?: unknown;
      messages?: WireMessage[];
      model?: string;
      stream?: boolean;
    };
    const served = engine.answer({
      system: flattenSystem(request.system),
      messages: request.messages ?? [],
      ...(request.model ? { model: request.model } : {}),
    });
    const leadMs = pacing.leadMs ?? served.pauseMs;

    if (!request.stream) {
      await wait(leadMs);
      send(res, 200, served.response);
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    for (const event of replayEvents(served.response, {
      leadMs,
      charsPerSecond: pacing.charsPerSecond,
      jitter: pacing.jitter,
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
    // The bindings go, and the scripts are read again, which is what makes a
    // hand edit show up without a relaunch.
    reset: () => {
      engine.reset();
      load();
    },
    scenarios: () => engine.scenarios(),
  };
}

/** The off-script line when a scenario has none: `_fallback.json`, else the built-in one. */
function fallbackText(recordingsDir: string): string {
  const block = loadFallback(recordingsDir)?.turns[0]?.response.content.find(
    (b) => b.type === 'text' && typeof b.text === 'string',
  );
  return (block?.text as string | undefined) ?? BUILT_IN_FALLBACK;
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
