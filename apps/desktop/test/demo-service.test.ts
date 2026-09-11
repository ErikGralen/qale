import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The demo build's own service (docs/demo-mode.md DM-2, DM-9).
 *
 * Two things are worth pinning. The date maths, because every recorded answer
 * and every fixture row is slid by the same number and a wrong one is only
 * visible in the demo itself. And what Reset actually deletes, because it
 * deletes a workspace: the test proves it rebuilds from the bundled copy,
 * clears the per-vault database and never reaches past the folders it owns.
 *
 * The whole of Electron is faked. `app.getPath` answers with scratch folders,
 * so the "Desktop" the samples land on is a temp directory and no test writes
 * anywhere a person keeps things.
 */

let userData = '';
let desktop = '';
/** Every clearStorageData call, so the test can see it happened. */
const cleared: unknown[] = [];
/** Every path handed to shell.openPath. */
const opened: string[] = [];

mock.module('electron', {
  namedExports: {
    app: {
      isPackaged: false,
      getAppPath: () => userData,
      getPath: (name: string) => (name === 'desktop' ? desktop : userData),
      getLocale: () => 'en-US',
      // `start()` listens for the window the pin seed writes into. No test
      // opens a window, so the listener is registered and never called.
      on: () => {},
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value, 'utf8'),
      decryptString: (buf: Buffer) => buf.toString('utf8'),
    },
    session: {
      defaultSession: {
        clearStorageData: (opts: unknown) => {
          cleared.push(opts);
          return Promise.resolve();
        },
      },
    },
    // @electron-toolkit/utils imports these two by name, so they have to exist
    // for the module to load at all. Nothing under test calls either.
    ipcMain: { on: () => {}, handle: () => {} },
    BrowserWindow: class {},
    shell: {
      openPath: (path: string) => {
        opened.push(path);
        return Promise.resolve('');
      },
    },
  },
});

const { DemoService, DEFAULT_PINS } = await import('../src/main/demo/demo-service.js');
const { SettingsService } = await import('../src/main/services/settings-service.js');
const { ANCHOR, appDbBasename } = await import('@qale/domain/demo');

type Service = InstanceType<typeof DemoService>;

/** A workspace service that records what was asked of it and owns no files. */
function fakeVault(): { calls: string[]; service: never } {
  const calls: string[] = [];
  const service = {
    dispose: async () => {
      calls.push('dispose');
    },
    open: async (path: string) => {
      calls.push(`open ${path}`);
      return {};
    },
  };
  return { calls, service: service as never };
}

/** A scratch install: userData, a Desktop, and the bundled demo material. */
function install(): { root: string; assets: string } {
  const root = mkdtempSync(join(tmpdir(), 'qale-demo-'));
  userData = join(root, 'userData');
  desktop = join(root, 'Desktop');
  mkdirSync(userData, { recursive: true });
  mkdirSync(desktop, { recursive: true });

  const assets = join(root, 'assets');
  mkdirSync(join(assets, 'vault-dev', 'notes'), { recursive: true });
  mkdirSync(join(assets, 'vault-dev', 'sessions', 'old-run'), { recursive: true });
  mkdirSync(join(assets, 'demo-samples'), { recursive: true });
  writeFileSync(
    join(assets, 'vault-dev', 'notes', 'a.md'),
    `---\ntype: note\ndate: ${ANCHOR}\n---\n\nWritten on ${ANCHOR}.\n`,
  );
  writeFileSync(join(assets, 'vault-dev', 'sessions', 'old-run', 'brief.md'), 'stale\n');
  writeFileSync(join(assets, 'demo-samples', 'transcript.txt'), 'Recorded 2026-07-17.\nAnna: hello\n');
  return { root, assets };
}

function service(assets: string, vault = fakeVault()): { demo: Service; vault: typeof vault } {
  const settings = new SettingsService();
  const demo = new DemoService({
    settings,
    vaultService: vault.service,
    assetsRoot: assets,
    disposeAgent: () => vault.calls.push('disposeAgent'),
    onReset: () => vault.calls.push('onReset'),
  });
  return { demo, vault };
}

function demoOn(): void {
  process.env['QALE_DEMO'] = '1';
}
function demoOff(): void {
  delete process.env['QALE_DEMO'];
}
function pinToday(day: string | null): void {
  if (day) process.env['QALE_DEMO_TODAY'] = day;
  else delete process.env['QALE_DEMO_TODAY'];
}

test('a pinned day sets both the date and the offset', () => {
  demoOn();
  pinToday('2026-07-25');
  const { assets } = install();
  const { demo } = service(assets);
  assert.equal(demo.today(), '2026-07-25');
  assert.equal(demo.dateOffsetDays(), 8);
  pinToday('2026-07-10');
  assert.equal(demo.dateOffsetDays(), -7);
  pinToday(ANCHOR);
  assert.equal(demo.dateOffsetDays(), 0);
  demoOff();
});

test('a pinned day that is not a date is ignored, and today is the real day', () => {
  demoOn();
  pinToday('next tuesday');
  const { assets } = install();
  const { demo } = service(assets);
  assert.equal(demo.today(), new Date().toISOString().slice(0, 10));
  pinToday(null);
  demoOff();
});

test('an ordinary build reports the demo as off and does nothing', async () => {
  demoOff();
  pinToday(null);
  const { assets } = install();
  const { demo, vault } = service(assets);
  const info = demo.info();
  assert.equal(info.enabled, false);
  await demo.start();
  await demo.reset();
  assert.equal(await demo.firstLaunch(), false);
  // Not one file moved and not one session was stopped.
  assert.deepEqual(vault.calls, []);
  assert.equal(existsSync(demo.workspacePath), false);
});

test('reset rebuilds the workspace from the bundled copy, dated to today', async () => {
  demoOn();
  pinToday('2026-07-25');
  const { root, assets } = install();
  const { demo, vault } = service(assets);

  // What the last demo left behind: a note nobody bundled, a session folder,
  // the per-vault database, the search index and a run receipt.
  const workspace = demo.workspacePath;
  mkdirSync(join(workspace, 'notes'), { recursive: true });
  writeFileSync(join(workspace, 'notes', 'left-over.md'), '---\ntype: note\n---\n');
  mkdirSync(join(userData, 'sessions'), { recursive: true });
  writeFileSync(join(userData, 'sessions', 'run.jsonl'), '{}\n');
  writeFileSync(join(userData, appDbBasename(workspace)), 'db');
  writeFileSync(join(userData, 'index.db'), 'index');

  await demo.reset();

  // The bundled note is back and every date in it moved eight days.
  const note = readFileSync(join(workspace, 'notes', 'a.md'), 'utf8');
  assert.match(note, /date: 2026-07-25/);
  assert.match(note, /Written on 2026-07-25\./);
  // Last demo's note is gone, and so is the session folder's contents.
  assert.equal(existsSync(join(workspace, 'notes', 'left-over.md')), false);
  assert.equal(existsSync(join(workspace, 'sessions')), true);
  assert.equal(existsSync(join(workspace, 'sessions', 'old-run')), false);
  // The app state keyed to that workspace is gone with it.
  assert.equal(existsSync(join(userData, appDbBasename(workspace))), false);
  assert.equal(existsSync(join(userData, 'index.db')), false);
  assert.equal(existsSync(join(userData, 'sessions', 'run.jsonl')), false);
  // The renderer's own memory of the last demo, asked for by name.
  assert.deepEqual(cleared.at(-1), { storages: ['localstorage'] });
  // The drag-in files are on the Desktop.
  // and dated like the workspace: the anchor date moved the same eight days.
  assert.equal(
    readFileSync(join(desktop, 'Qale demo files', 'transcript.txt'), 'utf8'),
    'Recorded 2026-07-25.\nAnna: hello\n',
  );
  // In order: sessions stop, the workspace closes, and it only reopens at the end.
  assert.deepEqual(vault.calls, ['disposeAgent', 'dispose', `open ${workspace}`, 'onReset']);

  rmSync(root, { recursive: true, force: true });
  demoOff();
});

test('reset can be told not to reopen, which is what first launch needs', async () => {
  demoOn();
  pinToday('2026-07-25');
  const { root, assets } = install();
  const { demo, vault } = service(assets);
  await demo.reset({ reopen: false });
  assert.deepEqual(vault.calls, ['disposeAgent', 'dispose']);
  assert.equal(existsSync(join(demo.workspacePath, 'notes', 'a.md')), true);
  rmSync(root, { recursive: true, force: true });
  demoOff();
});

test('first launch answers the whole opening, once', async () => {
  demoOn();
  pinToday('2026-07-25');
  const { root, assets } = install();
  const settings = new SettingsService();
  await settings.load();
  const vault = fakeVault();
  const demo = new DemoService({
    settings,
    vaultService: vault.service,
    assetsRoot: assets,
    disposeAgent: () => vault.calls.push('disposeAgent'),
    onReset: () => vault.calls.push('onReset'),
  });

  assert.equal(await demo.firstLaunch(), true);
  assert.equal(settings.get().vaultPath, demo.workspacePath);
  assert.equal(settings.getProvider(), 'anthropic');
  assert.equal(settings.getActiveKey(), 'demo');
  assert.deepEqual(settings.getConnection('atlassian'), {
    providerId: 'atlassian',
    fields: {
      siteUrl: 'https://bord.atlassian.net',
      email: 'demo@bord.example',
      apiToken: 'demo',
    },
  });
  // The Google grant is written rather than granted: the demo build has no
  // OAuth client, and the fake answers the token refresh this stands in for.
  const google = settings.getGoogle();
  assert.equal(google?.email, 'demo@bord.example');
  assert.ok(google?.scopes.includes('calendar.events'), 'the grant can write events');
  const onboarding = settings.getOnboarding();
  assert.ok(onboarding.finishedAt, 'the opening is finished, so it never renders');
  assert.equal(onboarding.telemetry, false);

  // A second launch has a workspace on file and takes none of it.
  const before = vault.calls.length;
  assert.equal(await demo.firstLaunch(), false);
  assert.equal(vault.calls.length, before);

  rmSync(root, { recursive: true, force: true });
  demoOff();
});

test('info lists the scenarios the build carries, once the replay server is up', async () => {
  demoOn();
  pinToday('2026-07-25');
  const { root, assets } = install();
  mkdirSync(join(assets, 'demo', 'scenarios'), { recursive: true });
  writeFileSync(
    join(assets, 'demo', 'scenarios', 's1.json'),
    JSON.stringify({
      version: 1,
      id: 's1',
      title: 'The meeting produced actions',
      do: 'Drag the transcript onto the window.',
      conversations: [
        {
          id: 'drop',
          trigger: { kind: 'skill', skill: 'arrival' },
          title: 'Steering',
          turns: [{ text: 'Filed.' }],
        },
      ],
    }),
  );
  const { demo, vault } = service(assets);
  // Before the replay server is up there is nothing to list.
  assert.deepEqual(demo.info().scenarios, []);
  await demo.start();
  try {
    assert.ok(demo.baseUrl, 'the replay server is up');
    assert.deepEqual(demo.info().scenarios, [
      { id: 's1', title: 'The meeting produced actions', do: 'Drag the transcript onto the window.' },
    ]);
    // The list is a reminder, not a choice: a Reset changes nothing about it,
    // and there is no other state for the Settings tab to read.
    await demo.reset();
    assert.deepEqual(vault.calls, ['disposeAgent', 'dispose', `open ${demo.workspacePath}`, 'onReset']);
    assert.deepEqual(Object.keys(demo.info()).sort(), ['anchor', 'enabled', 'scenarios', 'today']);
  } finally {
    await demo.stop();
    rmSync(root, { recursive: true, force: true });
    demoOff();
  }
});

/** A page's local storage, enough of it for the pin seed to run against. */
function fakeStorage(): { store: Map<string, string>; localStorage: unknown } {
  const store = new Map<string, string>();
  return {
    store,
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
}

/** A window that runs what it is given, the way `executeJavaScript` does. */
function fakePage(localStorage: unknown): {
  ran: number;
  contents: { executeJavaScript(code: string): Promise<unknown> };
} {
  const page = {
    ran: 0,
    contents: {
      executeJavaScript: (code: string) => {
        page.ran += 1;
        new Function('localStorage', code)(localStorage);
        return Promise.resolve(undefined);
      },
    },
  };
  return page;
}

test('reset leaves the rail empty, and the reloaded page gets the default pins', async () => {
  demoOn();
  pinToday('2026-07-25');
  const { root, assets } = install();
  const { demo } = service(assets);
  const key = `qale.favorites.v1:${demo.workspacePath}`;

  await demo.reset();
  // Reset cleared local storage, so the page comes back with no pin set at all.
  const { store, localStorage } = fakeStorage();
  const page = fakePage(localStorage);
  await demo.seedPins(page.contents);
  assert.deepEqual(JSON.parse(store.get(key) ?? 'null'), [...DEFAULT_PINS]);

  // Every launch runs it, and only the first one writes: a row the presenter
  // unpins during a demo stays unpinned until the next Reset.
  store.set(key, JSON.stringify(['notes/christmas-season-playbook.md']));
  await demo.seedPins(page.contents);
  assert.deepEqual(JSON.parse(store.get(key) ?? 'null'), ['notes/christmas-season-playbook.md']);
  assert.equal(page.ran, 2);

  rmSync(root, { recursive: true, force: true });
  demoOff();
});

test('every default pin is a page the demo workspace ships, under a place that holds pins', () => {
  const vault = fileURLToPath(new URL('../../../vault-dev/', import.meta.url));
  for (const path of DEFAULT_PINS) {
    assert.ok(existsSync(join(vault, path)), `vault-dev/${path} exists`);
    // Documents read `notes/` and a mirror reads its system's folder. Nothing
    // else holds a row (renderer/lib/pins.ts).
    assert.match(path, /^(notes|tickets\/jira|wikipages\/confluence)\//);
  }
});

test('an ordinary build seeds no pins, because it has no rail of ours to seed', async () => {
  demoOff();
  const { root, assets } = install();
  const { demo } = service(assets);
  const { store, localStorage } = fakeStorage();
  const page = fakePage(localStorage);
  await demo.seedPins(page.contents);
  assert.equal(page.ran, 0);
  assert.equal(store.size, 0);
  rmSync(root, { recursive: true, force: true });
});

test('opening the demo files fills the folder and then opens it', async () => {
  demoOn();
  const { root, assets } = install();
  const { demo } = service(assets);
  await demo.openSamples();
  assert.equal(opened.at(-1), join(desktop, 'Qale demo files'));
  assert.equal(existsSync(join(desktop, 'Qale demo files', 'transcript.txt')), true);
  rmSync(root, { recursive: true, force: true });
  demoOff();
});

/**
 * A sync service that records what was followed and owns no database. `list()`
 * answers from what `setFollow` has been told, the way the real one answers
 * from the per-vault database, so the "the presenter already chose" guard is
 * exercised rather than stubbed out.
 */
function fakeSync(catalogue: Record<string, string[]>): {
  followed: string[];
  refreshed: string[];
  service: never;
} {
  const followed: string[] = [];
  const refreshed: string[] = [];
  const service = {
    refreshContainers: async (connectionId: string) => {
      refreshed.push(connectionId);
      return (catalogue[connectionId] ?? []).map((id) => ({ id }));
    },
    setFollow: async (connectionId: string, containerId: string, on: boolean) => {
      const row = `${connectionId}:${containerId}`;
      if (on) followed.push(row);
      else followed.splice(followed.indexOf(row), 1);
    },
    list: () =>
      Object.entries(catalogue).map(([id, ids]) => ({
        id,
        containers: ids.map((c) => ({ id: c, followed: followed.includes(`${id}:${c}`) })),
      })),
  };
  return { followed, refreshed, service: service as never };
}

/** The two fixtures `start()` reads, cut down to what the fakes need to load. */
function writeFixtures(assets: string): void {
  mkdirSync(join(assets, 'demo', 'scenarios'), { recursive: true });
  writeFileSync(
    join(assets, 'demo', 'atlassian-fixture.json'),
    JSON.stringify({
      anchor: ANCHOR,
      siteUrl: 'https://bord.atlassian.net',
      self: { accountId: 'a1', displayName: 'Demo', emailAddress: 'demo@bord.example' },
      projects: [
        { id: '10000', key: 'BOK', name: 'Bookings' },
        { id: '10001', key: 'GST', name: 'Guest' },
        { id: '10002', key: 'PAY', name: 'Payments' },
      ],
      spaces: [{ id: '65537', key: 'PROD', name: 'Product' }],
      issues: [],
      pages: [],
    }),
  );
  writeFileSync(
    join(assets, 'demo', 'google-fixture.json'),
    JSON.stringify({
      anchor: ANCHOR,
      timeZone: 'Europe/Stockholm',
      self: { email: 'demo@bord.example', name: 'Demo' },
      calendars: [
        {
          id: 'demo@bord.example',
          summary: 'Demo user',
          primary: true,
          accessRole: 'owner',
          timeZone: 'Europe/Stockholm',
        },
      ],
      events: [],
    }),
  );
}

/** What the fakes list: one calendar, three projects and one space. */
const CATALOGUE = {
  'google-calendar': ['demo@bord.example'],
  atlassian: ['BOK', 'GST', 'PAY', 'PROD'],
};

test('the demo follows the calendar, the projects and the space, once', async () => {
  demoOn();
  pinToday('2026-07-25');
  const { root, assets } = install();
  writeFixtures(assets);
  const { demo } = service(assets);
  await demo.start();
  try {
    const sync = fakeSync(CATALOGUE);
    await demo.followSources(sync.service);
    // Every container the fakes serve. Without the four Atlassian ones a ticket
    // card is refused: the workspace follows no tracker project.
    assert.deepEqual(sync.followed, [
      'google-calendar:demo@bord.example',
      'atlassian:BOK',
      'atlassian:GST',
      'atlassian:PAY',
      'atlassian:PROD',
    ]);
    // A second call changes nothing: what the presenter unfollowed during a
    // demo stays unfollowed until the next Reset.
    const before = [...sync.followed];
    await demo.followSources(sync.service);
    assert.deepEqual(sync.followed, before);
  } finally {
    await demo.stop();
    rmSync(root, { recursive: true, force: true });
    demoOff();
  }
});

test('an ordinary build follows nothing, because there is nothing to follow', async () => {
  demoOff();
  const { root, assets } = install();
  const { demo } = service(assets);
  const sync = fakeSync(CATALOGUE);
  await demo.followSources(sync.service);
  assert.deepEqual(sync.followed, []);
  assert.deepEqual(sync.refreshed, []);
  rmSync(root, { recursive: true, force: true });
});
