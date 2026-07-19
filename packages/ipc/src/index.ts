import type {
  AgentRunInput,
  AgentRunHandle,
  BacklinkDTO,
  CaptureClassificationDTO,
  CaptureNoteInput,
  CaptureTodoInputDTO,
  GoldenAnswerInput,
  IngestCaptureInputDTO,
  IngestCaptureResultDTO,
  MaintenanceReportDTO,
  NoteCommitDTO,
  NoteQueryDTO,
  NoteRefDTO,
  ModelInfoDTO,
  ProposalPreviewDTO,
  NoteDTO,
  ProposalDTO,
  ProposalStatsDTO,
  ProblemHeatDTO,
  RenameNoteInput,
  SaveNoteInput,
  SaveFrontmatterInput,
  SearchHitDTO,
  AgentPingDTO,
  PingResolveActionDTO,
  ChatRefDTO,
  ChatHistoryDTO,
  SessionLifecycle,
  LiveSessionDTO,
  SettingsDTO,
  SkillDTO,
  TodoStatus,
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
  'settings:setSchedule': {
    args: [sessionType: string, patch: { dayOfWeek?: number; hour?: number; enabled?: boolean }];
    result: SettingsDTO;
  };
  'settings:setMcp': { args: [patch: { enabled?: boolean; port?: number }]; result: SettingsDTO };
  'schedule:runNow': { args: [sessionType: string]; result: { ok: boolean } };
  'models:list': { args: []; result: ModelInfoDTO[] };

  // Skills (v2) — the parsed skill catalogue behind the Skills view
  'skills:list': { args: []; result: SkillDTO[] };

  // Vault
  'vault:pick': { args: []; result: VaultInfoDTO | null };
  'vault:open': { args: [path: string]; result: VaultInfoDTO };
  'vault:current': { args: []; result: VaultInfoDTO | null };
  'vault:initGit': { args: []; result: VaultInfoDTO };
  'vault:tree': { args: []; result: VaultTreeDTO };
  'vault:rebuildIndex': { args: []; result: { indexed: number } };
  'vault:query': { args: [query: NoteQueryDTO]; result: NoteRefDTO[] };
  'librarian:report': { args: []; result: MaintenanceReportDTO };

  // Notes
  'note:get': { args: [path: string]; result: NoteDTO | null };
  'note:save': { args: [input: SaveNoteInput]; result: NoteDTO };
  'note:saveFrontmatter': { args: [input: SaveFrontmatterInput]; result: NoteDTO };
  'note:rename': { args: [input: RenameNoteInput]; result: NoteDTO };
  'note:delete': { args: [path: string]; result: { ok: boolean } };
  'note:backlinks': { args: [path: string]; result: BacklinkDTO[] };
  'note:resolveLink': { args: [target: string]; result: string | null };
  'note:history': { args: [path: string]; result: NoteCommitDTO[] };
  'note:versionAt': { args: [path: string, hash: string]; result: string | null };
  'problems:byHeat': { args: []; result: ProblemHeatDTO[] };

  // Todos (the commitment ledger)
  'todos:capture': { args: [input: CaptureTodoInputDTO]; result: NoteDTO };
  'todos:setStatus': { args: [path: string, status: TodoStatus]; result: NoteDTO };

  // Capture / search
  'note:capture': { args: [input: CaptureNoteInput]; result: NoteDTO };
  'capture:classify': { args: [text: string, fileName?: string]; result: CaptureClassificationDTO };
  'capture:ingest': { args: [input: IngestCaptureInputDTO]; result: IngestCaptureResultDTO };
  'search:query': { args: [query: string, limit?: number]; result: SearchHitDTO[] };

  // Proposals
  'proposals:list': { args: [status?: string]; result: ProposalDTO[] };
  'proposals:preview': { args: [id: string]; result: ProposalPreviewDTO | null };
  'proposals:accept': { args: [id: string, edited?: unknown]; result: { ok: boolean; stale?: boolean; error?: string; url?: string } };
  'proposals:reject': { args: [id: string]; result: { ok: boolean } };
  'proposals:stats': { args: []; result: ProposalStatsDTO };
  'golden:save': { args: [input: GoldenAnswerInput]; result: ProposalDTO };

  // Agent / sessions
  'agent:run': { args: [input: AgentRunInput]; result: AgentRunHandle };
  'agent:abort': { args: [streamId: string]; result: void };
  // Stored conversations (pi JSONL replay store)
  'chats:list': { args: []; result: ChatRefDTO[] };
  'chats:history': { args: [sessionId: string]; result: ChatHistoryDTO };
  'chats:delete': { args: [sessionId: string]; result: { ok: boolean } };
  'chats:setLifecycle': {
    args: [sessionId: string, lifecycle: SessionLifecycle];
    result: { ok: boolean };
  };
  'chats:forNote': { args: [path: string]; result: ChatRefDTO[] };
  // Live session state (the sidebar rail) + agent-initiated pings
  'sessions:live': { args: []; result: LiveSessionDTO[] };
  'pings:list': { args: []; result: AgentPingDTO[] };
  'pings:open': { args: [id: string]; result: AgentPingDTO | null };
  'pings:dismiss': { args: [id: string]; result: { ok: boolean } };
  /** Apply/skip one suggestion item on a ping — the click IS the approval. */
  'pings:resolveItem': {
    args: [pingId: string, itemId: string, action: PingResolveActionDTO];
    result: AgentPingDTO | null;
  };
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
  'settings:setSchedule',
  'settings:setMcp',
  'schedule:runNow',
  'models:list',
  'skills:list',
  'vault:pick',
  'vault:open',
  'vault:current',
  'vault:initGit',
  'vault:tree',
  'vault:rebuildIndex',
  'vault:query',
  'librarian:report',
  'note:get',
  'note:save',
  'note:saveFrontmatter',
  'note:rename',
  'note:delete',
  'note:backlinks',
  'note:resolveLink',
  'note:history',
  'note:versionAt',
  'problems:byHeat',
  'todos:capture',
  'todos:setStatus',
  'note:capture',
  'capture:classify',
  'capture:ingest',
  'search:query',
  'proposals:list',
  'proposals:preview',
  'proposals:accept',
  'proposals:reject',
  'proposals:stats',
  'golden:save',
  'agent:run',
  'agent:abort',
  'chats:list',
  'chats:history',
  'chats:delete',
  'chats:setLifecycle',
  'chats:forNote',
  'sessions:live',
  'pings:list',
  'pings:open',
  'pings:dismiss',
  'pings:resolveItem',
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
