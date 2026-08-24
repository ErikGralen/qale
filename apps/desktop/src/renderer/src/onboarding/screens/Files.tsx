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
 * The screen never names Obsidian or any other markdown tool (clarity review
 * area 3): to the first-time user those are somebody else's jargon, and the tip
 * they carried (make the workspace a folder inside your vault, never the vault
 * root) matters to a tiny slice of users who can pick any folder through Open
 * anyway. The underlying hazard is unchanged: `ensureScaffold` writes fourteen
 * of our folders into whatever root is picked and the librarian owns the root
 * `index.md`, so the copy under the Create path now says outright that Qale
 * sets up its own folders inside.
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
  /**
   * Windows only: the folder is too deep for the 260-character path limit. Its
   * own flag rather than a second message in `warned`, because both can be true
   * of the same folder (a deeply nested OneDrive is the likeliest one of all)
   * and the PM should see both reasons, not whichever we checked first.
   */
  const [tooDeep, setTooDeep] = useState(false);

  useEffect(() => {
    void invoke['vault:suggestPath']()
      .then(setSuggested)
      .catch(() => setSuggested(null));
  }, []);

  const create = async (force = false) => {
    if (!suggested) return;
    if ((suggested.syncedBy || suggested.pathTooDeep) && !force) {
      setWarned(suggested.syncedBy);
      setTooDeep(suggested.pathTooDeep);
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
    setTooDeep(false);
    try {
      const info = await openVaultDialog();
      // Cancelling the picker is not a failure and not an answer — the screen
      // just stays where it was.
      if (!info) return;
      if (info.syncedBy || info.pathTooDeep) {
        setWarned(info.syncedBy);
        setTooDeep(info.pathTooDeep);
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

  // Coming back with a workspace already open: the screen says which folder it
  // is, rather than offering to make one as though the choice never happened.
  // Changing it is still one click, and it is the same picker.
  const settled = vault !== null && !warned && !tooDeep;

  return (
    <Screen
      title={settled ? 'Your files live here' : 'Where should your files live?'}
      why="A plain folder of text files (markdown) that you own. Everything the app writes goes here, and you can open it with anything."
      footer={
        warned || tooDeep ? (
          <>
            <Button data-opening-primary size="lg" disabled={busy} onClick={proceedAnyway}>
              Use it anyway
            </Button>
            <Button size="lg" variant="outline" disabled={busy} onClick={() => void open()}>
              Choose another folder
            </Button>
          </>
        ) : settled ? (
          <>
            <Button data-opening-primary size="lg" disabled={busy} onClick={onNext}>
              Continue
            </Button>
            <Button size="lg" variant="outline" disabled={busy} onClick={() => void open()}>
              <FolderOpen className="size-4" aria-hidden />
              Choose a different folder
            </Button>
          </>
        ) : (
          <>
            <Button
              data-opening-primary
              size="lg"
              disabled={busy || !suggested}
              onClick={() => void create()}
            >
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
          <div className="text-dense font-medium text-muted-foreground">
            {settled ? 'Your workspace' : 'New workspace'}
          </div>
          <div
            className="mt-1 truncate font-mono text-sm"
            title={settled ? vault.path : suggested?.path}
          >
            {settled ? vault.path : (suggested?.path ?? '…')}
          </div>
          {!settled && suggested?.hasNotes && (
            <p className="mt-1.5 text-sm text-muted-foreground">
              This folder already has notes in it. Opening it reads what is there and leaves it
              alone.
            </p>
          )}
          {/* What Create actually does, before it does it: fourteen folders
              appear, and finding a tree you did not make is a surprise worth
              one sentence here (clarity review area 3). */}
          {!settled && (
            <p className="mt-1.5 text-sm text-muted-foreground">
              Qale makes this folder and sets up its own folders inside it.
            </p>
          )}
        </div>
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
        {tooDeep && (
          <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Windows cannot open a file whose full path is longer than 260 characters, and this
              folder is deep enough that notes inside it would pass that. Put the workspace nearer
              the top of the drive, like C:\Qale, or shorten the folders above it.
            </span>
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </Screen>
  );
}
