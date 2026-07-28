import { useCallback, useEffect, useRef, useState } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup, TooltipProvider } from '@pm/ui';
import { FileUp } from 'lucide-react';
import { AppStateProvider, useApp } from './state/app-state';
import { CAPTURE_EVENT } from './lib/capture-event';
import { Sidebar } from './app/Sidebar';
import { Landing } from './app/Landing';
import { NoteView } from './app/NoteView';
import { ChatView } from './app/ChatView';
import { ChatsView } from './app/ChatsView';
import { SettingsView } from './app/SettingsView';
import { SkillsView } from './app/SkillsView';
import { InboxView } from './app/InboxView';
import { TodosView } from './app/TodosView';
import { MemoryView } from './app/MemoryView';
import { FolderView } from './app/FolderView';
import { ContextView } from './app/ContextView';
import { RightPanel } from './app/RightPanel';
import { TabStrip } from './app/TabStrip';
import { QuickSwitcher } from './app/QuickSwitcher';
import { CaptureDialog, type CaptureDraft } from './app/CaptureDialog';
import { ExternalRefHoverLayer } from './components/ExternalRef';
import { useToast } from './components/toast';

function Center() {
  const { activeTab, bindTabSession, openSession } = useApp();
  if (!activeTab) return <Landing />;
  switch (activeTab.kind) {
    case 'doc':
      return <NoteView key={activeTab.path} path={activeTab.path} />;
    case 'session':
      return (
        <ChatView
          // Keyed by the history entry, not the tab: back/forward between two
          // conversations in one tab must remount the transcript.
          key={activeTab.key}
          sessionType={activeTab.sessionType}
          sessionId={activeTab.sessionId}
          initialPrompt={activeTab.initialPrompt}
          onSessionId={(sessionId) => bindTabSession(activeTab.key, sessionId)}
          onNewChat={() => openSession(activeTab.sessionType, { fresh: true })}
        />
      );
    case 'chats':
      return <ChatsView />;
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
    default:
      return <Landing />;
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
  const [captureDraft, setCaptureDraft] = useState<CaptureDraft | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem('pm.sidebar.visible') !== '0';
    } catch {
      return true;
    }
  });
  const dragDepth = useRef(0);
  const { openSession, activeTab, tabs, activeTabId, setActiveTab, closeTab, vault, captureNote, openDoc, goBack, goForward, reopenClosedTab } =
    useApp();
  const toast = useToast();

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

  const openCapture = useCallback((draft?: CaptureDraft) => {
    setCaptureDraft(draft ?? null);
    setCaptureOpen(true);
  }, []);

  // Landing, deep links, and anything outside the Shell request capture by event.
  useEffect(() => {
    const onCapture = () => openCapture();
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
        if (inEditable(e)) return;
        e.preventDefault();
        openSession('ask');
      } else if (key === 'w') {
        // Freed from the window menu (Close Window is ⌘⇧W).
        if (activeTabId) {
          e.preventDefault();
          closeTab(activeTabId);
        }
      } else if (key === 't') {
        // Browser muscle memory: ⌘T a fresh tab (a chat — this app's new-tab
        // page), ⇧⌘T restores the last closed tab with its history.
        e.preventDefault();
        if (e.shiftKey) reopenClosedTab();
        else openSession('chat', { fresh: true });
      } else if ((key === '[' || key === ']' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey) {
        // Per-tab history — both browser spellings (⌘[/⌘] and ⌘←/⌘→). Never
        // inside an editable: there ⌘← is line-start and ⌘[ may be outdent.
        if (inEditable(e)) return;
        e.preventDefault();
        if (key === '[' || e.key === 'ArrowLeft') goBack();
        else goForward();
      } else if (key === '\\') {
        e.preventDefault();
        toggleSidebar();
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
  }, [openSession, openCapture, newNote, toggleSidebar, activeTabId, tabs, setActiveTab, closeTab, goBack, goForward, reopenClosedTab]);

  // Shell-wide drop: anything dragged anywhere opens the capture dialog
  // prefilled — the classifier guesses, the user confirms. Never auto-run.
  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (!file || !vault) return;
      // Capture is one-at-a-time; dropping a bundle must not silently eat the rest.
      if (e.dataTransfer.files.length > 1) {
        toast(`Capturing "${file.name}" — drop the other ${e.dataTransfer.files.length - 1} one at a time.`);
      }
      if (file.type.startsWith('image/')) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = () => reject(r.error);
          r.readAsDataURL(file);
        });
        openCapture({ image: { name: file.name, dataUrl } });
      } else {
        openCapture({ text: await file.text(), fileName: file.name });
      }
    },
    [openCapture, vault, toast],
  );

  const showRight = activeTab?.kind === 'doc';

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
              tab without a chat panel becomes active; the panel splits below it. */}
          <div className="flex h-full flex-col">
            <TabStrip sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
            <div className="min-h-0 flex-1">
              <ResizablePanelGroup orientation="horizontal">
                <ResizablePanel defaultSize={showRight ? '65%' : '100%'} minSize="40%">
                  <Center />
                </ResizablePanel>
                {showRight && (
                  <>
                    <ResizableHandle />
                    <ResizablePanel defaultSize="35%" minSize="22%" maxSize="50%">
                      <RightPanel />
                    </ResizablePanel>
                  </>
                )}
              </ResizablePanelGroup>
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {dragging && vault && (
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
      <CaptureDialog open={captureOpen} onOpenChange={setCaptureOpen} draft={captureDraft} />
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
