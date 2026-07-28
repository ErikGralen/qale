import type {
  AgentRunInput,
  AgentRunHandle,
  AtRiskLinkDTO,
  BacklinkDTO,
  ConnectionDTO,
  ConnectResultDTO,
  DeliveryDeltaDTO,
  ExternalRefMetaDTO,
  ProviderDescriptorDTO,
  ShallowIndexItemDTO,
  CaptureClassificationDTO,
  CaptureMeetingMatchDTO,
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
  ThemeHeatDTO,
  PeopleDirectoryDTO,
  PersonCardDTO,
  RenameNoteInput,
  SaveNoteInput,
  SaveFrontmatterInput,
  SearchHitDTO,
  AgentPingDTO,
  PingResolveActionDTO,
  ChatRefDTO,
  ChatHistoryDTO,
  SessionLifecycle,
  SessionFileDTO,
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
  /** Who the PO is: display name and any extra addresses that mean "me". */
  'settings:setIdentity': {
    args: [patch: { name?: string | null; aliases?: string[] }];
    result: SettingsDTO;
  };
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
  'themes:byHeat': { args: []; result: ThemeHeatDTO[] };

  // People (participant chips + their preview cards)
  'people:directory': { args: []; result: PeopleDirectoryDTO };
  'people:create': { args: [input: { name?: string; email?: string }]; result: PersonCardDTO };

  // Todos (the commitment ledger)
  'todos:capture': { args: [input: CaptureTodoInputDTO]; result: NoteDTO };
  'todos:setStatus': { args: [path: string, status: TodoStatus]; result: NoteDTO };

  // Capture / search
  'note:capture': { args: [input: CaptureNoteInput]; result: NoteDTO };
  'capture:classify': { args: [text: string, fileName?: string]; result: CaptureClassificationDTO };
  'capture:ingest': { args: [input: IngestCaptureInputDTO]; result: IngestCaptureResultDTO };
  'capture:matchMeeting': { args: []; result: CaptureMeetingMatchDTO | null };
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
  /** A session's working files — the right-panel tree (Sessions v2 Part 1). */
  'sessions:files': { args: [sessionId: string]; result: SessionFileDTO[] };
  /** One working file's text, read-only. Null when it's gone. */
  'sessions:fileText': { args: [sessionId: string, path: string]; result: string | null };
  'pings:list': { args: []; result: AgentPingDTO[] };
  'pings:open': { args: [id: string]; result: AgentPingDTO | null };
  'pings:dismiss': { args: [id: string]; result: { ok: boolean } };
  /** Apply/skip one suggestion item on a ping — the click IS the approval. */
  'pings:resolveItem': {
    args: [pingId: string, itemId: string, action: PingResolveActionDTO];
    result: AgentPingDTO | null;
  };

  // Connections (external integrations, Area C). Reads are silent and cheap —
  // the renderer polls nothing; a `connections:changed` push invalidates.
  'connections:providers': { args: []; result: ProviderDescriptorDTO[] };
  'connections:list': { args: []; result: ConnectionDTO[] };
  'connections:connect': {
    args: [providerId: string, values: Record<string, string>];
    result: ConnectResultDTO;
  };
  /** Re-paste a token on the calm expired path — same verify, follows kept. */
  'connections:renewAuth': {
    args: [connectionId: string, values: Record<string, string>];
    result: ConnectResultDTO;
  };
  'connections:disconnect': { args: [connectionId: string]; result: void };
  /** Abort a pending OAuth browser flow (the PM gave up on the tab). */
  'connections:cancelOAuth': { args: []; result: void };
  'connections:setFollow': {
    args: [connectionId: string, containerId: string, followed: boolean];
    result: void;
  };
  'connections:syncNow': { args: []; result: { ok: boolean; error?: string } };
  'connections:searchIndex': { args: [query: string, limit?: number]; result: ShallowIndexItemDTO[] };
  'connections:refMeta': { args: [slug: string]; result: ExternalRefMetaDTO | null };
  'connections:atRisk': { args: []; result: AtRiskLinkDTO[] };
  'connections:deliveryDelta': { args: [meetingPath: string]; result: DeliveryDeltaDTO[] };
  /** Current mirrored body of a wikipage — the "before" of a redline preview. */
  'connections:pageBody': { args: [externalIdOrSlug: string]; result: string | null };
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
  'settings:setIdentity',
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
  'themes:byHeat',
  'people:directory',
  'people:create',
  'todos:capture',
  'todos:setStatus',
  'note:capture',
  'capture:classify',
  'capture:ingest',
  'capture:matchMeeting',
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
  'sessions:files',
  'sessions:fileText',
  'pings:list',
  'pings:open',
  'pings:dismiss',
  'pings:resolveItem',
  'connections:providers',
  'connections:list',
  'connections:connect',
  'connections:renewAuth',
  'connections:disconnect',
  'connections:cancelOAuth',
  'connections:setFollow',
  'connections:syncNow',
  'connections:searchIndex',
  'connections:refMeta',
  'connections:atRisk',
  'connections:deliveryDelta',
  'connections:pageBody',
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
