import { simpleGit, type SimpleGit } from 'simple-git';
import { existsSync } from 'node:fs';
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

  async isRepo(): Promise<boolean> {
    if (existsSync(join(this.root, '.git'))) return true;
    try {
      return await this.git.checkIsRepo();
    } catch {
      return false;
    }
  }

  async init(): Promise<void> {
    await this.git.init();
    // Seed an ignore so index/runtime artifacts never get committed into the vault.
    await this.git.raw(['config', 'user.name', 'pm']).catch(() => undefined);
  }

  async commitPaths(paths: string[], message: string): Promise<void> {
    if (paths.length === 0) return;
    if (!(await this.available()) || !(await this.isRepo())) return;
    try {
      await this.git.add(paths);
      const status = await this.git.status(paths);
      if (status.files.length === 0) return; // nothing actually changed
      await this.git.commit(message, paths);
    } catch {
      // Never let a git hiccup break a vault write; the file is already saved.
    }
  }
}
