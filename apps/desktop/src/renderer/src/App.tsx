import { useEffect, useState } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@pm/ui';
import { AppStateProvider, useApp } from './state/app-state';
import { Sidebar } from './app/Sidebar';
import { Landing } from './app/Landing';
import { NoteView } from './app/NoteView';
import { RightPanel } from './app/RightPanel';
import { QuickSwitcher } from './app/QuickSwitcher';
import { QuickCapture } from './app/QuickCapture';

function Center() {
  const { view } = useApp();
  return view.kind === 'note' ? <NoteView /> : <Landing />;
}

function Shell() {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);

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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
