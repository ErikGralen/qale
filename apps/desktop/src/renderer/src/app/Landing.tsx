import { useState } from 'react';
import { Button, Card, CardContent } from '@pm/ui';
import { ArrowRight, FolderOpen } from 'lucide-react';
import { useApp } from '../state/app-state';

export function Landing() {
  const { vault, openVaultDialog, captureNote, openNote } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const capture = async () => {
    if (!text.trim() || !vault) return;
    setBusy(true);
    try {
      const note = await captureNote({ body: text.trim() });
      setText('');
      await openNote(note.path);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="h-11" style={{ WebkitAppRegion: 'drag' } as never} />
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-8 pb-24">
        <div className="space-y-1.5">
          <h1 className="font-serif text-3xl font-semibold tracking-tight">What did we just learn?</h1>
          <p className="text-[15px] text-muted-foreground">
            Drop a meeting, capture a note, or ask across your product memory. The agent proposes —
            you dispose.
          </p>
        </div>

        {vault ? (
          <Card className="border-border/70 shadow-sm">
            <CardContent className="p-3">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void capture();
                }}
                placeholder="Paste a quote, a customer note, a thought…  (⌘↵ to capture)"
                rows={4}
                className="w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/70"
                autoFocus
              />
              <div className="flex items-center justify-between border-t border-border/60 pt-2.5">
                <span className="text-xs text-muted-foreground">Lands in notes/</span>
                <Button size="sm" onClick={capture} disabled={!text.trim() || busy}>
                  Capture
                  <ArrowRight className="size-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-border p-4">
            <FolderOpen className="size-5 text-muted-foreground" />
            <div className="flex-1">
              <div className="text-sm font-medium">No vault open</div>
              <div className="text-xs text-muted-foreground">
                Point pm at a folder of markdown — an existing Obsidian vault works.
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={openVaultDialog}>
              Open vault…
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
