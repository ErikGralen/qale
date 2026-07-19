import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, Button, Spinner } from '@pm/ui';
import { History, GitCommitHorizontal } from 'lucide-react';
import type { NoteCommitDTO } from '@pm/ipc';
import { useApp } from '../state/app-state';
import { invoke } from '../lib/ipc';
import { Markdown } from './Markdown';

/** Strip the leading frontmatter block (optional BOM) so the viewer shows just the prose. */
function stripFrontmatter(raw: string): string {
  return raw.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * A note's version history from git — the payoff of the git-backed vault. Lists
 * the commits that touched this file and shows the prose at any of them,
 * read-only. When the workspace isn't yet a repo it offers to enable history
 * (the consent point for `git init`); when git isn't installed it says so.
 */
export function NoteHistory({ path, open, onOpenChange }: { path: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { vault, enableGit } = useApp();
  const [commits, setCommits] = useState<NoteCommitDTO[] | null>(null);
  const [selected, setSelected] = useState<NoteCommitDTO | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);

  const gitOn = !!vault?.git;

  useEffect(() => {
    if (!open || !gitOn) return;
    setCommits(null);
    setSelected(null);
    invoke['note:history'](path)
      .then((list) => setCommits(list))
      .catch(() => setCommits([]));
  }, [open, gitOn, path]);

  useEffect(() => {
    if (!selected) {
      setBody(null);
      return;
    }
    let cancelled = false;
    invoke['note:versionAt'](path, selected.hash).then((raw) => {
      if (!cancelled) setBody(raw === null ? null : stripFrontmatter(raw));
    });
    return () => {
      cancelled = true;
    };
  }, [selected, path]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4" /> Version history
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">{path}</DialogDescription>
        </DialogHeader>

        {!gitOn ? (
          <div className="flex flex-col items-start gap-3 py-4">
            {vault?.gitAvailable ? (
              <>
                <p className="text-sm text-muted-foreground">
                  This workspace doesn't track version history yet. Enabling it creates a git
                  repository in the folder and records a first snapshot of every note — nothing
                  leaves your machine.
                </p>
                <Button
                  size="sm"
                  disabled={enabling}
                  onClick={async () => {
                    setEnabling(true);
                    try {
                      await enableGit();
                    } finally {
                      setEnabling(false);
                    }
                  }}
                >
                  {enabling ? 'Enabling…' : 'Enable version history'}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Version history needs git, which isn't installed on this system.
              </p>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 gap-4">
            <div className="w-64 shrink-0 overflow-y-auto border-r border-border pr-2">
              {commits === null ? (
                <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                  <Spinner className="size-3.5" /> Loading…
                </div>
              ) : commits.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  No commits touch this note yet — it will appear here after its next saved change.
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {commits.map((c) => (
                    <li key={c.hash}>
                      <button
                        className={`flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent ${
                          selected?.hash === c.hash ? 'bg-accent' : ''
                        }`}
                        onClick={() => setSelected(c)}
                      >
                        <span className="flex items-center gap-1.5">
                          <GitCommitHorizontal className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="truncate">{c.message}</span>
                        </span>
                        <span className="pl-5 text-xs text-muted-foreground">{shortDate(c.date)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="min-w-0 flex-1 overflow-y-auto">
              {!selected ? (
                <p className="p-3 text-sm text-muted-foreground">Pick a version to view it.</p>
              ) : body === null ? (
                <p className="p-3 text-sm text-muted-foreground">This note didn't exist at that commit.</p>
              ) : (
                <div className="prose-sm max-w-none">
                  <Markdown content={body} />
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
