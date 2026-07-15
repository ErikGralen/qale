import { useState } from 'react';
import { Button, Input } from '@pm/ui';
import { FileUp } from 'lucide-react';
import { useApp } from '../state/app-state';

/**
 * Meeting drop (PLAN-V2 §3.2): drop/paste a transcript → meetings/…md, then kick
 * off an After-Meeting session that produces the truth delta as approval cards.
 */
export function IngestView() {
  const { dropMeeting } = useApp();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [safeSpace, setSafeSpace] = useState(false);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    const text = await file.text();
    setBody(text);
    if (!title) setTitle(file.name.replace(/\.(txt|md|vtt)$/i, ''));
  };

  const submit = async () => {
    if (!body.trim() && !safeSpace) return;
    setBusy(true);
    try {
      await dropMeeting(title.trim() || 'Meeting transcript', body.trim(), safeSpace);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 items-center gap-2 px-5 text-sm font-medium text-muted-foreground" style={{ WebkitAppRegion: 'drag' } as never}>
        <FileUp className="size-4" /> Drop a meeting transcript
      </div>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 px-8 py-4">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Meeting title (e.g. Acme QBR — 2026-07-12)"
        />
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) void onFile(file);
          }}
          className="flex-1"
        >
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Paste the transcript here, or drop a .txt / .md / .vtt file…"
            className="h-full min-h-72 w-full resize-none rounded-lg border border-input bg-card p-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={safeSpace} onChange={(e) => setSafeSpace(e.target.checked)} />
          Safe space — private meeting: capture off, transcript not retained, nothing formalized.
        </label>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {safeSpace
              ? 'Files a stub meeting note only — no transcript, no session.'
              : 'Lands in meetings/, then the After-Meeting session proposes decisions, insights & a summary.'}
          </span>
          <Button size="sm" onClick={submit} disabled={(!body.trim() && !safeSpace) || busy}>
            {safeSpace ? 'Record safe-space meeting' : 'Drop & run session'}
          </Button>
        </div>
      </div>
    </div>
  );
}
