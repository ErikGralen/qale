import { simpleGit, type SimpleGit } from 'simple-git';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { GitPort } from '@pm/application';

/**
 * Git layer (PLAN §3.5): thin wrapper over system git via simple-git, with a
 * startup availability check. Commits are path-scoped to exactly the files a
 * save/accept touched — never `add -A`. Consent for `init` is handled by the
 * caller (main), not here.
 */
export class GitAdapter implements GitPort {
  private git: SimpleGit;

  constructor(private readonly root: string) {
    this.git = simpleGit({ baseDir: root });
  }

  async available(): Promise<boolean> {
    try {
      await this.git.version();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * True only when the vault root IS the repo root. A vault nested inside some
   * other repo's work tree (e.g. a dev vault inside the app's source repo) must
   * NOT count — committing there would write vault edits into the parent repo.
   */
  async isRepo(): Promise<boolean> {
    if (existsSync(join(this.root, '.git'))) return true;
    try {
      const toplevel = (await this.git.raw(['rev-parse', '--show-toplevel'])).trim();
      return realpathSync(toplevel) === realpathSync(this.root);
    } catch {
      return false;
    }
  }

  async init(): Promise<void> {
    await this.git.init();
    // Seed an ignore so OS junk never gets committed into the vault.
    const ignorePath = join(this.root, '.gitignore');
    if (!existsSync(ignorePath)) await writeFile(ignorePath, '.DS_Store\n', 'utf8');
    // Repo-local identity fallback: without user.email, every commit fails on
    // machines that never configured git globally.
    const email = await this.git.raw(['config', 'user.email']).catch(() => '');
    if (!String(email).trim()) {
      await this.git.raw(['config', 'user.name', 'pm']).catch(() => undefined);
      await this.git.raw(['config', 'user.email', 'pm@localhost']).catch(() => undefined);
    }
  }

  async commitPaths(paths: string[], message: string): Promise<void> {
    if (paths.length === 0) return;
    if (!(await this.available()) || !(await this.isRepo())) return;
    try {
      // Add per-path: one bad pathspec (e.g. the old name of a never-committed
      // rename) must not abort staging the rest of the batch.
      for (const p of paths) {
        await this.git.add(p).catch((err) => {
          console.error(`[git] add failed for ${p}:`, err instanceof Error ? err.message : err);
        });
      }
      const status = await this.git.status(paths);
      if (status.files.length === 0) return; // nothing actually changed
      // Commit only the paths git recognizes — an unmatched pathspec (never-
      // tracked deletion) would abort the whole commit.
      await this.git.commit(
        message,
        status.files.map((f) => f.path),
      );
    } catch (err) {
      // Never let a git hiccup break a vault write; the file is already saved.
      // But never silently either — a broken setup would otherwise disable
      // versioning forever with zero signal.
      console.error('[git] commit failed:', err instanceof Error ? err.message : err);
    }
  }
}
