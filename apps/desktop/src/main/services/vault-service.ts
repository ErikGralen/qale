import { app } from 'electron';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { FsVault, SqliteIndex, VaultWatcher, GitAdapter, AppDb, type VaultChange } from '@qale/vault';
import { openVault, type UseCaseContext, type VaultInfo } from '@qale/application';
import { isReservedFile, isRunnableResource } from '@qale/domain';

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
   * Proposals, questions and the check ledger are scoped per vault via one app
   * DB file per vault root — a shared queue would carry vault A's pending cards
   * into vault B, and accepting one would write A's paths into B.
   */
  private appDbPathFor(root: string): string {
    const key = createHash('sha256').update(root).digest('hex').slice(0, 12);
    return join(app.getPath('userData'), `app-${key}.db`);
  }

  constructor(private readonly notifyChanged: (paths: string[]) => void) {}

  context(): UseCaseContext | null {
    return this.ctx;
  }

  /** Sync-engine state for the OPEN vault (follows, marks, shallow index). */
  syncStore(): AppDb['sync'] | null {
    return this.appDb?.sync ?? null;
  }

  requireContext(): UseCaseContext {
    if (!this.ctx) throw new Error('no workspace open');
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
    // and the app DB's stores swap to that vault's own file.
    const switching = this.currentPath !== vault.root() || !this.appDb;
    const appDb = switching ? new AppDb(this.appDbPathFor(vault.root())) : this.appDb!;

    const git = new GitAdapter(path);
    const clock = { now: () => localIsoNow() };
    const ctx: UseCaseContext = {
      vault,
      index: this.index,
      git,
      clock,
      proposals: appDb.proposals,
      asks: appDb.asks,
      checks: appDb.checks,
    };

    if (this.currentPath && this.currentPath !== vault.root()) this.index.clear();
    // Only publish the context (and tear down the old vault's state) once the
    // open fully succeeds — a mid-open throw must not leave requireContext()
    // returning a half-open vault or the old vault against closed stores.
    let info: VaultInfo;
    try {
      info = await openVault(ctx);
    } catch (err) {
      if (appDb !== this.appDb) appDb.close();
      if (this.ctx && this.currentPath && this.currentPath !== vault.root()) {
        this.index.clear();
        await openVault(this.ctx).catch(() => undefined);
      }
      if (this.currentPath) this.startWatcher(this.currentPath);
      throw err;
    }
    if (this.appDb && this.appDb !== appDb) this.appDb.close();
    this.appDb = appDb;
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
          // Reserved files (index.md/log.md) are orientation, not notes — never
          // index them, so the librarian regenerating index.md can't loop back
          // in as a phantom note here. Same for a skill's own material: a file
          // beside SKILL.md is read when its skill says so, and is not a note.
          if (isReservedFile(change.path) || isRunnableResource(change.path)) continue;
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

/** Local-offset ISO timestamp (e.g. `…T14:05:00.000+02:00`) — every consumer
 *  that slices the date out gets the user's LOCAL day, not the UTC one. */
function localIsoNow(): string {
  const d = new Date();
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}
