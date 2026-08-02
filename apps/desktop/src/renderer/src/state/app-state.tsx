import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  AgentDTO,
  AgentPingDTO,
  BacklinkDTO,
  CaptureNoteInput,
  CaptureTodoInputDTO,
  ChatRefDTO,
  IngestCaptureInputDTO,
  IngestCaptureResultDTO,
  ArrivalAmbitionDTO,
  ArrivalItemInputDTO,
  ArrivalPlanDTO,
  ArrivalResultDTO,
  ArrivalUndoResultDTO,
  LiveSessionDTO,
  MeetingReviewAskDTO,
  NoteDTO,
  NoteQueryDTO,
  NoteRefDTO,
  NoteType,
  PeopleDirectoryDTO,
  PersonCardDTO,
  PingResolveActionDTO,
  ThemeHeatDTO,
  ProposalDTO,
  SearchHitDTO,
  SessionFileDTO,
  SessionLifecycle,
  SpawnRequestDTO,
  AskRequestDTO,
  AskAnswerDTO,
  SkillDTO,
  TodoCommitment,
  VaultInfoDTO,
  VaultTreeDTO,
} from '@pm/ipc';
import { isFolderIndex } from '@pm/domain';
import { invoke, onEvent } from '../lib/ipc';
import { outcomeOf } from '../lib/arrival-outcome';
import { requestCapture } from '../lib/capture-event';
import { meetingRailHorizon, qualifiesForRail } from '../lib/note-status';
import { buildAttention, waitingOnYou, type AttentionItem } from '../lib/attention';
import {
  CORE_TYPES,
  contentTypes,
  loadRevealSeen,
  loadRevealed,
  persistRevealSeen,
  persistRevealed,
} from '../lib/reveal';
import type { NavOpts } from '../lib/nav';

/**
 * One visitable place — a document, a session, or an app view. Tabs navigate
 * browser-style (PLAN-V2 §3.3): a plain click pushes the destination onto the
 * ACTIVE tab's history, ⌘click opens it in a new tab, and every tab has its
 * own back/forward.
 */
export type ViewBody = { title: string } & (
  /** The gateway: greeting, one composer, what's waiting. Also what an empty
   *  workbench falls back to, so Home is never a place you can lose. */
  | { kind: 'home' }
  | { kind: 'doc'; path: string; noteType?: NoteType }
  /** `skill` is the invocation the FIRST turn carries — not a kind of session.
   *  A bound conversation (sessionId set) has already spent it and passes none.
   *  `autoTitle` marks a placeholder title ("Ask", "Session") that the session
   *  itself replaces once it has a first message to name itself with. */
  | {
      kind: 'session';
      skill?: string;
      sessionId?: string;
      initialPrompt?: string;
      autoTitle?: boolean;
    }
  /** A session's working file, read-only and visibly not a note (Sessions v2). */
  | { kind: 'sessionFile'; sessionId: string; path: string }
  | { kind: 'chats' }
  | { kind: 'inbox' }
  | { kind: 'todos' }
  | { kind: 'memory' }
  | { kind: 'folder'; dir: string }
  | { kind: 'context'; tag: string }
  | { kind: 'settings' }
  | { kind: 'skills' }
  /** The background watchers and their off switches — Skills' sibling. */
  | { kind: 'agents' }
);

/** A history entry. `key` is stable for the entry's lifetime — React remount
 *  keys and session binding hang off it. */
export type View = ViewBody & { key: string };

/** A tab: a browser-style history of views plus a cursor into it. */
interface TabState {
  id: string;
  history: View[];
  index: number;
}

/** What consumers see per tab: its CURRENT view, flattened next to the id. */
export type Tab = View & { id: string };

const currentView = (t: TabState): View => t.history[t.index]!;

/** Same destination? A re-click must not grow history. */
function sameTarget(a: View, b: ViewBody): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'doc':
      return a.path === (b as Extract<ViewBody, { kind: 'doc' }>).path;
    case 'sessionFile': {
      const f = b as Extract<ViewBody, { kind: 'sessionFile' }>;
      return a.sessionId === f.sessionId && a.path === f.path;
    }
    case 'folder':
      return a.dir === (b as Extract<ViewBody, { kind: 'folder' }>).dir;
    case 'context':
      return a.tag === (b as Extract<ViewBody, { kind: 'context' }>).tag;
    case 'session': {
      const s = b as Extract<ViewBody, { kind: 'session' }>;
      // Bound conversations match by id; two unbound blanks opening on the same
      // skill (e.g. re-clicking Ask) are the same fresh composer.
      if (a.sessionId || s.sessionId) return a.sessionId === s.sessionId;
      return a.skill === s.skill && !a.initialPrompt && !s.initialPrompt;
    }
    default:
      return true;
  }
}

/** Per-tab history cap — a runaway browse session must not grow unbounded. */
const HISTORY_CAP = 50;

interface DocData {
  note: NoteDTO | null;
  backlinks: BacklinkDTO[];
}

/**
 * A session as the shell sees it — one merged row per conversation, combining
 * the stored transcript (chats list), the live run state (session:status), the
 * cards it has pending, and whether the PO has seen its latest activity.
 * This single derivation feeds the sidebar rail, the Inbox, and the history view.
 */
export interface SessionOverview {
  id: string;
  title: string;
  updated: number;
  running: boolean;
  /** In-flight stream — present while running; lets any surface stop the run. */
  streamId?: string;
  pendingCards: number;
  /** Activity since the PO last looked at this session (and it isn't running). */
  unread: boolean;
  messageCount: number;
  /** User-set shelf state — done/dismissed sessions leave the active surfaces. */
  lifecycle: SessionLifecycle;
}

interface AppState {
  vault: VaultInfoDTO | null;
  tree: VaultTreeDTO | null;
  /**
   * Everyone with a person page, plus who "me" is — the table participant chips
   * resolve against, so a name never costs a round trip and the PO's own row
   * never reads as an email. Refreshed with the tree.
   */
  people: PeopleDirectoryDTO | null;
  /** Give a name/address its own page (from a participant chip) — the join key
   *  that lets the NEXT calendar sync resolve that attendee here. */
  createPerson: (input: { name?: string; email?: string }) => Promise<PersonCardDTO>;
  tabs: Tab[];
  activeTabId: string | null;
  activeTab: Tab | null;
  docData: Record<string, DocData>;
  openVaultDialog: () => Promise<void>;
  /** Turn the open workspace into a git repo (consent-gated version history). */
  enableGit: () => Promise<void>;
  /**
   * Every note on the sidebar rail, per workspace — this set *is* what the rail
   * shows. Both the PO's hand-pins and the system's auto-pins live here; there is
   * no separate "pinned" shelf. Ordering/grouping by type happens at render.
   */
  favorites: string[];
  /**
   * Pin ⇄ unpin a note (exact opposites). Pin adds it to the rail under its type
   * and clears any prior unpin; unpin removes it and records the path so the
   * auto-pinner won't drag it back. Used by the note-view toggle and the rail's X.
   */
  toggleFavorite: (path: string) => void;
  /**
   * Paths the PO has unpinned. View-only state (never a vault write). Its sole job
   * is to stop the auto-pinner from re-adding something the PO deliberately cleared
   * — `favorites ∪ dismissed` is the "already decided, hands off" set.
   */
  dismissed: string[];
  /**
   * Progressive reveal: every type the UI may surface — the core set plus any
   * type the memory has ever held. Earned stays earned; nothing un-reveals.
   */
  revealed: Set<NoteType>;
  /** Freshly earned types the PO hasn't visited yet — they carry the quiet
   *  "new" mark until first click. */
  revealNew: Set<NoteType>;
  /** Acknowledge a newly earned type (clears its "new" mark). */
  markRevealSeen: (type: NoteType) => void;
  /**
   * Paths the auto-pinner put on the rail that the PO hasn't opened from there
   * yet — they carry the same quiet mark a freshly revealed type does. Only the
   * system's additions land here; a hand-pin is never marked.
   */
  autoPinNew: Set<string>;
  /** Acknowledge an auto-pinned row (clears its mark). */
  markPinSeen: (path: string) => void;
  proposals: ProposalDTO[];
  themes: ThemeHeatDTO[];
  /** Merged session rows (stored + live + cards + seen) — rail, Inbox, history. */
  sessions: SessionOverview[];
  pings: AgentPingDTO[];
  /** The parsed skill catalogue (Skills v2) — refreshed on skill-file changes. */
  skills: SkillDTO[];
  refreshSkills: () => Promise<void>;
  /** The agent roster — refreshed on agent-file changes, new cards, and settled runs. */
  agents: AgentDTO[];
  refreshAgents: () => Promise<void>;
  /** Flip an agent's switch (a frontmatter edit in its file), optimistically. */
  setAgentEnabled: (id: string, enabled: boolean) => Promise<void>;
  /**
   * The one attention list — everything waiting on the PO, ranked, in one
   * place (`lib/attention.ts`). Home, the sidebar badge, ⌘K and the Inbox are
   * all named filters over THIS array; none of them counts anything itself.
   */
  attention: AttentionItem[];
  /** `waitingOnYou(attention).length` — the single number every "N waiting"
   *  badge prints. Kept here so the filter is applied exactly once. */
  waitingCount: number;
  markSessionSeen: (sessionId: string) => void;
  refreshSessions: () => Promise<void>;
  openPing: (ping: AgentPingDTO) => Promise<void>;
  dismissPing: (id: string) => Promise<void>;
  /** One-tap apply/skip of a ping suggestion item — the tap is the approval. */
  resolvePingItem: (pingId: string, itemId: string, action: PingResolveActionDTO) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  /** Mark a conversation done/dismissed, or reopen it (active). */
  setSessionLifecycle: (sessionId: string, lifecycle: SessionLifecycle) => Promise<void>;
  // navigation — every open* navigates the active tab in place unless the
  // NavOpts (from a ⌘click via navFromEvent) ask for a new tab.
  openDoc: (path: string, opts?: NavOpts) => Promise<void>;
  /** Open a fresh conversation, optionally invoking a skill on its first turn. */
  openSession: (
    skill?: string,
    opts?: { initialPrompt?: string; title?: string; fresh?: boolean } & NavOpts,
  ) => void;
  /** Reopen a stored conversation (replayed from the pi JSONL). */
  openChat: (chat: { id: string; title: string }, opts?: NavOpts) => void;
  /** Open the chat-history list. */
  openChats: (opts?: NavOpts) => void;
  /** Fan-out approval cards waiting on the PM, keyed by session id. */
  spawnRequests: Record<string, SpawnRequestDTO>;
  resolveSpawn: (request: SpawnRequestDTO, decision: { approved: boolean; modelId?: string }) => Promise<void>;
  /** Question cards a running turn is parked on, keyed by session id. */
  askRequests: Record<string, AskRequestDTO>;
  /** Answer one — `null` skips it, which un-parks the turn rather than stopping it. */
  resolveAsk: (request: AskRequestDTO, answers: AskAnswerDTO[] | null) => Promise<void>;
  /** Working files of a session, keyed by session id (Sessions v2 Part 1). */
  sessionFiles: Record<string, SessionFileDTO[]>;
  refreshSessionFiles: (sessionId: string) => Promise<void>;
  /** Open one working file read-only, as its own tab. */
  openSessionFile: (sessionId: string, path: string, opts?: NavOpts) => void;
  /** Record the session id the agent assigned to a session view's conversation. */
  bindTabSession: (viewKey: string, sessionId: string) => void;
  /** Open Home — the gateway (⇧⌘H; ⌘T opens it in a fresh tab). */
  openHome: (opts?: NavOpts) => void;
  openInbox: (opts?: NavOpts) => void;
  /** Open the Todos view — the commitment ledger. */
  openTodos: (opts?: NavOpts) => void;
  /** Open the Memory page — the full directory of every note type. */
  openMemory: (opts?: NavOpts) => void;
  openFolder: (dir: string, opts?: NavOpts) => void;
  /** Open a context (tag) page — the cross-cutting project/product/area axis. */
  openContext: (tag: string, opts?: NavOpts) => void;
  openSettings: (opts?: NavOpts) => void;
  /** Open the Skills view — the parsed skill catalogue (Skills v2). */
  openSkills: (opts?: NavOpts) => void;
  /** Open the Agents view — the background watchers and their off switches. */
  openAgents: (opts?: NavOpts) => void;
  /** Per-tab history — back/forward act on the active tab (browser semantics). */
  goBack: () => void;
  goForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  /** ⇧⌘T — restore the most recently closed tab, its history intact. */
  reopenClosedTab: () => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeAllTabs: () => void;
  closeTabsBefore: (id: string) => void;
  closeTabsAfter: (id: string) => void;
  /** Move a tab to a new position in the strip (drag-and-drop / keyboard reorder). */
  moveTab: (id: string, toIndex: number) => void;
  setActiveTab: (id: string) => void;
  // data
  /** Re-fetch a note (+ backlinks) into docData — e.g. to resync after a rejected save. */
  loadDoc: (path: string) => Promise<NoteDTO | null>;
  query: (q: NoteQueryDTO) => Promise<NoteRefDTO[]>;
  /** Universal ingest: file the capture, then open the follow-up session or the note. */
  ingestCapture: (input: IngestCaptureInputDTO) => Promise<IngestCaptureResultDTO>;
  /** Native multi-select picker; returns items ready for `inspectArrival`. */
  pickMaterial: () => Promise<ArrivalItemInputDTO[]>;
  /** What an arrival will do, computed by the code that will do it. */
  inspectArrival: (
    items: ArrivalItemInputDTO[],
    ambition?: ArrivalAmbitionDTO,
  ) => Promise<ArrivalPlanDTO>;
  /** File a whole batch; the receipt it returns owns the undo. */
  ingestArrival: (
    items: ArrivalItemInputDTO[],
    ambition?: ArrivalAmbitionDTO,
  ) => Promise<ArrivalResultDTO>;
  /** Take a whole arrival back — created files removed, modified ones restored. */
  undoArrival: (id: string) => Promise<ArrivalUndoResultDTO>;
  previewProposal: (
    id: string,
  ) => Promise<{
    before: string;
    after: string;
    stale: boolean;
    staleReason?: 'changed' | 'unanchored';
  } | null>;
  refreshProposals: () => Promise<void>;
  /** Both resolves can hand back a `review` ask: the session emptied with
   *  nothing kept, so the Inbox asks whether its meeting is reviewed anyway. */
  acceptProposal: (
    id: string,
    edited?: unknown,
  ) => Promise<{
    ok: boolean;
    stale?: boolean;
    error?: string;
    url?: string;
    review?: MeetingReviewAskDTO;
  }>;
  rejectProposal: (id: string) => Promise<{ ok: boolean; review?: MeetingReviewAskDTO }>;
  /** The PO's answer to that ask: take the meeting out of "needs review". */
  markMeetingReviewed: (path: string) => Promise<{ ok: boolean }>;
  captureNote: (input: CaptureNoteInput) => Promise<NoteDTO>;
  /** Quick-add a todo (already parsed from the one-liner). */
  captureTodo: (input: CaptureTodoInputDTO) => Promise<NoteDTO>;
  /** Flip a todo open/done/dropped. */
  setTodoStatus: (path: string, commitment: TodoCommitment) => Promise<void>;
  saveNote: (path: string, body: string) => Promise<void>;
  saveFrontmatter: (path: string, frontmatter: Record<string, unknown>) => Promise<void>;
  /** Retitle a note; the file may move, so open tabs/favourites follow the new path. */
  renameNote: (path: string, title: string) => Promise<NoteDTO>;
  /** Delete a note: close open tabs, drop from favourites, purge docData, remove file. */
  deleteNote: (path: string) => Promise<void>;
  search: (query: string) => Promise<SearchHitDTO[]>;
}

const Ctx = createContext<AppState | null>(null);

let tabSeq = 0;
const nextId = (): string => `t${Date.now().toString(36)}_${tabSeq++}`;

const TABS_KEY = 'pm.tabs.v3';
/** Pre-history format: one flat view per tab. Read once for migration. */
const LEGACY_TABS_KEY = 'pm.tabs.v2';
/** Favourites persist per workspace: `pm.favorites.v1:<vault path>` → string[]. */
const FAVORITES_KEY = 'pm.favorites.v1';
/** Unpinned-off-rail paths, per workspace: `pm.dismissed.v1:<vault path>` → string[]. */
const DISMISSED_KEY = 'pm.dismissed.v1';
/**
 * Auto-pinned paths the PO hasn't opened from the rail yet, per workspace:
 * `pm.autoPinNew.v1:<vault path>` → string[]. View-only state (never a vault
 * write), written the moment the auto-pinner adds a path and emptied one path
 * at a time as the PO clicks the rows.
 */
const AUTO_PIN_NEW_KEY = 'pm.autoPinNew.v1';
/**
 * Per-workspace "last looked at this session" timestamps. `__init` grandfathers
 * pre-existing conversations so the feature's first launch doesn't mark the
 * whole history unread.
 */
const SEEN_KEY = 'pm.sessionSeen.v1';

function loadSeen(vaultPath: string): Record<string, number> {
  const storageKey = `${SEEN_KEY}:${vaultPath}`;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, number>;
    }
  } catch {
    /* fall through to init */
  }
  const init = { __init: Date.now() };
  try {
    localStorage.setItem(storageKey, JSON.stringify(init));
  } catch {
    /* ignore quota */
  }
  return init;
}

function loadFavorites(vaultPath: string): string[] {
  try {
    const raw = localStorage.getItem(`${FAVORITES_KEY}:${vaultPath}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

/** Write the per-workspace favourites list back to localStorage (best-effort). */
function persistFavorites(vaultPath: string, next: string[]) {
  try {
    localStorage.setItem(`${FAVORITES_KEY}:${vaultPath}`, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}

function loadDismissed(vaultPath: string): string[] {
  try {
    const raw = localStorage.getItem(`${DISMISSED_KEY}:${vaultPath}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) return parsed.filter((p): p is string => typeof p === 'string');
    // Migrate the old { path: mtime } shape to a plain set of unpinned paths.
    if (parsed && typeof parsed === 'object') return Object.keys(parsed as Record<string, unknown>);
    return [];
  } catch {
    return [];
  }
}

/** Write the per-workspace unpinned-path set back to localStorage (best-effort). */
function persistDismissed(vaultPath: string, next: string[]) {
  try {
    localStorage.setItem(`${DISMISSED_KEY}:${vaultPath}`, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}

function loadAutoPinNew(vaultPath: string): string[] {
  try {
    const raw = localStorage.getItem(`${AUTO_PIN_NEW_KEY}:${vaultPath}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

/** Write the per-workspace unseen-auto-pin set back to localStorage (best-effort). */
function persistAutoPinNew(vaultPath: string, next: string[]) {
  try {
    localStorage.setItem(`${AUTO_PIN_NEW_KEY}:${vaultPath}`, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}

/** Retired view kinds from older persists — dropped on load. */
const RETIRED_KINDS = new Set(['meeting-drop', 'smartview']);

/** Session views survive restarts (the pi JSONL replays their transcript) but
 *  must shed initialPrompt so a persisted kickoff doesn't re-fire. */
function reviveView(v: View): View | null {
  if (RETIRED_KINDS.has((v as { kind: string }).kind)) return null;
  const keyed = v.key ? v : { ...v, key: nextId() };
  return keyed.kind === 'session' ? { ...keyed, initialPrompt: undefined } : keyed;
}

function loadPersistedTabs(): { tabs: TabState[]; activeTabId: string | null } {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { tabs: TabState[]; activeTabId: string | null };
      const tabs = (parsed.tabs ?? [])
        .map((t) => {
          const history = (t.history ?? []).map(reviveView).filter((v): v is View => v !== null);
          return { ...t, history, index: Math.max(0, Math.min(t.index ?? 0, history.length - 1)) };
        })
        .filter((t) => t.history.length > 0);
      const activeTabId = tabs.some((t) => t.id === parsed.activeTabId)
        ? parsed.activeTabId
        : (tabs[0]?.id ?? null);
      return { tabs, activeTabId };
    }
    // Migrate the flat pre-history format: each old tab becomes a one-entry history.
    const legacy = localStorage.getItem(LEGACY_TABS_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as {
        tabs: ({ id: string; preview?: boolean } & ViewBody)[];
        activeTabId: string | null;
      };
      const tabs = (parsed.tabs ?? [])
        .map((t) => {
          const { id, preview: _preview, ...body } = t;
          const view = reviveView({ ...body, key: nextId() } as View);
          return view ? { id, history: [view], index: 0 } : null;
        })
        .filter((t): t is TabState => t !== null);
      const activeTabId = tabs.some((t) => t.id === parsed.activeTabId)
        ? parsed.activeTabId
        : (tabs[0]?.id ?? null);
      return { tabs, activeTabId };
    }
    return { tabs: [], activeTabId: null };
  } catch {
    return { tabs: [], activeTabId: null };
  }
}

/** A clock the attention list can age against: one read a minute, which is the
 *  finest granularity anything in that list is stated in ("in 20m", "due today"). */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [vault, setVault] = useState<VaultInfoDTO | null>(null);
  const [tree, setTree] = useState<VaultTreeDTO | null>(null);
  const [people, setPeople] = useState<PeopleDirectoryDTO | null>(null);
  const initial = useRef(loadPersistedTabs());
  const [tabStates, setTabStates] = useState<TabState[]>(initial.current.tabs);
  const [activeTabId, setActiveTabId] = useState<string | null>(initial.current.activeTabId);
  /** Recently closed tabs, histories intact — ⇧⌘T restores the last one. */
  const closedTabs = useRef<TabState[]>([]);
  const [docData, setDocData] = useState<Record<string, DocData>>({});
  const [proposals, setProposals] = useState<ProposalDTO[]>([]);
  const [themes, setThemes] = useState<ThemeHeatDTO[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  /** Types the memory has ever held (persisted); core types are implicit. */
  const [revealedStored, setRevealedStored] = useState<NoteType[]>([]);
  /** Earned types whose reveal the PO has acknowledged. */
  const [revealSeen, setRevealSeen] = useState<NoteType[]>([]);
  /** Auto-pinned paths still wearing their mark (persisted). */
  const [autoPinNewPaths, setAutoPinNewPaths] = useState<string[]>([]);
  const [chats, setChats] = useState<ChatRefDTO[]>([]);
  const [live, setLive] = useState<Record<string, LiveSessionDTO>>({});
  const [pings, setPings] = useState<AgentPingDTO[]>([]);
  const [skills, setSkills] = useState<SkillDTO[]>([]);
  const [agents, setAgents] = useState<AgentDTO[]>([]);
  const [seen, setSeen] = useState<Record<string, number>>({});
  /**
   * Working files of the session the PO is looking at (Sessions v2 Part 1).
   * Kept per session id rather than as one list: the tree must survive tab
   * switches, and a `session:files` push for a background run must land even
   * when a different tab is in front.
   */
  const [sessionFiles, setSessionFiles] = useState<Record<string, SessionFileDTO[]>>({});
  /** Fan-outs waiting on the PM, by session id (Sessions v2 Part 2). */
  const [spawnRequests, setSpawnRequests] = useState<Record<string, SpawnRequestDTO>>({});
  /** Questions the agent is parked on, by session id. One per session at a time. */
  const [askRequests, setAskRequests] = useState<Record<string, AskRequestDTO>>({});

  // Consumers see each tab as its current view, flattened next to the id.
  const tabs = useMemo<Tab[]>(
    () => tabStates.map((t) => ({ id: t.id, ...currentView(t) })),
    [tabStates],
  );
  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId],
  );
  const activeState = useMemo(
    () => tabStates.find((t) => t.id === activeTabId) ?? null,
    [tabStates, activeTabId],
  );
  const canGoBack = !!activeState && activeState.index > 0;
  const canGoForward = !!activeState && activeState.index < activeState.history.length - 1;

  // Persist tabs (with their histories) across restarts.
  useEffect(() => {
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify({ tabs: tabStates, activeTabId }));
    } catch {
      /* ignore quota */
    }
  }, [tabStates, activeTabId]);

  const refreshTree = useCallback(async () => {
    try {
      setTree(await invoke['vault:tree']());
    } catch {
      setTree(null);
    }
    // People move with the tree (a new page, a renamed one, an email added) and
    // every surface that shows a participant needs them — one refresh, not a
    // second subscription to keep in sync.
    try {
      setPeople(await invoke['people:directory']());
    } catch {
      setPeople(null);
    }
  }, []);

  const createPerson = useCallback(
    async (input: { name?: string; email?: string }) => {
      const card = await invoke['people:create'](input);
      await refreshTree();
      return card;
    },
    [refreshTree],
  );

  const refreshSkills = useCallback(async () => {
    try {
      setSkills(await invoke['skills:list']());
    } catch {
      setSkills([]);
    }
  }, []);

  const refreshAgents = useCallback(async () => {
    try {
      setAgents(await invoke['agents:list']());
    } catch {
      setAgents([]);
    }
  }, []);

  const setAgentEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      // Optimistic: the switch answers the finger, then the truth from main lands.
      setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, enabled } : a)));
      try {
        setAgents(await invoke['agents:setEnabled'](id, enabled));
      } catch {
        void refreshAgents();
      }
    },
    [refreshAgents],
  );

  const loadDoc = useCallback(async (path: string) => {
    const [note, backlinks] = await Promise.all([
      invoke['note:get'](path),
      invoke['note:backlinks'](path),
    ]);
    setDocData((d) => ({ ...d, [path]: { note, backlinks } }));
    return note;
  }, []);

  /**
   * The single navigation engine (browser semantics). Default: push onto the
   * active tab's history, truncating any forward entries — exactly what a
   * browser does on link click. `newTab` opens a background tab (⌘click);
   * `foreground` focuses it (⌘⇧click). Re-navigating to the current view is
   * a no-op so re-clicks never grow history.
   */
  const navigate = useCallback(
    (body: ViewBody, opts?: NavOpts) => {
      const view: View = { ...body, key: nextId() };
      const hasActiveTab = tabStates.some((t) => t.id === activeTabId);
      if (opts?.newTab || !hasActiveTab) {
        const tab: TabState = { id: nextId(), history: [view], index: 0 };
        setTabStates((prev) => [...prev, tab]);
        if (!opts?.newTab || opts.foreground) setActiveTabId(tab.id);
        return;
      }
      setTabStates((prev) => {
        const idx = prev.findIndex((t) => t.id === activeTabId);
        if (idx === -1) return prev;
        const t = prev[idx]!;
        if (sameTarget(currentView(t), body)) return prev;
        const history = [
          ...t.history.slice(Math.max(0, t.index + 1 - (HISTORY_CAP - 1)), t.index + 1),
          view,
        ];
        const next = [...prev];
        next[idx] = { ...t, history, index: history.length - 1 };
        return next;
      });
    },
    [activeTabId, tabStates],
  );

  const goBack = useCallback(() => {
    setTabStates((prev) =>
      prev.map((t) => (t.id === activeTabId && t.index > 0 ? { ...t, index: t.index - 1 } : t)),
    );
  }, [activeTabId]);

  const goForward = useCallback(() => {
    setTabStates((prev) =>
      prev.map((t) =>
        t.id === activeTabId && t.index < t.history.length - 1 ? { ...t, index: t.index + 1 } : t,
      ),
    );
  }, [activeTabId]);

  /** Update every history entry the mapper touches, across all tabs. Returns
   *  the same array when nothing changed so React skips the re-render. */
  const mapViews = useCallback((fn: (v: View) => View) => {
    setTabStates((prev) => {
      let changed = false;
      const next = prev.map((t) => {
        let tabChanged = false;
        const history = t.history.map((v) => {
          const m = fn(v);
          if (m !== v) tabChanged = true;
          return m;
        });
        if (!tabChanged) return t;
        changed = true;
        return { ...t, history };
      });
      return changed ? next : prev;
    });
  }, []);

  /** Remove matching entries from every history; a tab left empty closes, and
   *  a removed current entry lands on its predecessor (browser back). */
  const dropViews = useCallback((drop: (v: View) => boolean) => {
    setTabStates((prev) => {
      const next: TabState[] = [];
      let changed = false;
      for (const t of prev) {
        const history: View[] = [];
        let index = t.index;
        t.history.forEach((v, i) => {
          if (drop(v)) {
            if (i <= t.index) index--;
          } else history.push(v);
        });
        if (history.length === t.history.length) {
          next.push(t);
          continue;
        }
        changed = true;
        if (history.length === 0) continue;
        next.push({ ...t, history, index: Math.max(0, Math.min(index, history.length - 1)) });
      }
      if (!changed) return prev;
      setActiveTabId((cur) => {
        if (cur === null || next.some((t) => t.id === cur)) return cur;
        const idx = prev.findIndex((t) => t.id === cur);
        return next[Math.max(0, Math.min(idx - 1, next.length - 1))]?.id ?? null;
      });
      return next;
    });
  }, []);

  const openDoc = useCallback(
    async (path: string, opts?: NavOpts) => {
      const title = path.split('/').pop()?.replace(/\.md$/, '') ?? path;
      navigate({ kind: 'doc', path, title }, opts);
      const note = await loadDoc(path);
      // The real title/type arrive after the fetch — retitle every history
      // entry that points at this doc (tab titles read from the current one).
      if (note)
        mapViews((v) =>
          v.kind === 'doc' &&
          v.path === path &&
          (v.title !== note.title || v.noteType !== note.type)
            ? { ...v, title: note.title, noteType: note.type }
            : v,
        );
    },
    [navigate, loadDoc, mapViews],
  );

  const openSession = useCallback(
    (skill?: string, opts?: { initialPrompt?: string; title?: string; fresh?: boolean } & NavOpts) => {
      const title = opts?.title ?? (skill ? skill.replace(/-/g, ' ') : 'Session');
      navigate(
        {
          kind: 'session',
          skill,
          initialPrompt: opts?.initialPrompt,
          title,
          // Nobody named this tab — the first message will (see the retitle effect).
          autoTitle: !opts?.title,
        },
        // A deliberately fresh conversation always gets its own focused tab.
        opts?.fresh ? { newTab: true, foreground: true } : opts,
      );
    },
    [navigate],
  );

  const openChat = useCallback(
    (chat: { id: string; title: string }, opts?: NavOpts) => {
      // A stored conversation has already spent its opening skill — reopening it
      // invokes nothing, it just resumes.
      navigate({ kind: 'session', sessionId: chat.id, title: chat.title }, opts);
    },
    [navigate],
  );

  const openChats = useCallback(
    (opts?: NavOpts) => navigate({ kind: 'chats', title: 'Sessions' }, opts),
    [navigate],
  );

  const openSessionFile = useCallback(
    (sessionId: string, path: string, opts?: NavOpts) =>
      navigate({ kind: 'sessionFile', sessionId, path, title: path.split('/').pop() ?? path }, opts),
    [navigate],
  );

  /** Session titles by id — the running row already carries the first message by
   *  the time a tab learns its session id, and this survives between renders. */
  const sessionTitles = useRef(new Map<string, string>());

  const bindTabSession = useCallback(
    (viewKey: string, sessionId: string) => {
      // Clearing initialPrompt is essential: the view keeps its identity across
      // SessionView remounts (back/forward, background-settle reload), and a
      // lingering prompt would auto-send again on every remount — spamming the
      // agent with the same seed message.
      mapViews((v) => {
        if (v.key !== viewKey || v.kind !== 'session') return v;
        // Binding is also the moment a placeholder-titled tab can take the
        // conversation's own name.
        const named = v.autoTitle ? sessionTitles.current.get(sessionId) : undefined;
        const title = named && named !== v.title ? named : undefined;
        if (v.sessionId === sessionId && !v.initialPrompt && !title) return v;
        return { ...v, sessionId, initialPrompt: undefined, ...(title ? { title } : {}) };
      });
    },
    [mapViews],
  );

  const openHome = useCallback(
    (opts?: NavOpts) => {
      // An empty workbench already *is* Home (App falls back to it), so going
      // Home from there is a no-op rather than a tab you then have to close.
      // ⌘T and ⌘-click still ask for a tab explicitly, and still get one.
      if (!opts?.newTab && !tabStates.some((t) => t.id === activeTabId)) return;
      navigate({ kind: 'home', title: 'Home' }, opts);
    },
    [navigate, tabStates, activeTabId],
  );
  const openInbox = useCallback(
    (opts?: NavOpts) => navigate({ kind: 'inbox', title: 'Inbox' }, opts),
    [navigate],
  );
  const openTodos = useCallback(
    (opts?: NavOpts) => navigate({ kind: 'todos', title: 'Todos' }, opts),
    [navigate],
  );
  const openMemory = useCallback(
    (opts?: NavOpts) => navigate({ kind: 'memory', title: 'Memory' }, opts),
    [navigate],
  );
  const openFolder = useCallback(
    (dir: string, opts?: NavOpts) => navigate({ kind: 'folder', dir, title: dir }, opts),
    [navigate],
  );
  const openContext = useCallback(
    (tag: string, opts?: NavOpts) => navigate({ kind: 'context', tag, title: `#${tag}` }, opts),
    [navigate],
  );
  const openSettings = useCallback(
    (opts?: NavOpts) => navigate({ kind: 'settings', title: 'Settings' }, opts),
    [navigate],
  );
  const openSkills = useCallback(
    (opts?: NavOpts) => {
      void refreshSkills();
      navigate({ kind: 'skills', title: 'Skills' }, opts);
    },
    [navigate, refreshSkills],
  );
  const openAgents = useCallback(
    (opts?: NavOpts) => {
      void refreshAgents();
      navigate({ kind: 'agents', title: 'Agents' }, opts);
    },
    [navigate, refreshAgents],
  );

  /** Remember closed tabs (history intact) for ⇧⌘T — a dozen deep, like a
   *  browser. Id-deduped so StrictMode's double-invoked updaters stay pure. */
  const rememberClosed = useCallback((closing: TabState[]) => {
    const rest = closedTabs.current.filter((t) => !closing.some((c) => c.id === t.id));
    closedTabs.current = [...rest, ...closing].slice(-12);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      setTabStates((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx === -1) return prev;
        rememberClosed([prev[idx]!]);
        const next = prev.filter((t) => t.id !== id);
        setActiveTabId((cur) => (cur === id ? (next[Math.max(0, idx - 1)]?.id ?? null) : cur));
        return next;
      });
    },
    [rememberClosed],
  );

  const closeOtherTabs = useCallback(
    (id: string) => {
      setTabStates((prev) => {
        const kept = prev.filter((t) => t.id === id);
        if (kept.length === prev.length) return prev;
        rememberClosed(prev.filter((t) => t.id !== id));
        setActiveTabId(kept[0]?.id ?? null);
        return kept;
      });
    },
    [rememberClosed],
  );

  const closeAllTabs = useCallback(() => {
    setTabStates((prev) => {
      rememberClosed(prev);
      return [];
    });
    setActiveTabId(null);
  }, [rememberClosed]);

  const closeTabsBefore = useCallback(
    (id: string) => {
      setTabStates((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx <= 0) return prev;
        rememberClosed(prev.slice(0, idx));
        const kept = prev.slice(idx);
        setActiveTabId((cur) => (kept.some((t) => t.id === cur) ? cur : id));
        return kept;
      });
    },
    [rememberClosed],
  );

  const closeTabsAfter = useCallback(
    (id: string) => {
      setTabStates((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx === -1 || idx === prev.length - 1) return prev;
        rememberClosed(prev.slice(idx + 1));
        const kept = prev.slice(0, idx + 1);
        setActiveTabId((cur) => (kept.some((t) => t.id === cur) ? cur : id));
        return kept;
      });
    },
    [rememberClosed],
  );

  const reopenClosedTab = useCallback(() => {
    const tab = closedTabs.current.pop();
    if (!tab) return;
    setTabStates((prev) => (prev.some((t) => t.id === tab.id) ? prev : [...prev, tab]));
    setActiveTabId(tab.id);
  }, []);

  const moveTab = useCallback((id: string, toIndex: number) => {
    setTabStates((prev) => {
      const from = prev.findIndex((t) => t.id === id);
      if (from === -1) return prev;
      const to = Math.max(0, Math.min(toIndex, prev.length - 1));
      if (from === to) return prev;
      const next = [...prev];
      const [tab] = next.splice(from, 1);
      if (!tab) return prev;
      next.splice(to, 0, tab);
      return next;
    });
  }, []);

  const setActiveTab = useCallback((id: string) => setActiveTabId(id), []);

  // The rail's pin set and its unpinned-guard follow the open workspace.
  useEffect(() => {
    setFavorites(vault ? loadFavorites(vault.path) : []);
    setDismissed(vault ? loadDismissed(vault.path) : []);
    setAutoPinNewPaths(vault ? loadAutoPinNew(vault.path) : []);
    setRevealedStored([]);
    setRevealSeen(vault ? loadRevealSeen(vault.path) : []);
  }, [vault]);

  // Progressive reveal: a type earns its surface the first time the memory
  // holds one, and keeps it forever. First launch against an existing workspace
  // grandfathers everything already there — silently, no "new" marks — so only
  // growth the PO actually witnesses gets announced.
  useEffect(() => {
    if (!vault || !tree) return;
    const content = contentTypes(tree);
    const stored = loadRevealed(vault.path);
    if (stored === null) {
      persistRevealed(vault.path, content);
      persistRevealSeen(vault.path, content);
      setRevealedStored(content);
      setRevealSeen(content);
      return;
    }
    const next = [...stored, ...content.filter((t) => !stored.includes(t))];
    if (next.length > stored.length) persistRevealed(vault.path, next);
    setRevealedStored((prev) =>
      prev.length === next.length && next.every((t, i) => prev[i] === t) ? prev : next,
    );
  }, [vault, tree]);

  const markRevealSeen = useCallback(
    (type: NoteType) => {
      setRevealSeen((prev) => {
        if (prev.includes(type)) return prev;
        const next = [...prev, type];
        if (vault) persistRevealSeen(vault.path, next);
        return next;
      });
    },
    [vault],
  );

  // The auto-pin mark is spent on first contact with the row, exactly like a
  // newly revealed section's.
  const markPinSeen = useCallback(
    (path: string) => {
      setAutoPinNewPaths((prev) => {
        if (!prev.includes(path)) return prev;
        const next = prev.filter((p) => p !== path);
        if (vault) persistAutoPinNew(vault.path, next);
        return next;
      });
    },
    [vault],
  );

  const autoPinNew = useMemo(() => new Set(autoPinNewPaths), [autoPinNewPaths]);

  const revealed = useMemo(() => new Set([...CORE_TYPES, ...revealedStored]), [revealedStored]);
  const revealNew = useMemo(
    () => new Set(revealedStored.filter((t) => !CORE_TYPES.includes(t) && !revealSeen.includes(t))),
    [revealedStored, revealSeen],
  );

  // Pin ⇄ unpin as exact opposites: pinning adds to the rail and clears any prior
  // unpin; unpinning removes it and remembers the path so the auto-pinner leaves
  // it alone. One handler backs both the note-view toggle and the rail's X.
  const toggleFavorite = useCallback(
    (path: string) => {
      const pinned = favorites.includes(path);
      setFavorites((prev) => {
        const next = pinned
          ? prev.filter((p) => p !== path)
          : prev.includes(path)
            ? prev
            : [...prev, path];
        if (vault) persistFavorites(vault.path, next);
        return next;
      });
      setDismissed((prev) => {
        const next = pinned
          ? prev.includes(path)
            ? prev
            : [...prev, path]
          : prev.filter((p) => p !== path);
        if (vault) persistDismissed(vault.path, next);
        return next;
      });
      // Either direction is the PO's own hand on this note, so the "the system
      // put this here" mark has nothing left to announce.
      markPinSeen(path);
    },
    [vault, favorites, markPinSeen],
  );

  // Liveness for meetings is a fact about the clock, not just the vault: a meeting
  // enters the rail's horizon when its day arrives (or when mid-afternoon turns the
  // rail toward tomorrow), with no file change to trigger it. Tick every five
  // minutes so an app left open overnight still picks up the new day's meetings.
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setClockTick((n) => n + 1), 5 * 60_000);
    return () => window.clearInterval(t);
  }, []);

  // The auto-pinner: when the memory (or the clock) changes, ADD any note that has
  // newly become live to the rail — but only if it's in neither set, so each note is
  // auto-pinned at most once, ever. It never removes; a reviewed meeting stays until
  // the PO clears it, and an unpinned note is never dragged back. See qualifiesForRail.
  useEffect(() => {
    if (!vault || !tree) return;
    const openThemes = new Set(themes.filter((p) => p.stance !== 'wont-do').map((p) => p.path));
    const decided = new Set([...favorites, ...dismissed]);
    const horizon = meetingRailHorizon(tree.groups.flatMap((g) => g.notes));
    const additions: string[] = [];
    for (const g of tree.groups)
      for (const n of g.notes)
        if (
          !isFolderIndex(n.path) &&
          !decided.has(n.path) &&
          qualifiesForRail(n, openThemes, horizon)
        )
          additions.push(n.path);
    if (additions.length === 0) return;
    setFavorites((prev) => {
      const next = [...prev, ...additions.filter((p) => !prev.includes(p))];
      if (vault) persistFavorites(vault.path, next);
      return next;
    });
    // A row that appeared on its own says so. Only this path marks anything, so
    // a hand-pin never wears the mark.
    setAutoPinNewPaths((prev) => {
      const next = [...prev, ...additions.filter((p) => !prev.includes(p))];
      if (vault) persistAutoPinNew(vault.path, next);
      return next;
    });
    // favorites/dismissed intentionally omitted: the guard is recomputed from the
    // freshest sets inside the loop, and listing them would re-run on every pin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault, tree, themes, clockTick]);

  const query = useCallback((q: NoteQueryDTO) => invoke['vault:query'](q), []);

  const pickMaterial = useCallback(() => invoke['arrival:pick'](), []);
  const inspectArrival = useCallback(
    (items: ArrivalItemInputDTO[], ambition?: ArrivalAmbitionDTO) =>
      invoke['arrival:inspect'](items, ambition),
    [],
  );

  /**
   * File a batch, then land the PO on its result where there is one to land on.
   * `landsOnResult` owns that judgement, and the receipt reads the same rule to
   * decide whether it has anything left to add (lib/arrival-outcome).
   */
  const ingestArrival = useCallback(
    async (items: ArrivalItemInputDTO[], ambition?: ArrivalAmbitionDTO) => {
      const result = await invoke['arrival:ingest'](items, ambition);
      await refreshTree();
      const { sessions, filed } = outcomeOf(result);
      if (sessions.length === 1) {
        const only = sessions[0]!;
        navigate(
          { kind: 'session', sessionId: only.session!.id, title: only.session!.label },
          { newTab: true, foreground: true },
        );
      } else if (sessions.length === 0 && filed.length === 1) {
        const only = filed[0]!;
        navigate({ kind: 'doc', path: only.path!, title: only.title ?? only.name });
        await loadDoc(only.path!);
      }
      return result;
    },
    [refreshTree, navigate, loadDoc],
  );

  const undoArrival = useCallback(
    async (id: string) => {
      const result = await invoke['arrival:undo'](id);
      // A tab still showing a note this just deleted would render an empty
      // shell forever — undo has to take the views back too, exactly as
      // deleting a note does.
      if (result.removed.length > 0) {
        const gone = new Set(result.removed);
        setDocData((d) => Object.fromEntries(Object.entries(d).filter(([p]) => !gone.has(p))));
        dropViews((v) => v.kind === 'doc' && gone.has(v.path));
      }
      await refreshTree();
      return result;
    },
    [refreshTree, dropViews],
  );

  const ingestCapture = useCallback(
    async (input: IngestCaptureInputDTO) => {
      const result = await invoke['capture:ingest'](input);
      await refreshTree();
      if (result.processing?.sessionId) {
        // The capture fired a background session (After-Meeting / External
        // transcript). Land the PO in it — watch it work and approve the cards
        // it proposes inline; the same cards also collect in the Inbox.
        navigate(
          {
            kind: 'session',
            sessionId: result.processing.sessionId,
            title: result.processing.label,
          },
          { newTab: true, foreground: true },
        );
      } else if (result.followUp) {
        // The capture needs processing — After-Meeting or Intake picks it up
        // in a fresh session tab; everything it produces is approval cards.
        navigate(
          {
            kind: 'session',
            skill: result.followUp.skill,
            initialPrompt: result.followUp.prompt,
            title: result.followUp.tabTitle,
          },
          { newTab: true, foreground: true },
        );
      } else {
        // Nothing to process (plain note) — show what was filed.
        navigate({ kind: 'doc', path: result.note.path, title: result.note.title });
        await loadDoc(result.note.path);
      }
      return result;
    },
    [refreshTree, navigate, loadDoc],
  );

  const previewProposal = useCallback((id: string) => invoke['proposals:preview'](id), []);

  const refreshProposals = useCallback(async () => {
    try {
      setProposals(await invoke['proposals:list']('pending'));
    } catch {
      setProposals([]);
    }
  }, []);

  const refreshThemes = useCallback(async () => {
    try {
      setThemes(await invoke['themes:byHeat']());
    } catch {
      setThemes([]);
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const [chatList, liveList, asks] = await Promise.all([
        invoke['chats:list'](),
        invoke['sessions:live'](),
        // Parked questions are durable (QM ticket 9), so they are read back here
        // rather than only arriving as pushes: one asked before a quit has to be
        // waiting in the badge and on Home at the next launch, not only once its
        // session is opened. Main is authoritative, so this replaces the map.
        invoke['sessions:pendingAsks'](),
      ]);
      setChats(chatList);
      setLive(Object.fromEntries(liveList.map((l) => [l.sessionId, l])));
      setAskRequests(Object.fromEntries(asks.map((a) => [a.sessionId, a])));
    } catch {
      setChats([]);
      setLive({});
    }
  }, []);

  const refreshSessionFiles = useCallback(async (sessionId: string) => {
    try {
      const files = await invoke['sessions:files'](sessionId);
      setSessionFiles((prev) => (prev[sessionId]?.length === 0 && files.length === 0 ? prev : { ...prev, [sessionId]: files }));
    } catch {
      /* a session with no folder is the common case, not an error */
    }
  }, []);

  /**
   * Answer a fan-out card. Clearing the row locally rather than waiting for the
   * push keeps Approve feeling instant — the children take seconds to start.
   */
  const resolveSpawn = useCallback(async (request: SpawnRequestDTO, decision: { approved: boolean; modelId?: string }) => {
    setSpawnRequests((prev) => {
      const next = { ...prev };
      delete next[request.sessionId];
      return next;
    });
    await invoke['sessions:resolveSpawn'](request.id, decision).catch(() => undefined);
  }, []);

  /**
   * Answer (or skip) a question card. Cleared locally on submit for the same
   * reason as the spawn card: the turn picks up where it left off and the next
   * thing on screen should be the agent working, not the question again.
   */
  const resolveAsk = useCallback(async (request: AskRequestDTO, answers: AskAnswerDTO[] | null) => {
    setAskRequests((prev) => {
      const next = { ...prev };
      delete next[request.sessionId];
      return next;
    });
    await invoke['sessions:resolveAsk'](request.id, answers).catch(() => undefined);
  }, []);

  const refreshPings = useCallback(async () => {
    try {
      setPings(await invoke['pings:list']());
    } catch {
      setPings([]);
    }
  }, []);

  // Seen timestamps follow the open workspace (like favourites).
  useEffect(() => {
    setSeen(vault ? loadSeen(vault.path) : {});
  }, [vault]);

  const markSessionSeen = useCallback(
    (sessionId: string) => {
      setSeen((prev) => {
        const next = { ...prev, [sessionId]: Date.now() };
        if (vault) {
          try {
            localStorage.setItem(`${SEEN_KEY}:${vault.path}`, JSON.stringify(next));
          } catch {
            /* ignore quota */
          }
        }
        return next;
      });
    },
    [vault],
  );

  // One merged row per session — the rail, Inbox, and history all read this.
  const sessions = useMemo<SessionOverview[]>(() => {
    const cardsBySession = new Map<string, number>();
    for (const p of proposals) {
      if (p.status !== 'pending') continue;
      cardsBySession.set(p.sessionId, (cardsBySession.get(p.sessionId) ?? 0) + 1);
    }
    const initAt = seen['__init'] ?? 0;
    const rows = new Map<string, SessionOverview>();
    for (const chat of chats) {
      const running = !!live[chat.id];
      rows.set(chat.id, {
        id: chat.id,
        title: chat.title,
        updated: chat.updated,
        running,
        streamId: live[chat.id]?.streamId,
        pendingCards: cardsBySession.get(chat.id) ?? 0,
        unread: !running && chat.updated > (seen[chat.id] ?? initAt),
        messageCount: chat.messageCount,
        lifecycle: chat.lifecycle,
      });
    }
    // A first turn in flight isn't in the chats list yet — surface it anyway.
    for (const l of Object.values(live)) {
      if (rows.has(l.sessionId)) continue;
      rows.set(l.sessionId, {
        id: l.sessionId,
        title: l.title,
        updated: l.startedAt,
        running: true,
        streamId: l.streamId,
        pendingCards: cardsBySession.get(l.sessionId) ?? 0,
        unread: false,
        messageCount: 0,
        lifecycle: 'active',
      });
    }
    return [...rows.values()].sort((a, b) => b.updated - a.updated);
  }, [chats, live, proposals, seen]);

  // A session names its own tab: the placeholder the tab opened with ("Ask",
  // "Session") gives way to the session's title — its first message — which arrives
  // with the live row the moment that first turn starts.
  useEffect(() => {
    const titles = new Map(sessions.map((s) => [s.id, s.title]));
    sessionTitles.current = titles;
    mapViews((v) => {
      if (v.kind !== 'session' || !v.autoTitle || !v.sessionId) return v;
      const title = titles.get(v.sessionId);
      return title && title !== v.title ? { ...v, title } : v;
    });
  }, [sessions, mapViews]);

  // The one attention list, and the one number over it. Membership is partly a
  // fact about the clock (a meeting starts, a commitment comes due), so it ages
  // on a minute tick — the same clock Home used to keep to itself, moved here
  // now that every surface reads the same list.
  const now = useMinuteClock();
  const attention = useMemo(
    () => buildAttention({ proposals, sessions, askRequests, pings, tree }, now),
    [proposals, sessions, askRequests, pings, tree, now],
  );
  const waitingCount = useMemo(() => waitingOnYou(attention).length, [attention]);

  const acceptProposal = useCallback(
    async (id: string, edited?: unknown) => {
      const result = await invoke['proposals:accept'](id, edited);
      await Promise.all([refreshProposals(), refreshTree(), refreshThemes()]);
      return result;
    },
    [refreshProposals, refreshTree, refreshThemes],
  );

  const rejectProposal = useCallback(
    async (id: string) => {
      const result = await invoke['proposals:reject'](id);
      await refreshProposals();
      return result;
    },
    [refreshProposals],
  );

  const markMeetingReviewed = useCallback(
    async (path: string) => {
      const result = await invoke['meeting:markReviewed'](path);
      // The status change is what takes the meeting off the review surfaces.
      if (result.ok) await refreshTree();
      return result;
    },
    [refreshTree],
  );

  // Taking the conversation: mark the ping opened, seed a fresh session with it.
  const openPing = useCallback(
    async (ping: AgentPingDTO) => {
      try {
        await invoke['pings:open'](ping.id);
      } finally {
        await refreshPings();
      }
      openSession(ping.skill, {
        initialPrompt: ping.seedPrompt,
        title: ping.title,
        fresh: true,
      });
    },
    [refreshPings, openSession],
  );

  const dismissPing = useCallback(
    async (id: string) => {
      await invoke['pings:dismiss'](id);
      await refreshPings();
    },
    [refreshPings],
  );

  // A fix writes the workspace; the watcher refreshes trees/docs, we refresh pings.
  const resolvePingItem = useCallback(
    async (pingId: string, itemId: string, action: PingResolveActionDTO) => {
      try {
        await invoke['pings:resolveItem'](pingId, itemId, action);
      } finally {
        await refreshPings();
      }
    },
    [refreshPings],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      await invoke['chats:delete'](sessionId);
      await refreshSessions();
    },
    [refreshSessions],
  );

  const setSessionLifecycle = useCallback(
    async (sessionId: string, lifecycle: SessionLifecycle) => {
      await invoke['chats:setLifecycle'](sessionId, lifecycle);
      await refreshSessions();
    },
    [refreshSessions],
  );

  const bootVault = useCallback(
    async (info: VaultInfoDTO | null) => {
      setVault((prev) => {
        // Switching to a different workspace: doc/folder/session views point at
        // the old vault, so drop them from every tab's history (views like
        // inbox just re-query).
        if (prev && info && prev.path !== info.path) {
          setDocData({});
          // The old tree must not leak into the new workspace's derived state
          // (the reveal ledger persists per vault path from whatever tree it sees).
          setTree(null);
          dropViews((v) => v.kind === 'doc' || v.kind === 'folder' || v.kind === 'session');
        }
        return info;
      });
      if (info)
        await Promise.all([
          refreshTree(),
          refreshProposals(),
          refreshThemes(),
          refreshSessions(),
          refreshPings(),
          refreshSkills(),
          refreshAgents(),
        ]);
    },
    [
      refreshTree,
      refreshProposals,
      refreshThemes,
      refreshSessions,
      refreshPings,
      refreshSkills,
      refreshAgents,
      dropViews,
    ],
  );

  const openVaultDialog = useCallback(async () => {
    const info = await invoke['vault:pick']();
    if (info) await bootVault(info);
  }, [bootVault]);

  const enableGit = useCallback(async () => {
    setVault(await invoke['vault:initGit']());
  }, []);

  const captureNote = useCallback(
    async (input: CaptureNoteInput) => {
      const note = await invoke['note:capture'](input);
      await refreshTree();
      return note;
    },
    [refreshTree],
  );

  const captureTodo = useCallback(
    async (input: CaptureTodoInputDTO) => {
      const note = await invoke['todos:capture'](input);
      await refreshTree();
      return note;
    },
    [refreshTree],
  );

  const setTodoStatus = useCallback(
    async (path: string, commitment: TodoCommitment) => {
      await invoke['todos:setStatus'](path, commitment);
      await refreshTree();
    },
    [refreshTree],
  );

  const saveNote = useCallback(
    async (path: string, body: string) => {
      // Update docData from the returned note instead of re-fetching via
      // loadDoc — a reload would push a new body into the live editor and
      // clobber the cursor mid-autosave.
      const note = await invoke['note:save']({ path, body });
      setDocData((d) => ({ ...d, [path]: { note, backlinks: d[path]?.backlinks ?? [] } }));
      await refreshTree();
    },
    [refreshTree],
  );

  const saveFrontmatter = useCallback(
    async (path: string, frontmatter: Record<string, unknown>) => {
      await invoke['note:saveFrontmatter']({ path, frontmatter });
      await Promise.all([refreshTree(), refreshThemes(), loadDoc(path)]);
    },
    [refreshTree, refreshThemes, loadDoc],
  );

  const renameNote = useCallback(
    async (path: string, title: string) => {
      const note = await invoke['note:rename']({ path, title });
      // The file may have moved: retarget docData, tabs, and favourites before
      // the tree refresh so the open view never points at a dead path.
      setDocData((d) => {
        const { [path]: old, ...rest } = d;
        return { ...rest, [note.path]: { note, backlinks: old?.backlinks ?? [] } };
      });
      mapViews((v) =>
        v.kind === 'doc' && v.path === path
          ? { ...v, path: note.path, title: note.title, noteType: note.type }
          : v,
      );
      if (note.path !== path) {
        setFavorites((prev) => {
          if (!prev.includes(path)) return prev;
          const next = prev.map((p) => (p === path ? note.path : p));
          if (vault) persistFavorites(vault.path, next);
          return next;
        });
        // The old path is gone; renaming is hands-on enough to spend the mark.
        markPinSeen(path);
      }
      await refreshTree();
      return note;
    },
    [vault, refreshTree, mapViews, markPinSeen],
  );

  const deleteNote = useCallback(
    async (path: string) => {
      await invoke['note:delete'](path);
      setDocData((d) => {
        const { [path]: _, ...rest } = d;
        return rest;
      });
      // Purge the note from every tab's history; a tab that held only this doc
      // closes and hands focus to a neighbor, exactly like closeTab.
      dropViews((v) => v.kind === 'doc' && v.path === path);
      setFavorites((prev) => {
        if (!prev.includes(path)) return prev;
        const next = prev.filter((p) => p !== path);
        if (vault) persistFavorites(vault.path, next);
        return next;
      });
      markPinSeen(path); // no row left to mark
      await refreshTree();
    },
    [vault, refreshTree, dropViews, markPinSeen],
  );

  const search = useCallback(async (q: string) => {
    if (!q.trim()) return [];
    return invoke['search:query'](q, 20);
  }, []);

  // Initial load: any workspace opened on startup by main.
  useEffect(() => {
    void invoke['vault:current']().then(async (info) => {
      await bootVault(info);
      // Reload the active doc tab's content after restart.
      const active = initial.current.tabs.find((t) => t.id === initial.current.activeTabId);
      const view = active ? currentView(active) : undefined;
      if (info && view?.kind === 'doc') void loadDoc(view.path);
      const open = new URLSearchParams(window.location.search).get('open');
      if (info && open === '__settings') openSettings();
      else if (info && open === '__skills') openSkills();
      else if (info && open === '__agents') openAgents();
      else if (info && open === '__chat') openSession(undefined);
      else if (info && open === '__review') openInbox();
      else if (info && open === '__todos') openTodos();
      else if (info && open === '__memory') openMemory();
      else if (info && (open === '__capture' || open === '__meeting')) requestCapture();
      else if (info && open?.startsWith('__session:')) {
        // A conversation by id — the deep link the session surfaces (working
        // files, fan-out cards) are reachable through.
        const id = open.slice('__session:'.length);
        const known = await invoke['chats:list']().catch(() => []);
        openChat(known.find((c) => c.id === id) ?? { id, title: 'Session' });
      } else if (info && open?.startsWith('__folder:')) openFolder(open.slice('__folder:'.length));
      else if (info && open?.startsWith('__context:')) openContext(open.slice('__context:'.length));
      else if (info && open) void openDoc(open);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live refresh when the workspace changes on disk (external Obsidian edits).
  useEffect(() => {
    return onEvent((event) => {
      if (event.channel === 'vault:changed') {
        void refreshTree();
        void refreshThemes();
        if (event.paths.some((p) => p.startsWith('skills/'))) void refreshSkills();
        if (event.paths.some((p) => p.startsWith('agents/'))) void refreshAgents();
        for (const path of event.paths) if (docData[path]) void loadDoc(path);
      } else if (event.channel === 'proposals:changed') {
        // The event carries a count, but the renderer never reads it: the card
        // count is `countOf(attention, 'card')` over the list we refresh here,
        // and a second number is exactly what this app is not allowed to have.
        void refreshProposals();
        // Agent rows carry a pending-card count — keep it honest.
        void refreshAgents();
      } else if (event.channel === 'session:status') {
        // The rail's heartbeat: track runs as they start, refresh rows on settle.
        if (event.status === 'running') {
          setLive((prev) => ({
            ...prev,
            [event.sessionId]: {
              sessionId: event.sessionId,
              title: event.title,
              streamId: '',
              startedAt: event.updated,
            },
          }));
          void refreshSessions();
        } else {
          setLive((prev) => {
            const next = { ...prev };
            delete next[event.sessionId];
            return next;
          });
          void refreshSessions();
          // A settled run may have been an agent's — its "last ran" moved.
          void refreshAgents();
        }
      } else if (event.channel === 'session:files') {
        void refreshSessionFiles(event.sessionId);
      } else if (event.channel === 'session:spawn') {
        setSpawnRequests((prev) => {
          const next = { ...prev };
          if (event.request) next[event.sessionId] = event.request;
          else delete next[event.sessionId];
          return next;
        });
      } else if (event.channel === 'session:ask') {
        setAskRequests((prev) => {
          const next = { ...prev };
          if (event.request) next[event.sessionId] = event.request;
          else delete next[event.sessionId];
          return next;
        });
      } else if (event.channel === 'pings:changed') {
        void refreshPings();
      } else if (event.channel === 'session:focus') {
        // OS notification click — land the PO in that conversation.
        openChat({ id: event.sessionId, title: event.title });
      }
    });
  }, [
    refreshTree,
    refreshThemes,
    refreshProposals,
    refreshSessions,
    refreshSessionFiles,
    refreshPings,
    refreshSkills,
    refreshAgents,
    openChat,
    loadDoc,
    docData,
  ]);

  // Opening (or landing back on) a conversation loads its working files once.
  // Live growth arrives by push; this is the cold read for a session that
  // already ran, or one whose files landed while another tab was in front.
  const activeSessionId = activeTab?.kind === 'session' ? activeTab.sessionId : undefined;
  useEffect(() => {
    if (!activeSessionId) return;
    void refreshSessionFiles(activeSessionId);
    // A fan-out parked on approval outlives the tab that started it: without
    // this, reopening the conversation would show a run that is waiting on a
    // card nobody can see.
    void invoke['sessions:pendingSpawn'](activeSessionId)
      .then((request) => {
        if (request) setSpawnRequests((prev) => ({ ...prev, [request.sessionId]: request }));
      })
      .catch(() => undefined);
    // Same for a question the agent is parked on: it outlives the tab that
    // asked it, and a turn stuck behind an invisible question reads as a hang.
    void invoke['sessions:pendingAsk'](activeSessionId)
      .then((request) => {
        if (request) setAskRequests((prev) => ({ ...prev, [request.sessionId]: request }));
      })
      .catch(() => undefined);
  }, [activeSessionId, refreshSessionFiles]);

  const value = useMemo<AppState>(
    () => ({
      vault,
      tree,
      people,
      createPerson,
      tabs,
      activeTabId,
      activeTab,
      docData,
      openVaultDialog,
      enableGit,
      favorites,
      toggleFavorite,
      dismissed,
      revealed,
      revealNew,
      markRevealSeen,
      autoPinNew,
      markPinSeen,
      proposals,
      themes,
      sessions,
      pings,
      skills,
      refreshSkills,
      agents,
      refreshAgents,
      setAgentEnabled,
      attention,
      waitingCount,
      markSessionSeen,
      refreshSessions,
      openPing,
      dismissPing,
      resolvePingItem,
      deleteSession,
      setSessionLifecycle,
      openDoc,
      openSession,
      openChat,
      openChats,
      spawnRequests,
      resolveSpawn,
      askRequests,
      resolveAsk,
      sessionFiles,
      refreshSessionFiles,
      openSessionFile,
      bindTabSession,
      openHome,
      openInbox,
      openTodos,
      openMemory,
      openFolder,
      openContext,
      openSettings,
      openSkills,
      openAgents,
      goBack,
      goForward,
      canGoBack,
      canGoForward,
      reopenClosedTab,
      closeTab,
      closeOtherTabs,
      closeAllTabs,
      closeTabsBefore,
      closeTabsAfter,
      moveTab,
      setActiveTab,
      loadDoc,
      query,
      ingestCapture,
      pickMaterial,
      inspectArrival,
      ingestArrival,
      undoArrival,
      previewProposal,
      refreshProposals,
      acceptProposal,
      rejectProposal,
      markMeetingReviewed,
      captureNote,
      captureTodo,
      setTodoStatus,
      saveNote,
      saveFrontmatter,
      renameNote,
      deleteNote,
      search,
    }),
    [
      vault,
      tree,
      people,
      createPerson,
      tabs,
      activeTabId,
      activeTab,
      docData,
      openVaultDialog,
      enableGit,
      favorites,
      toggleFavorite,
      dismissed,
      revealed,
      revealNew,
      markRevealSeen,
      autoPinNew,
      markPinSeen,
      proposals,
      themes,
      sessions,
      pings,
      skills,
      refreshSkills,
      agents,
      refreshAgents,
      setAgentEnabled,
      attention,
      waitingCount,
      markSessionSeen,
      refreshSessions,
      openPing,
      dismissPing,
      resolvePingItem,
      deleteSession,
      setSessionLifecycle,
      openDoc,
      openSession,
      openChat,
      openChats,
      spawnRequests,
      resolveSpawn,
      askRequests,
      resolveAsk,
      sessionFiles,
      refreshSessionFiles,
      openSessionFile,
      bindTabSession,
      openHome,
      openInbox,
      openTodos,
      openMemory,
      openFolder,
      openContext,
      openSettings,
      openSkills,
      openAgents,
      goBack,
      goForward,
      canGoBack,
      canGoForward,
      reopenClosedTab,
      closeTab,
      closeOtherTabs,
      closeAllTabs,
      closeTabsBefore,
      closeTabsAfter,
      moveTab,
      setActiveTab,
      query,
      ingestCapture,
      pickMaterial,
      inspectArrival,
      ingestArrival,
      undoArrival,
      previewProposal,
      refreshProposals,
      acceptProposal,
      rejectProposal,
      markMeetingReviewed,
      captureNote,
      captureTodo,
      setTodoStatus,
      saveNote,
      saveFrontmatter,
      renameNote,
      deleteNote,
      search,
      loadDoc,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used within AppStateProvider');
  return ctx;
}
