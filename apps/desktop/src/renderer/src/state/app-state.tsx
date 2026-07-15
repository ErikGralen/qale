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
  BacklinkDTO,
  CaptureNoteInput,
  HealthDTO,
  NoteDTO,
  NoteQueryDTO,
  NoteRefDTO,
  ProblemHeatDTO,
  ProblemStance,
  ProposalDTO,
  SearchHitDTO,
  VaultInfoDTO,
  VaultTreeDTO,
} from '@pm/ipc';
import { invoke, onEvent } from '../lib/ipc';
import { SMART_VIEWS, type SmartViewId } from './smart-views';

export type ChatSessionType = 'chat' | 'ask' | 'after-meeting';

/** A tab holds a document or a session interchangeably (PLAN-V2 §3.3). */
export type Tab =
  | { id: string; kind: 'doc'; path: string; title: string }
  | { id: string; kind: 'session'; sessionType: ChatSessionType; sessionId?: string; initialPrompt?: string; title: string }
  | { id: string; kind: 'inbox'; title: string }
  | { id: string; kind: 'smartview'; viewId: SmartViewId; title: string }
  | { id: string; kind: 'folder'; dir: string; title: string }
  | { id: string; kind: 'meeting-drop'; title: string }
  | { id: string; kind: 'settings'; title: string };

interface DocData {
  note: NoteDTO | null;
  backlinks: BacklinkDTO[];
}

interface AppState {
  vault: VaultInfoDTO | null;
  tree: VaultTreeDTO | null;
  tabs: Tab[];
  activeTabId: string | null;
  activeTab: Tab | null;
  docData: Record<string, DocData>;
  openVaultDialog: () => Promise<void>;
  pendingCount: number;
  proposals: ProposalDTO[];
  problems: ProblemHeatDTO[];
  health: HealthDTO | null;
  // navigation
  openDoc: (path: string) => Promise<void>;
  openSession: (sessionType: ChatSessionType, opts?: { initialPrompt?: string; title?: string; fresh?: boolean }) => void;
  openInbox: () => void;
  openSmartView: (id: SmartViewId) => void;
  openFolder: (dir: string) => void;
  openMeetingDrop: () => void;
  openSettings: () => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  // data
  query: (q: NoteQueryDTO) => Promise<NoteRefDTO[]>;
  dropMeeting: (title: string, body: string, safeSpace?: boolean) => Promise<void>;
  previewProposal: (id: string) => Promise<{ before: string; after: string; stale: boolean } | null>;
  refreshProposals: () => Promise<void>;
  acceptProposal: (id: string, edited?: unknown) => Promise<{ ok: boolean; stale?: boolean }>;
  rejectProposal: (id: string) => Promise<void>;
  setProblemStance: (path: string, stance: ProblemStance) => Promise<void>;
  captureNote: (input: CaptureNoteInput) => Promise<NoteDTO>;
  saveNote: (path: string, body: string) => Promise<void>;
  saveFrontmatter: (path: string, frontmatter: Record<string, unknown>) => Promise<void>;
  search: (query: string) => Promise<SearchHitDTO[]>;
}

const Ctx = createContext<AppState | null>(null);

let tabSeq = 0;
const nextId = (): string => `t${Date.now().toString(36)}_${tabSeq++}`;

const TABS_KEY = 'pm.tabs.v2';

function loadPersistedTabs(): { tabs: Tab[]; activeTabId: string | null } {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return { tabs: [], activeTabId: null };
    const parsed = JSON.parse(raw) as { tabs: Tab[]; activeTabId: string | null };
    // Drop live sessions on restart (pi resume is Phase 3); keep docs/views/folders.
    const tabs = (parsed.tabs ?? []).filter((t) => t.kind !== 'session');
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
  const [health, setHealth] = useState<HealthDTO | null>(null);

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

  const loadDoc = useCallback(async (path: string) => {
    const [note, backlinks] = await Promise.all([
      invoke['note:get'](path),
      invoke['note:backlinks'](path),
    ]);
    setDocData((d) => ({ ...d, [path]: { note, backlinks } }));
  }, []);

  const focusOrAddTab = useCallback((tab: Tab, isSame: (t: Tab) => boolean) => {
    setTabs((prev) => {
      const existing = prev.find(isSame);
      if (existing) {
        setActiveTabId(existing.id);
        return prev;
      }
      setActiveTabId(tab.id);
      return [...prev, tab];
    });
  }, []);

  const openDoc = useCallback(
    async (path: string) => {
      const title = path.split('/').pop()?.replace(/\.md$/, '') ?? path;
      focusOrAddTab({ id: nextId(), kind: 'doc', path, title }, (t) => t.kind === 'doc' && t.path === path);
      await loadDoc(path);
    },
    [focusOrAddTab, loadDoc],
  );

  const openSession = useCallback(
    (sessionType: ChatSessionType, opts?: { initialPrompt?: string; title?: string; fresh?: boolean }) => {
      const title = opts?.title ?? (sessionType === 'ask' ? 'Ask' : sessionType === 'after-meeting' ? 'After-Meeting' : 'Chat');
      const tab: Tab = { id: nextId(), kind: 'session', sessionType, initialPrompt: opts?.initialPrompt, title };
      if (opts?.fresh) {
        setTabs((prev) => [...prev, tab]);
        setActiveTabId(tab.id);
      } else {
        focusOrAddTab(tab, (t) => t.kind === 'session' && t.sessionType === sessionType && !t.initialPrompt && !opts?.initialPrompt);
      }
    },
    [focusOrAddTab],
  );

  const openInbox = useCallback(
    () => focusOrAddTab({ id: nextId(), kind: 'inbox', title: 'Inbox' }, (t) => t.kind === 'inbox'),
    [focusOrAddTab],
  );
  const openSmartView = useCallback(
    (id: SmartViewId) =>
      focusOrAddTab(
        { id: nextId(), kind: 'smartview', viewId: id, title: SMART_VIEWS[id].label },
        (t) => t.kind === 'smartview' && t.viewId === id,
      ),
    [focusOrAddTab],
  );
  const openFolder = useCallback(
    (dir: string) => focusOrAddTab({ id: nextId(), kind: 'folder', dir, title: dir }, (t) => t.kind === 'folder' && t.dir === dir),
    [focusOrAddTab],
  );
  const openMeetingDrop = useCallback(
    () => focusOrAddTab({ id: nextId(), kind: 'meeting-drop', title: 'After-Meeting' }, (t) => t.kind === 'meeting-drop'),
    [focusOrAddTab],
  );
  const openSettings = useCallback(
    () => focusOrAddTab({ id: nextId(), kind: 'settings', title: 'Settings' }, (t) => t.kind === 'settings'),
    [focusOrAddTab],
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

  const setActiveTab = useCallback((id: string) => setActiveTabId(id), []);

  const query = useCallback((q: NoteQueryDTO) => invoke['vault:query'](q), []);

  const dropMeeting = useCallback(
    async (title: string, body: string, safeSpace?: boolean) => {
      const note = await invoke['meeting:capture']({ title, body, safeSpace });
      await refreshTree();
      // A safe-space meeting is never formalized — just open the (stub) note.
      if (safeSpace) {
        focusOrAddTab({ id: nextId(), kind: 'doc', path: note.path, title: note.title }, (t) => t.kind === 'doc' && t.path === note.path);
        await loadDoc(note.path);
        return;
      }
      const tab: Tab = {
        id: nextId(),
        kind: 'session',
        sessionType: 'after-meeting',
        initialPrompt: `Run the After-Meeting session on ${note.path}: read the transcript and related memory, then produce the truth delta as approval cards.`,
        title: `After-Meeting: ${note.title}`,
      };
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
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

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await invoke['vault:health']());
    } catch {
      setHealth(null);
    }
  }, []);

  const acceptProposal = useCallback(
    async (id: string, edited?: unknown) => {
      const result = await invoke['proposals:accept'](id, edited);
      await Promise.all([refreshProposals(), refreshTree(), refreshProblems(), refreshHealth()]);
      return result;
    },
    [refreshProposals, refreshTree, refreshProblems, refreshHealth],
  );

  const rejectProposal = useCallback(
    async (id: string) => {
      await invoke['proposals:reject'](id);
      await refreshProposals();
    },
    [refreshProposals],
  );

  const setProblemStance = useCallback(
    async (path: string, stance: ProblemStance) => {
      await invoke['note:setProblemStance'](path, stance);
      await Promise.all([refreshProblems(), refreshTree(), loadDoc(path)]);
    },
    [refreshProblems, refreshTree, loadDoc],
  );

  const bootVault = useCallback(
    async (info: VaultInfoDTO | null) => {
      setVault(info);
      if (info) await Promise.all([refreshTree(), refreshProposals(), refreshProblems(), refreshHealth()]);
    },
    [refreshTree, refreshProposals, refreshProblems, refreshHealth],
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

  const saveNote = useCallback(
    async (path: string, body: string) => {
      await invoke['note:save']({ path, body });
      await Promise.all([refreshTree(), loadDoc(path)]);
    },
    [refreshTree, loadDoc],
  );

  const saveFrontmatter = useCallback(
    async (path: string, frontmatter: Record<string, unknown>) => {
      await invoke['note:saveFrontmatter']({ path, frontmatter });
      await Promise.all([refreshTree(), refreshProblems(), refreshHealth(), loadDoc(path)]);
    },
    [refreshTree, refreshProblems, refreshHealth, loadDoc],
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
      else if (info && open === '__chat') openSession('chat');
      else if (info && open === '__review') openInbox();
      else if (info && open === '__meeting') openMeetingDrop();
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
        void refreshHealth();
        for (const path of event.paths) if (docData[path]) void loadDoc(path);
      } else if (event.channel === 'proposals:changed') {
        setPendingCount(event.pendingCount);
        void refreshProposals();
      }
    });
  }, [refreshTree, refreshProblems, refreshHealth, refreshProposals, loadDoc, docData]);

  const value = useMemo<AppState>(
    () => ({
      vault,
      tree,
      tabs,
      activeTabId,
      activeTab,
      docData,
      openVaultDialog,
      pendingCount,
      proposals,
      problems,
      health,
      openDoc,
      openSession,
      openInbox,
      openSmartView,
      openFolder,
      openMeetingDrop,
      openSettings,
      closeTab,
      setActiveTab,
      query,
      dropMeeting,
      previewProposal,
      refreshProposals,
      acceptProposal,
      rejectProposal,
      setProblemStance,
      captureNote,
      saveNote,
      saveFrontmatter,
      search,
    }),
    [vault, tree, tabs, activeTabId, activeTab, docData, openVaultDialog, pendingCount, proposals, problems, health, openDoc, openSession, openInbox, openSmartView, openFolder, openMeetingDrop, openSettings, closeTab, setActiveTab, query, dropMeeting, previewProposal, refreshProposals, acceptProposal, rejectProposal, setProblemStance, captureNote, saveNote, saveFrontmatter, search],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used within AppStateProvider');
  return ctx;
}
