import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
  Spinner,
} from '@qale/ui';
import { History, GitCommitHorizontal, Undo2 } from 'lucide-react';
import type { NoteCommitDTO } from '@qale/ipc';
import { useApp } from '../state/app-state';
import { invoke } from '../lib/ipc';
import { stripFrontmatter } from '../lib/frontmatter';
import { Markdown } from './Markdown';
import { useToast } from './toast';

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Trailing-newline-insensitive equality; the workspace normalizes the tail. */
function sameText(a: string, b: string): boolean {
  return a.replace(/\s+$/, '') === b.replace(/\s+$/, '');
}

/**
 * A note's version history from git — the payoff of the git-backed vault. Lists
 * the commits that touched this file, shows the prose at any of them, and puts
 * the note back to one. When the workspace isn't yet a repo it offers to enable
 * history (the consent point for `git init`); when git isn't installed it says
 * so, and there is nothing to restore from, so no restore control renders.
 */
export function NoteHistory({
  path,
  open,
  onOpenChange,
  flushEdits,
}: {
  path: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /**
   * Land whatever is unsaved in the open editor before the body is replaced.
   * The editor keeps in-flight typing over an external change, so without this
   * a restore would look like it worked and then be autosaved back over.
   */
  flushEdits?: () => Promise<void>;
}) {
  const { vault, enableGit, restoreVersion, docData } = useApp();
  const toast = useToast();
  const [commits, setCommits] = useState<NoteCommitDTO[] | null>(null);
  const [selected, setSelected] = useState<NoteCommitDTO | null>(null);
  // undefined = version still loading; null = the note didn't exist at that commit.
  const [body, setBody] = useState<string | null | undefined>(undefined);
  const [enabling, setEnabling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const gitOn = !!vault?.git;
  const current = docData[path]?.note ?? null;

  useEffect(() => {
    if (!open || !gitOn) return;
    setCommits(null);
    setSelected(null);
    invoke['note:history'](path)
      .then((list) => setCommits(list))
      .catch(() => setCommits([]));
  }, [open, gitOn, path]);

  useEffect(() => {
    setBody(undefined);
    setConfirming(false);
    if (!selected) return;
    let cancelled = false;
    invoke['note:versionAt'](path, selected.hash).then((raw) => {
      if (!cancelled) setBody(raw === null ? null : stripFrontmatter(raw));
    });
    return () => {
      cancelled = true;
    };
  }, [selected, path]);

  // Restorable only when there is something to put back that isn't already
  // there: a note whose body the workspace lets anyone edit, a version that
  // actually held this note, and text that differs from what it says now.
  const canRestore =
    !!selected &&
    typeof body === 'string' &&
    !!current?.bodyEditable &&
    !sameText(body, current.body);

  async function restore() {
    if (!selected) return;
    setRestoring(true);
    try {
      // Anything half-typed lands first, as its own version, so the restore
      // replaces a saved note rather than racing the editor's autosave.
      await flushEdits?.();
      await restoreVersion(path, selected.hash);
      onOpenChange(false);
    } catch (err) {
      toast(
        `Couldn't restore that version: ${err instanceof Error ? err.message : 'the write was rejected.'}`,
      );
    } finally {
      setRestoring(false);
      setConfirming(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* sm:max-w-3xl, not max-w-3xl: the dialog's own base sets `sm:max-w-sm`,
          which outranks an unprefixed cap on every window this app runs in and
          was clipping the preview (and the restore action) off the right edge. */}
      <DialogContent className="max-h-[80vh] sm:max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4" /> Version history
          </DialogTitle>
          {/* Which note this is, by its name. The file path used to sit here,
              which said the same thing in the one vocabulary the reader never
              has to learn. */}
          <DialogDescription className="text-xs">{current?.title ?? 'This note'}</DialogDescription>
        </DialogHeader>

        {!gitOn ? (
          <div className="flex flex-col items-start gap-3 py-4">
            {vault?.gitAvailable ? (
              <>
                {/* "Nothing leaves your machine" was true of us and silent
                    about the folder (OW10): git never pushes on its own, but a
                    synced folder carries the whole history with it. */}
                <p className="text-sm text-muted-foreground">
                  This workspace doesn't track version history yet. Enabling it creates a git
                  repository in the folder and records a first snapshot of every note. It stays in
                  that folder and is never pushed anywhere. Anything syncing the folder, like iCloud
                  or Dropbox, syncs the history too.
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
                  No earlier versions of this note yet. One appears here after its next saved
                  change.
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
                          <GitCommitHorizontal
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                          <span className="truncate">{c.message}</span>
                        </span>
                        <span className="pl-5 text-xs text-muted-foreground">
                          {shortDate(c.date)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              {/* The action sits above the version you are reading, so "this
                  one" is never ambiguous. Nothing renders for a note whose body
                  the workspace won't let anyone rewrite (a piece of material, a
                  session's record): there would be no way to honour the click. */}
              {typeof body === 'string' && current?.bodyEditable && (
                <div className="mb-2 flex min-h-8 items-center gap-2 border-b border-border pb-2">
                  {!canRestore ? (
                    <span className="text-xs text-muted-foreground">
                      This is what the note says now.
                    </span>
                  ) : confirming ? (
                    <>
                      <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                        Replace the note's text with this? What's there now stays in the list.
                      </span>
                      <Button size="sm" disabled={restoring} onClick={() => void restore()}>
                        {restoring ? 'Restoring…' : 'Restore'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={restoring}
                        onClick={() => setConfirming(false)}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
                        <Undo2 className="size-3.5" /> Restore this version
                      </Button>
                      <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                        Brings back the text, not the properties.
                      </span>
                    </>
                  )}
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {!selected ? (
                  <p className="p-3 text-sm text-muted-foreground">Pick a version to view it.</p>
                ) : body === undefined ? (
                  <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                    <Spinner className="size-3.5" /> Loading…
                  </div>
                ) : body === null ? (
                  <p className="p-3 text-sm text-muted-foreground">
                    This note didn't exist in that version.
                  </p>
                ) : (
                  <div className="prose-sm max-w-none">
                    <Markdown content={body} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
