import { useEffect, useState } from 'react';
import { Button } from '@qale/ui';
import { FolderOpen, FolderPlus, TriangleAlert } from 'lucide-react';
import type { PathCheckDTO } from '@qale/ipc';
import { invoke } from '../../lib/ipc';
import { useApp } from '../../state/app-state';
import { Screen } from '../Opening';

/**
 * Screen 3 (ONB-4). Where the files live — the one screen that cannot be
 * skipped, because everything else writes into what is chosen here.
 *
 * Two doors: create one at a sensible place, or open a folder they already
 * have.
 *
 * What this screen deliberately does NOT invite is opening an existing Obsidian
 * vault as the workspace root. Structure here is folder-shaped: `typeForDir`
 * types a note by the folder it sits in, `ensureScaffold` writes fourteen of our
 * folders into whatever root is picked, and the librarian owns the root
 * `index.md`. Pointed at someone's vault, all of that lands on top of a tree we
 * did not design, their own folders stay invisible in navigation, and their root
 * `index.md` gets overwritten. So the Obsidian line offers the version that is
 * actually true: make the workspace a folder INSIDE the vault. Their notes are
 * untouched, ours are still plain markdown they can edit in Obsidian.
 *
 * The sync check runs BEFORE the folder is created, not after. Telling someone
 * their workspace is inside iCloud once we have already scaffolded it is a
 * report; telling them first is a choice. They can still go ahead — plenty of
 * people know exactly what they are doing — but the warning names the actual
 * failure (two programs writing the same file), not "this is unsupported".
 */
export function Files({ onNext }: { onNext: () => void }) {
  const { createVault, openVaultDialog, vault } = useApp();
  const [suggested, setSuggested] = useState<PathCheckDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A sync warning the PM has been shown once and can now overrule. */
  const [warned, setWarned] = useState<string | null>(null);

  useEffect(() => {
    void invoke['vault:suggestPath']()
      .then(setSuggested)
      .catch(() => setSuggested(null));
  }, []);

  const create = async (force = false) => {
    if (!suggested) return;
    if (suggested.syncedBy && !force) {
      setWarned(suggested.syncedBy);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createVault(suggested.path);
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That folder could not be opened.');
    } finally {
      setBusy(false);
    }
  };

  const open = async () => {
    setBusy(true);
    setError(null);
    // Clear any standing warning first: it was about the folder they just
    // walked away from, and leaving it up would make a clean pick look unsafe.
    setWarned(null);
    try {
      const info = await openVaultDialog();
      // Cancelling the picker is not a failure and not an answer — the screen
      // just stays where it was.
      if (!info) return;
      if (info.syncedBy) {
        setWarned(info.syncedBy);
        return;
      }
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That folder could not be opened.');
    } finally {
      setBusy(false);
    }
  };

  // A folder opened through the picker is already open by the time we warn
  // about it, so "go ahead" here is simply moving on.
  const proceedAnyway = () => {
    if (vault) onNext();
    else void create(true);
  };

  return (
    <Screen
      title="Where should your files live?"
      why="A plain folder of markdown that you own. Everything the app writes goes here, readable and editable without it."
      footer={
        warned ? (
          <>
            <Button data-opening-primary size="lg" disabled={busy} onClick={proceedAnyway}>
              Use it anyway
            </Button>
            <Button size="lg" variant="outline" disabled={busy} onClick={() => void open()}>
              Choose another folder
            </Button>
          </>
        ) : (
          <>
            <Button data-opening-primary size="lg" disabled={busy || !suggested} onClick={() => void create()}>
              <FolderPlus className="size-4" aria-hidden />
              {suggested?.exists ? 'Use this folder' : 'Create it'}
            </Button>
            <Button size="lg" variant="outline" disabled={busy} onClick={() => void open()}>
              <FolderOpen className="size-4" aria-hidden />
              Open a folder I have
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3">
        <div className="rounded-xl bg-card p-4 ring-1 ring-border">
          <div className="text-dense font-medium text-muted-foreground">New workspace</div>
          <div className="mt-1 truncate font-mono text-sm" title={suggested?.path}>
            {suggested?.path ?? '…'}
          </div>
          {suggested?.hasNotes && (
            <p className="mt-1.5 text-sm text-muted-foreground">
              This folder already has markdown in it. Opening it reads what is there and leaves it
              alone.
            </p>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Use Obsidian? Put this folder inside your vault. Qale sets up its own folders in here and
          leaves the rest of your vault alone, and everything it writes is plain markdown you can
          open and edit in Obsidian.
        </p>
        {warned && (
          <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {warned} is syncing this folder. When two programs write the same file at once, edits
              can go missing and search can stop working. A plain folder on this computer is safer,
              but you know your setup.
            </span>
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </Screen>
  );
}
