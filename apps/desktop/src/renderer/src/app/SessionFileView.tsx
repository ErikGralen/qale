import { useEffect, useState } from 'react';
import { Spinner } from '@pm/ui';
import { FileText } from 'lucide-react';
import { invoke } from '../lib/ipc';

/**
 * One session working file, read-only (Sessions v2 Part 1).
 *
 * Deliberately NOT a note: monospace, no editor, no properties block, and a
 * muted strip that says what it is. If a session file opened looking like a
 * note, the PM would edit it and reasonably expect that to mean something — it
 * would mean nothing, and the file may be gone tomorrow.
 */
export function SessionFileView({ sessionId, path }: { sessionId: string; path: string }) {
  const [text, setText] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    invoke['sessions:fileText'](sessionId, path)
      .then((t) => {
        if (!cancelled) setText(t);
      })
      .catch(() => {
        if (!cancelled) setText(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, path]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-5 text-sm font-medium text-muted-foreground">
        <FileText className="size-3.5" />
        <span className="truncate font-mono">{path}</span>
      </div>
      <div className="border-b border-border bg-muted/40 px-5 py-1.5 text-xs text-muted-foreground">
        Session file · not part of your memory · read-only, and safe to delete
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {text === undefined ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-3.5" /> Opening…
          </div>
        ) : text === null ? (
          <p className="text-sm text-muted-foreground">
            This file is gone. Session files are working material — nothing keeps them.
          </p>
        ) : (
          <pre className="font-mono text-[13px] leading-relaxed whitespace-pre-wrap">{text}</pre>
        )}
      </div>
    </div>
  );
}
