import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

/**
 * The headless runner (docs/claude-code-tickets.md CC-5, CC-11): what comes back
 * from one `claude` run, and what the run was allowed to do.
 *
 * There is no real Claude Code here and there is none in CI. What the service
 * spawns is a shell script that prints what the real tool prints, so the two
 * things worth asserting are testable without a model behind them: every answer
 * the runner accepts, every failure it turns into one plain line, and the flags
 * that make writing the repo impossible rather than discouraged.
 *
 * The script is found the way the app finds the real one, through the probe, so
 * the resolve path is under test as well. It is a POSIX script, so this suite
 * does not run on Windows; the app is developed on a Mac and Windows is a CI
 * runner, which means these run on every machine anybody writes this code on.
 */

const skip = process.platform === 'win32' ? 'the stand-in claude is a shell script' : false;

/** The scratch userData the settings service reads and writes. */
let userData = '';

mock.module('electron', {
  namedExports: {
    app: { getPath: () => userData, getLocale: () => 'en-US' },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value: string) => Buffer.from(value, 'utf8'),
      decryptString: (buf: Buffer) => buf.toString('utf8'),
    },
  },
});

const { SettingsService } = await import('../src/main/services/settings-service.js');
const { CodebaseService } = await import('../src/main/services/codebase-service.js');

const exec = promisify(execFile);

/**
 * The stand-in binary. `--version` answers the probe; everything else writes the
 * working directory and the arguments down, then prints whichever answer
 * FAKE_CLAUDE_MODE names.
 */
const STAND_IN = `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "2.1.220 (Claude Code)"
  exit 0
fi
{ pwd; for arg in "$@"; do echo "$arg"; done; } > "$FAKE_CLAUDE_LOG"
case "$FAKE_CLAUDE_MODE" in
  success)
    printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"result":"importRows writes straight through.","session_id":"cc-42"}'
    ;;
  refused)
    printf '%s\\n' '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"the prompt is longer than the context"}'
    ;;
  anonymous)
    printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"result":"an answer with no session behind it"}'
    ;;
  garbage)
    printf '%s\\n' 'Killed: 9'
    ;;
  excused)
    printf '%s\\n' '{"type":"result","subtype":"success","is_error":true,"result":"the model no-such-model does not exist"}'
    exit 1
    ;;
  crash)
    echo 'not logged in' >&2
    exit 3
    ;;
  hang)
    exec sleep 5
    ;;
esac
`;

async function scratch(name: string): Promise<string> {
  const dir = join(
    tmpdir(),
    `qale-runner-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** A real repo with one commit on `main`. */
async function makeRepo(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await exec('git', ['init', '-b', 'main'], { cwd: dir });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: dir });
  await fs.writeFile(join(dir, 'README.md'), 'one\n', 'utf8');
  await exec('git', ['add', '.'], { cwd: dir });
  await exec('git', ['commit', '-m', 'first'], { cwd: dir });
}

// Put the stand-in where the probe will find it. `SHELL` goes so that the
// resolve falls through to plain PATH: asking a login shell where `claude` is
// would find the real one on the machine this is written on.
const binDir = await scratch('bin');
await fs.writeFile(join(binDir, 'claude'), STAND_IN, { mode: 0o755 });
delete process.env['SHELL'];
process.env['PATH'] = `${binDir}:${process.env['PATH'] ?? ''}`;

const QUESTION = 'Does the importer de-duplicate rows before writing?';

/** One repo, one service, and the stand-in set to answer a given way. */
async function runner(
  mode: string,
  opts: { gitPull?: boolean; runTimeoutMs?: number } = {},
): Promise<{
  service: InstanceType<typeof CodebaseService>;
  settings: InstanceType<typeof SettingsService>;
  repo: string;
  head: string;
  invocation: string;
  /** How many times the probe has told the host it landed. */
  settled: () => number;
}> {
  const root = await scratch(mode);
  const repo = join(root, 'checkout');
  await makeRepo(repo);
  const head = (await exec('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();

  userData = await scratch('userdata');
  const settings = new SettingsService();
  await settings.load();
  await settings.setCodebasePaths([{ path: repo, gitPull: opts.gitPull ?? false }]);

  const invocation = join(root, 'invocation.txt');
  process.env['FAKE_CLAUDE_MODE'] = mode;
  process.env['FAKE_CLAUDE_LOG'] = invocation;
  let settled = 0;
  return {
    service: new CodebaseService(settings, () => settled++, opts.runTimeoutMs ?? 60_000),
    settings,
    repo,
    head,
    invocation,
    settled: () => settled,
  };
}

/** The working directory of the run, then every argument, one per line. */
async function invoked(path: string): Promise<{ cwd: string; args: string[] }> {
  const [cwd, ...args] = (await fs.readFile(path, 'utf8')).trim().split('\n');
  return { cwd: cwd ?? '', args };
}

/** The value after a flag, or null when the flag was not sent at all. */
const valueOf = (args: string[], flag: string): string | null => {
  const at = args.indexOf(flag);
  return at === -1 ? null : (args[at + 1] ?? '');
};

test('the probe finds claude through PATH and reads its version', { skip }, async () => {
  const { service } = await runner('success');
  const status = await service.status();
  assert.deepEqual(status.claude, { ok: true, version: '2.1.220' });
  assert.deepEqual(
    status.repos.map((r) => r.name),
    ['checkout'],
  );
  assert.ok(service.port(), 'a repo and a binary is the whole gate');
});

test('every probe that lands tells the host, wherever it was started', { skip }, async () => {
  const { service, settled } = await runner('success');
  assert.equal(settled(), 0);
  // The panel asking is a probe like any other. Before this, only the warm at
  // launch called back, so a PM who installed Claude Code with Settings open
  // got a "found" line over a port nobody ever picked up.
  await service.status();
  assert.equal(settled(), 1, 'the probe said it had landed');
  await service.status();
  assert.equal(settled(), 1, 'a cached answer is not news');
});

test('what a session was built against moves with the folders', { skip }, async () => {
  const { service, settings } = await runner('success');
  assert.equal(service.fingerprint(), '', 'no binary yet, so no tool to build with');

  await service.status();
  const first = service.fingerprint();
  assert.ok(first.length > 0, 'a repo and a binary is a session that can ask');

  await settings.setCodebasePaths([]);
  assert.equal(service.fingerprint(), '', 'the folder is gone, and so is the tool');
  assert.notEqual(first, service.fingerprint(), 'the host rebuilds the live sessions off this');
});

test('an answer comes back with the state of the code it was read at', { skip }, async () => {
  const { service, repo, head } = await runner('success');
  await service.status();
  const result = await service.port()!.run({ repoDir: repo, prompt: QUESTION, modelId: 'sonnet' });

  assert.equal(result.text, 'importRows writes straight through.');
  assert.equal(result.sessionId, 'cc-42');
  assert.equal(result.commit, head);
  assert.equal(result.branch, 'main');
  // What freshen said, carried through untouched: the report is filed against
  // this, so a run that did not pull has to say so here.
  assert.equal(result.freshened, false);
  assert.equal(result.skippedWhy, 'git pull is off for this folder');
});

test('the run is handed the read tools and nothing else', { skip }, async () => {
  const { service, repo, invocation } = await runner('success');
  await service.status();
  await service.port()!.run({ repoDir: repo, prompt: QUESTION, modelId: 'sonnet' });

  const { cwd, args } = await invoked(invocation);
  assert.equal(cwd, await fs.realpath(repo), 'the question is asked inside the repo');
  assert.equal(valueOf(args, '-p'), QUESTION);
  assert.equal(valueOf(args, '--output-format'), 'json');
  assert.equal(valueOf(args, '--model'), 'sonnet');
  assert.equal(valueOf(args, '--tools'), 'Read,Glob,Grep');
  assert.ok(args.includes('--strict-mcp-config'), 'no MCP server may join the run');
  // The third lock, and the one the tool policy cannot cover: a settings file
  // can hold hooks, and a hook is a shell command the CLI runs by itself. A
  // `SessionStart` hook in a repo's own .claude/settings.json ran and wrote a
  // file before this flag went in. An empty source list loads none of them.
  assert.equal(valueOf(args, '--setting-sources'), '', 'no settings file may join the run');

  // The second lock on the same door. Both of these are the reason Qale can
  // say it never writes code: not an instruction, a tool set.
  const denied = (valueOf(args, '--disallowed-tools') ?? '').split(',');
  for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash']) {
    assert.ok(denied.includes(tool), `${tool} was not denied`);
  }
  assert.equal(valueOf(args, '--resume'), null);
});

test('a resume continues the session and sends no model', { skip }, async () => {
  const { service, repo, invocation } = await runner('success');
  await service.status();
  await service.port()!.run({
    repoDir: repo,
    prompt: QUESTION,
    modelId: 'opus',
    resumeSessionId: 'cc-42',
  });

  const { args } = await invoked(invocation);
  assert.equal(valueOf(args, '--resume'), 'cc-42');
  // A session keeps the model it started with. Sending one here would either be
  // ignored or refused, and either way it would be a lie on the card.
  assert.equal(valueOf(args, '--model'), null);
});

test('a run that stops with an error is one plain line', { skip }, async () => {
  const { service, repo } = await runner('crash');
  await service.status();
  await assert.rejects(
    service.port()!.run({ repoDir: repo, prompt: QUESTION, modelId: 'sonnet' }),
    /stopped with code 3: not logged in/,
  );
});

test('a run that stops with its reason on stdout is told in its own words', { skip }, async () => {
  const { service, repo } = await runner('excused');
  await service.status();
  // The CLI usually prints why it stopped as JSON on stdout and leaves stderr
  // empty, so reading the exit code first would answer "it printed nothing"
  // over a sentence that says exactly what went wrong.
  await assert.rejects(
    service.port()!.run({ repoDir: repo, prompt: QUESTION, modelId: 'sonnet' }),
    /stopped with code 1: the model no-such-model does not exist/,
  );
});

test('output that is not JSON is refused, never half-read', { skip }, async () => {
  const { service, repo } = await runner('garbage');
  await service.status();
  await assert.rejects(
    service.port()!.run({ repoDir: repo, prompt: QUESTION, modelId: 'sonnet' }),
    /could not read/,
  );
});

test('an answer Claude Code itself calls an error never becomes a report', { skip }, async () => {
  const { service, repo } = await runner('refused');
  await service.status();
  await assert.rejects(
    service.port()!.run({ repoDir: repo, prompt: QUESTION, modelId: 'sonnet' }),
    /could not answer: the prompt is longer than the context/,
  );
});

test('an answer with no session id is refused, not filed unresumable', { skip }, async () => {
  const { service, repo } = await runner('anonymous');
  await service.status();
  await assert.rejects(
    service.port()!.run({ repoDir: repo, prompt: QUESTION, modelId: 'sonnet' }),
    /without a session id/,
  );
});

test('a question that never answers is killed rather than waited on', { skip }, async () => {
  const { service, repo } = await runner('hang', { runTimeoutMs: 300 });
  await service.status();
  await assert.rejects(
    service.port()!.run({ repoDir: repo, prompt: QUESTION, modelId: 'sonnet' }),
    /did not answer within 10 minutes/,
  );
});

test('Stop kills the question rather than paying out the ten minutes', { skip }, async () => {
  const { service, repo } = await runner('hang');
  await service.status();
  const stop = new AbortController();
  const asked = service.port()!.run({
    repoDir: repo,
    prompt: QUESTION,
    modelId: 'sonnet',
    signal: stop.signal,
  });
  // Long enough for the child to be up and holding the pipe.
  await new Promise((r) => setTimeout(r, 200));
  stop.abort();
  await assert.rejects(asked, /The run was stopped\./);
});

test('a question the PM already stopped never starts', { skip }, async () => {
  const { service, repo, invocation } = await runner('success');
  await service.status();
  const stop = new AbortController();
  stop.abort();
  await assert.rejects(
    service
      .port()!
      .run({ repoDir: repo, prompt: QUESTION, modelId: 'sonnet', signal: stop.signal }),
    /stopped before it started/,
  );
  await assert.rejects(fs.readFile(invocation, 'utf8'), 'nothing was spawned at all');
});

test('quitting takes a running question with it', { skip }, async () => {
  const { service, repo } = await runner('hang');
  await service.status();
  const asked = service.port()!.run({ repoDir: repo, prompt: QUESTION, modelId: 'sonnet' });
  // Long enough for the child to be up and holding the pipe.
  await new Promise((r) => setTimeout(r, 200));
  service.dispose();
  await assert.rejects(asked, /Claude Code/);
});
