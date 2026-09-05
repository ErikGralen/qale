/**
 * The local replay server (docs/demo-mode.md DM-3..6). Speaks the Anthropic
 * Messages API on 127.0.0.1 so the demo build's model calls never leave the
 * machine. STUB: the signature below is the contract; the body is being built.
 */

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

export async function startReplayServer(_opts: ReplayServerOptions): Promise<ReplayServer> {
  throw new Error('replay server not built yet');
}
