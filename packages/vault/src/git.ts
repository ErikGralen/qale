import { simpleGit, type SimpleGit } from 'simple-git';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { SESSION_FILES_DIR } from '@qale/domain';
import type { GitCommit, GitPort, GitTouch } from '@qale/application';

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
 * What to tell someone whose machine has no git, in one sentence they can act
 * on. Every workspace is a repo from the moment it is made (E-1), so "no git"
 * is not a setting they chose: it is history quietly off, and the only honest
 * thing to do is name the one command that turns it back on.
 *
 * macOS needs no restart afterwards. The availability probe re-asks every few
 * minutes (see {@link RECHECK_MISSING_MS}) precisely because `xcode-select
 * --install` finishes while the app is open. Windows and Linux put git on PATH,
 * which a running process does not re-read, so those two say to start again.
 */
export function gitInstallHint(platform: string = process.platform): string {
  if (platform === 'darwin') {
    return 'Open Terminal and run xcode-select --install. History starts working a few minutes later, with no restart.';
  }
  if (platform === 'win32') {
    return 'Install Git for Windows from git-scm.com, then start Qale again.';
  }
  return 'Install git with your package manager, for example sudo apt install git, then start Qale again.';
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
    // Past the free check this needs to ask git itself, and `openVault` asks on
    // every open: without the guard, that is the one call that would spawn the
    // macOS stub and pop Apple's installer on a machine with no developer tools.
    if (!(await this.available())) return false;
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
      await this.git.raw(['config', 'user.name', 'Qale']).catch(() => undefined);
      await this.git.raw(['config', 'user.email', 'qale@localhost']).catch(() => undefined);
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
      const log = await this.git.log<{
        hash: string;
        date: string;
        message: string;
        author_name: string;
      }>({
        file: relPath,
        format: { hash: '%H', date: '%aI', message: '%s', author_name: '%an' },
        '--follow': null,
      });
      return log.all.map((c) => ({
        hash: c.hash,
        date: c.date,
        message: c.message,
        author: c.author_name,
      }));
    } catch (err) {
      console.error(
        `[git] history failed for ${relPath}:`,
        err instanceof Error ? err.message : err,
      );
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

  /**
   * The paths one commit changed that concern this note: the note's own path,
   * and the other side of a rename when the commit renamed it. Empty when the
   * commit did not touch the note at all.
   *
   * This is what makes an undo safe (E-2). Reading the file at the parent
   * commit answers "what did it say before", but not "did this commit touch it
   * at all" — a hash from another note reads back a perfectly good older
   * version, and undoing with it would overwrite work nobody asked about. An
   * empty answer here is the refusal.
   *
   * The pathspec is deliberately left off the `git show`. Filtering by path can
   * be applied before rename detection, which reports a rename as an add and a
   * delete, and the undo would then leave a copy under the old name. Our
   * commits are path-scoped to a handful of files, so scanning the whole diff
   * costs nothing and always sees both sides.
   */
  async pathsChangedWith(hash: string, relPath: string): Promise<string[]> {
    if (!(await this.available()) || !(await this.isRepo())) return [];
    try {
      const out = await this.git.raw([
        'show',
        '--name-status',
        '--find-renames',
        '--format=',
        hash,
      ]);
      for (const line of out.split('\n')) {
        const cols = line.trimEnd().split('\t');
        if (cols.length < 2 || !cols[0]) continue;
        // R100 / C75: a rename or a copy, written as `code<TAB>from<TAB>to`.
        if ((cols[0][0] === 'R' || cols[0][0] === 'C') && cols.length >= 3) {
          if (cols[1] === relPath || cols[2] === relPath) return [cols[1]!, cols[2]!];
          continue;
        }
        if (cols[1] === relPath) return [relPath];
      }
      return [];
    } catch (err) {
      console.error(
        `[git] could not read what ${hash} changed:`,
        err instanceof Error ? err.message : err,
      );
      return [];
    }
  }

  /**
   * The last `days` days of history, path by path (IM-15).
   *
   * One `git log` for the whole window, not one per note: the caller wants to
   * rank the whole workspace, and a log per path would spawn a process for
   * every note in it. Each commit prints one header line, then the paths it
   * touched, so the parser walks the output once.
   *
   * The header starts with a NUL byte. A commit message can hold anything a
   * person types, including a line that looks exactly like a path, but a path
   * on disk can never hold a NUL, so the mark cannot be forged.
   */
  async changedSince(days: number): Promise<Map<string, GitTouch[]>> {
    const touched = new Map<string, GitTouch[]>();
    if (!(await this.available()) || !(await this.isRepo())) return touched;
    try {
      const out = await this.git.raw([
        'log',
        `--since=${days}.days`,
        '--name-only',
        '--date=short',
        '--format=%x00%ad %s',
      ]);
      let day = '';
      let prefix = '';
      for (const line of out.split('\n')) {
        if (line.startsWith('\0')) {
          const head = line.slice(1);
          day = head.slice(0, 10);
          const message = head.slice(11);
          const colon = message.indexOf(':');
          prefix = colon === -1 ? '' : message.slice(0, colon).trim().toLowerCase();
          continue;
        }
        const path = line.trim();
        if (!path || !day) continue;
        const list = touched.get(path);
        if (list) list.push({ day, prefix });
        else touched.set(path, [{ day, prefix }]);
      }
      return touched;
    } catch (err) {
      console.error(
        `[git] could not read the last ${days} days:`,
        err instanceof Error ? err.message : err,
      );
      return touched;
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
      //
      // Both ends of a rename, or the old name is left behind. git reports a
      // rename as ONE row naming the new path, with the old one in `from`, and
      // a commit is a partial commit: a path missing from this list keeps its
      // change staged and out of the commit forever. Without `from`, every
      // renamed note stayed in HEAD under its old name as well as its new one,
      // and its removal sat in the index for good.
      const spec = new Set<string>();
      for (const f of status.files) {
        spec.add(f.path);
        if (f.from) spec.add(f.from);
      }
      await this.git.commit(message, [...spec]);
    } catch (err) {
      // Never let a git hiccup break a vault write; the file is already saved.
      // But never silently either — a broken setup would otherwise disable
      // versioning forever with zero signal.
      console.error(
        `[git] commit failed for ${paths.length} path(s) ("${message}"):`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
