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
  CaptureSignalInput,
  NoteDTO,
  SearchHitDTO,
  VaultInfoDTO,
  VaultTreeDTO,
} from '@pm/ipc';
import { invoke, onEvent } from '../lib/ipc';

export type CenterView =
  | { kind: 'landing' }
  | { kind: 'note'; path: string }
  | { kind: 'chat' }
  | { kind: 'settings' };

interface AppState {
  vault: VaultInfoDTO | null;
  tree: VaultTreeDTO | null;
  view: CenterView;
  currentNote: NoteDTO | null;
  backlinks: BacklinkDTO[];
  openVaultDialog: () => Promise<void>;
  openNote: (path: string) => Promise<void>;
  showLanding: () => void;
  showChat: () => void;
  showSettings: () => void;
  captureSignal: (input: CaptureSignalInput) => Promise<NoteDTO>;
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

  const showChat = useCallback(() => setView({ kind: 'chat' }), []);
  const showSettings = useCallback(() => setView({ kind: 'settings' }), []);

  const bootVault = useCallback(
    async (info: VaultInfoDTO | null) => {
      setVault(info);
      if (info) await refreshTree();
    },
    [refreshTree],
  );

  const openVaultDialog = useCallback(async () => {
    const info = await invoke['vault:pick']();
    if (info) await bootVault(info);
  }, [bootVault]);

  const captureSignal = useCallback(
    async (input: CaptureSignalInput) => {
      const note = await invoke['signal:capture'](input);
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

  // Initial load: any vault opened on startup by main.
  useEffect(() => {
    void invoke['vault:current']().then(async (info) => {
      await bootVault(info);
      const open = new URLSearchParams(window.location.search).get('open');
      if (info && open === '__settings') setView({ kind: 'settings' });
      else if (info && open === '__chat') setView({ kind: 'chat' });
      else if (info && open) void openNote(open);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootVault]);

  // Live refresh when the vault changes on disk (external Obsidian edits).
  useEffect(() => {
    return onEvent((event) => {
      if (event.channel === 'vault:changed') {
        void refreshTree();
        if (view.kind === 'note' && event.paths.includes(view.path)) void loadNote(view.path);
      }
    });
  }, [refreshTree, loadNote, view]);

  const value = useMemo<AppState>(
    () => ({
      vault,
      tree,
      view,
      currentNote,
      backlinks,
      openVaultDialog,
      openNote,
      showLanding,
      showChat,
      showSettings,
      captureSignal,
      saveNote,
      search,
      refresh,
    }),
    [vault, tree, view, currentNote, backlinks, openVaultDialog, openNote, showLanding, showChat, showSettings, captureSignal, saveNote, search, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used within AppStateProvider');
  return ctx;
}
