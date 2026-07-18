import { app } from 'electron';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { FsVault, SqliteIndex, VaultWatcher, GitAdapter, AppDb, type VaultChange } from '@pm/vault';
import { openVault, type UseCaseContext, type VaultInfo } from '@pm/application';

/**
 * Owns the live vault: fs + index + git + watcher for the currently-open vault.
 * The index lives in userData (rebuildable); switching vaults clears and rescans.
 * Watcher batches are applied to the index, then a `vault:changed` notification
 * is pushed so the renderer refreshes (external Obsidian edits show up live).
 */
export class VaultService {
  private ctx: UseCaseContext | null = null;
  private index: SqliteIndex | null = null;
  private appDb: AppDb | null = null;
  private watcher: VaultWatcher | null = null;
  private currentPath: string | null = null;
  private readonly indexPath = join(app.getPath('userData'), 'index.db');

  /**
   * Proposals/pings are scoped per vault via one app DB file per vault root —
   * a shared queue would carry vault A's pending cards into vault B, and
   * accepting one would write A's paths into B.
   */
  private appDbPathFor(root: string): string {
    const key = createHash('sha256').update(root).digest('hex').slice(0, 12);
    return join(app.getPath('userData'), `app-${key}.db`);
  }

  constructor(private readonly notifyChanged: (paths: string[]) => void) {}

  context(): UseCaseContext | null {
    return this.ctx;
  }

  requireContext(): UseCaseContext {
    if (!this.ctx) throw new Error('no vault open');
    return this.ctx;
  }

  currentVaultPath(): string | null {
    return this.currentPath;
  }

  async open(path: string): Promise<VaultInfo> {
    await this.closeWatcher();

    const vault = new FsVault(path);
    if (!this.index) this.index = new SqliteIndex(this.indexPath);
    // Switching to a different vault: the shared index must be rebuilt for it,
    // and the proposal/ping stores swap to that vault's own DB file.
    if (this.currentPath !== vault.root() || !this.appDb) {
      if (this.currentPath && this.currentPath !== vault.root()) this.index.clear();
      this.appDb?.close();
      this.appDb = new AppDb(this.appDbPathFor(vault.root()));
    }

    const git = new GitAdapter(path);
    const clock = { now: () => new Date().toISOString() };
    const ctx: UseCaseContext = {
      vault,
      index: this.index,
      git,
      clock,
      proposals: this.appDb.proposals,
      pings: this.appDb.pings,
    };

    // Only publish the context once the open fully succeeds — a mid-open throw
    // must not leave requireContext() returning a half-open vault.
    const info = await openVault(ctx);
    this.ctx = ctx;
    this.currentPath = vault.root();
    this.startWatcher(vault.root());
    return info;
  }

  private startWatcher(root: string): void {
    this.watcher = new VaultWatcher(root, {
      onBatch: async (changes: VaultChange[]) => {
        if (!this.ctx || !this.index) return;
        for (const change of changes) {
          if (change.kind === 'remove') {
            this.index.removeByPath(change.path);
          } else {
            const note = await this.ctx.vault.readNote(change.path);
            if (note) this.index.reindex(note);
          }
        }
        this.notifyChanged(changes.map((c) => c.path));
      },
    });
    this.watcher.start();
  }

  private async closeWatcher(): Promise<void> {
    await this.watcher?.stop();
    this.watcher = null;
  }

  async dispose(): Promise<void> {
    await this.closeWatcher();
    this.index?.close();
    this.index = null;
    this.appDb?.close();
    this.appDb = null;
    this.ctx = null;
  }
}
