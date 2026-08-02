import { simpleGit, type SimpleGit } from 'simple-git';
import { execFile } from 'node:child_process';
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
 * How long a "git is not on this machine" answer stands before we look again.
 *
 * Whether git exists is a fact about the machine, not about a vault, so the
 * answer is cached for the whole process and shared by every adapter. A yes is
 * kept forever: git does not get uninstalled underneath a running app, and if
 * it somehow did, every call site already fails soft. A no is the one worth
 * revisiting, because the fix we tell people to run (`xcode-select --install`)
 * happens while the app is open — without this they would stay stuck on "no
 * history" until the next launch, with nothing saying why.
 */
const RECHECK_MISSING_MS = 5 * 60_000;

let availability: { value: boolean; at: number } | null = null;
/** The probe in flight, so a save and an open racing spawn one process, not two. */
let probing: Promise<boolean> | null = null;

/** Drop the cached probe. Tests only — nothing in the app re-asks by hand. */
export function resetGitAvailability(): void {
  availability = null;
  probing = null;
}

/**
 * macOS ships a 118KB `/usr/bin/git` shim on every machine, developer tools
 * installed or not (it is linked against libxcselect, not a git at all). So the
 * file existing proves nothing, and running it without the Command Line Tools
 * is precisely what pops Apple's "the git command requires the command line
 * developer tools" installer — which, since we probe on workspace open, would
 * arrive unexplained on top of someone just opening their folder.
 *
 * `xcode-select -p` answers the same question, exits non-zero when the tools
 * are absent, and never opens the installer. Anything but a clean exit (no
 * `xcode-select` at all, a hang, an unexpected failure) counts as no git: being
 * wrong that way costs version history and undo and says so plainly, being
 * wrong the other way throws an Apple modal at the user.
 */
function developerToolsPresent(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      execFile('xcode-select', ['-p'], { timeout: 5_000 }, (err) => resolve(!err));
    } catch {
      resolve(false);
    }
  });
}

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

  /**
   * Is there a usable git on this machine? Cached (see `RECHECK_MISSING_MS`):
   * `history`, `fileAt` and `commitPaths` all ask, so an uncached probe spawns
   * a process on every note save.
   */
  async available(): Promise<boolean> {
    if (availability && (availability.value || Date.now() - availability.at < RECHECK_MISSING_MS)) {
      return availability.value;
    }
    probing ??= this.probe().then((value) => {
      availability = { value, at: Date.now() };
      probing = null;
      return value;
    });
    return probing;
  }

  private async probe(): Promise<boolean> {
    // Never spawn git on macOS until the safe check says there is a real one.
    if (process.platform === 'darwin' && !(await developerToolsPresent())) return false;
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
