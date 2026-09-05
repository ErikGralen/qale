/**
 * Everything the demo build does on its own (docs/demo-mode.md DM-2, DM-7, DM-9).
 *
 * The demo build is the real product with three things swapped underneath it:
 * the model answers from recordings, Jira and Confluence answer from a fixture,
 * and the workspace is a copy of `vault-dev/` dated to today. This service owns
 * the third one, plus the first launch and the Reset that returns the install to
 * the start of the script.
 *
 * Nothing here runs in an ordinary build. Every caller is behind `isDemoBuild()`,
 * and `enabled` says so again for the renderer.
 */
import { app, session, shell } from 'electron';
import { is } from '@electron-toolkit/utils';
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  ANCHOR,
  appDbBasename,
  copyVault,
  daysBetween,
  shiftVaultDates,
  validateVault,
} from '@qale/domain/demo';
import type { FetchLike } from '@qale/connectors';
import { isDemoBuild } from '../build-env.js';
import type { SettingsService } from '../services/settings-service.js';
import type { VaultService } from '../services/vault-service.js';
import { createFakeAtlassian, type DemoStep, type FakeAtlassian } from './fake-atlassian.js';
import { startReplayServer, type ReplayServer } from './replay-server.js';

/** The provider whose REST calls the fake answers. Its id is in the registry. */
const ATLASSIAN_PROVIDER = 'atlassian';

/** The site the `vault-dev/` mirrors already name. It does not exist. */
const DEMO_SITE_URL = 'https://tavla.atlassian.net';

/** Where the drag-in material lands so the presenter can find it. */
const SAMPLES_FOLDER = 'Qale demo files';

export interface DemoInfo {
  enabled: boolean;
  /** The day the workspace is dated to, YYYY-MM-DD. */
  today: string;
  /** The day `vault-dev/` is written around, YYYY-MM-DD. */
  anchor: string;
  steps: DemoStep[];
}

export interface DemoServiceOptions {
  settings: SettingsService;
  vaultService: VaultService;
  /** Where the bundled material is. Resolved from the build when not given. */
  assetsRoot?: string;
  /** Stop every live session and drop the model runtime before files move. */
  disposeAgent: () => void;
  /** Repaint: push the settings and workspace events, reload the window. */
  onReset: () => void;
}

export class DemoService {
  private fake: FakeAtlassian | null = null;
  private replay: ReplayServer | null = null;
  private readonly assets: string;

  constructor(private readonly opts: DemoServiceOptions) {
    this.assets = opts.assetsRoot ?? assetsRoot();
  }

  /** False in every ordinary build, which is what empties the Settings section. */
  get enabled(): boolean {
    return isDemoBuild();
  }

  /** The workspace the demo opens. One folder, replaced whole by every Reset. */
  get workspacePath(): string {
    return join(app.getPath('userData'), 'workspace');
  }

  /**
   * The day the demo is dated to. A dev run can pin it (`QALE_DEMO_TODAY`) to
   * prove the shift holds on another day; a packaged build never reads it, like
   * every other QALE_* variable.
   */
  today(): string {
    const pinned = is.dev ? process.env['QALE_DEMO_TODAY'] : undefined;
    if (pinned && /^\d{4}-\d{2}-\d{2}$/.test(pinned)) return pinned;
    return new Date().toISOString().slice(0, 10);
  }

  /** How far every date in the vault, the fixture and the recordings slides. */
  dateOffsetDays(): number {
    return daysBetween(ANCHOR, this.today());
  }

  /** `http://127.0.0.1:<port>`, or null if the replay server did not start. */
  get baseUrl(): string | null {
    return this.replay?.baseUrl ?? null;
  }

  /**
   * The fake Jira and Confluence, as SyncService asks for it: one provider is
   * answered from the fixture and every other provider is left alone.
   */
  readonly fetchImplFor = (providerId: string): FetchLike | undefined =>
    providerId === ATLASSIAN_PROVIDER ? this.fake?.fetchImpl : undefined;

  /**
   * Start the two fakes. Called once, before the agent is configured, because
   * the agent's `baseUrl` is read when it is configured and not again.
   *
   * Neither failure is fatal. A demo build with no recordings yet is still worth
   * launching: the vault, Reset and the Settings section all work, and the model
   * calls simply fail the way they would with a dead key.
   */
  async start(): Promise<void> {
    if (!this.enabled) return;
    const record = is.dev && process.env['QALE_DEMO_RECORD'] === '1';
    try {
      this.replay = await startReplayServer({
        mode: record ? 'record' : 'replay',
        recordingsDir: join(this.assets, 'demo', 'recordings'),
        dateOffsetDays: this.dateOffsetDays(),
        // In record mode the stored key is the real one and the requests go
        // upstream. In replay mode the stored key is the word "demo" and the
        // server ignores it.
        ...(record ? { upstreamApiKey: this.opts.settings.getActiveKey() ?? '' } : {}),
      });
      console.log(
        `[qale] demo: replay server (${record ? 'record' : 'replay'}) on ${this.baseUrl}`,
      );
    } catch (err) {
      console.error('[qale] demo: the replay server did not start:', err);
    }
    try {
      this.fake = createFakeAtlassian({
        fixturePath: join(this.assets, 'demo', 'atlassian-fixture.json'),
        statePath: join(app.getPath('userData'), 'demo', 'atlassian.json'),
        dateOffsetDays: this.dateOffsetDays(),
        siteUrl: DEMO_SITE_URL,
      });
    } catch (err) {
      console.error('[qale] demo: the fake Atlassian did not start:', err);
    }
  }

  async stop(): Promise<void> {
    await this.replay?.close().catch(() => {});
    this.replay = null;
  }

  /** What the Demo section in Settings draws. */
  info(): DemoInfo {
    if (!this.enabled) return { enabled: false, today: this.today(), anchor: ANCHOR, steps: [] };
    return { enabled: true, today: this.today(), anchor: ANCHOR, steps: this.steps() };
  }

  steps(): DemoStep[] {
    try {
      return this.fake?.steps() ?? [];
    } catch (err) {
      console.error('[qale] demo: could not read the scripted steps:', err);
      return [];
    }
  }

  /** Apply one scripted change to the fake tracker. Unknown ids do nothing. */
  applyStep(id: string): DemoStep[] {
    try {
      this.fake?.applyStep(id);
    } catch (err) {
      console.error(`[qale] demo: step "${id}" failed:`, err);
    }
    return this.steps();
  }

  /**
   * First launch of a demo build (DM-2). The opening asks for a workspace, a
   * key, a name and connections; in this build all four are known, so it is
   * answered here rather than shown.
   *
   * The guard is a settings file with no workspace in it. A second launch, and
   * every launch after a Reset, has one and takes none of this.
   */
  async firstLaunch(): Promise<boolean> {
    if (!this.enabled) return false;
    const settings = this.opts.settings;
    if (settings.get().vaultPath) return false;
    console.log('[qale] demo: first launch — building the workspace');
    // Nothing is open yet, so nothing is reopened: onReady opens the workspace
    // from `vaultPath` a few lines later.
    await this.reset({ reopen: false });
    await settings.setProvider('anthropic');
    // Any non-empty key gets past the "no key, nothing can run" gate; the replay
    // server never looks at it.
    await settings.setKey('anthropic', 'demo');
    await settings.setConnection(ATLASSIAN_PROVIDER, ATLASSIAN_PROVIDER, {
      siteUrl: DEMO_SITE_URL,
      email: 'demo@tavla.example',
      apiToken: 'demo',
    });
    // Finished, on the last screen, consent off. Telemetry stays off in a demo
    // build whatever this says (see telemetry.ts), but the switch should read
    // the way the build behaves.
    await settings.patchOnboarding({ finished: true, step: 'telemetry', telemetry: false });
    await settings.setVaultPath(this.workspacePath);
    return true;
  }

  /**
   * Reset the demo (DM-9): back to the start of the script, dated today.
   *
   * The order is the point. Live sessions and the open workspace hold the files
   * and the database this is about to delete, so both let go first, and the
   * workspace is only reopened once everything underneath it is new.
   */
  async reset(opts: { reopen?: boolean } = {}): Promise<void> {
    if (!this.enabled) return;
    const reopen = opts.reopen ?? true;
    const workspace = this.workspacePath;
    const offset = this.dateOffsetDays();

    // 1. Every running turn stops, and the model runtime goes with it.
    this.opts.disposeAgent();
    // 2. The workspace closes: the watcher, the search index and the per-vault
    //    database all have the files open.
    await this.opts.vaultService.dispose().catch((err) => {
      console.error('[qale] demo: could not close the workspace:', err);
    });
    // 3. The workspace is replaced whole, then dated to today. Deleting the
    //    folder also takes the git history the app wrote into it.
    rmSync(workspace, { recursive: true, force: true });
    const source = join(this.assets, 'vault-dev');
    copyVault(source, workspace);
    const shifted = shiftVaultDates(workspace, offset);
    console.log(
      `[qale] demo: dated to ${this.today()} (${offset >= 0 ? '+' : ''}${offset} days), ` +
        `${shifted.fm} frontmatter and ${shifted.body} prose date(s) in ${shifted.filesTouched} file(s).`,
    );
    // 4. Validate, and only warn. A broken link makes one backlink miss; it is
    //    not a reason to leave the presenter with no workspace at all.
    const { unresolved, untyped } = validateVault(workspace);
    if (untyped.length > 0)
      console.warn(`[qale] demo: ${untyped.length} file(s) have no type: ${untyped.join(', ')}`);
    if (unresolved.length > 0)
      console.warn(
        `[qale] demo: ${unresolved.length} unresolved wikilink(s): ${unresolved.join(', ')}`,
      );
    // 5. The app state keyed to that workspace: the per-vault database (cards,
    //    proposals, questions), the search index, and the run receipts.
    this.clearAppState(workspace);
    // 6. The renderer's own memory of the last demo: open tabs, pins, drafts.
    await session.defaultSession
      .clearStorageData({ storages: ['localstorage'] })
      .catch((err) => console.error('[qale] demo: could not clear local storage:', err));
    // 7. The two fakes forget what the last demo did to them.
    try {
      this.fake?.reset();
    } catch (err) {
      console.error('[qale] demo: could not reset the fake Atlassian:', err);
    }
    this.replay?.reset();
    // 8. The files he drags in, where he can find them.
    this.copySamples(true);

    if (reopen) {
      try {
        await this.opts.vaultService.open(workspace);
      } catch (err) {
        console.error('[qale] demo: could not reopen the workspace:', err);
      }
      this.opts.onReset();
    }
  }

  /** Put the demo files on the Desktop and open the folder. */
  async openSamples(): Promise<void> {
    const dest = this.copySamples(false);
    if (!dest) return;
    const error = await shell.openPath(dest);
    if (error) console.error(`[qale] demo: could not open ${dest}: ${error}`);
  }

  /**
   * Copy `demo-samples/` to the Desktop. `overwrite` replaces whatever is there,
   * which is what Reset wants; "Open demo files" only fills a gap, so a file he
   * renamed between two demos survives.
   */
  private copySamples(overwrite: boolean): string | null {
    const source = join(this.assets, 'demo-samples');
    const dest = join(app.getPath('desktop'), SAMPLES_FOLDER);
    try {
      if (!existsSync(source)) return null;
      if (overwrite) rmSync(dest, { recursive: true, force: true });
      if (!existsSync(dest)) cpSync(source, dest, { recursive: true });
      return dest;
    } catch (err) {
      console.error('[qale] demo: could not copy the demo files to the Desktop:', err);
      return null;
    }
  }

  /**
   * The app state a workspace rebuild cannot reach, because none of it lives in
   * the workspace: the per-vault database, the shared search index and the pi
   * session files. The same three `scripts/refresh-demo.ts` clears.
   */
  private clearAppState(workspace: string): void {
    const dir = app.getPath('userData');
    const rm = (p: string): void => rmSync(p, { force: true });
    const db = appDbBasename(workspace);
    for (const suffix of ['', '-shm', '-wal']) {
      rm(join(dir, db + suffix));
      rm(join(dir, `index.db${suffix}`));
    }
    const sessionsDir = join(dir, 'sessions');
    if (!existsSync(sessionsDir)) return;
    for (const f of readdirSync(sessionsDir)) {
      if (f.endsWith('.jsonl')) rm(join(sessionsDir, f));
    }
  }
}

/**
 * Where the bundled demo material lives: `vault-dev/`, `demo-samples/` and
 * `demo/` (the recordings and the Atlassian fixture).
 *
 * A packaged build carries them as `extraResources`, so they sit beside the app
 * under `Contents/Resources/demo-assets`. A dev run reads them straight out of
 * the repo, which is found by walking up from the app until a folder holds
 * `vault-dev/` — the same folder `pnpm refresh-demo` reads.
 */
function assetsRoot(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'demo-assets');
  const fromApp = repoRoot(app.getAppPath());
  if (fromApp) return fromApp;
  const fromHere = repoRoot(dirname(new URL(import.meta.url).pathname));
  if (fromHere) return fromHere;
  console.error('[qale] demo: no vault-dev/ above this build — the demo has no material to copy.');
  return app.getAppPath();
}

/** The nearest folder at or above `start` that holds `vault-dev/`. */
function repoRoot(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'vault-dev'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Exported for the tests. Nothing in the app resolves a path a second way. */
export { repoRoot };
