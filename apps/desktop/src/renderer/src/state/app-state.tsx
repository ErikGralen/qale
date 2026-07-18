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
  AgentPingDTO,
  BacklinkDTO,
  CaptureNoteInput,
  CaptureTodoInputDTO,
  ChatRefDTO,
  IngestCaptureInputDTO,
  IngestCaptureResultDTO,
  LiveSessionDTO,
  NoteDTO,
  NoteQueryDTO,
  NoteRefDTO,
  NoteType,
  PingResolveActionDTO,
  ProblemHeatDTO,
  ProposalDTO,
  SearchHitDTO,
  SessionLifecycle,
  SkillDTO,
  TodoStatus,
  VaultInfoDTO,
  VaultTreeDTO,
} from '@pm/ipc';
import { invoke, onEvent } from '../lib/ipc';
import { requestCapture } from '../lib/capture-event';

export type ChatSessionType = 'chat' | 'ask' | 'after-meeting' | 'weekly-update';

/**
 * A tab holds a document or a session interchangeably (PLAN-V2 §3.3).
 * `preview` marks the single reusable tab (VS Code/Obsidian style): the next
 * preview navigation replaces it in place instead of adding another tab.
 */
export type Tab = { id: string; title: string; preview?: boolean } & (
  | { kind: 'doc'; path: string; noteType?: NoteType }
  | { kind: 'session'; sessionType: string; sessionId?: string; initialPrompt?: string }
  | { kind: 'chats' }
  | { kind: 'inbox' }
  | { kind: 'todos' }
  | { kind: 'memory' }
  | { kind: 'folder'; dir: string }
  | { kind: 'context'; tag: string }
  | { kind: 'settings' }
  | { kind: 'skills' }
);

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
  sessionType: string;
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
  tabs: Tab[];
  activeTabId: string | null;
  activeTab: Tab | null;
  docData: Record<string, DocData>;
  openVaultDialog: () => Promise<void>;
  /** Pinned note paths — the PO's curated sidebar shortlist, per workspace. */
  favorites: string[];
  toggleFavorite: (path: string) => void;
  pendingCount: number;
  proposals: ProposalDTO[];
  problems: ProblemHeatDTO[];
  /** Merged session rows (stored + live + cards + seen) — rail, Inbox, history. */
  sessions: SessionOverview[];
  pings: AgentPingDTO[];
  /** The parsed skill catalogue (Skills v2) — refreshed on skill-file changes. */
  skills: SkillDTO[];
  refreshSkills: () => Promise<void>;
  /** What genuinely awaits the PO: pending cards + unread sessions. Maintenance
   * pings are visible in the Inbox but never counted — they can wait. */
  attentionCount: number;
  markSessionSeen: (sessionId: string) => void;
  refreshSessions: () => Promise<void>;
  openPing: (ping: AgentPingDTO) => Promise<void>;
  dismissPing: (id: string) => Promise<void>;
  /** One-tap apply/skip of a ping suggestion item — the tap is the approval. */
  resolvePingItem: (pingId: string, itemId: string, action: PingResolveActionDTO) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  /** Mark a conversation done/dismissed, or reopen it (active). */
  setSessionLifecycle: (sessionId: string, lifecycle: SessionLifecycle) => Promise<void>;
  // navigation
  openDoc: (path: string, opts?: { preview?: boolean }) => Promise<void>;
  openSession: (
    sessionType: string,
    opts?: { initialPrompt?: string; title?: string; fresh?: boolean; preview?: boolean },
  ) => void;
  /** Reopen a stored conversation in a session tab (replayed from the pi JSONL). */
  openChat: (chat: { id: string; sessionType: string; title: string }) => void;
  /** Open the chat-history list. */
  openChats: (opts?: { preview?: boolean }) => void;
  /** Record the session id the agent assigned to a session tab's conversation. */
  bindTabSession: (tabId: string, sessionId: string) => void;
  openInbox: (opts?: { preview?: boolean }) => void;
  /** Open the Todos view — the commitment ledger. */
  openTodos: (opts?: { preview?: boolean }) => void;
  /** Open the Memory page — the full directory of every note type. */
  openMemory: (opts?: { preview?: boolean }) => void;
  openFolder: (dir: string, opts?: { preview?: boolean }) => void;
  /** Open a context (tag) page — the cross-cutting project/product/area axis. */
  openContext: (tag: string, opts?: { preview?: boolean }) => void;
  openSettings: (opts?: { preview?: boolean }) => void;
  /** Open the Skills view — the parsed skill catalogue (Skills v2). */
  openSkills: (opts?: { preview?: boolean }) => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeAllTabs: () => void;
  closeTabsBefore: (id: string) => void;
  closeTabsAfter: (id: string) => void;
  /** Promote a preview tab to a permanent one. */
  keepTab: (id: string) => void;
  /** Move a tab to a new position in the strip (drag-and-drop / keyboard reorder). */
  moveTab: (id: string, toIndex: number) => void;
  setActiveTab: (id: string) => void;
  // data
  /** Re-fetch a note (+ backlinks) into docData — e.g. to resync after a rejected save. */
  loadDoc: (path: string) => Promise<NoteDTO | null>;
  query: (q: NoteQueryDTO) => Promise<NoteRefDTO[]>;
  /** Universal ingest: file the capture, then open the follow-up session or the note. */
  ingestCapture: (input: IngestCaptureInputDTO) => Promise<IngestCaptureResultDTO>;
  previewProposal: (id: string) => Promise<{ before: string; after: string; stale: boolean } | null>;
  refreshProposals: () => Promise<void>;
  acceptProposal: (id: string, edited?: unknown) => Promise<{ ok: boolean; stale?: boolean; error?: string; url?: string }>;
  rejectProposal: (id: string) => Promise<void>;
  captureNote: (input: CaptureNoteInput) => Promise<NoteDTO>;
  /** Quick-add a todo (already parsed from the one-liner). */
  captureTodo: (input: CaptureTodoInputDTO) => Promise<NoteDTO>;
  /** Flip a todo open/done/dropped. */
  setTodoStatus: (path: string, status: TodoStatus) => Promise<void>;
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

const TABS_KEY = 'pm.tabs.v2';
/** Favourites persist per workspace: `pm.favorites.v1:<vault path>` → string[]. */
const FAVORITES_KEY = 'pm.favorites.v1';
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

function loadPersistedTabs(): { tabs: Tab[]; activeTabId: string | null } {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return { tabs: [], activeTabId: null };
    const parsed = JSON.parse(raw) as { tabs: Tab[]; activeTabId: string | null };
    // Session tabs survive restarts: the pi JSONL replays their transcript.
    // Strip initialPrompt so a persisted After-Meeting kickoff doesn't re-fire.
    // Drop retired tab kinds (meeting-drop, smartview) from older persists.
    const retiredKinds = new Set(['meeting-drop', 'smartview']);
    const tabs = (parsed.tabs ?? [])
      .filter((t) => !retiredKinds.has((t as { kind: string }).kind))
      .map((t) => (t.kind === 'session' ? { ...t, initialPrompt: undefined } : t));
    const activeTabId = tabs.some((t) => t.id === parsed.activeTabId) ? parsed.activeTabId : tabs[0]?.id ?? null;
    return { tabs, activeTabId };
  } catch {
    return { tabs: [], activeTabId: null };
  }
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [vault, setVault] = useState<VaultInfoDTO | null>(null);
  const [tree, setTree] = useState<VaultTreeDTO | null>(null);
  const initial = useRef(loadPersistedTabs());
  const [tabs, setTabs] = useState<Tab[]>(initial.current.tabs);
  const [activeTabId, setActiveTabId] = useState<string | null>(initial.current.activeTabId);
  const [docData, setDocData] = useState<Record<string, DocData>>({});
  const [pendingCount, setPendingCount] = useState(0);
  const [proposals, setProposals] = useState<ProposalDTO[]>([]);
  const [problems, setProblems] = useState<ProblemHeatDTO[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [chats, setChats] = useState<ChatRefDTO[]>([]);
  const [live, setLive] = useState<Record<string, LiveSessionDTO>>({});
  const [pings, setPings] = useState<AgentPingDTO[]>([]);
  const [skills, setSkills] = useState<SkillDTO[]>([]);
  const [seen, setSeen] = useState<Record<string, number>>({});

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId) ?? null, [tabs, activeTabId]);

  // Persist tabs across restarts.
  useEffect(() => {
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, activeTabId }));
    } catch {
      /* ignore quota */
    }
  }, [tabs, activeTabId]);

  const refreshTree = useCallback(async () => {
    try {
      setTree(await invoke['vault:tree']());
    } catch {
      setTree(null);
    }
  }, []);

  const refreshSkills = useCallback(async () => {
    try {
      setSkills(await invoke['skills:list']());
    } catch {
      setSkills([]);
    }
  }, []);

  const loadDoc = useCallback(async (path: string) => {
    const [note, backlinks] = await Promise.all([
      invoke['note:get'](path),
      invoke['note:backlinks'](path),
    ]);
    setDocData((d) => ({ ...d, [path]: { note, backlinks } }));
    return note;
  }, []);

  const focusOrAddTab = useCallback((tab: Tab, isSame: (t: Tab) => boolean, opts?: { preview?: boolean }) => {
    setTabs((prev) => {
      const existing = prev.find(isSame);
      if (existing) {
        setActiveTabId(existing.id);
        // An explicit permanent open (double-click) promotes the preview tab.
        if (existing.preview && opts?.preview === false)
          return prev.map((t) => (t.id === existing.id ? { ...t, preview: undefined } : t));
        return prev;
      }
      const next = opts?.preview ? { ...tab, preview: true } : tab;
      setActiveTabId(next.id);
      // Preview navigation reuses the single preview slot instead of piling up tabs.
      if (opts?.preview) {
        const slot = prev.findIndex((t) => t.preview);
        if (slot !== -1) return prev.map((t, i) => (i === slot ? next : t));
      }
      return [...prev, next];
    });
  }, []);

  const openDoc = useCallback(
    async (path: string, opts?: { preview?: boolean }) => {
      const title = path.split('/').pop()?.replace(/\.md$/, '') ?? path;
      focusOrAddTab({ id: nextId(), kind: 'doc', path, title }, (t) => t.kind === 'doc' && t.path === path, {
        preview: opts?.preview ?? true,
      });
      const note = await loadDoc(path);
      if (note) {
        setTabs((prev) =>
          prev.map((t) =>
            t.kind === 'doc' && t.path === path ? { ...t, title: note.title, noteType: note.type } : t,
          ),
        );
      }
    },
    [focusOrAddTab, loadDoc],
  );

  const openSession = useCallback(
    (sessionType: string, opts?: { initialPrompt?: string; title?: string; fresh?: boolean; preview?: boolean }) => {
      const title =
        opts?.title ??
        (sessionType === 'ask'
          ? 'Ask'
          : sessionType === 'after-meeting'
            ? 'After-Meeting'
            : sessionType === 'chat'
              ? 'Chat'
              : sessionType.replace(/-/g, ' '));
      const tab: Tab = { id: nextId(), kind: 'session', sessionType, initialPrompt: opts?.initialPrompt, title };
      if (opts?.fresh) {
        setTabs((prev) => [...prev, tab]);
        setActiveTabId(tab.id);
      } else {
        // Preview until the first message runs — bindTabSession promotes it.
        focusOrAddTab(tab, (t) => t.kind === 'session' && t.sessionType === sessionType && !t.initialPrompt && !opts?.initialPrompt, {
          preview: opts?.preview ?? true,
        });
      }
    },
    [focusOrAddTab],
  );

  const openChat = useCallback(
    (chat: { id: string; sessionType: string; title: string }) => {
      // Browsing history is preview too; continuing the conversation promotes.
      focusOrAddTab(
        { id: nextId(), kind: 'session', sessionType: chat.sessionType, sessionId: chat.id, title: chat.title },
        (t) => t.kind === 'session' && t.sessionId === chat.id,
        { preview: true },
      );
    },
    [focusOrAddTab],
  );

  const openChats = useCallback(
    (opts?: { preview?: boolean }) =>
      focusOrAddTab({ id: nextId(), kind: 'chats', title: 'Sessions' }, (t) => t.kind === 'chats', {
        preview: opts?.preview ?? true,
      }),
    [focusOrAddTab],
  );

  const bindTabSession = useCallback((tabId: string, sessionId: string) => {
    // A running conversation also commits the tab — it stops being a preview.
    // Clearing initialPrompt is essential: the tab keeps its object identity
    // across ChatView remounts (navigating away and back, or a background-settle
    // reload), and a lingering prompt would auto-send again on every remount —
    // spamming the agent with the same seed message.
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId &&
        t.kind === 'session' &&
        (t.sessionId !== sessionId || t.preview || t.initialPrompt)
          ? { ...t, sessionId, preview: undefined, initialPrompt: undefined }
          : t,
      ),
    );
  }, []);

  const openInbox = useCallback(
    (opts?: { preview?: boolean }) =>
      focusOrAddTab({ id: nextId(), kind: 'inbox', title: 'Inbox' }, (t) => t.kind === 'inbox', {
        preview: opts?.preview ?? true,
      }),
    [focusOrAddTab],
  );
  const openTodos = useCallback(
    (opts?: { preview?: boolean }) =>
      focusOrAddTab({ id: nextId(), kind: 'todos', title: 'Todos' }, (t) => t.kind === 'todos', {
        preview: opts?.preview ?? true,
      }),
    [focusOrAddTab],
  );
  const openMemory = useCallback(
    (opts?: { preview?: boolean }) =>
      focusOrAddTab({ id: nextId(), kind: 'memory', title: 'Memory' }, (t) => t.kind === 'memory', {
        preview: opts?.preview ?? true,
      }),
    [focusOrAddTab],
  );
  const openFolder = useCallback(
    (dir: string, opts?: { preview?: boolean }) =>
      focusOrAddTab({ id: nextId(), kind: 'folder', dir, title: dir }, (t) => t.kind === 'folder' && t.dir === dir, {
        preview: opts?.preview ?? true,
      }),
    [focusOrAddTab],
  );
  const openContext = useCallback(
    (tag: string, opts?: { preview?: boolean }) =>
      focusOrAddTab(
        { id: nextId(), kind: 'context', tag, title: `#${tag}` },
        (t) => t.kind === 'context' && t.tag === tag,
        { preview: opts?.preview ?? true },
      ),
    [focusOrAddTab],
  );
  const openSettings = useCallback(
    (opts?: { preview?: boolean }) =>
      focusOrAddTab({ id: nextId(), kind: 'settings', title: 'Settings' }, (t) => t.kind === 'settings', {
        preview: opts?.preview ?? true,
      }),
    [focusOrAddTab],
  );
  const openSkills = useCallback(
    (opts?: { preview?: boolean }) => {
      void refreshSkills();
      focusOrAddTab({ id: nextId(), kind: 'skills', title: 'Skills' }, (t) => t.kind === 'skills', {
        preview: opts?.preview ?? true,
      });
    },
    [focusOrAddTab, refreshSkills],
  );

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      const next = prev.filter((t) => t.id !== id);
      setActiveTabId((cur) => (cur === id ? next[Math.max(0, idx - 1)]?.id ?? null : cur));
      return next;
    });
  }, []);

  const closeOtherTabs = useCallback((id: string) => {
    setTabs((prev) => {
      const kept = prev.filter((t) => t.id === id);
      if (kept.length === prev.length) return prev;
      setActiveTabId(kept[0]?.id ?? null);
      return kept;
    });
  }, []);

  const closeAllTabs = useCallback(() => {
    setTabs([]);
    setActiveTabId(null);
  }, []);

  const closeTabsBefore = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx <= 0) return prev;
      const kept = prev.slice(idx);
      setActiveTabId((cur) => (kept.some((t) => t.id === cur) ? cur : id));
      return kept;
    });
  }, []);

  const closeTabsAfter = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1 || idx === prev.length - 1) return prev;
      const kept = prev.slice(0, idx + 1);
      setActiveTabId((cur) => (kept.some((t) => t.id === cur) ? cur : id));
      return kept;
    });
  }, []);

  const keepTab = useCallback((id: string) => {
    setTabs((prev) => (prev.some((t) => t.id === id && t.preview) ? prev.map((t) => (t.id === id ? { ...t, preview: undefined } : t)) : prev));
  }, []);

  const moveTab = useCallback((id: string, toIndex: number) => {
    setTabs((prev) => {
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

  // Favourites follow the open workspace.
  useEffect(() => {
    setFavorites(vault ? loadFavorites(vault.path) : []);
  }, [vault]);

  const toggleFavorite = useCallback(
    (path: string) => {
      setFavorites((prev) => {
        const next = prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path];
        if (vault) persistFavorites(vault.path, next);
        return next;
      });
    },
    [vault],
  );

  const query = useCallback((q: NoteQueryDTO) => invoke['vault:query'](q), []);

  const ingestCapture = useCallback(
    async (input: IngestCaptureInputDTO) => {
      const result = await invoke['capture:ingest'](input);
      await refreshTree();
      if (result.followUp) {
        // The capture needs processing — After-Meeting or Intake picks it up
        // in a fresh session tab; everything it produces is approval cards.
        const tab: Tab = {
          id: nextId(),
          kind: 'session',
          sessionType: result.followUp.sessionType,
          initialPrompt: result.followUp.prompt,
          title: result.followUp.tabTitle,
        };
        setTabs((prev) => [...prev, tab]);
        setActiveTabId(tab.id);
      } else {
        // Nothing to process (plain note) — show what was filed.
        focusOrAddTab(
          { id: nextId(), kind: 'doc', path: result.note.path, title: result.note.title },
          (t) => t.kind === 'doc' && t.path === result.note.path,
        );
        await loadDoc(result.note.path);
      }
      return result;
    },
    [refreshTree, focusOrAddTab, loadDoc],
  );

  const previewProposal = useCallback((id: string) => invoke['proposals:preview'](id), []);

  const refreshProposals = useCallback(async () => {
    try {
      const list = await invoke['proposals:list']('pending');
      setProposals(list);
      setPendingCount(list.length);
    } catch {
      setProposals([]);
      setPendingCount(0);
    }
  }, []);

  const refreshProblems = useCallback(async () => {
    try {
      setProblems(await invoke['problems:byHeat']());
    } catch {
      setProblems([]);
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const [chatList, liveList] = await Promise.all([invoke['chats:list'](), invoke['sessions:live']()]);
      setChats(chatList);
      setLive(Object.fromEntries(liveList.map((l) => [l.sessionId, l])));
    } catch {
      setChats([]);
      setLive({});
    }
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
        sessionType: chat.sessionType,
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
        sessionType: l.sessionType,
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

  const attentionCount = useMemo(
    () =>
      pendingCount +
      sessions.filter((s) => s.lifecycle === 'active' && s.unread && s.pendingCards === 0).length,
    [pendingCount, sessions],
  );

  const acceptProposal = useCallback(
    async (id: string, edited?: unknown) => {
      const result = await invoke['proposals:accept'](id, edited);
      await Promise.all([refreshProposals(), refreshTree(), refreshProblems()]);
      return result;
    },
    [refreshProposals, refreshTree, refreshProblems],
  );

  const rejectProposal = useCallback(
    async (id: string) => {
      await invoke['proposals:reject'](id);
      await refreshProposals();
    },
    [refreshProposals],
  );

  // Taking the conversation: mark the ping opened, seed a fresh session with it.
  const openPing = useCallback(
    async (ping: AgentPingDTO) => {
      try {
        await invoke['pings:open'](ping.id);
      } finally {
        await refreshPings();
      }
      openSession(ping.sessionType, { initialPrompt: ping.seedPrompt, title: ping.title, fresh: true });
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
        // Switching to a different workspace: doc/folder/session tabs point at the
        // old vault, so drop them (views like inbox just re-query).
        if (prev && info && prev.path !== info.path) {
          setDocData({});
          setTabs((tabs) => {
            const kept = tabs.filter((t) => t.kind !== 'doc' && t.kind !== 'folder' && t.kind !== 'session');
            setActiveTabId((active) => (kept.some((t) => t.id === active) ? active : kept[0]?.id ?? null));
            return kept;
          });
        }
        return info;
      });
      if (info)
        await Promise.all([
          refreshTree(),
          refreshProposals(),
          refreshProblems(),
          refreshSessions(),
          refreshPings(),
          refreshSkills(),
        ]);
    },
    [refreshTree, refreshProposals, refreshProblems, refreshSessions, refreshPings, refreshSkills],
  );

  const openVaultDialog = useCallback(async () => {
    const info = await invoke['vault:pick']();
    if (info) await bootVault(info);
  }, [bootVault]);

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
    async (path: string, status: TodoStatus) => {
      await invoke['todos:setStatus'](path, status);
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
      await Promise.all([refreshTree(), refreshProblems(), loadDoc(path)]);
    },
    [refreshTree, refreshProblems, loadDoc],
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
      setTabs((prev) =>
        prev.map((t) =>
          t.kind === 'doc' && t.path === path ? { ...t, path: note.path, title: note.title, noteType: note.type } : t,
        ),
      );
      if (note.path !== path) {
        setFavorites((prev) => {
          if (!prev.includes(path)) return prev;
          const next = prev.map((p) => (p === path ? note.path : p));
          if (vault) persistFavorites(vault.path, next);
          return next;
        });
      }
      await refreshTree();
      return note;
    },
    [vault, refreshTree],
  );

  const deleteNote = useCallback(
    async (path: string) => {
      await invoke['note:delete'](path);
      setDocData((d) => {
        const { [path]: _, ...rest } = d;
        return rest;
      });
      setTabs((prev) => {
        const next = prev.filter((t) => !(t.kind === 'doc' && t.path === path));
        // Deleting the note you're viewing must hand focus to a neighbor,
        // exactly like closeTab — otherwise no tab is active and ⌘W dies.
        setActiveTabId((cur) => {
          if (cur === null || next.some((t) => t.id === cur)) return cur;
          const idx = prev.findIndex((t) => t.id === cur);
          return next[Math.max(0, idx - 1)]?.id ?? null;
        });
        return next;
      });
      setFavorites((prev) => {
        if (!prev.includes(path)) return prev;
        const next = prev.filter((p) => p !== path);
        if (vault) persistFavorites(vault.path, next);
        return next;
      });
      await refreshTree();
    },
    [vault, refreshTree],
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
      if (info && active?.kind === 'doc') void loadDoc(active.path);
      const open = new URLSearchParams(window.location.search).get('open');
      if (info && open === '__settings') openSettings();
      else if (info && open === '__skills') openSkills();
      else if (info && open === '__chat') openSession('chat');
      else if (info && open === '__review') openInbox();
      else if (info && open === '__todos') openTodos();
      else if (info && open === '__memory') openMemory();
      else if (info && (open === '__capture' || open === '__meeting')) requestCapture();
      else if (info && open?.startsWith('__folder:')) openFolder(open.slice('__folder:'.length));
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
        void refreshProblems();
        if (event.paths.some((p) => p.startsWith('skills/'))) void refreshSkills();
        for (const path of event.paths) if (docData[path]) void loadDoc(path);
      } else if (event.channel === 'proposals:changed') {
        setPendingCount(event.pendingCount);
        void refreshProposals();
      } else if (event.channel === 'session:status') {
        // The rail's heartbeat: track runs as they start, refresh rows on settle.
        if (event.status === 'running') {
          setLive((prev) => ({
            ...prev,
            [event.sessionId]: {
              sessionId: event.sessionId,
              sessionType: event.sessionType,
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
        }
      } else if (event.channel === 'pings:changed') {
        void refreshPings();
      } else if (event.channel === 'session:focus') {
        // OS notification click — land the PO in that conversation.
        openChat({ id: event.sessionId, sessionType: event.sessionType, title: event.title });
      }
    });
  }, [refreshTree, refreshProblems, refreshProposals, refreshSessions, refreshPings, refreshSkills, openChat, loadDoc, docData]);

  const value = useMemo<AppState>(
    () => ({
      vault,
      tree,
      tabs,
      activeTabId,
      activeTab,
      docData,
      openVaultDialog,
      favorites,
      toggleFavorite,
      pendingCount,
      proposals,
      problems,
      sessions,
      pings,
      skills,
      refreshSkills,
      attentionCount,
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
      bindTabSession,
      openInbox,
      openTodos,
      openMemory,
      openFolder,
      openContext,
      openSettings,
      openSkills,
      closeTab,
      closeOtherTabs,
      closeAllTabs,
      closeTabsBefore,
      closeTabsAfter,
      keepTab,
      moveTab,
      setActiveTab,
      loadDoc,
      query,
      ingestCapture,
      previewProposal,
      refreshProposals,
      acceptProposal,
      rejectProposal,
      captureNote,
      captureTodo,
      setTodoStatus,
      saveNote,
      saveFrontmatter,
      renameNote,
      deleteNote,
      search,
    }),
    [vault, tree, tabs, activeTabId, activeTab, docData, openVaultDialog, favorites, toggleFavorite, pendingCount, proposals, problems, sessions, pings, skills, refreshSkills, attentionCount, markSessionSeen, refreshSessions, openPing, dismissPing, resolvePingItem, deleteSession, setSessionLifecycle, openDoc, openSession, openChat, openChats, bindTabSession, openInbox, openTodos, openMemory, openFolder, openContext, openSettings, openSkills, closeTab, closeOtherTabs, closeAllTabs, closeTabsBefore, closeTabsAfter, keepTab, moveTab, setActiveTab, query, ingestCapture, previewProposal, refreshProposals, acceptProposal, rejectProposal, captureNote, captureTodo, setTodoStatus, saveNote, saveFrontmatter, renameNote, deleteNote, search, loadDoc],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used within AppStateProvider');
  return ctx;
}
