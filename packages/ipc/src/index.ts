import type {
  AgentDTO,
  AgentRunInput,
  AgentRunHandle,
  ArrivalCheckDTO,
  ArrivalHandoffDTO,
  ArrivalItemInputDTO,
  AtRiskLinkDTO,
  BacklinkDTO,
  ConnectionDTO,
  ConnectResultDTO,
  DeliveryDeltaDTO,
  ExternalRefMetaDTO,
  ProviderDescriptorDTO,
  ShallowIndexItemDTO,
  CaptureNoteInput,
  CaptureNudgeDismissDTO,
  CaptureNudgeStateDTO,
  CaptureTodoInputDTO,
  MaintenanceReportDTO,
  MeetingReviewAskDTO,
  NoteCommitDTO,
  NoteQueryDTO,
  NoteRefDTO,
  ModelInfoDTO,
  OnboardingPatchDTO,
  PathCheckDTO,
  ProposalPreviewDTO,
  NoteDTO,
  ProposalDTO,
  ThemeHeatDTO,
  PeopleDirectoryDTO,
  PersonCardDTO,
  RenameNoteInput,
  RestoreVersionInput,
  SaveNoteInput,
  SaveFrontmatterInput,
  SearchHitDTO,
  ChatRefDTO,
  ChatHistoryDTO,
  SessionLifecycle,
  SessionFileDTO,
  SpawnRequestDTO,
  AskRequestDTO,
  AskAnswerDTO,
  LiveSessionDTO,
  SettingsDTO,
  SkillDTO,
  SkillPackReviewDTO,
  TodoCommitment,
  VaultInfoDTO,
  VaultTreeDTO,
} from './dtos.js';
import type { PushEvent } from './events.js';

export * from './dtos.js';
export * from './events.js';
export * from './telemetry.js';

/**
 * The single source of truth for request/response IPC. Each entry maps a channel
 * to its argument tuple and result. The preload turns this into concrete
 * per-channel functions (see {@link IpcApi}); there is deliberately no generic
 * `invoke(channel, …)` passthrough, which would reopen the any-channel hole
 * (PLAN §3.2).
 */
export interface InvokeMap {
  'app:ping': { args: [message: string]; result: string };
  /**
   * The plain-text block behind Settings → "Copy diagnostics": versions, flags,
   * counts and the scrubbed log tail. Built in main because main is the only
   * side that knows any of it. Carries nothing of the PM's own material.
   */
  'diagnostics:report': { args: []; result: string };

  // Settings / lifecycle
  'settings:get': { args: []; result: SettingsDTO };
  'settings:setAnthropicKey': { args: [key: string]; result: SettingsDTO };
  /**
   * Does this key work? One minimal call from main, so a typo fails at the
   * field instead of twenty minutes later inside a session (ONB-5). Never
   * stores anything — saving is still `settings:setAnthropicKey`.
   */
  'settings:verifyAnthropicKey': { args: [key: string]; result: { ok: boolean; error?: string } };
  'settings:setAtlassian': {
    args: [creds: { baseUrl: string; email: string; token: string }];
    result: SettingsDTO;
  };
  'settings:setModel': { args: [modelId: string]; result: SettingsDTO };
  'settings:setSchedule': {
    args: [skill: string, patch: { dayOfWeek?: number; hour?: number; enabled?: boolean }];
    result: SettingsDTO;
  };
  'settings:setMcp': { args: [patch: { enabled?: boolean; port?: number }]; result: SettingsDTO };
  /** Who the PO is: display name and any extra addresses that mean "me". */
  'settings:setIdentity': {
    args: [patch: { name?: string | null; aliases?: string[] }];
    result: SettingsDTO;
  };
  /** First run: advance, skip, finish, dismiss, consent (docs/onboarding.md). */
  'settings:setOnboarding': { args: [patch: OnboardingPatchDTO]; result: SettingsDTO };
  'schedule:runNow': { args: [skill: string]; result: { ok: boolean } };
  'models:list': { args: []; result: ModelInfoDTO[] };

  // Skills (v2) — the parsed skill catalogue behind the Skills view
  'skills:list': { args: []; result: SkillDTO[] };
  /** Write a starter skill and hand back where it landed, so the view opens it. */
  'skills:create': { args: [title: string]; result: { path: string } };
  /**
   * What the pack has to say for itself: built-ins the PM edited that we have
   * since changed, and retired ones we moved out of force. The three below all
   * answer with the refreshed review, so the page never has to ask twice.
   */
  'skills:review': { args: []; result: SkillPackReviewDTO };
  /** Take our new version of one file, replacing theirs. */
  'skills:applyUpdate': { args: [file: string]; result: SkillPackReviewDTO };
  /** Keep theirs (or acknowledge a retirement): do not raise this one again. */
  'skills:dismissUpdate': { args: [file: string]; result: SkillPackReviewDTO };

  // Agents — the background watchers behind the Agents view, and their off switches
  'agents:list': { args: []; result: AgentDTO[] };
  'agents:setEnabled': { args: [id: string, enabled: boolean]; result: AgentDTO[] };

  // Vault
  'vault:pick': { args: []; result: VaultInfoDTO | null };
  'vault:open': { args: [path: string]; result: VaultInfoDTO };
  /**
   * Where a new workspace would go by default (`~/Documents/<AppName>`), and
   * what is already true of that folder. Read-only — nothing is created.
   */
  'vault:suggestPath': { args: []; result: PathCheckDTO };
  /** The same question about any path the PM typed or picked. */
  'vault:checkPath': { args: [path: string]; result: PathCheckDTO };
  /** Make the folder if it isn't there, then open it as the workspace. */
  'vault:create': { args: [path: string]; result: VaultInfoDTO };
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
  'note:restoreVersion': { args: [input: RestoreVersionInput]; result: NoteDTO };
  'themes:byHeat': { args: []; result: ThemeHeatDTO[] };

  // People (participant chips + their preview cards)
  'people:directory': { args: []; result: PeopleDirectoryDTO };
  'people:create': { args: [input: { name?: string; email?: string }]; result: PersonCardDTO };

  // Todos (the commitment ledger)
  'todos:capture': { args: [input: CaptureTodoInputDTO]; result: NoteDTO };
  'todos:setStatus': { args: [path: string, commitment: TodoCommitment]; result: NoteDTO };

  // Capture / search
  'note:capture': { args: [input: CaptureNoteInput]; result: NoteDTO };

  // Arrival (docs/arrival-agentic.md) — pick files, check we can read them, hand
  // the batch to a session. Nothing here decides what the material IS: `check`
  // answers "can these bytes be read at all", which is the only question left in
  // the tray, and `ingest` writes the files into a session folder and starts the
  // agent that files them.
  'arrival:pick': { args: []; result: ArrivalItemInputDTO[] };
  'arrival:check': { args: [items: ArrivalItemInputDTO[]]; result: ArrivalCheckDTO };
  'arrival:ingest': {
    args: [items: ArrivalItemInputDTO[], instruction?: string];
    result: ArrivalHandoffDTO;
  };
  'search:query': { args: [query: string, limit?: number]; result: SearchHitDTO[] };

  // Proposals
  'proposals:list': { args: [status?: string]; result: ProposalDTO[] };
  'proposals:preview': { args: [id: string]; result: ProposalPreviewDTO | null };
  // `review` rides along on the resolve that empties a session: the question to
  // put to the PO when their cards were all discarded (see MeetingReviewAskDTO).
  'proposals:accept': { args: [id: string, edited?: unknown]; result: { ok: boolean; stale?: boolean; error?: string; url?: string; review?: MeetingReviewAskDTO } };
  'proposals:reject': { args: [id: string]; result: { ok: boolean; review?: MeetingReviewAskDTO } };
  /** The PO's answer to that question: take the meeting out of "needs review". */
  'meeting:markReviewed': { args: [path: string]; result: { ok: boolean } };

  // The capture nudge's memory (docs/capture-nudge.md) — which empty meetings
  // the PO has waved off, and which recurring series went quiet after two.
  'captureNudge:state': { args: []; result: CaptureNudgeStateDTO };
  'captureNudge:dismiss': { args: [path: string]; result: CaptureNudgeDismissDTO };
  /** Take one dismissal back, series mute included. */
  'captureNudge:undo': { args: [path: string, series?: string]; result: CaptureNudgeStateDTO };

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
  // Live session state (the sidebar rail) + the cards a session parks on
  'sessions:live': { args: []; result: LiveSessionDTO[] };
  /** A session's working files — the right-panel tree (Sessions v2 Part 1). */
  'sessions:files': { args: [sessionId: string]; result: SessionFileDTO[] };
  /** One working file's text, read-only. Null when it's gone. */
  'sessions:fileText': { args: [sessionId: string, path: string]; result: string | null };
  /** The fan-out card this session is parked on, for a tab that reopened. */
  'sessions:pendingSpawn': { args: [sessionId: string]; result: SpawnRequestDTO | null };
  /** Answer a fan-out card: approve (with the chosen model) or cancel. */
  'sessions:resolveSpawn': {
    args: [requestId: string, decision: { approved: boolean; modelId?: string }];
    result: { ok: boolean };
  };
  /** The question card this session is parked on, for a tab that reopened. */
  'sessions:pendingAsk': { args: [sessionId: string]; result: AskRequestDTO | null };
  /**
   * Every question still waiting on the PM, across sessions. A parked question
   * outlives the app run that asked it (QM ticket 9), so the surfaces that rank
   * it first — the badge, Home, the sidebar — have to be able to learn about one
   * they never saw arrive.
   */
  'sessions:pendingAsks': { args: []; result: AskRequestDTO[] };
  /**
   * Answer a question card. `answers: null` is a skip — the run continues and
   * the agent is told to decide for itself, rather than being left parked.
   */
  'sessions:resolveAsk': {
    args: [requestId: string, answers: AskAnswerDTO[] | null];
    result: { ok: boolean };
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
  /**
   * The one thing only the renderer knows: which part of the app is open
   * (docs/telemetry-posthog.md TEL-5). Deliberately not a free string — the
   * main side folds anything it does not recognise away, so a view name can
   * never carry a note title. Fire and forget, like the other void channels.
   */
  'telemetry:view': { args: [view: string]; result: void };
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
  'diagnostics:report',
  'settings:get',
  'settings:setAnthropicKey',
  'settings:verifyAnthropicKey',
  'settings:setAtlassian',
  'settings:setModel',
  'settings:setSchedule',
  'settings:setMcp',
  'settings:setIdentity',
  'settings:setOnboarding',
  'schedule:runNow',
  'models:list',
  'skills:list',
  'skills:create',
  'skills:review',
  'skills:applyUpdate',
  'skills:dismissUpdate',
  'agents:list',
  'agents:setEnabled',
  'vault:pick',
  'vault:open',
  'vault:suggestPath',
  'vault:checkPath',
  'vault:create',
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
  'note:restoreVersion',
  'themes:byHeat',
  'people:directory',
  'people:create',
  'todos:capture',
  'todos:setStatus',
  'note:capture',
  'arrival:pick',
  'arrival:check',
  'arrival:ingest',
  'search:query',
  'proposals:list',
  'proposals:preview',
  'proposals:accept',
  'proposals:reject',
  'meeting:markReviewed',
  'captureNudge:state',
  'captureNudge:dismiss',
  'captureNudge:undo',
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
  'sessions:pendingSpawn',
  'sessions:resolveSpawn',
  'sessions:pendingAsk',
  'sessions:pendingAsks',
  'sessions:resolveAsk',
  'connections:providers',
  'connections:list',
  'connections:connect',
  'connections:renewAuth',
  'connections:disconnect',
  'connections:cancelOAuth',
  'connections:setFollow',
  'connections:syncNow',
  'telemetry:view',
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

/** The typed client surface exposed on `window.qale.invoke`. */
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

/** The full bridge surface the preload puts on `window.qale`. */
export interface QaleBridge {
  invoke: IpcApi;
  /** Subscribe to a push channel; returns an unsubscribe fn. */
  onEvent: (cb: (event: PushEvent) => void) => () => void;
  /**
   * Where a dropped file actually lives on disk, or "" for something dragged
   * out of a web page. This is what makes a dropped FOLDER work: the renderer
   * can only read a folder as an unreadable zero-byte file, while main can walk
   * it. Every drop takes the path route when there is one, so dropping and
   * choosing from the picker are one code path.
   */
  pathForFile: (file: DroppedFile) => string;
}

/**
 * The DOM's `File`, structurally. Spelled out because this package is shared
 * with main and has no DOM lib; a real `File` satisfies it, which is all the
 * renderer ever passes.
 */
export interface DroppedFile {
  name: string;
  size: number;
  type: string;
}
