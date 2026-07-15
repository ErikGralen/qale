import type {
  AgentRunInput,
  AgentRunHandle,
  BacklinkDTO,
  CaptureNoteInput,
  CaptureMeetingInput,
  HealthDTO,
  NoteQueryDTO,
  NoteRefDTO,
  ModelInfoDTO,
  ProposalPreviewDTO,
  NoteDTO,
  ProposalDTO,
  ProposalStatsDTO,
  ProblemHeatDTO,
  SaveNoteInput,
  SaveFrontmatterInput,
  SearchHitDTO,
  SessionRefDTO,
  SettingsDTO,
  ProblemStance,
  VaultInfoDTO,
  VaultTreeDTO,
} from './dtos.js';
import type { PushEvent } from './events.js';

export * from './dtos.js';
export * from './events.js';

/**
 * The single source of truth for request/response IPC. Each entry maps a channel
 * to its argument tuple and result. The preload turns this into concrete
 * per-channel functions (see {@link IpcApi}); there is deliberately no generic
 * `invoke(channel, …)` passthrough, which would reopen the any-channel hole
 * (PLAN §3.2).
 */
export interface InvokeMap {
  'app:ping': { args: [message: string]; result: string };

  // Settings / lifecycle
  'settings:get': { args: []; result: SettingsDTO };
  'settings:setAnthropicKey': { args: [key: string]; result: SettingsDTO };
  'settings:setAtlassian': {
    args: [creds: { baseUrl: string; email: string; token: string }];
    result: SettingsDTO;
  };
  'settings:setModel': { args: [modelId: string]; result: SettingsDTO };
  'models:list': { args: []; result: ModelInfoDTO[] };

  // Vault
  'vault:pick': { args: []; result: VaultInfoDTO | null };
  'vault:open': { args: [path: string]; result: VaultInfoDTO };
  'vault:current': { args: []; result: VaultInfoDTO | null };
  'vault:tree': { args: []; result: VaultTreeDTO };
  'vault:rebuildIndex': { args: []; result: { indexed: number } };
  'vault:health': { args: []; result: HealthDTO };
  'vault:refreshIndexes': { args: []; result: { written: number } };
  'vault:query': { args: [query: NoteQueryDTO]; result: NoteRefDTO[] };

  // Notes
  'note:get': { args: [path: string]; result: NoteDTO | null };
  'note:save': { args: [input: SaveNoteInput]; result: NoteDTO };
  'note:saveFrontmatter': { args: [input: SaveFrontmatterInput]; result: NoteDTO };
  'note:backlinks': { args: [path: string]; result: BacklinkDTO[] };
  'note:resolveLink': { args: [target: string]; result: string | null };
  'note:setProblemStance': { args: [path: string, stance: ProblemStance]; result: NoteDTO };
  'problems:byHeat': { args: []; result: ProblemHeatDTO[] };

  // Capture / search
  'note:capture': { args: [input: CaptureNoteInput]; result: NoteDTO };
  'meeting:capture': { args: [input: CaptureMeetingInput]; result: NoteDTO };
  'search:query': { args: [query: string, limit?: number]; result: SearchHitDTO[] };

  // Proposals
  'proposals:list': { args: [status?: string]; result: ProposalDTO[] };
  'proposals:preview': { args: [id: string]; result: ProposalPreviewDTO | null };
  'proposals:accept': { args: [id: string, edited?: unknown]; result: { ok: boolean; stale?: boolean } };
  'proposals:reject': { args: [id: string]; result: { ok: boolean } };
  'proposals:stats': { args: []; result: ProposalStatsDTO };

  // Agent / sessions
  'agent:run': { args: [input: AgentRunInput]; result: AgentRunHandle };
  'agent:abort': { args: [streamId: string]; result: void };
  'sessions:list': { args: []; result: SessionRefDTO[] };
}

export type InvokeChannel = keyof InvokeMap;

/**
 * Runtime list of every invoke channel. The preload iterates this to build the
 * concrete API; keeping it in lockstep with {@link InvokeMap} is enforced by the
 * `satisfies` check below (a missing/extra key is a compile error).
 */
export const INVOKE_CHANNELS = [
  'app:ping',
  'settings:get',
  'settings:setAnthropicKey',
  'settings:setAtlassian',
  'settings:setModel',
  'models:list',
  'vault:pick',
  'vault:open',
  'vault:current',
  'vault:tree',
  'vault:rebuildIndex',
  'vault:health',
  'vault:refreshIndexes',
  'vault:query',
  'note:get',
  'note:save',
  'note:saveFrontmatter',
  'note:backlinks',
  'note:resolveLink',
  'note:setProblemStance',
  'problems:byHeat',
  'note:capture',
  'meeting:capture',
  'search:query',
  'proposals:list',
  'proposals:preview',
  'proposals:accept',
  'proposals:reject',
  'proposals:stats',
  'agent:run',
  'agent:abort',
  'sessions:list',
] as const satisfies readonly InvokeChannel[];

// Compile-time completeness guard: every InvokeMap key must appear above.
type _AllChannelsListed = Exclude<InvokeChannel, (typeof INVOKE_CHANNELS)[number]>;
const _exhaustive: _AllChannelsListed extends never ? true : ['missing channels', _AllChannelsListed] =
  true as never;
void _exhaustive;

/** The typed client surface exposed on `window.pm.invoke`. */
export type IpcApi = {
  [K in InvokeChannel]: (...args: InvokeMap[K]['args']) => Promise<InvokeMap[K]['result']>;
};

/** Handler signature main-side for a given channel. */
export type IpcHandler<K extends InvokeChannel> = (
  ...args: InvokeMap[K]['args']
) => InvokeMap[K]['result'] | Promise<InvokeMap[K]['result']>;

export type IpcHandlers = {
  [K in InvokeChannel]: IpcHandler<K>;
};

/** The full bridge surface the preload puts on `window.pm`. */
export interface PmBridge {
  invoke: IpcApi;
  /** Subscribe to a push channel; returns an unsubscribe fn. */
  onEvent: (cb: (event: PushEvent) => void) => () => void;
}
