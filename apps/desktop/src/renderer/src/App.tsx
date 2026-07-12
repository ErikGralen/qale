import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@pm/ui';
import { Sidebar } from './app/Sidebar';
import { Landing } from './app/Landing';
import { RightPanel } from './app/RightPanel';

/**
 * The three-pane shell (PLAN §4): sidebar · center · right panel. Phase 0 is a
 * themed walking skeleton — real navigation state arrives with the vault (Phase 1).
 */
export function App() {
  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel defaultSize={20} minSize={14} maxSize={30} className="bg-sidebar">
          <Sidebar />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={52} minSize={30}>
          <Landing />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={28} minSize={18} maxSize={40}>
          <RightPanel />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
