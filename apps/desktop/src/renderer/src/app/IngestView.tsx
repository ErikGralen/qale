import { useState } from 'react';
import { Button, Input } from '@pm/ui';
import { FileUp } from 'lucide-react';
import { useApp } from '../state/app-state';

/**
 * Transcript ingest (PLAN §5, Phase 4): drop/paste a transcript → transcripts/…md
 * (raw), then kick off an ingest-transcript session that proposes extractions.
 */
export function IngestView() {
  const { ingestTranscript } = useApp();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    const text = await file.text();
    setBody(text);
    if (!title) setTitle(file.name.replace(/\.(txt|md|vtt)$/i, ''));
  };

  const submit = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await ingestTranscript(title.trim() || 'Meeting transcript', body.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 items-center gap-2 px-5 text-sm font-medium text-muted-foreground" style={{ WebkitAppRegion: 'drag' } as never}>
        <FileUp className="size-4" /> Ingest a transcript
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
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Lands in transcripts/ (raw), then the agent proposes signals, decisions, actions & a summary.
          </span>
          <Button size="sm" onClick={submit} disabled={!body.trim() || busy}>
            Ingest & extract
          </Button>
        </div>
      </div>
    </div>
  );
}
