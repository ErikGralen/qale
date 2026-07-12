import { PanelRight } from 'lucide-react';

export function RightPanel() {
  return (
    <div className="flex h-full flex-col border-l border-border bg-card/40">
      <div className="flex h-11 items-center px-4 text-sm font-medium text-muted-foreground">
        Context
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <PanelRight className="size-6 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          The note or proposal a session references shows up here.
        </p>
      </div>
    </div>
  );
}
