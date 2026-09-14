import { useCallback, useEffect, useRef, useState } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup, TooltipProvider } from '@qale/ui';
import { AlertTriangle, FileUp, X } from 'lucide-react';
import { pathForFile } from './lib/ipc';
import { itemsFromFiles } from './lib/attachments';
import { AppStateProvider, useApp } from './state/app-state';
import { CAPTURE_EVENT, type CaptureRequest } from './lib/capture-event';
import { useNewNote } from './lib/new-note';
import { Sidebar } from './app/Sidebar';
import { Home } from './app/Home';
import { NoteView } from './app/NoteView';
import { SessionView } from './app/SessionView';
import { SessionsView } from './app/SessionsView';
import { SessionFileView } from './app/SessionFileView';
import { SettingsView } from './app/SettingsView';
import { SkillsView } from './app/SkillsView';
import { TodosView } from './app/TodosView';
import { MemoryView } from './app/MemoryView';
import { ActivityView } from './app/ActivityView';
import { FolderView } from './app/FolderView';
import { CalendarView } from './app/CalendarView';
import { DocumentsView, NEW_FOLDER_EVENT } from './app/DocumentsView';
import { ContextView } from './app/ContextView';
import { RightPanel } from './app/RightPanel';
import { TabStrip } from './app/TabStrip';
import { QuickSwitcher } from './app/QuickSwitcher';
import { AddSource, type SourceDraft } from './app/AddSource';
import { ExternalRefHoverLayer } from './components/ExternalRef';
import { Opening } from './onboarding/Opening';

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
          draftKey={activeTab.key}
          initialPrompt={activeTab.initialPrompt}
          initialModel={activeTab.modelId}
          scope={activeTab.scope}
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
    case 'todos':
      return <TodosView />;
    // Calendar and Documents are rail places before they are screens. The
    // meetings and notes folders are the truest thing we have today, so they
    // stand in: replace the one line with the real view when it lands.
    case 'calendar':
      return <CalendarView key="calendar" />;
    // The key stays "documents" on purpose: the level comes in as a prop, so
    // walking folders keeps one component and its expansion state.
    case 'documents':
      return (
        <DocumentsView
          key="documents"
          viewKey={activeTab.key}
          folder={activeTab.folder ?? ''}
          expanded={activeTab.expanded}
        />
      );
    // The key stays "memory" for the same reason Documents keeps its own: what
    // is expanded comes in as a prop, so one component holds the page.
    case 'memory':
      return <MemoryView key="memory" viewKey={activeTab.key} expanded={activeTab.expanded} />;
    case 'activity':
      return <ActivityView />;
    case 'folder':
      return <FolderView key={activeTab.dir} dir={activeTab.dir} />;
    case 'context':
      return <ContextView key={activeTab.tag} tag={activeTab.tag} />;
    case 'settings':
      return <SettingsView viewKey={activeTab.key} section={activeTab.section} />;
    case 'skills':
      return <SkillsView viewKey={activeTab.key} section={activeTab.section} />;
    default:
      return <Home />;
  }
}

/** True when the key event originates inside a text-editing element. */
function inEditable(e: KeyboardEvent): boolean {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return false;
  return (
    t.isContentEditable ||
    t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT'
  );
}

function Shell() {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureDraft, setCaptureDraft] = useState<SourceDraft | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem('qale.sidebar.visible') !== '0';
    } catch {
      return true;
    }
  });
  // Two rails, two memories, both shut until asked for. Opening a document
  // must never pop a chat panel the PM didn't ask for, any more than opening
  // a session should pop its file tree.
  const [docPanelOpen, setDocPanelOpen] = useState(() => {
    try {
      return localStorage.getItem('qale.rightPanel.doc.visible') === '1';
    } catch {
      return false;
    }
  });
  const [sessionFilesOpen, setSessionFilesOpen] = useState(() => {
    try {
      return localStorage.getItem('qale.rightPanel.session.visible') === '1';
    } catch {
      return false;
    }
  });
  const dragDepth = useRef(0);
  const {
    openSession,
    openChat,
    openHome,
    openSettings,
    activeTab,
    tabs,
    activeTabId,
    setActiveTab,
    closeTab,
    vault,
    settings,
    captureNote,
    openDoc,
    goBack,
    goForward,
    reopenClosedTab,
    sessionFiles,
    blockedBy,
    dismissBlockedBy,
  } = useApp();

  // Documents' own "New document", so ⌘N on that page files where the page is.
  const { create: createDocument } = useNewNote();

  // ⌘N: a blank note straight into the editor — capture (⇧⌘N) keeps the dialog.
  // On a Documents tab it lands in the folder that tab is standing in, which is
  // what the page's own "New document" does and what its tooltip promises.
  const newNote = useCallback(async () => {
    if (!vault) return;
    if (activeTab?.kind === 'documents')
      return void createDocument('note', undefined, activeTab.folder);
    const note = await captureNote({ body: '', summary: 'Untitled' });
    await openDoc(note.path);
  }, [vault, activeTab, createDocument, captureNote, openDoc]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((o) => {
      try {
        localStorage.setItem('qale.sidebar.visible', o ? '0' : '1');
      } catch {
        /* ignore quota */
      }
      return !o;
    });
  }, []);

  // Each rail hides on its own preference, remembered across launches, so
  // pushing one away never affects the other.
  const toggleRightPanel = useCallback(() => {
    const setOpen = activeTab?.kind === 'session' ? setSessionFilesOpen : setDocPanelOpen;
    const key =
      activeTab?.kind === 'session'
        ? 'qale.rightPanel.session.visible'
        : 'qale.rightPanel.doc.visible';
    setOpen((o) => {
      try {
        localStorage.setItem(key, o ? '0' : '1');
      } catch {
        /* ignore quota */
      }
      return !o;
    });
  }, [activeTab?.kind]);

  const openCapture = useCallback((draft?: SourceDraft) => {
    setCaptureDraft(draft ?? null);
    setCaptureOpen(true);
  }, []);

  /**
   * The drag overlay's kill switch. The Shell counts dragenter/dragleave, but a
   * drop that lands on the Add source tray stops propagating before the
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
  // with a draft when they already hold the source (a pasted transcript).
  useEffect(() => {
    const onCapture = (e: Event) =>
      openCapture((e as CustomEvent<CaptureRequest | undefined>).detail ?? undefined);
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
      } else if (e.altKey && e.code === 'KeyN') {
        // ⌥⌘N is Documents' own: a new folder at the level that tab stands in.
        // The key is read by `code`, because ⌥ rewrites `key` into the character
        // the layout makes ("˜" on a US Mac). ⇧⌘N stays the capture tray.
        if (activeTab?.kind !== 'documents') return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(NEW_FOLDER_EVENT));
      } else if (key === 'n') {
        // ⇧⌘N is guarded exactly like ⌘↵: pressing it with the tray already
        // open used to re-open it with a fresh draft, throwing away every file
        // gathered so far (AR-12). The tray is already the thing it opens.
        if (e.shiftKey && captureOpen) return;
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
      } else if (
        (key === '[' || key === ']' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
        !e.altKey
      ) {
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
  }, [
    openSession,
    openHome,
    openSettings,
    openCapture,
    newNote,
    toggleSidebar,
    toggleRightPanel,
    activeTabId,
    tabs,
    setActiveTab,
    closeTab,
    goBack,
    goForward,
    reopenClosedTab,
    captureOpen,
    activeTab,
  ]);

  /**
   * Shell-wide drop: a drop nobody else claimed lands in the Add source tray,
   * however many files it is.
   *
   * Pages with a composer claim their own drops before this runs (Home and a
   * session put the files in the bar), and pages that carry an aim claim theirs
   * too (a meeting page, a folder). What is left is a drop on a page with
   * nowhere to put a file, and the tray is where that goes
   * (docs/vision/arrival.md §7).
   */
  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const dropped = Array.from(e.dataTransfer.files);
      if (dropped.length === 0 || !vault) return;
      openCapture({ files: await itemsFromFiles(dropped, pathForFile) });
    },
    [openCapture, vault],
  );

  // The right panel is the note's session corner, or a session's working-file
  // tree. A session with no files gets no panel: an empty 35% column would read
  // as a broken feature on every ordinary session.
  const sessionFileCount =
    activeTab?.kind === 'session' && activeTab.sessionId
      ? (sessionFiles[activeTab.sessionId]?.length ?? 0)
      : 0;
  const rightAvailable = activeTab?.kind === 'doc' || sessionFileCount > 0;
  // Two different rails, two different widths. The note's session corner is a
  // chat and needs room to read; the session's file tree is a column of short
  // filenames, and 420px of it was mostly empty space taken off the session.
  // The key remounts the panel so the new default applies — a width dragged by
  // hand still holds for as long as that kind of rail stays up.
  const railKind: 'files' | 'doc' = activeTab?.kind === 'session' ? 'files' : 'doc';
  const railWidth = railKind === 'files' ? '320px' : '420px';
  const rightOpen = railKind === 'files' ? sessionFilesOpen : docPanelOpen;
  const showRight = rightAvailable && rightOpen;
  // The toggle names what it would open — "session files", not "panel" — and
  // stays in the strip (disabled) on tabs that have no rail, so the cluster
  // beside it never reflows. On a document the rail is a chat, not a panel:
  // the button reads "Start session" and carries an AI icon, distinct from
  // the file-tree toggle a session tab shows.
  const rightPanel = {
    open: rightOpen,
    available: rightAvailable,
    kind: railKind,
    name: railKind === 'files' ? 'session files' : 'the session',
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
            <TabStrip
              sidebarOpen={sidebarOpen}
              onToggleSidebar={toggleSidebar}
              rightPanel={rightPanel}
            />
            {/* Nothing can run until this is cleared, so it sits above whatever
                you are looking at rather than inside the session that happened
                to hit it first. It takes itself down the moment a turn gets an
                answer, but a run queued before the fix can still resettle after
                and put it back up, so the close button is a manual override for
                that race, not a way to unblock anything. */}
            {blockedBy && (
              <div className="flex items-start gap-2 border-b border-warning/40 bg-warning/10 px-6 py-2 text-sm text-warning">
                <AlertTriangle className="mt-px size-4 shrink-0" aria-hidden />
                <span className="flex-1">{blockedBy}</span>
                <button
                  className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-warning transition-colors duration-150 hover:bg-warning/20 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none"
                  onClick={dismissBlockedBy}
                  aria-label="Dismiss"
                  title="Dismiss"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
            )}
            <div className="min-h-0 flex-1">
              <ResizablePanelGroup orientation="horizontal">
                <ResizablePanel defaultSize={showRight ? '65%' : '100%'} minSize="40%">
                  <Center />
                </ResizablePanel>
                {showRight && (
                  <>
                    <ResizableHandle />
                    {/* Fixed in px, not a percentage of the group: on a wide
                        window a percentage grows past a readable column width
                        and steals focus from the center panel. */}
                    <ResizablePanel
                      key={railKind}
                      defaultSize={railWidth}
                      minSize="260px"
                      maxSize="640px"
                    >
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
                A transcript, an article, a screenshot. You confirm before anything runs
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
      <AddSource
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        draft={captureDraft}
        /* Pressing Add goes to the session holding the source. It used to
           close onto a floating line asking whether you wanted to look, plus a
           second rule that opened the tab anyway once the run stopped to ask
           something. Both are gone: the session is where the work is, so that
           is where Add lands you, and there is nothing left to dismiss. */
        onHandoff={(r) => openChat({ id: r.sessionId, title: 'Handling new source' })}
      />
      {/* One hover card serves every [[PAY-142]]-style reference — read view,
          cards, and the editor's wikilink atoms all stamp data-external-ref. */}
      <ExternalRefHoverLayer onOpen={(path) => void openDoc(path)} />

      {/* First run, over everything — including the no-workspace state, which
          is what the opening is there to resolve (docs/onboarding.md ONB-1).
          Gated on settings having loaded so nobody sees the shell flash first. */}
      {settings && !settings.onboarding.finishedAt && <Opening />}
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
