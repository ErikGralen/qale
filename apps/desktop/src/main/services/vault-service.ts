import { app } from 'electron';
import { join } from 'node:path';
import { FsVault, SqliteIndex, VaultWatcher, GitAdapter, ProposalStore, type VaultChange } from '@pm/vault';
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
  private proposals: ProposalStore | null = null;
  private watcher: VaultWatcher | null = null;
  private currentPath: string | null = null;
  private readonly indexPath = join(app.getPath('userData'), 'index.db');
  private readonly appDbPath = join(app.getPath('userData'), 'app.db');

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
    if (!this.proposals) this.proposals = new ProposalStore(this.appDbPath);
    // Switching to a different vault: the shared index must be rebuilt for it.
    if (this.currentPath && this.currentPath !== vault.root()) this.index.clear();

    const git = new GitAdapter(path);
    const clock = { now: () => new Date().toISOString() };
    this.ctx = { vault, index: this.index, git, clock, proposals: this.proposals };
    this.currentPath = vault.root();

    const info = await openVault(this.ctx);
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
    this.ctx = null;
  }
}
