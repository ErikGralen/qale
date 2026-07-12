import { useEffect, useState } from 'react';
import { Button, Card, CardContent } from '@pm/ui';
import { ArrowRight, FolderOpen, CheckCircle2, AlertCircle } from 'lucide-react';
import { invoke } from '../lib/ipc';

function ConnectionBadge() {
  const [status, setStatus] = useState<'checking' | 'ok' | 'error'>('checking');
  const [detail, setDetail] = useState('');

  useEffect(() => {
    let alive = true;
    invoke['app:ping']('hello from renderer')
      .then((reply) => {
        if (!alive) return;
        setStatus('ok');
        setDetail(reply);
      })
      .catch((err) => {
        if (!alive) return;
        setStatus('error');
        setDetail(String(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  const Icon = status === 'ok' ? CheckCircle2 : status === 'error' ? AlertCircle : null;
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {Icon && (
        <Icon className={status === 'ok' ? 'size-3.5 text-brand' : 'size-3.5 text-destructive'} />
      )}
      <span className="truncate font-mono">
        {status === 'checking' ? 'connecting to main…' : detail}
      </span>
    </div>
  );
}

export function Landing() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 items-center justify-between px-5" style={{ WebkitAppRegion: 'drag' } as never}>
        <span className="text-sm font-medium text-muted-foreground">Landing</span>
        <div style={{ WebkitAppRegion: 'no-drag' } as never}>
          <ConnectionBadge />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-8 pb-24">
        <div className="space-y-1.5">
          <h1 className="font-serif text-3xl font-semibold tracking-tight">
            What did we just learn?
          </h1>
          <p className="text-[15px] text-muted-foreground">
            Capture a signal, drop a transcript, or ask across the brain. The agent proposes — you
            dispose.
          </p>
        </div>

        <Card className="border-border/70 shadow-sm">
          <CardContent className="p-3">
            <textarea
              placeholder="Paste a signal, a quote, a customer note…  (⌘N)"
              rows={4}
              className="w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/70"
              disabled
            />
            <div className="flex items-center justify-between border-t border-border/60 pt-2.5">
              <span className="text-xs text-muted-foreground">Capture lands in the vault once opened</span>
              <Button size="sm" disabled>
                Capture
                <ArrowRight className="size-3.5" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3 rounded-lg border border-dashed border-border p-4">
          <FolderOpen className="size-5 text-muted-foreground" />
          <div className="flex-1">
            <div className="text-sm font-medium">No vault open</div>
            <div className="text-xs text-muted-foreground">
              Point pm at a folder of markdown — an existing Obsidian vault works.
            </div>
          </div>
          <Button variant="outline" size="sm" disabled>
            Open vault…
          </Button>
        </div>
      </div>
    </div>
  );
}
