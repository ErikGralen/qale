import { watch, type FSWatcher } from 'chokidar';
import { relative } from 'node:path';
import { toPosixPath } from './paths.js';

/**
 * Vault watcher (PLAN §3.5): chokidar v5 (ESM, no globs — we filter `.md`
 * ourselves), ignoring dot-folders and `node_modules/`. Events funnel through a
 * debounced serial queue so a git-pull / Obsidian-Sync burst re-indexes in a
 * batch and can't starve the IPC/agent loop.
 *
 * The ignore rule is deliberately the same one `FsVault.walk` uses — any segment
 * starting with `.` is invisible — and not a list of known folders. When the two
 * disagreed, a session's own working files under `sessions/.files/<id>/` were
 * skipped by the scan but upserted live by the watcher, so a dropped transcript
 * put a phantom "Input — What arrived" note in the notes list and in search
 * until the next reconcile quietly evicted it.
 */

export type ChangeKind = 'upsert' | 'remove';
export interface VaultChange {
  path: string;
  kind: ChangeKind;
}

export interface VaultWatcherOptions {
  /** Process a settled batch of changes. Awaited before the next batch drains. */
  onBatch: (changes: VaultChange[]) => Promise<void>;
  debounceMs?: number;
}

/**
 * Is this absolute path inside a folder the watcher must not report? Pure, so
 * the rule can be checked without waiting on a filesystem event.
 */
export function isWatchIgnored(root: string, path: string): boolean {
  const rel = toPosixPath(relative(root, path));
  if (!rel) return false;
  return rel.split('/').some((p) => p.startsWith('.') || p === 'node_modules');
}

export class VaultWatcher {
  private watcher: FSWatcher | null = null;
  private readonly pending = new Map<string, ChangeKind>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private draining = false;

  constructor(
    private readonly root: string,
    private readonly opts: VaultWatcherOptions,
  ) {}

  start(): void {
    this.watcher = watch(this.root, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      ignored: (path: string) => {
        try {
          return isWatchIgnored(this.root, path);
        } catch (err) {
          // chokidar calls this synchronously on every fs event; a throw here
          // is not caught by chokidar, so fail open (don't ignore) rather than
          // let one pathological path stop the scan or the watch outright.
          console.error('[watcher] ignore check failed:', err instanceof Error ? err.message : err);
          return false;
        }
      },
    });

    const enqueue = (kind: ChangeKind) => (abs: string) => {
      try {
        if (!abs.toLowerCase().endsWith('.md')) return;
        // The other door a note id comes in through, and it has to agree with the
        // walk in `FsVault` exactly: chokidar reports OS-shaped absolute paths, so
        // without this a Windows edit would upsert `meetings\weekly.md` beside the
        // `meetings/weekly.md` the scan already indexed, and the note the PM is
        // looking at would never refresh.
        const rel = toPosixPath(relative(this.root, abs));
        this.pending.set(rel, kind);
        this.schedule();
      } catch (err) {
        // A throw here runs inside chokidar's own event emission, uncaught by
        // chokidar — swallow it rather than risk losing this and every later
        // event for the change kind it was registered on.
        console.error(`[watcher] failed to enqueue ${abs}:`, err instanceof Error ? err.message : err);
      }
    };

    this.watcher
      .on('add', enqueue('upsert'))
      .on('change', enqueue('upsert'))
      .on('unlink', enqueue('remove'));
  }

  private schedule(): void {
    const debounce = this.opts.debounceMs ?? 150;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.drain(), debounce);
  }

  private async drain(): Promise<void> {
    if (this.draining) {
      this.schedule();
      return;
    }
    this.draining = true;
    try {
      while (this.pending.size > 0) {
        const batch: VaultChange[] = [...this.pending.entries()].map(([path, kind]) => ({
          path,
          kind,
        }));
        this.pending.clear();
        try {
          await this.opts.onBatch(batch);
        } catch (err) {
          // Put the batch back (newer events win) and retry — a reindex hiccup
          // must not silently drop these files from the index forever.
          for (const { path, kind } of batch) {
            if (!this.pending.has(path)) this.pending.set(path, kind);
          }
          const names = batch
            .slice(0, 5)
            .map((c) => c.path)
            .join(', ');
          const rest = batch.length > 5 ? ` (+${batch.length - 5} more)` : '';
          console.error(
            `[watcher] batch failed, retrying — ${names}${rest}:`,
            err instanceof Error ? err.message : err,
          );
          this.timer = setTimeout(() => void this.drain(), 2000);
          return;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    await this.watcher?.close();
    this.watcher = null;
    // Final drain: a burst that arrived just before stop still lands.
    if (this.pending.size > 0) await this.drain();
    // A retry scheduled during that drain must not outlive the watcher.
    if (this.timer) clearTimeout(this.timer);
    this.pending.clear();
  }
}
