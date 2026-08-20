import { useEffect, useState } from 'react';
import { Button, Input } from '@qale/ui';
import { TriangleAlert } from 'lucide-react';
import type { PathCheckDTO, VaultInfoDTO } from '@qale/ipc';
import { invoke } from '../lib/ipc';
import { useApp } from '../state/app-state';

/**
 * Make a second (or first) workspace: a name, a place to put it, and one
 * button. Used in Settings and in the no-workspace Home, because "start a
 * fresh one" is a different question from "open the one I have" and the OS
 * folder picker only ever answered the second.
 *
 * The folder is created on submit, never while typing — the live check below
 * only reads. Same rule as the opening (docs/onboarding.md ONB-4): the sync
 * warning has to land before anything is written, so it is a choice and not a
 * report. An existing folder is adopted as it stands rather than refused; that
 * is also how a folder inside an Obsidian vault arrives.
 */
export function NewWorkspace({
  onCancel,
  onCreated,
}: {
  onCancel?: () => void;
  onCreated?: (info: VaultInfoDTO) => void;
}) {
  const { vault, createVault } = useApp();
  const [parent, setParent] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [check, setCheck] = useState<PathCheckDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The sync warning has been shown once, so the button now means "I know". */
  const [warned, setWarned] = useState(false);

  // The suggested path is only mined for its two halves: where people keep
  // documents, and a name that is free to change.
  useEffect(() => {
    void invoke['vault:suggestPath']()
      .then((s) => {
        setParent(dirOf(s.path));
        setName(baseOf(s.path));
      })
      .catch(() => setParent(null));
  }, []);

  const path = parent && name ? joinPath(parent, name) : null;
  const sameAsOpen = !!path && !!vault && path === vault.path;

  // What this folder already is, asked while they type. Read-only.
  useEffect(() => {
    setWarned(false);
    if (!path) {
      setCheck(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void invoke['vault:checkPath'](path)
        .then((c) => live && setCheck(c))
        .catch(() => live && setCheck(null));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [path]);

  const choose = async () => {
    const picked = await invoke['vault:pickLocation']().catch(() => null);
    if (picked) setParent(picked);
  };

  const create = async () => {
    if (!path || busy || sameAsOpen) return;
    if ((check?.syncedBy || check?.pathTooDeep) && !warned) {
      setWarned(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const info = await createVault(path);
      onCreated?.(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That folder could not be created.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="space-y-1.5">
        <label
          className="text-dense font-medium text-muted-foreground"
          htmlFor="new-workspace-name"
        >
          Name
        </label>
        <Input
          id="new-workspace-name"
          value={name}
          // Separators would silently make this a path, not a name.
          onChange={(e) => setName(e.target.value.replace(/[\\/]/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && void create()}
          placeholder="Product memory"
          autoFocus
        />
      </div>
      <div className="space-y-1.5">
        <div className="text-dense font-medium text-muted-foreground">Location</div>
        <div className="flex items-center gap-2">
          <div
            className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
            title={path ?? undefined}
          >
            {path ?? '…'}
          </div>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => void choose()}>
            Choose…
          </Button>
        </div>
      </div>

      {sameAsOpen ? (
        <p className="text-sm text-muted-foreground">
          That is the workspace you already have open.
        </p>
      ) : check?.exists && check.hasNotes ? (
        <p className="text-sm text-muted-foreground">
          This folder already has markdown in it. Opening it reads what is there and leaves it
          alone.
        </p>
      ) : null}

      {check?.syncedBy && (
        <p className="flex items-start gap-2 rounded-md bg-warning/10 px-2 py-1.5 text-sm text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {check.syncedBy} is syncing this folder. When two programs write the same file at once,
            edits can go missing and search can stop working. A plain folder on this computer is
            safer, but you know your setup.
          </span>
        </p>
      )}

      {/* Windows only. Same shape as the sync warning above and for the same
          reason: it has to arrive while the folder is still a choice, because
          nothing later can move a workspace that is three folders too deep. */}
      {check?.pathTooDeep && (
        <p className="flex items-start gap-2 rounded-md bg-warning/10 px-2 py-1.5 text-sm text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Windows cannot open a file whose full path is longer than 260 characters, and this
            folder is deep enough that notes inside it would pass that. Put the workspace nearer the
            top of the drive, like C:\Qale, or shorten the folders above it.
          </span>
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy || !path || sameAsOpen} onClick={() => void create()}>
          {(check?.syncedBy || check?.pathTooDeep) && warned
            ? 'Create it anyway'
            : 'Create workspace'}
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        )}
        {vault && !sameAsOpen && (
          <span className="text-xs text-muted-foreground">
            Opens straight away. Nothing is moved.
          </span>
        )}
      </div>
    </div>
  );
}

/** The separator this path is already written with — never guessed from the OS. */
function sepOf(path: string): string {
  return path.includes('/') ? '/' : '\\';
}

function dirOf(path: string): string {
  const sep = sepOf(path);
  const cut = path.lastIndexOf(sep);
  return cut > 0 ? path.slice(0, cut) : path;
}

function baseOf(path: string): string {
  const sep = sepOf(path);
  return path.slice(path.lastIndexOf(sep) + 1);
}

function joinPath(parent: string, name: string): string {
  return `${parent.replace(/[\\/]+$/, '')}${sepOf(parent)}${name.trim()}`;
}
