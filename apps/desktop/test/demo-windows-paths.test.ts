import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { buildKickoff } from '@qale/sessions';
import { ScriptEngine } from '../src/main/demo/script-engine.js';
import { loadScenarios, type Scenario } from '../src/main/demo/scenario.js';
import { renderTurn } from '../src/main/demo/script-templates.js';
import type { ContentBlock, WireMessage } from '../src/main/demo/replay-recordings.js';

/**
 * Windows, from a Mac (docs/plan-demo-replay.md, section 4.1).
 *
 * Two kinds of path meet in the demo build and they must never be confused.
 * The folder the scripts are READ from is an OS path: on Windows it is
 * `C:\Users\...\resources\demo-assets\demo\scenarios`, with backslashes and a
 * drive letter. The paths INSIDE a script (`tickets/jira/SCH-118.md`) are
 * vault paths, which are posix on every platform — the invariant
 * `packages/vault/src/paths.ts` states, because the index, the wikilinks and
 * every writer in the app split on `/` and nothing else.
 *
 * Nobody here develops on Windows, so the only test that can catch the day
 * someone runs a vault path through `path.join` is one that hands the loader a
 * Windows-shaped folder deliberately and then reads the served tool calls back.
 *
 * The folder is built differently on the two platforms, because the shape has
 * to be real on both. On Windows the temp root is already a drive-letter path
 * with backslashes, and `:` and `\` cannot appear in a name at all, so the
 * shape comes free and the test folder only adds the spaces. On macOS both
 * characters are legal in a name, so the whole Windows path becomes one folder
 * NAME. That is what makes the loader prove it treats the folder as opaque
 * rather than parsing it.
 */

const FIXTURE = join(import.meta.dirname, 'fixtures', 'scenario-s1.json');

/** The tail every install has under it, with the space Windows puts in it. */
const TAIL = ['Qale Demo', 'resources', 'demo-assets', 'demo', 'scenarios'];

/** A scenarios folder shaped the way Windows shapes one. */
function windowsScenariosDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'qale-win-'));
  const dir =
    process.platform === 'win32'
      ? join(root, 'Program Files', ...TAIL)
      : join(root, `C:\\Program Files\\${TAIL.join('\\')}`);
  mkdirSync(dir, { recursive: true });
  cpSync(FIXTURE, join(dir, 's1.json'));
  return dir;
}

/** A served tool_use block's input. The wire type carries it as `unknown`. */
function inputOf(block: ContentBlock | undefined): Record<string, unknown> {
  return (block?.['input'] ?? {}) as Record<string, unknown>;
}

/** Every string anywhere in a tool call's input. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === 'object')
    for (const v of Object.values(value as Record<string, unknown>)) strings(v, out);
  return out;
}

function engineWith(scenarios: Scenario[]): ScriptEngine {
  const engine = new ScriptEngine({ offsetDays: 8, fallbackText: 'off script' });
  engine.load(scenarios);
  return engine;
}

/** The drop that starts s1: the arrival kickoff, then the turns after it. */
function arrival(assistantTurns: number): WireMessage[] {
  const messages: WireMessage[] = [
    { role: 'user', content: buildKickoff({ skill: 'arrival', instruction: '' }) },
  ];
  for (let i = 0; i < assistantTurns; i++) {
    messages.push({ role: 'assistant', content: 'ok' });
    messages.push({ role: 'user', content: 'go on' });
  }
  return messages;
}

test('a Windows scenarios folder loads, and the vault paths inside it stay posix', () => {
  const dir = windowsScenariosDir();
  // A drive letter, backslashes and a space, on both platforms.
  assert.match(dir, /[A-Za-z]:\\/);
  assert.match(dir, /Qale Demo\\resources\\demo-assets\\demo\\scenarios$/);

  const scenarios = loadScenarios(dir);
  assert.equal(scenarios.length, 1);
  const drop = scenarios[0]!.conversations[0]!;
  // Read back byte for byte from the file: the folder it came from left no mark.
  assert.equal(
    drop.turns[0]?.tools?.[0]?.input['path'],
    'sources/{{today}}-steering-transcript.md',
  );
  assert.equal(JSON.stringify(scenarios[0]), JSON.stringify(JSON.parse(readFileSync(FIXTURE, 'utf8'))));
});

test('served tool calls carry posix vault paths, whatever the folder was called', () => {
  const engine = engineWith(loadScenarios(windowsScenariosDir()));

  // Turn 0: the file_source call that files the dropped transcript.
  const first = engine.answer({ system: 'You are the embedded agent.', messages: arrival(0) });
  assert.equal(first.source, 'script');
  const filed = first.response.content.find((b) => b.type === 'tool_use');
  assert.equal(filed?.['name'], 'file_source');
  // The template resolved to the demo day and nothing else about the path moved.
  assert.equal(inputOf(filed)['path'], 'sources/2026-07-25-steering-transcript.md');

  // Turn 1: a todo whose source is a wikilink and whose note names a decision.
  const second = engine.answer({ system: 'You are the embedded agent.', messages: arrival(1) });
  const todo = second.response.content.find((b) => b.type === 'tool_use');
  assert.equal(todo?.['name'], 'propose_todo');
  assert.deepEqual(inputOf(todo)['sources'], ['[[meetings/2026-07-24-steering]]']);
  assert.match(String(inputOf(todo)['note']), /decisions\/2026-05-18-h2-order-payroll-first\.md$/);

  // Nothing served for this conversation carries a backslash anywhere.
  for (const served of [first, second]) {
    for (const block of served.response.content) {
      if (block.type !== 'tool_use') continue;
      for (const s of strings(inputOf(block))) assert.ok(!s.includes('\\'), `backslash in ${s}`);
    }
  }
});

test('a Windows OS path inside a script is left exactly as written', () => {
  // Not something a scenario should carry, but the expander walks every string
  // in a tool input, so it must not touch separators or a drive letter.
  const osPath = 'C:\\Users\\erik\\AppData\\Roaming\\Qale Demo\\workspace';
  const rendered = renderTurn(
    { text: 'Filed.', tools: [{ name: 'files_read', input: { path: osPath, at: '{{today}}' } }] },
    8,
  );
  assert.equal(rendered.tools[0]?.input['path'], osPath);
  assert.equal(rendered.tools[0]?.input['at'], '2026-07-25');
});

/**
 * The pin seed is a line of JavaScript run in the page, and the workspace path
 * is inside it as a string. On Windows that path is full of backslashes, every
 * one of which is an escape character in JavaScript. `JSON.stringify` is what
 * keeps the line valid; without it `C:\Users\...` would arrive as `C:Users...`
 * or fail to parse, and the rail would open empty in front of the audience.
 */
test('the pin seed survives a Windows workspace path', async () => {
  const windowsUserData = 'C:\\Users\\erik\\AppData\\Roaming\\Qale Demo';
  mock.module('electron', {
    namedExports: {
      app: {
        isPackaged: false,
        getAppPath: () => windowsUserData,
        getPath: () => windowsUserData,
        getLocale: () => 'en-US',
        on: () => {},
      },
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: (v: string) => Buffer.from(v, 'utf8'),
        decryptString: (b: Buffer) => b.toString('utf8'),
      },
      session: { defaultSession: { clearStorageData: () => Promise.resolve() } },
      ipcMain: { on: () => {}, handle: () => {} },
      BrowserWindow: class {},
      shell: { openPath: () => Promise.resolve('') },
    },
  });
  const { DemoService, DEFAULT_PINS } = await import('../src/main/demo/demo-service.js');
  const { SettingsService } = await import('../src/main/services/settings-service.js');

  const demo = new DemoService({
    settings: new SettingsService(),
    vaultService: {} as never,
    assetsRoot: windowsUserData,
    disposeAgent: () => {},
    onReset: () => {},
  });

  // What Electron's own `join` would have built there.
  const workspace = win32.join(windowsUserData, 'workspace');
  assert.ok(demo.workspacePath.includes('\\'), 'the workspace path should carry backslashes');

  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  // Run the seed the way the renderer does. A bad escape throws here.
  new Function('localStorage', demo.pinSeedScript())(localStorage);

  const [key] = [...store.keys()];
  assert.equal(key, `qale.favorites.v1:${demo.workspacePath}`);
  assert.ok(key!.startsWith(`qale.favorites.v1:${windowsUserData}`));
  assert.equal(win32.basename(workspace), 'workspace');
  // The pins themselves are vault paths, so they stay posix.
  assert.deepEqual(JSON.parse(store.get(key!)!), [...DEFAULT_PINS]);
  for (const pin of DEFAULT_PINS) assert.ok(!pin.includes('\\'), `backslash in ${pin}`);
});
