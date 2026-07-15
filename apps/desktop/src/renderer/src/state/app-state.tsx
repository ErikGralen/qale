import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  BacklinkDTO,
  CaptureNoteInput,
  HealthDTO,
  NoteDTO,
  ProblemHeatDTO,
  ProblemStance,
  ProposalDTO,
  SearchHitDTO,
  VaultInfoDTO,
  VaultTreeDTO,
} from '@pm/ipc';
import { invoke, onEvent } from '../lib/ipc';

export type ChatSessionType = 'chat' | 'ask' | 'after-meeting';

export type CenterView =
  | { kind: 'landing' }
  | { kind: 'note'; path: string }
  | { kind: 'chat'; sessionType: ChatSessionType; initialPrompt?: string }
  | { kind: 'review' }
  | { kind: 'problems' }
  | { kind: 'meeting-drop' }
  | { kind: 'settings' };

interface AppState {
  vault: VaultInfoDTO | null;
  tree: VaultTreeDTO | null;
  view: CenterView;
  currentNote: NoteDTO | null;
  backlinks: BacklinkDTO[];
  openVaultDialog: () => Promise<void>;
  pendingCount: number;
  proposals: ProposalDTO[];
  problems: ProblemHeatDTO[];
  health: HealthDTO | null;
  openNote: (path: string) => Promise<void>;
  showLanding: () => void;
  showChat: (sessionType?: ChatSessionType, initialPrompt?: string) => void;
  showReview: () => void;
  showProblems: () => void;
  showMeetingDrop: () => void;
  showSettings: () => void;
  dropMeeting: (title: string, body: string) => Promise<void>;
  previewProposal: (id: string) => Promise<{ before: string; after: string; stale: boolean } | null>;
  refreshProposals: () => Promise<void>;
  acceptProposal: (id: string, edited?: unknown) => Promise<{ ok: boolean; stale?: boolean }>;
  rejectProposal: (id: string) => Promise<void>;
  setProblemStance: (path: string, stance: ProblemStance) => Promise<void>;
  captureNote: (input: CaptureNoteInput) => Promise<NoteDTO>;
  saveNote: (path: string, body: string) => Promise<void>;
  search: (query: string) => Promise<SearchHitDTO[]>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [vault, setVault] = useState<VaultInfoDTO | null>(null);
  const [tree, setTree] = useState<VaultTreeDTO | null>(null);
  const [view, setView] = useState<CenterView>({ kind: 'landing' });
  const [currentNote, setCurrentNote] = useState<NoteDTO | null>(null);
  const [backlinks, setBacklinks] = useState<BacklinkDTO[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [proposals, setProposals] = useState<ProposalDTO[]>([]);
  const [problems, setProblems] = useState<ProblemHeatDTO[]>([]);
  const [health, setHealth] = useState<HealthDTO | null>(null);

  const refreshTree = useCallback(async () => {
    try {
      setTree(await invoke['vault:tree']());
    } catch {
      setTree(null);
    }
  }, []);

  const loadNote = useCallback(async (path: string) => {
    const [note, links] = await Promise.all([
      invoke['note:get'](path),
      invoke['note:backlinks'](path),
    ]);
    setCurrentNote(note);
    setBacklinks(links);
  }, []);

  const openNote = useCallback(
    async (path: string) => {
      setView({ kind: 'note', path });
      await loadNote(path);
    },
    [loadNote],
  );

  const showLanding = useCallback(() => {
    setView({ kind: 'landing' });
    setCurrentNote(null);
    setBacklinks([]);
  }, []);

  const showChat = useCallback(
    (sessionType: ChatSessionType = 'chat', initialPrompt?: string) =>
      setView({ kind: 'chat', sessionType, initialPrompt }),
    [],
  );
  const showReview = useCallback(() => setView({ kind: 'review' }), []);
  const showProblems = useCallback(() => setView({ kind: 'problems' }), []);
  const showMeetingDrop = useCallback(() => setView({ kind: 'meeting-drop' }), []);
  const showSettings = useCallback(() => setView({ kind: 'settings' }), []);

  const dropMeeting = useCallback(
    async (title: string, body: string) => {
      const note = await invoke['meeting:capture']({ title, body });
      await refreshTree();
      setView({
        kind: 'chat',
        sessionType: 'after-meeting',
        initialPrompt: `Run the After-Meeting session on ${note.path}: read the transcript and related memory, then produce the truth delta as approval cards.`,
      });
    },
    [refreshTree],
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
      await Promise.all([refreshProblems(), refreshTree()]);
    },
    [refreshProblems, refreshTree],
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
      await Promise.all([refreshTree(), loadNote(path)]);
    },
    [refreshTree, loadNote],
  );

  const search = useCallback(async (query: string) => {
    if (!query.trim()) return [];
    return invoke['search:query'](query, 20);
  }, []);

  const refresh = useCallback(async () => {
    await refreshTree();
    if (view.kind === 'note') await loadNote(view.path);
  }, [refreshTree, loadNote, view]);

  // Initial load: any workspace opened on startup by main.
  useEffect(() => {
    void invoke['vault:current']().then(async (info) => {
      await bootVault(info);
      const open = new URLSearchParams(window.location.search).get('open');
      if (info && open === '__settings') setView({ kind: 'settings' });
      else if (info && open === '__chat') setView({ kind: 'chat', sessionType: 'chat' });
      else if (info && open === '__review') setView({ kind: 'review' });
      else if (info && open === '__problems') setView({ kind: 'problems' });
      else if (info && open === '__meeting') setView({ kind: 'meeting-drop' });
      else if (info && open) void openNote(open);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootVault]);

  // Live refresh when the workspace changes on disk (external Obsidian edits).
  useEffect(() => {
    return onEvent((event) => {
      if (event.channel === 'vault:changed') {
        void refreshTree();
        void refreshProblems();
        void refreshHealth();
        if (view.kind === 'note' && event.paths.includes(view.path)) void loadNote(view.path);
      } else if (event.channel === 'proposals:changed') {
        setPendingCount(event.pendingCount);
        void refreshProposals();
      }
    });
  }, [refreshTree, refreshProblems, refreshHealth, refreshProposals, loadNote, view]);

  const value = useMemo<AppState>(
    () => ({
      vault,
      tree,
      view,
      currentNote,
      backlinks,
      openVaultDialog,
      pendingCount,
      proposals,
      problems,
      health,
      openNote,
      showLanding,
      showChat,
      showReview,
      showProblems,
      showMeetingDrop,
      showSettings,
      dropMeeting,
      previewProposal,
      refreshProposals,
      acceptProposal,
      rejectProposal,
      setProblemStance,
      captureNote,
      saveNote,
      search,
      refresh,
    }),
    [vault, tree, view, currentNote, backlinks, pendingCount, proposals, problems, health, openVaultDialog, openNote, showLanding, showChat, showReview, showProblems, showMeetingDrop, showSettings, dropMeeting, previewProposal, refreshProposals, acceptProposal, rejectProposal, setProblemStance, captureNote, saveNote, search, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used within AppStateProvider');
  return ctx;
}
