import { simpleGit, type SimpleGit } from 'simple-git';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { SESSION_FILES_DIR } from '@pm/domain';
import type { GitCommit, GitPort } from '@pm/application';

/**
 * Seeded into every vault's `.gitignore`: OS junk, plus session working files —
 * a session's scratch folder is deliberately untracked (Sessions v2 invariant 1:
 * session files are not the memory, and the memory is what git versions).
 */
const IGNORED = ['.DS_Store', `${SESSION_FILES_DIR}/`];

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
    await this.ensureIgnored(IGNORED);
    // Repo-local identity fallback: without user.email, every commit fails on
    // machines that never configured git globally.
    const email = await this.git.raw(['config', 'user.email']).catch(() => '');
    if (!String(email).trim()) {
      await this.git.raw(['config', 'user.name', 'pm']).catch(() => undefined);
      await this.git.raw(['config', 'user.email', 'pm@localhost']).catch(() => undefined);
    }
  }

  /**
   * Append any missing patterns to the vault's `.gitignore` (creating it).
   * Idempotent, and safe on a vault whose ignore file the PM has edited — we
   * only ever add lines. Called on every open, not just `init`: session files
   * (`sessions/.files/`) landed after workspaces already existed, and a vault
   * that missed the seed must not start committing scratch.
   */
  async ensureIgnored(patterns: string[]): Promise<void> {
    const ignorePath = join(this.root, '.gitignore');
    let current = '';
    try {
      current = existsSync(ignorePath) ? await readFile(ignorePath, 'utf8') : '';
    } catch {
      return;
    }
    const have = new Set(current.split('\n').map((l) => l.trim()));
    const missing = patterns.filter((p) => !have.has(p));
    if (missing.length === 0) return;
    const body = current && !current.endsWith('\n') ? `${current}\n` : current;
    await writeFile(ignorePath, `${body}${missing.join('\n')}\n`, 'utf8').catch((err) => {
      console.error('[git] .gitignore update failed:', err instanceof Error ? err.message : err);
    });
  }

  async history(relPath: string): Promise<GitCommit[]> {
    if (!(await this.available()) || !(await this.isRepo())) return [];
    try {
      // --follow tracks the file across renames; the file may be uncommitted.
      const log = await this.git.log<{ hash: string; date: string; message: string; author_name: string }>({
        file: relPath,
        format: { hash: '%H', date: '%aI', message: '%s', author_name: '%an' },
        '--follow': null,
      });
      return log.all.map((c) => ({ hash: c.hash, date: c.date, message: c.message, author: c.author_name }));
    } catch (err) {
      console.error('[git] history failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  async fileAt(relPath: string, hash: string): Promise<string | null> {
    if (!(await this.available()) || !(await this.isRepo())) return null;
    try {
      return await this.git.show([`${hash}:${relPath}`]);
    } catch {
      // Not present at that commit (added later, or path differs pre-rename).
      return null;
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
