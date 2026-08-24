import { useEffect, useState } from 'react';
import { Button } from '@qale/ui';
import { Check, FolderGit2, Plus } from 'lucide-react';
import type { CodebasePathDTO, CodebaseStatusDTO } from '@qale/ipc';
import { Setting, SettingNotice } from '../components/Setting';
import { invoke } from '../lib/ipc';

/**
 * Settings → Codebase (docs/claude-code-tickets.md CC-3). The one place this
 * capability is discovered: point at a repo, or at a folder of repos, and a
 * session can ask Claude Code a question about the code. Nothing else in the
 * app mentions it, so this panel has to carry the whole story, including the
 * two limits that matter (reading only, and one approval per question).
 *
 * The panel repaints from what main discovers, never from what the PM typed:
 * the folder list comes back trimmed and de-duplicated, and the repo list under
 * each folder is what the discovery pass actually found on disk.
 */
export function CodebaseSettings() {
  const [paths, setPaths] = useState<CodebasePathDTO[]>([]);
  const [status, setStatus] = useState<CodebaseStatusDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    try {
      const [p, s] = await Promise.all([invoke['codebase:get'](), invoke['codebase:status']()]);
      setPaths(p);
      setStatus(s);
      setLoadFailed(false);
    } catch {
      // An IPC failure is not "no folders". Say so, rather than showing an
      // empty panel over folders that are configured.
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  /**
   * Save the list and repaint from the answer. Main trims and folds duplicates
   * as it stores, so the folders are read back rather than assumed: a repo is
   * grouped under a folder by an exact path match, and a path that only exists
   * in this component would group nothing.
   *
   * A save that fails repaints from what main still holds and says so. Without
   * that, a toggle the PM flipped stays flipped over a setting that never
   * changed, which is the panel lying about the machine.
   */
  const save = async (next: CodebasePathDTO[]) => {
    setBusy(true);
    try {
      const s = await invoke['codebase:set'](next);
      setStatus(s);
      setPaths(await invoke['codebase:get']());
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const addFolder = async () => {
    const picked = await invoke['app:pickFolder']('Choose a folder with your code');
    if (!picked) return;
    // git pull starts off. Touching somebody's clone is a permission, and a
    // permission is given, not assumed.
    await save([...paths, { path: picked, gitPull: false }]);
  };

  const claude = status?.claude;

  return (
    <>
      <Setting
        title="Code folders"
        description="Point at a repo, or at a folder that holds several. A session can then ask Claude Code a question about the code and read the answer here. Every question waits for your approval first, and the answer is a report: the app never writes code, and never opens a branch or a pull request. A session asks for a repo by name."
      >
        {loadFailed ? (
          <p className="text-sm text-muted-foreground">
            Couldn’t load your code folders.{' '}
            <button
              className="font-medium text-brand hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => void reload()}
            >
              Try again
            </button>
          </p>
        ) : loading ? null : (
          <>
            {paths.map((entry) => (
              <PathCard
                key={entry.path}
                entry={entry}
                repos={(status?.repos ?? []).filter((r) => r.parentPath === entry.path)}
                busy={busy}
                onToggleGitPull={(gitPull) =>
                  save(paths.map((p) => (p.path === entry.path ? { ...p, gitPull } : p)))
                }
                onRemove={() => save(paths.filter((p) => p.path !== entry.path))}
              />
            ))}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void addFolder()}>
              <Plus className="size-3.5" /> Add a folder
            </Button>
            {saveFailed ? (
              <p className="text-sm text-muted-foreground">
                That change didn’t save, so your folders are as they were. Try again.
              </p>
            ) : null}
          </>
        )}
      </Setting>

      <Setting
        title="Claude Code"
        description="Questions about your code run through the Claude Code command line tool on this machine, under your own account. Qale starts it with reading allowed and writing refused."
        badge={
          claude?.ok && (
            <span className="flex items-center gap-1 text-xs text-success">
              <Check className="size-3.5" aria-hidden /> found
            </span>
          )
        }
      >
        {claude &&
          (claude.ok ? (
            <p className="text-sm text-muted-foreground">
              {claude.version
                ? `Claude Code found, version ${claude.version}.`
                : 'Claude Code found.'}
            </p>
          ) : (
            <SettingNotice>
              {claude.reason ?? 'Claude Code is not available on this machine.'} Questions about
              your code stay off until it is there.
            </SettingNotice>
          ))}
      </Setting>
    </>
  );
}

/** One configured folder: what it is, whether git may pull in it, what is in it. */
function PathCard({
  entry,
  repos,
  busy,
  onToggleGitPull,
  onRemove,
}: {
  entry: CodebasePathDTO;
  repos: CodebaseStatusDTO['repos'];
  busy: boolean;
  onToggleGitPull: (gitPull: boolean) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-xs text-muted-foreground" title={entry.path}>
            {entry.path}
          </div>
        </div>
        <button
          className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-destructive disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          disabled={busy}
          onClick={() => void onRemove()}
        >
          Remove
        </button>
      </div>

      {repos.length > 0 ? (
        <ul className="mt-2 flex flex-col divide-y divide-border/60">
          {repos.map((repo) => (
            <li key={repo.dir} className="flex items-center gap-2.5 py-1.5">
              <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm">{repo.name}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          No repo here. A repo is a folder with a <code className="font-mono">.git</code> in it,
          either this folder or one directly inside it.
        </p>
      )}

      <label className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={entry.gitPull}
          disabled={busy}
          onChange={(e) => void onToggleGitPull(e.target.checked)}
        />
        Keep up to date with git
      </label>
      <p className="mt-1 text-xs text-muted-foreground">
        Before a question, fetch and fast-forward these repos. A repo with uncommitted changes, or
        one on another branch, is left alone and the answer says so.
      </p>
    </div>
  );
}
