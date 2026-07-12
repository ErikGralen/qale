import { watch, type FSWatcher } from 'chokidar';
import { relative, sep } from 'node:path';

/**
 * Vault watcher (PLAN §3.5): chokidar v5 (ESM, no globs — we filter `.md`
 * ourselves), ignoring `.obsidian/` and `.git/`. Events funnel through a
 * debounced serial queue so a git-pull / Obsidian-Sync burst re-indexes in a
 * batch and can't starve the IPC/agent loop.
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
        const rel = relative(this.root, path);
        if (!rel) return false;
        const parts = rel.split(sep);
        return parts.some((p) => p === '.git' || p === '.obsidian' || p === 'node_modules');
      },
    });

    const enqueue = (kind: ChangeKind) => (abs: string) => {
      if (!abs.toLowerCase().endsWith('.md')) return;
      const rel = relative(this.root, abs);
      this.pending.set(rel, kind);
      this.schedule();
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
        const batch: VaultChange[] = [...this.pending.entries()].map(([path, kind]) => ({ path, kind }));
        this.pending.clear();
        await this.opts.onBatch(batch);
      }
    } finally {
      this.draining = false;
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    await this.watcher?.close();
    this.watcher = null;
  }
}
