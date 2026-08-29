import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { CodebasePort, CodebaseRunRequest, CodebaseRunResult } from '@qale/application';
import type { CodebaseClaudeDTO, CodebaseRepoDTO, CodebaseStatusDTO } from '@qale/ipc';
import type { CodebasePath, SettingsService } from './settings-service.js';

/**
 * Codebase service (docs/claude-code-tickets.md CC-2, CC-4, CC-5): find the
 * PM's repos, keep them current, and put one question to Claude Code in one of
 * them.
 *
 * The hard rule of the whole feature is that Qale reads code and never writes
 * it. Two things enforce it here, and neither is a matter of instruction: the
 * runner hands the `claude` tool a read-only tool set (see {@link claudeArgs}),
 * and the git side does `fetch` and a fast-forward pull and nothing else. No
 * merge, no stash, no checkout, no branch, no commit. A wrong merge in the
 * PM's own clone is worse than a stale answer.
 */

/** How long a "no `claude` on this machine" answer stands before we look again.
 *
 *  A yes is kept for the whole run: the binary does not move underneath a
 *  running app. A no is worth revisiting, because the fix (installing Claude
 *  Code) happens while Qale is open, and without this the settings panel would
 *  say "not found" until the next launch. Same shape as the git probe in
 *  packages/vault/src/git.ts. */
const RECHECK_MISSING_MS = 5 * 60_000;

/** A repo pulled more recently than this is left alone (CC-4). */
const PULL_INTERVAL_MS = 15 * 60_000;

/** How long one question may take before the run is killed. */
const RUN_TIMEOUT_MS = 10 * 60_000;

/** Grace between the polite kill and the one that always lands. */
const KILL_GRACE_MS = 5_000;

/**
 * Every tool the run is allowed to have. Reading the repo takes three, and the
 * list is the allowance itself, not a preference inside a larger set.
 */
const READ_TOOLS = ['Read', 'Glob', 'Grep'];

/**
 * Named again on the deny side. `--tools` already leaves them out, so this is
 * the second lock on the same door: if that flag is ever renamed or ignored,
 * the run must fail closed rather than quietly gain a write tool.
 */
const DENIED_TOOLS = [
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
  'BashOutput',
  'KillShell',
];

/** What the state of one repo was when a question was asked (CC-4). */
export interface FreshenResult {
  commit: string;
  branch: string;
  freshened: boolean;
  /** Set when nothing was pulled: one plain line saying why. */
  skippedWhy?: string;
}

/** The JSON one `claude -p --output-format json` run prints, as far as we read it. */
interface ClaudeResultJson {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
}

/** First line only, trimmed: every failure here becomes one line of tool text. */
function oneLine(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > 300 ? `${line.slice(0, 297)}...` : line;
}

/** Run a command and answer with what it printed, never throwing. */
function runCommand(
  file: string,
  args: string[],
  opts: { timeout: number; cwd?: string },
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((done) => {
    try {
      execFile(
        file,
        args,
        { timeout: opts.timeout, cwd: opts.cwd, windowsHide: true },
        (err, stdout, stderr) => done({ ok: !err, stdout: String(stdout), stderr: String(stderr) }),
      );
    } catch {
      done({ ok: false, stdout: '', stderr: '' });
    }
  });
}

/**
 * The exact command one question runs, in one place because the CLI's flag
 * surface moves. Checked against Claude Code 2.1.220 (`claude --help`, plus a
 * live run of each flag) on 2026-08-23.
 *
 * - `-p` with `--output-format json` is headless mode: one JSON object on
 *   stdout, then exit.
 * - `--tools` replaces the built-in tool set with the three read tools, so
 *   Write, Edit and Bash are never offered. `--disallowed-tools` names them
 *   again as the second lock.
 * - `--strict-mcp-config`, with no `--mcp-config` beside it, means no MCP
 *   servers. Without it the run inherits whatever servers the machine has
 *   configured, and a probe run on this machine was offered write tools by one
 *   of them.
 * - `--setting-sources` with an empty list loads none of the three settings
 *   files (user, project, local). This one is not about tools: a settings file
 *   can hold hooks, and a hook is a shell command the CLI runs by itself. A
 *   `SessionStart` hook in a repo's own `.claude/settings.json` ran and wrote a
 *   file during a check of the flags above, which is a write the tool policy
 *   never sees. With the flag the same hook does not run and the answer still
 *   comes back. Residual risk: settings an administrator installs on the
 *   machine (managed policy) still apply, and no CLI flag turns those off.
 * - `--resume` continues the Claude Code session an earlier answer came from.
 *   The model is not sent again on a resume: the session keeps the one it
 *   started with, which is why switching models means a new session.
 */
function claudeArgs(req: CodebaseRunRequest): string[] {
  return [
    '-p',
    req.prompt,
    '--output-format',
    'json',
    ...(req.resumeSessionId ? ['--resume', req.resumeSessionId] : ['--model', req.modelId]),
    '--strict-mcp-config',
    '--setting-sources',
    '',
    '--tools',
    READ_TOOLS.join(','),
    '--disallowed-tools',
    DENIED_TOOLS.join(','),
  ];
}

export class CodebaseService {
  /** The resolved absolute path of `claude`, once a probe found one. */
  private binary: string | null = null;
  /** The last probe's answer, and when it landed (see {@link RECHECK_MISSING_MS}). */
  private probed: { value: CodebaseClaudeDTO; at: number } | null = null;
  /** The probe in flight, so two callers spawn one process, not two. */
  private probing: Promise<CodebaseClaudeDTO> | null = null;
  /** When each repo was last pulled, epoch ms, keyed by repo dir. In memory:
   *  losing it on restart costs one extra pull. */
  private readonly lastPull = new Map<string, number>();
  /** Live child processes, so a quit takes them with it. */
  private readonly running = new Set<ChildProcess>();
  /** Stable object, so `ctx.codebase` does not change identity every reconfigure. */
  private readonly runner: CodebasePort = {
    repos: () => this.listRepos(),
    run: (req) => this.run(req),
  };

  /**
   * @param settings where the configured folders live.
   * @param onSettled called once the `claude` probe answers, so whoever holds
   *   the port can pick it up. The probe is async and the wiring that needs its
   *   answer is not, which is the whole reason this callback exists.
   * @param runTimeoutMs how long one question may take. The app never passes it;
   *   it is here so a test can watch a run get killed without sitting through
   *   ten minutes of it.
   */
  constructor(
    private readonly settings: SettingsService,
    private readonly onSettled: () => void,
    private readonly runTimeoutMs: number = RUN_TIMEOUT_MS,
  ) {}

  /**
   * The port, or nothing. Nothing is the gate: `!!ctx.codebase` is what decides
   * whether the `ask_codebase` tool is offered, so an unconfigured workspace and
   * a machine without Claude Code both answer the same way, at every read.
   */
  port(): CodebasePort | undefined {
    if (this.settings.getCodebasePaths().length === 0) return undefined;
    if (!this.binary) return undefined;
    return this.runner;
  }

  /**
   * Kick the probe if a folder is configured and we have not looked yet. Called
   * from the same place the rest of the agent wiring is rebuilt; the answer
   * arrives later and calls back.
   */
  warm(): void {
    if (this.settings.getCodebasePaths().length === 0) return;
    if (this.binary || this.probing) return;
    // The callback comes off the probe itself (see {@link claude}), so a warm
    // that only reads a cached answer changes nothing and calls nobody.
    void this.claude();
  }

  /**
   * What the sessions were built against, as one comparable string. Empty when
   * there is no port at all, which is the same thing a session sees: no tool.
   *
   * The tool set is fixed when a session is built, so the host compares this
   * against the last one and rebuilds the live sessions when it moves. Exactly
   * what the connections list does (`connectionsFingerprint` in the runtime).
   * The git toggle is left out on purpose: it changes what a run does to a
   * clone, never which tools a session has.
   */
  fingerprint(): string {
    if (!this.port()) return '';
    return this.settings
      .getCodebasePaths()
      .map((entry) => resolve(entry.path))
      .join('\u0000');
  }

  /** Everything the settings panel shows, gathered in one call. */
  async status(): Promise<CodebaseStatusDTO> {
    const [claude, repos] = await Promise.all([this.claude(), this.listRepos()]);
    return { claude, repos };
  }

  /** The repos under the configured folders. */
  listRepos(): Promise<CodebaseRepoDTO[]> {
    return this.discoverRepos(this.settings.getCodebasePaths());
  }

  /**
   * Find the repos under a set of folders. A folder with a `.git` is one repo;
   * otherwise every direct subfolder with a `.git` is a repo. We do not walk
   * deeper: a nested repo is somebody's dependency checkout, not a thing the PM
   * meant to point at.
   *
   * A repo reachable through two configured folders is one repo. Names that
   * still collide after that are qualified with their parent folder, because
   * `name` is the address a session asks by and two repos cannot share one.
   */
  async discoverRepos(paths: readonly CodebasePath[]): Promise<CodebaseRepoDTO[]> {
    const found: CodebaseRepoDTO[] = [];
    const seenDirs = new Set<string>();
    for (const entry of paths) {
      const parentPath = resolve(entry.path);
      const dirs = isRepoDir(parentPath) ? [parentPath] : await subRepos(parentPath);
      for (const dir of dirs) {
        if (seenDirs.has(dir)) continue;
        seenDirs.add(dir);
        found.push({ name: basename(dir), dir, parentPath });
      }
    }
    const times = new Map<string, number>();
    for (const repo of found) times.set(repo.name, (times.get(repo.name) ?? 0) + 1);
    return found.map((repo) =>
      (times.get(repo.name) ?? 0) > 1
        ? { ...repo, name: `${basename(dirname(repo.dir))}/${repo.name}` }
        : repo,
    );
  }

  /**
   * Is the `claude` command line tool on this machine, and which version?
   * Cached; a miss is re-checked after {@link RECHECK_MISSING_MS}.
   */
  async claude(): Promise<CodebaseClaudeDTO> {
    if (this.probed && (this.probed.value.ok || Date.now() - this.probed.at < RECHECK_MISSING_MS))
      return this.probed.value;
    this.probing ??= this.probeClaude()
      .catch((err: unknown) => {
        // resolveClaude/runCommand are meant to turn every failure into
        // { ok: false, reason }, but if one still throws, land here rather than
        // leaving `probing` set forever — that would wedge `warm()`'s guard and
        // stop every future probe.
        console.error('[qale] claude probe failed:', err instanceof Error ? err.message : err);
        return { ok: false, reason: 'Could not check for Claude Code.' } satisfies CodebaseClaudeDTO;
      })
      .then((value) => {
        this.probed = { value, at: Date.now() };
        this.probing = null;
        // Every probe that lands calls back, wherever it was started from: the
        // warm at launch, and the settings panel asking again after a miss. The
        // port is only read when something tells the host to read it, so a probe
        // that answered yes and told nobody would leave the tool off until the
        // next reconfigure.
        try {
          this.onSettled();
        } catch {
          // A callback that throws is the host's problem. The probe still answers.
        }
        return value;
      });
    return this.probing;
  }

  /**
   * Resolve `claude`, then ask it its version.
   *
   * The gotcha is the resolve. A macOS app launched from the Dock inherits the
   * PATH launchd hands it, not the one the user's shell builds, and Claude Code
   * installs into `~/.local/bin` or a version manager's shim directory. So
   * plain `execFile('claude')` finds nothing inside a packaged Qale while the
   * same command works in every terminal on the machine. Asking the login shell
   * where it is closes that gap, and the absolute path it answers with is what
   * every later run spawns. The `xcode-select -p` probe in
   * packages/vault/src/git.ts is the same move for the same class of problem.
   */
  private async probeClaude(): Promise<CodebaseClaudeDTO> {
    const binary = await resolveClaude();
    if (!binary) {
      this.binary = null;
      return { ok: false, reason: 'Claude Code is not installed on this machine.' };
    }
    const probe = await runCommand(binary, ['--version'], { timeout: 15_000 });
    if (!probe.ok) {
      this.binary = null;
      return {
        ok: false,
        reason: oneLine(probe.stderr) || 'Claude Code is on this machine but would not start.',
      };
    }
    this.binary = binary;
    // "2.1.220 (Claude Code)": the number is the part anyone reads.
    const version = /\d+\.\d+\.\d+/.exec(probe.stdout)?.[0];
    return version ? { ok: true, version } : { ok: true };
  }

  /**
   * Bring one repo up to date before a question, or say why it was left alone
   * (CC-4). It always answers with the state the question was asked against,
   * skip or no skip, so the report can tell the truth about how current the
   * code was.
   */
  async freshen(repoDir: string): Promise<FreshenResult> {
    const git = simpleGit({ baseDir: repoDir });
    const head = await headState(git);
    const skip = (why: string): FreshenResult => ({ ...head, freshened: false, skippedWhy: why });

    if (!head.commit) return skip('the repo has no commits yet');
    if (!this.gitPullFor(repoDir)) return skip('git pull is off for this folder');

    const last = this.lastPull.get(repoDir);
    if (last !== undefined && Date.now() - last < PULL_INTERVAL_MS)
      return skip('it was pulled less than 15 minutes ago');

    const clean = await git
      .status()
      .then((s) => s.isClean())
      .catch(() => false);
    if (!clean) return skip('the working tree has uncommitted changes');

    const fallback = await defaultBranch(git);
    if (!fallback) return skip('there is no remote to pull from');
    if (head.branch !== fallback.branch)
      return skip(`the checkout is on ${head.branch}, not the default branch ${fallback.branch}`);

    try {
      await git.fetch(fallback.remote, fallback.branch);
    } catch (err) {
      return skip(`the fetch failed: ${oneLine(err instanceof Error ? err.message : String(err))}`);
    }
    try {
      // Fast-forward or nothing. A merge commit here would be Qale writing to
      // the PM's clone, which this feature does not do.
      await git.pull(fallback.remote, fallback.branch, { '--ff-only': null });
    } catch {
      // Not stamped: nothing was pulled, and a clone that has diverged has to
      // keep saying so. Stamping here would tell the next question inside the
      // quarter hour that the code was pulled recently, which is the opposite
      // of what happened.
      return { ...(await headState(git)), freshened: false, skippedWhy: 'it cannot fast-forward' };
    }
    // Stamped on the pull that worked, and only on that one.
    this.lastPull.set(repoDir, Date.now());
    return { ...(await headState(git)), freshened: true };
  }

  /**
   * Whether this repo's configured folder allows a pull. A repo we cannot trace
   * back to a configured folder gets a no: not configured means not touched.
   */
  private gitPullFor(repoDir: string): boolean {
    for (const entry of this.settings.getCodebasePaths()) {
      const configured = resolve(entry.path);
      if (repoDir === configured || dirname(repoDir) === configured) return entry.gitPull;
    }
    return false;
  }

  /**
   * Put one question to Claude Code and bring back the answer with the state of
   * the code it was read from. Every failure comes back as a rejection carrying
   * one plain line; the tool turns that into tool text rather than a thrown turn.
   */
  private async run(req: CodebaseRunRequest): Promise<CodebaseRunResult> {
    const binary = this.binary;
    if (!binary) throw new Error('Claude Code is not installed on this machine.');
    if (req.signal?.aborted) throw new Error('The run was stopped before it started.');
    const state = await this.freshen(req.repoDir);
    const json = await this.spawnClaude(binary, req);
    return {
      text: json.result ?? '',
      sessionId: json.session_id ?? '',
      commit: state.commit,
      branch: state.branch,
      freshened: state.freshened,
      ...(state.skippedWhy ? { skippedWhy: state.skippedWhy } : {}),
    };
  }

  /** One child process, one JSON object, or one plain line saying what went wrong. */
  private spawnClaude(binary: string, req: CodebaseRunRequest): Promise<ClaudeResultJson> {
    return new Promise((done, fail) => {
      const child = spawn(binary, claudeArgs(req), {
        cwd: req.repoDir,
        // stdin closed: headless mode must never end up waiting on a prompt
        // nobody can answer.
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.running.add(child);
      let out = '';
      let err = '';
      let timedOut = false;
      let stopped = false;
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => (out += chunk));
      child.stderr.on('data', (chunk: string) => (err += chunk));

      const timer = setTimeout(() => {
        timedOut = true;
        kill(child);
      }, this.runTimeoutMs);

      // Stop means stop: the PM stopping the turn takes the child with it,
      // rather than leaving ten minutes of somebody else's machine running for
      // an answer nobody will read. Same two signals as the timeout.
      const onAbort = (): void => {
        stopped = true;
        kill(child);
      };
      req.signal?.addEventListener('abort', onAbort, { once: true });
      const settle = (): void => {
        clearTimeout(timer);
        req.signal?.removeEventListener('abort', onAbort);
        this.running.delete(child);
      };

      child.on('error', (spawnErr) => {
        settle();
        fail(new Error(`Claude Code would not start: ${oneLine(spawnErr.message)}`));
      });

      child.on('close', (code) => {
        settle();
        if (stopped) return fail(new Error('The run was stopped.'));
        if (timedOut) return fail(new Error('Claude Code did not answer within 10 minutes.'));
        // Read stdout before the exit code, because the CLI often prints its
        // own reason there and leaves stderr empty: a `--model` it does not
        // know exits 1 with the sentence about it in `result`. Its own words
        // beat "it printed nothing" every time.
        let json: ClaudeResultJson | null = null;
        try {
          json = JSON.parse(out) as ClaudeResultJson;
        } catch {
          json = null;
        }
        if (code !== 0) {
          const reason = oneLine(json?.result ?? '') || oneLine(err) || 'it printed nothing';
          return fail(new Error(`Claude Code stopped with code ${code}: ${reason}`));
        }
        if (!json) return fail(new Error('Claude Code returned output this app could not read.'));
        if (json.is_error || json.subtype !== 'success')
          return fail(
            new Error(
              `Claude Code could not answer: ${oneLine(json.result ?? json.subtype ?? '')}`,
            ),
          );
        if (!json.session_id) return fail(new Error('Claude Code answered without a session id.'));
        done(json);
      });
    });
  }

  /** Quit-time teardown: no run outlives the app. */
  dispose(): void {
    for (const child of this.running) kill(child);
    this.running.clear();
  }
}

/** Ask politely, then make sure. */
function kill(child: ChildProcess): void {
  child.kill('SIGTERM');
  const grace = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
  // The timer must not hold the app open on quit.
  grace.unref?.();
  child.once('close', () => clearTimeout(grace));
}

/** A repo is a directory with a `.git` (a folder for a clone, a file for a worktree). */
function isRepoDir(dir: string): boolean {
  return existsSync(join(dir, '.git'));
}

/** Direct subfolders that are repos. An unreadable folder yields none, quietly:
 *  the settings panel showing no repos is the honest answer either way. */
async function subRepos(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => join(dir, e.name))
    .filter(isRepoDir)
    .sort();
}

/** Where HEAD is. Empty strings for a repo with no commits, which is a skip. */
async function headState(git: SimpleGit): Promise<{ commit: string; branch: string }> {
  const commit = await git
    .revparse(['HEAD'])
    .then((s) => s.trim())
    .catch(() => '');
  const branch = await git
    .revparse(['--abbrev-ref', 'HEAD'])
    .then((s) => s.trim())
    .catch(() => '');
  return { commit, branch };
}

/**
 * Which branch this clone is meant to sit on, and the remote it follows.
 * `origin/HEAD` is what a clone writes down, so it is asked first; `main` and
 * `master` are the fallback for a clone that lost it. Null when there is no
 * remote at all, which is a repo nothing can be pulled into.
 */
async function defaultBranch(git: SimpleGit): Promise<{ remote: string; branch: string } | null> {
  const remotes = await git.getRemotes(false).catch(() => []);
  if (remotes.length === 0) return null;
  const remote = remotes.find((r) => r.name === 'origin')?.name ?? remotes[0]!.name;
  const symbolic = await git
    .raw(['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`])
    .then((s) => s.trim())
    .catch(() => '');
  if (symbolic.startsWith(`${remote}/`))
    return { remote, branch: symbolic.slice(remote.length + 1) };
  for (const name of ['main', 'master']) {
    const exists = await git
      .raw(['rev-parse', '--verify', `refs/remotes/${remote}/${name}`])
      .then(() => true)
      .catch(() => false);
    if (exists) return { remote, branch: name };
  }
  return null;
}

/**
 * The absolute path of `claude`, or null. Tries the user's login shell first
 * (see {@link CodebaseService.probeClaude} for why), then an interactive one
 * for the machines that build PATH in `.zshrc` rather than `.zprofile`, then
 * plain PATH for Windows and for a Qale started from a terminal.
 */
async function resolveClaude(): Promise<string | null> {
  const shell = process.env['SHELL'];
  if (process.platform !== 'win32' && shell) {
    for (const flags of ['-lc', '-lic']) {
      const found = await runCommand(shell, [flags, 'command -v claude'], { timeout: 8_000 });
      const path = found.stdout.trim().split('\n').pop()?.trim();
      if (found.ok && path && existsSync(path)) return path;
    }
  }
  const which = process.platform === 'win32' ? 'where' : 'which';
  const fallback = await runCommand(which, ['claude'], { timeout: 8_000 });
  const path = fallback.stdout.trim().split('\n')[0]?.trim();
  return fallback.ok && path ? path : null;
}
