import type {
  ActivityDTO,
  LearnedRowDTO,
  AgentDTO,
  AgentRunInput,
  AgentRunHandle,
  ArrivalCheckDTO,
  ArrivalAttachDTO,
  ArrivalHandoffDTO,
  ArrivalItemInputDTO,
  ArrivalProgressDTO,
  AtRiskLinkDTO,
  BacklinkDTO,
  ConnectionDTO,
  ConnectResultDTO,
  ContainerRecommendationDTO,
  ExternalRefMetaDTO,
  ProviderDescriptorDTO,
  ShallowIndexItemDTO,
  CaptureNoteInput,
  CaptureNudgeDismissDTO,
  CaptureNudgeStateDTO,
  CaptureTodoInputDTO,
  CreateNoteInputDTO,
  LlmProviderDTO,
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
  PeopleDirectoryDTO,
  PersonCardDTO,
  MoveNoteInput,
  CreateFolderInput,
  DeleteFolderInput,
  RenameFolderInput,
  RenameNoteInput,
  RestoreVersionInput,
  SaveNoteInput,
  SaveFrontmatterInput,
  SearchHitDTO,
  ChatRefDTO,
  ChatHistoryDTO,
  CodebasePathDTO,
  CodebaseRequestDTO,
  CodebaseStatusDTO,
  DemoInfoDTO,
  GitStatusDTO,
  RevertChangeInput,
  RevertResultDTO,
  SessionLifecycle,
  SessionFileDTO,
  SpawnRequestDTO,
  AskRequestDTO,
  AskAnswerDTO,
  LiveSessionDTO,
  SettingsDTO,
  SidebarMeetingStateDTO,
  SkillDTO,
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
   * A native folder picker, and nothing else: it opens no folder and changes no
   * setting, it only answers with the path the PM chose (null when they backed
   * out). The caller supplies the dialog title, so one channel serves any panel
   * that needs a folder from the machine.
   */
  'app:pickFolder': { args: [title: string]; result: string | null };
  /**
   * The plain-text block behind Settings → "Copy diagnostics": versions, flags,
   * counts and the scrubbed log tail. Built in main because main is the only
   * side that knows any of it. Carries nothing of the PM's own material.
   */
  'diagnostics:report': { args: []; result: string };

  // Settings / lifecycle
  'settings:get': { args: []; result: SettingsDTO };
  /**
   * Store one provider's key. It does not choose the provider: the two are
   * separate calls, so the opening can ask for them in either order. An empty
   * key removes that provider's stored one.
   */
  'settings:setProviderKey': {
    args: [provider: LlmProviderDTO, key: string];
    result: SettingsDTO;
  };
  /**
   * Whose API answers, from now on. The model moves with it: a session default
   * belonging to the other provider is carried to this one's default.
   */
  'settings:setProvider': { args: [provider: LlmProviderDTO]; result: SettingsDTO };
  /**
   * Does this key work? One minimal call from main, so a typo fails at the
   * field instead of twenty minutes later inside a session (ONB-5). Never
   * stores anything: saving is still `settings:setProviderKey`.
   */
  'settings:verifyProviderKey': {
    args: [provider: LlmProviderDTO, key: string];
    result: { ok: boolean; error?: string };
  };
  'settings:setModel': { args: [modelId: string]; result: SettingsDTO };
  /**
   * What the workspace is written in, as a language tag. Only affects what gets
   * written from now on: notes already on disk keep the language they are in.
   */
  'settings:setLanguage': { args: [language: string]; result: SettingsDTO };
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
  /** The same for a voice: a flat file in `voices/`, seeded with a tone brief. */
  'voices:create': { args: [title: string]; result: { path: string } };

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
  /**
   * A folder picker that only answers "where" — the folder to put a new
   * workspace *in*. Unlike `vault:pick` it opens nothing and changes nothing,
   * so the PM can back out of the new-workspace form with the old one intact.
   */
  'vault:pickLocation': { args: []; result: string | null };
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
  'note:create': { args: [input: CreateNoteInputDTO]; result: NoteDTO };
  'note:rename': { args: [input: RenameNoteInput]; result: NoteDTO };
  /** Move a document into one of the PM's own folders under `notes/` (E-14). */
  'note:move': { args: [input: MoveNoteInput]; result: NoteDTO };
  'note:delete': { args: [path: string]; result: { ok: boolean } };
  // Folders in Documents (docs/documents-folders.md DF-1). A folder is a
  // persistent object: it exists when `notes/<folder>/index.md` exists or a
  // document is in it.
  /** Make a folder. Answers with the normalized path, so the view can open it. */
  'folder:create': { args: [input: CreateFolderInput]; result: { folder: string } };
  /** Delete an empty folder. */
  'folder:delete': { args: [input: DeleteFolderInput]; result: { ok: boolean } };
  /** Rename a folder; every file inside moves with it, basenames untouched. */
  'folder:rename': { args: [input: RenameFolderInput]; result: { folder: string } };
  /**
   * "I checked this": append one `human:<you>` verification to the note. Its
   * own channel because the frontmatter form cannot carry it. The mutability
   * invariant freezes `verified` on the very types worth vouching for (a
   * meeting, a session receipt). `ok: false` when the note is gone, or when you
   * already checked it today.
   */
  'note:markChecked': { args: [path: string]; result: { ok: boolean } };
  'note:backlinks': { args: [path: string]; result: BacklinkDTO[] };
  'note:resolveLink': { args: [target: string]; result: string | null };
  'note:history': { args: [path: string]; result: NoteCommitDTO[] };
  'note:versionAt': { args: [path: string, hash: string]; result: string | null };
  'note:restoreVersion': { args: [input: RestoreVersionInput]; result: NoteDTO };
  /** Can this machine keep history, and if not, how does the PM get it? */
  'git:status': { args: []; result: GitStatusDTO };
  /**
   * Undo one recorded change to one note (E-2): an edit goes back, a deleted
   * note comes back, a note the change created goes away. Written forward, so
   * the undo is itself a version and can be undone in turn. This is the one
   * revert path in the app; Activity is its caller.
   */
  'history:revert': { args: [input: RevertChangeInput]; result: RevertResultDTO };

  // People (participant chips + their preview cards)
  'people:directory': { args: []; result: PeopleDirectoryDTO };
  'people:create': { args: [input: { name?: string; email?: string }]; result: PersonCardDTO };

  // Todos (the commitment ledger)
  'todos:capture': { args: [input: CaptureTodoInputDTO]; result: NoteDTO };
  /** Null when the todo went away: dropping one Qale only heard deletes the
   *  file rather than leaving a closed row (docs/fewer-approvals.md FA-7). */
  'todos:setStatus': { args: [path: string, commitment: TodoCommitment]; result: NoteDTO | null };
  /** Snooze: move the due date, or `null` to clear it (→ Someday). */
  'todos:setDue': { args: [path: string, due: string | null]; result: NoteDTO };

  // Capture / search
  'note:capture': { args: [input: CaptureNoteInput]; result: NoteDTO };

  // Arrival (docs/arrival-agentic.md) — pick files, check we can read them, hand
  // the batch to a session. Nothing here decides what the sources ARE: `check`
  // answers "can these bytes be read at all", which is the only question left in
  // the tray, and `ingest` writes the files into a session folder and starts the
  // agent that files them.
  'arrival:pick': { args: []; result: ArrivalItemInputDTO[] };
  'arrival:check': { args: [items: ArrivalItemInputDTO[]]; result: ArrivalCheckDTO };
  'arrival:ingest': {
    args: [items: ArrivalItemInputDTO[], instruction?: string, modelId?: string];
    result: ArrivalHandoffDTO;
  };
  /**
   * Files onto a session that already exists: a drop on an open conversation.
   * `ingest` cannot carry this: it mints a new session every time. Nothing is
   * started here, because the session is already running; the renderer sends an
   * ordinary message naming the files it got back.
   */
  'arrival:attach': {
    args: [sessionId: string, items: ArrivalItemInputDTO[]];
    result: ArrivalAttachDTO;
  };
  /**
   * Batches that are still being read, or that settled while this window was
   * away (docs/critical-mass.md CM-2). The counts arrive as pushes; this is the
   * cold read a reopened tab needs so a run in flight is not a blank line.
   */
  'arrival:batches': { args: []; result: ArrivalProgressDTO[] };
  'search:query': { args: [query: string, limit?: number]; result: SearchHitDTO[] };

  // Proposals
  'proposals:list': { args: [status?: string]; result: ProposalDTO[] };
  /**
   * The cards one session already had judged: accepted and rejected, oldest
   * first. The chat's receipt is built from these rather than from hook state,
   * so reopening a session next week still shows what it changed
   * (docs/closing-beat.md). Scoped to the session on purpose: the whole
   * history of every resolved card is not something a surface should carry.
   */
  'proposals:resolved': { args: [sessionId: string]; result: ProposalDTO[] };
  'proposals:preview': { args: [id: string]; result: ProposalPreviewDTO | null };
  // `review` rides along on the resolve that empties a session: the question to
  // put to the PO when their cards were all discarded (see MeetingReviewAskDTO).
  'proposals:accept': {
    args: [id: string, edited?: unknown];
    result: {
      ok: boolean;
      stale?: boolean;
      /** Why a stale refusal refused, in the preview's vocabulary. `missing` is
       *  a delete card's only way to go stale: the file is already gone. */
      staleReason?: 'unanchored' | 'duplicate' | 'missing';
      error?: string;
      url?: string;
      /** What the send touched at the provider: the key of the ticket it just
       *  created, the id of the event it added. The green receipt draws it as a
       *  chip, so the line the PM reads is a way to the item itself. */
      externalId?: string;
      review?: MeetingReviewAskDTO;
      /** The vault note the accept wrote, after any rename it also made — the
       *  rail pins what the PM approves (docs/autopinning.md). */
      path?: string;
      /** The Activity row the approved write left, so the chat can draw it as a
       *  landed row with a put-back (docs/receipt-redesign.md RC-4). Absent for
       *  a send, and for a workspace that kept no history. */
      activityId?: string;
    };
  };
  'proposals:reject': { args: [id: string]; result: { ok: boolean; review?: MeetingReviewAskDTO } };
  /** The PO's answer to that question: take the meeting out of "needs review". */
  'meeting:markReviewed': { args: [path: string]; result: { ok: boolean } };
  /**
   * What the agent did without asking, newest first (docs/easier-tickets.md
   * E-9). Read-only: nothing writes a row from the renderer, and every row is
   * already the receipt for a write that landed.
   */
  'activity:list': { args: [limit?: number]; result: ActivityDTO[] };
  /**
   * The last thing Qale learned about each file it learns into (ticket 13).
   * The Skills page asks for these rather than filter the list above: what it
   * needs is one row per file, and the newest one can be older than any limit
   * a list read would carry.
   */
  'activity:latestByPath': { args: []; result: LearnedRowDTO[] };
  /**
   * Put one Activity row back, by its id. The row already holds the commit to
   * undo, so main reads it from there and the renderer never handles a hash:
   * a row can only ever undo its own write. It runs the same use-case
   * `history:revert` does, and marks the row put back once the files are.
   */
  'activity:revert': { args: [id: string]; result: RevertResultDTO };

  // The capture nudge's memory (docs/capture-nudge.md) — which empty meetings
  // the PO has waved off, and which recurring series went quiet after two.
  'captureNudge:state': { args: []; result: CaptureNudgeStateDTO };
  'captureNudge:dismiss': { args: [path: string]; result: CaptureNudgeDismissDTO };
  /** Take one dismissal back, series mute included. */
  'captureNudge:undo': { args: [path: string, series?: string]; result: CaptureNudgeStateDTO };

  // The sidebar Meetings row's own memory (docs/sidebar-ia.md, SB-6) — which
  // upcoming meetings the PO waved off that row for. Separate from the capture
  // nudge above: dismissing a sidebar row says nothing about filing notes.
  'sidebarMeeting:state': { args: []; result: SidebarMeetingStateDTO };
  'sidebarMeeting:dismiss': { args: [path: string]; result: SidebarMeetingStateDTO };
  'sidebarMeeting:undo': { args: [path: string]; result: SidebarMeetingStateDTO };

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
  /** The codebase card this session is parked on, for a tab that reopened. */
  'sessions:pendingCodebase': { args: [sessionId: string]; result: CodebaseRequestDTO | null };
  /**
   * Answer a codebase card: run it (with the chosen model) or not. A run that
   * resumes a Claude Code session carries no model: it keeps the one that
   * session started with.
   */
  'sessions:resolveCodebase': {
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
   * The PM answered a question card, or skipped it (`null`). A card whose turn
   * is gone is replayed: the session reopens and the answer arrives as a
   * message.
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
   * What this connection's survey says is worth following, busiest first
   * (docs/product-understanding.md FL-1/FL-2). Hits the provider, so it is
   * asked for once when the picker opens rather than on every list. An empty
   * result is the honest answer for a brand-new hire, and the picker falls back
   * to the flat catalogue without comment.
   */
  'connections:recommend': {
    args: [connectionId: string];
    result: ContainerRecommendationDTO[];
  };
  /**
   * The one thing only the renderer knows: which part of the app is open
   * (docs/telemetry-posthog.md TEL-5). Deliberately not a free string — the
   * main side folds anything it does not recognise away, so a view name can
   * never carry a note title. Fire and forget, like the other void channels.
   */
  'telemetry:view': { args: [view: string, tabs: number]; result: void };
  /**
   * Which meeting tool's guide got opened in First steps (CM-1). Same rule as
   * the view above: one word from a list we wrote, folded away main-side if it
   * is not one of ours, so the channel can carry nothing else. Fire and forget.
   */
  'telemetry:meetingTool': { args: [tool: string]; result: void };
  /**
   * Which update style the PM picked under the first draft, and for which
   * voice (docs/learning-how-you-work.md ticket 15). The panel is the only
   * place that knows, and its labels are headings out of the voice file, which
   * the PM may have rewritten. So the renderer folds all three to words from
   * the allowlist before they reach this channel, and the allowlist folds
   * again main-side. Fire and forget.
   */
  'telemetry:stylePick': { args: [voice: string, style: string, answer: string]; result: void };
  'connections:searchIndex': {
    args: [query: string, limit?: number];
    result: ShallowIndexItemDTO[];
  };
  'connections:refMeta': { args: [slug: string]; result: ExternalRefMetaDTO | null };
  'connections:atRisk': { args: []; result: AtRiskLinkDTO[] };
  /** Current mirrored body of a wikipage — the "before" of a redline preview. */
  'connections:pageBody': { args: [externalIdOrSlug: string]; result: string | null };

  // Codebase (docs/claude-code-tickets.md). Nothing outside the settings panel
  // asks for any of this: the capability is discovered there or not at all.
  /** The configured folders. Empty means the capability is off. */
  'codebase:get': { args: []; result: CodebasePathDTO[] };
  /**
   * Replace the folder list, and answer with what that list now discovers, so
   * the panel repaints from one round trip. An empty list turns it all off.
   */
  'codebase:set': { args: [paths: CodebasePathDTO[]]; result: CodebaseStatusDTO };
  /** The repos under the configured folders, plus the `claude` probe. */
  'codebase:status': { args: []; result: CodebaseStatusDTO };

  // Demo build only (docs/demo-mode.md). In an ordinary build `demo:info`
  // answers `enabled: false` with no scenarios and the Settings section is
  // not drawn, so the other two are never called.
  /** What the Demo section draws: the date it is set to, and the scenarios. */
  'demo:info': { args: []; result: DemoInfoDTO };
  /** Back to the start of the script, dated today. Throws away the last demo. */
  'demo:reset': { args: []; result: void };
  /** Put the drag-in files on the Desktop and open the folder. */
  'demo:openSamples': { args: []; result: void };
}

export type InvokeChannel = keyof InvokeMap;

/**
 * Runtime list of every invoke channel. The preload iterates this to build the
 * concrete API; keeping it in lockstep with {@link InvokeMap} is enforced by the
 * `satisfies` check below (a missing/extra key is a compile error).
 */
export const INVOKE_CHANNELS = [
  'app:ping',
  'app:pickFolder',
  'diagnostics:report',
  'settings:get',
  'settings:setProviderKey',
  'settings:setProvider',
  'settings:verifyProviderKey',
  'settings:setModel',
  'settings:setLanguage',
  'settings:setSchedule',
  'settings:setMcp',
  'settings:setIdentity',
  'settings:setOnboarding',
  'schedule:runNow',
  'models:list',
  'skills:list',
  'skills:create',
  'voices:create',
  'agents:list',
  'agents:setEnabled',
  'vault:pick',
  'vault:open',
  'vault:suggestPath',
  'vault:checkPath',
  'vault:pickLocation',
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
  'note:create',
  'note:rename',
  'note:move',
  'note:delete',
  'folder:create',
  'folder:delete',
  'folder:rename',
  'note:markChecked',
  'note:backlinks',
  'note:resolveLink',
  'note:history',
  'note:versionAt',
  'note:restoreVersion',
  'git:status',
  'history:revert',
  'people:directory',
  'people:create',
  'todos:capture',
  'todos:setStatus',
  'todos:setDue',
  'note:capture',
  'arrival:pick',
  'arrival:check',
  'arrival:ingest',
  'arrival:attach',
  'arrival:batches',
  'search:query',
  'proposals:list',
  'proposals:resolved',
  'proposals:preview',
  'proposals:accept',
  'proposals:reject',
  'meeting:markReviewed',
  'activity:list',
  'activity:latestByPath',
  'activity:revert',
  'captureNudge:state',
  'captureNudge:dismiss',
  'captureNudge:undo',
  'sidebarMeeting:state',
  'sidebarMeeting:dismiss',
  'sidebarMeeting:undo',
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
  'sessions:pendingCodebase',
  'sessions:resolveCodebase',
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
  'connections:recommend',
  'telemetry:view',
  'telemetry:meetingTool',
  'telemetry:stylePick',
  'connections:searchIndex',
  'connections:refMeta',
  'connections:atRisk',
  'connections:pageBody',
  'codebase:get',
  'codebase:set',
  'codebase:status',
  'demo:info',
  'demo:reset',
  'demo:openSamples',
] as const satisfies readonly InvokeChannel[];

// Compile-time completeness guard: every InvokeMap key must appear above. A
// channel that is typed and handled but missing from the list has no preload
// function, so the renderer call throws `is not a function` mid-render and the
// window goes white. Keep the value below a plain `true`: an `as never` cast
// satisfies any annotation and turns this guard into a no-op, which is how
// `sessions:pendingCodebase` shipped missing.
type _AllChannelsListed = Exclude<InvokeChannel, (typeof INVOKE_CHANNELS)[number]>;
const _exhaustive: _AllChannelsListed extends never
  ? true
  : ['missing channels', _AllChannelsListed] = true;
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
