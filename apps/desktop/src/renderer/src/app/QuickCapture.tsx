import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
} from '@pm/ui';
import { useApp } from '../state/app-state';

/** ⌘N quick capture — drops a note into the workspace so real data accrues. */
export function QuickCapture({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { captureNote, openNote, vault } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!text.trim() || !vault) return;
    setBusy(true);
    try {
      const note = await captureNote({ body: text.trim() });
      setText('');
      onOpenChange(false);
      await openNote(note.path);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Quick capture</DialogTitle>
          <DialogDescription>
            {vault ? 'Lands in notes/.' : 'Open a workspace first.'}
          </DialogDescription>
        </DialogHeader>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit();
          }}
          placeholder="Paste a quote, a customer note, a thought…"
          rows={5}
          disabled={!vault}
          className="w-full resize-none rounded-md border border-input bg-card p-3 text-[15px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          autoFocus
        />
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={!text.trim() || busy || !vault}>
            Capture
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
