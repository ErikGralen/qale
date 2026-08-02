import { useCallback, useEffect, useRef, useState } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup, TooltipProvider } from '@pm/ui';
import type { ArrivalItemInputDTO, ArrivalResultDTO } from '@pm/ipc';
import { readableAs } from '@pm/domain';
import { FileUp } from 'lucide-react';
import { AppStateProvider, useApp } from './state/app-state';
import { CAPTURE_EVENT, type CaptureRequest } from './lib/capture-event';
import { Sidebar } from './app/Sidebar';
import { Home } from './app/Home';
import { NoteView } from './app/NoteView';
import { SessionView } from './app/SessionView';
import { SessionsView } from './app/SessionsView';
import { SessionFileView } from './app/SessionFileView';
import { SettingsView } from './app/SettingsView';
import { SkillsView } from './app/SkillsView';
import { AgentsView } from './app/AgentsView';
import { InboxView } from './app/InboxView';
import { TodosView } from './app/TodosView';
import { MemoryView } from './app/MemoryView';
import { FolderView } from './app/FolderView';
import { ContextView } from './app/ContextView';
import { RightPanel } from './app/RightPanel';
import { TabStrip } from './app/TabStrip';
import { QuickSwitcher } from './app/QuickSwitcher';
import { AddMaterial, type MaterialDraft } from './app/AddMaterial';
import { ArrivalReceipt } from './components/ArrivalReceipt';
import { worthAReceipt } from './lib/arrival-outcome';
import { ExternalRefHoverLayer } from './components/ExternalRef';

function Center() {
  const { activeTab, bindTabSession, openSession } = useApp();
  // No tabs at all is Home too — the gateway is never a place you can lose.
  if (!activeTab) return <Home />;
  switch (activeTab.kind) {
    case 'home':
      return <Home />;
    case 'doc':
      return <NoteView key={activeTab.path} path={activeTab.path} />;
    case 'session':
      return (
        <SessionView
          // Keyed by the history entry, not the tab: back/forward between two
          // sessions in one tab must remount the transcript.
          key={activeTab.key}
          skill={activeTab.skill}
          sessionId={activeTab.sessionId}
          initialPrompt={activeTab.initialPrompt}
          onSessionId={(sessionId) => bindTabSession(activeTab.key, sessionId)}
          onNewSession={() => openSession(activeTab.skill, { fresh: true })}
        />
      );
    case 'sessionFile':
      return (
        <SessionFileView
          key={`${activeTab.sessionId}:${activeTab.path}`}
          sessionId={activeTab.sessionId}
          path={activeTab.path}
        />
      );
    case 'chats':
      return <SessionsView />;
    case 'inbox':
      return <InboxView />;
    case 'todos':
      return <TodosView />;
    case 'memory':
      return <MemoryView />;
    case 'folder':
      return <FolderView key={activeTab.dir} dir={activeTab.dir} />;
    case 'context':
      return <ContextView key={activeTab.tag} tag={activeTab.tag} />;
    case 'settings':
      return <SettingsView />;
    case 'skills':
      return <SkillsView />;
    case 'agents':
      return <AgentsView />;
    default:
      return <Home />;
  }
}

/** True when the key event originates inside a text-editing element. */
function inEditable(e: KeyboardEvent): boolean {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

function Shell() {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureDraft, setCaptureDraft] = useState<MaterialDraft | null>(null);
  /**
   * The last arrival's receipt — persistent until dismissed. Only set when the
   * arrival has something to report that the screen doesn't already show; a
   * capture whose result the PO is now looking at gets no card at all.
   */
  const [receipt, setReceipt] = useState<ArrivalResultDTO | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem('pm.sidebar.visible') !== '0';
    } catch {
      return true;
    }
  });
  const [rightOpen, setRightOpen] = useState(() => {
    try {
      return localStorage.getItem('pm.rightPanel.visible') !== '0';
    } catch {
      return true;
    }
  });
  const dragDepth = useRef(0);
  const { openSession, openHome, openSettings, activeTab, tabs, activeTabId, setActiveTab, closeTab, vault, captureNote, openDoc, goBack, goForward, reopenClosedTab, sessionFiles } =
    useApp();

  // ⌘N: a blank note straight into the editor — capture (⇧⌘N) keeps the dialog.
  const newNote = useCallback(async () => {
    if (!vault) return;
    const note = await captureNote({ body: '', summary: 'Untitled' });
    await openDoc(note.path);
  }, [vault, captureNote, openDoc]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((o) => {
      try {
        localStorage.setItem('pm.sidebar.visible', o ? '0' : '1');
      } catch {
        /* ignore quota */
      }
      return !o;
    });
  }, []);

  // The right rail hides like the sidebar does: one workbench-wide preference,
  // remembered across launches, so a session's file tree never takes the window
  // back after the PM has pushed it away.
  const toggleRightPanel = useCallback(() => {
    setRightOpen((o) => {
      try {
        localStorage.setItem('pm.rightPanel.visible', o ? '0' : '1');
      } catch {
        /* ignore quota */
      }
      return !o;
    });
  }, []);

  const openCapture = useCallback((draft?: MaterialDraft) => {
    setCaptureDraft(draft ?? null);
    setCaptureOpen(true);
  }, []);

  /**
   * The drag overlay's kill switch. The Shell counts dragenter/dragleave, but a
   * drop that lands on the Add material tray stops propagating before the
   * Shell's own handler runs — so without this the counter never returns to
   * zero and the "Drop anything" overlay stays on screen for good. Capture
   * phase on the window catches every drop, ours or not.
   */
  useEffect(() => {
    const clear = () => {
      dragDepth.current = 0;
      setDragging(false);
    };
    window.addEventListener('drop', clear, true);
    window.addEventListener('dragend', clear, true);
    return () => {
      window.removeEventListener('drop', clear, true);
      window.removeEventListener('dragend', clear, true);
    };
  }, []);

  // Home, deep links, and anything outside the Shell request capture by event —
  // with a draft when they already hold the material (a pasted transcript).
  useEffect(() => {
    const onCapture = (e: Event) => openCapture((e as CustomEvent<CaptureRequest | undefined>).detail ?? undefined);
    window.addEventListener(CAPTURE_EVENT, onCapture);
    return () => window.removeEventListener(CAPTURE_EVENT, onCapture);
  }, [openCapture]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        setSwitcherOpen((o) => !o);
      } else if (key === 'n') {
        e.preventDefault();
        if (e.shiftKey) openCapture();
        else void newNote();
      } else if (e.key === 'Enter') {
        // ⌘↵ submits inside composers (capture, quick capture) — only open Ask
        // from non-editable context, otherwise one keystroke does two things.
        // Capture owns the chord outright while it is open: its own ⌘↵ files
        // from anywhere in the dialog, including its chips, which are buttons.
        if (inEditable(e) || captureOpen) return;
        e.preventDefault();
        openSession('ask');
      } else if (key === 'w') {
        // Freed from the window menu (Close Window is ⌘⇧W).
        if (activeTabId) {
          e.preventDefault();
          closeTab(activeTabId);
        }
      } else if (key === 't') {
        // Browser muscle memory: ⌘T a fresh tab — and this app's new-tab page is
        // Home. ⇧⌘T restores the last closed tab with its history.
        e.preventDefault();
        if (e.shiftKey) reopenClosedTab();
        else openHome({ newTab: true, foreground: true });
      } else if (key === ',') {
        // ⌘, — the platform's word for preferences. Settings moved under the
        // cog's menu with Skills and Agents; the keystroke keeps it one step.
        e.preventDefault();
        openSettings();
      } else if (key === 'h' && e.shiftKey) {
        // ⇧⌘H — the Home button's keyboard path. Navigates the active tab, the
        // way a browser's home button does; ⌘T is the one that opens a new one.
        e.preventDefault();
        openHome();
      } else if ((key === '[' || key === ']' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey) {
        // Per-tab history — both browser spellings (⌘[/⌘] and ⌘←/⌘→). Never
        // inside an editable: there ⌘← is line-start and ⌘[ may be outdent.
        if (inEditable(e)) return;
        e.preventDefault();
        if (key === '[' || e.key === 'ArrowLeft') goBack();
        else goForward();
      } else if (key === '\\' || key === '|') {
        // ⌘\ the left rail, ⇧⌘\ the right one — mirrored keys for mirrored
        // panels. Shift makes the backslash a pipe on a US layout, so accept both.
        e.preventDefault();
        if (e.shiftKey) toggleRightPanel();
        else toggleSidebar();
      } else if (key >= '1' && key <= '9') {
        const tab = tabs[Number(key) - 1];
        if (tab) {
          e.preventDefault();
          setActiveTab(tab.id);
        }
      }
    };
    const onCycle = (e: KeyboardEvent) => {
      // ctrl-tab / ctrl-shift-tab cycle tabs, matching browser muscle memory.
      if (e.ctrlKey && e.key === 'Tab' && tabs.length > 0) {
        e.preventDefault();
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        const next = tabs[(idx + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length];
        if (next) setActiveTab(next.id);
      }
    };
    // Mouse back/forward buttons navigate the active tab, like a browser.
    const onMouseNav = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        goBack();
      } else if (e.button === 4) {
        e.preventDefault();
        goForward();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onCycle);
    window.addEventListener('mouseup', onMouseNav);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onCycle);
      window.removeEventListener('mouseup', onMouseNav);
    };
  }, [openSession, openHome, openSettings, openCapture, newNote, toggleSidebar, toggleRightPanel, activeTabId, tabs, setActiveTab, closeTab, goBack, goForward, reopenClosedTab, captureOpen]);

  /**
   * Shell-wide drop: everything dragged anywhere lands in the Add material
   * tray, however many files it is. The drop is an accelerator for the button,
   * not a second door with its own behaviour — discovering one has to teach the
   * other (docs/vision/arrival.md §7).
   */
  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const dropped = Array.from(e.dataTransfer.files);
      if (dropped.length === 0 || !vault) return;
      const files: ArrivalItemInputDTO[] = [];
      for (const file of dropped) {
        if (readableAs(file.name) === null) {
          files.push({ name: file.name, lastModified: file.lastModified });
          continue;
        }
        if (file.type.startsWith('image/')) {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result as string);
            r.onerror = () => reject(r.error);
            r.readAsDataURL(file);
          });
          files.push({
            name: file.name,
            dataBase64: dataUrl.split(',')[1] ?? '',
            lastModified: file.lastModified,
          });
        } else {
          files.push({ name: file.name, text: await file.text(), lastModified: file.lastModified });
        }
      }
      openCapture({ files });
    },
    [openCapture, vault],
  );

  // The right panel is the note's session corner, or a session's working-file
  // tree. A session with no files gets no panel: an empty 35% column would read
  // as a broken feature on every ordinary session.
  const sessionFileCount =
    activeTab?.kind === 'session' && activeTab.sessionId ? sessionFiles[activeTab.sessionId]?.length ?? 0 : 0;
  const rightAvailable = activeTab?.kind === 'doc' || sessionFileCount > 0;
  const showRight = rightAvailable && rightOpen;
  // The toggle names what it would open — "session files", not "panel" — and
  // stays in the strip (disabled) on tabs that have no rail, so the cluster
  // beside it never reflows.
  const rightPanel = {
    open: rightOpen,
    available: rightAvailable,
    name: activeTab?.kind === 'session' ? 'session files' : activeTab?.kind === 'doc' ? 'the session' : 'panel',
    count: sessionFileCount,
    onToggle: toggleRightPanel,
  };

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-background text-foreground"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <ResizablePanelGroup orientation="horizontal">
        {sidebarOpen && (
          <>
            <ResizablePanel defaultSize="20%" minSize="14%" maxSize="30%" className="bg-sidebar">
              <Sidebar
                onSearch={() => setSwitcherOpen(true)}
                onNewNote={() => void newNote()}
                onIngest={() => openCapture()}
              />
            </ResizablePanel>
            <ResizableHandle />
          </>
        )}
        <ResizablePanel defaultSize="80%" minSize="40%">
          {/* The tab strip spans the full workbench so it never reflows when a
              tab without a session panel becomes active; the panel splits below it. */}
          <div className="flex h-full flex-col">
            <TabStrip sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} rightPanel={rightPanel} />
            <div className="min-h-0 flex-1">
              <ResizablePanelGroup orientation="horizontal">
                <ResizablePanel defaultSize={showRight ? '65%' : '100%'} minSize="40%">
                  <Center />
                </ResizablePanel>
                {showRight && (
                  <>
                    <ResizableHandle />
                    <ResizablePanel defaultSize="35%" minSize="22%" maxSize="58%">
                      <RightPanel />
                    </ResizablePanel>
                  </>
                )}
              </ResizablePanelGroup>
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {dragging && vault && !captureOpen && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-background/80">
          <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-brand bg-card px-10 py-8">
            <FileUp className="size-8 text-brand" />
            <div className="text-center">
              <div className="text-sm font-semibold">Drop anything</div>
              <div className="mt-0.5 text-sm text-muted-foreground">
                A transcript, an article, a screenshot — you confirm before anything runs
              </div>
            </div>
          </div>
        </div>
      )}

      <QuickSwitcher
        open={switcherOpen}
        onOpenChange={setSwitcherOpen}
        onOpenCapture={() => openCapture()}
        onNewNote={() => void newNote()}
      />
      <AddMaterial
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        draft={captureDraft}
        onArrived={(r) => setReceipt(worthAReceipt(r) ? r : null)}
      />
      {receipt && <ArrivalReceipt arrival={receipt} onDismiss={() => setReceipt(null)} />}
      {/* One hover card serves every [[PAY-142]]-style reference — read view,
          cards, and the editor's wikilink atoms all stamp data-external-ref. */}
      <ExternalRefHoverLayer onOpen={(path) => void openDoc(path)} />
    </div>
  );
}

export function App() {
  return (
    <AppStateProvider>
      {/* Quick but not instant: hover long enough to want the hint, short
          enough that the shortcut is always one glance away. */}
      <TooltipProvider delayDuration={450} skipDelayDuration={300}>
        <Shell />
      </TooltipProvider>
    </AppStateProvider>
  );
}
