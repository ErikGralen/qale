import { useEffect, useState } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@pm/ui';
import { AppStateProvider, useApp } from './state/app-state';
import { Sidebar } from './app/Sidebar';
import { Landing } from './app/Landing';
import { NoteView } from './app/NoteView';
import { ChatView } from './app/ChatView';
import { SettingsView } from './app/SettingsView';
import { InboxView } from './app/InboxView';
import { SmartViewPage } from './app/SmartViewPage';
import { FolderView } from './app/FolderView';
import { IngestView } from './app/IngestView';
import { RightPanel } from './app/RightPanel';
import { TabStrip } from './app/TabStrip';
import { QuickSwitcher } from './app/QuickSwitcher';
import { QuickCapture } from './app/QuickCapture';

function Center() {
  const { activeTab } = useApp();
  if (!activeTab) return <Landing />;
  switch (activeTab.kind) {
    case 'doc':
      return <NoteView key={activeTab.path} path={activeTab.path} />;
    case 'session':
      return (
        <ChatView
          key={activeTab.id}
          sessionType={activeTab.sessionType}
          initialPrompt={activeTab.initialPrompt}
        />
      );
    case 'inbox':
      return <InboxView />;
    case 'smartview':
      return <SmartViewPage key={activeTab.viewId} viewId={activeTab.viewId} />;
    case 'folder':
      return <FolderView key={activeTab.dir} dir={activeTab.dir} />;
    case 'meeting-drop':
      return <IngestView />;
    case 'settings':
      return <SettingsView />;
    default:
      return <Landing />;
  }
}

function Shell() {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const { openSession, activeTab } = useApp();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSwitcherOpen((o) => !o);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setCaptureOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        openSession('ask');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSession]);

  const showRight = activeTab?.kind === 'doc';

  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel defaultSize="20%" minSize="14%" maxSize="30%" className="bg-sidebar">
          <Sidebar />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={showRight ? '52%' : '80%'} minSize="30%">
          <div className="flex h-full flex-col">
            <TabStrip />
            <div className="min-h-0 flex-1">
              <Center />
            </div>
          </div>
        </ResizablePanel>
        {showRight && (
          <>
            <ResizableHandle />
            <ResizablePanel defaultSize="28%" minSize="18%" maxSize="40%">
              <RightPanel />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      <QuickSwitcher open={switcherOpen} onOpenChange={setSwitcherOpen} />
      <QuickCapture open={captureOpen} onOpenChange={setCaptureOpen} />
    </div>
  );
}

export function App() {
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  );
}
