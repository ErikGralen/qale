import { useEffect, useState } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@pm/ui';
import { AppStateProvider, useApp } from './state/app-state';
import { Sidebar } from './app/Sidebar';
import { Landing } from './app/Landing';
import { NoteView } from './app/NoteView';
import { ChatView } from './app/ChatView';
import { SettingsView } from './app/SettingsView';
import { ReviewView } from './app/ReviewView';
import { ThemesView } from './app/ThemesView';
import { IngestView } from './app/IngestView';
import { RightPanel } from './app/RightPanel';
import { QuickSwitcher } from './app/QuickSwitcher';
import { QuickCapture } from './app/QuickCapture';

function Center() {
  const { view } = useApp();
  switch (view.kind) {
    case 'note':
      return <NoteView />;
    case 'chat':
      return <ChatView key={view.sessionType} sessionType={view.sessionType} initialPrompt={view.initialPrompt} />;
    case 'review':
      return <ReviewView />;
    case 'problems':
      return <ThemesView />;
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
  const { showChat } = useApp();

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
        showChat('ask');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showChat]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel defaultSize="20%" minSize="14%" maxSize="30%" className="bg-sidebar">
          <Sidebar />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize="52%" minSize="30%">
          <Center />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize="28%" minSize="18%" maxSize="40%">
          <RightPanel />
        </ResizablePanel>
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
