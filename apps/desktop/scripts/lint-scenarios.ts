/**
 * `pnpm demo:lint`: every scenario script run headless (docs/plan-demo-replay.md,
 * section 4.8).
 *
 * A script says what the assistant says and which tools it calls. The tools are
 * real, so a script goes stale the moment a tool name, an argument schema or a
 * line of the seed vault moves. This finds that out before demo day instead of
 * in front of an audience.
 *
 * What it does, per scenario and per offset:
 *
 * 1. Shape. The file parses, `validateScenario` passes, every trigger names a
 *    skill that resolves, every tool is one the session really has, every
 *    `input` passes that tool's TypeBox schema, and every `{{template}}`
 *    resolves.
 * 2. Workspace. A temp copy of `vault-dev/` dated to the offset, opened the way
 *    `VaultService.open` opens one, with the fake Atlassian and the fake Google
 *    Calendar behind it and one sync run, so the calendar mirrors are on disk.
 *    The same state `DemoService.reset` leaves behind.
 * 3. Run. Every turn of every conversation, in order, through the real tools.
 *    A refusal or a throw is an error naming the scenario, the conversation,
 *    the turn, the tool and what came back. Then every send the conversation
 *    drafted is approved through the real accept path, with one sync run after
 *    each the way the demo build runs one, because a card the PM cannot approve
 *    is the demo failing in front of the audience.
 * 4. Order. Every scenario through one `ScriptEngine` twice, forwards and
 *    backwards, with a reset between, to prove `reset()` leaves no binding
 *    behind.
 * 5. Sequence. The presenter presses Reset once and then runs any subset of
 *    the scenarios in any order, with no reset between. So: four orders, and
 *    for each one workspace at offset 0, one engine with nothing pinned, and
 *    every scenario's conversations routed through the engine by what the
 *    presenter does (the kickoff, or the `do` line typed under the skill in
 *    force) and run through the real tools, one after the other. A wrong
 *    binding or a tool that fails because an earlier scenario changed the
 *    workspace is an error naming the order.
 *
 * No Electron and no model: the cheap calls are answered by the same rules the
 * demo build answers them with (`cheap-answers.ts`).
 *
 *   pnpm demo:lint
 *   pnpm demo:lint --scenario s1
 *   pnpm demo:lint --offsets 0,12,65 --dir demo/scenarios
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Value } from 'typebox/value';
import type { TSchema } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { ANCHOR, appDbBasename, copyVault, shiftVaultDates } from '@qale/domain/demo';
import { runnableCandidates } from '@qale/domain';
import { AppDb, FsVault, GitAdapter, SqliteIndex } from '@qale/vault';
import {
  approveProposal,
  migrateProductPagesToAbout,
  migrateRunnableFolders,
  migrateThemesToResearch,
  openVault,
  type UseCaseContext,
} from '@qale/application';
import { CONNECTOR_PROVIDERS, type FetchLike } from '@qale/connectors';
import {
  BASE_SKILL_NAME,
  DEFAULT_SKILL_BY_NAME,
  SessionHarness,
  buildKickoff,
  buildSkillBrief,
  isBaseSkillName,
  parseRunnable,
  type Runnable,
} from '@qale/sessions';
import {
  CHILD_PREAMBLE,
  createAskTool,
  createCheckClaimsTool,
  createDeferralTool,
  createDraftTools,
  createEndQuietlyTool,
  createFilingTools,
  createProposeTools,
  createReadTools,
  createSessionFileTools,
  createTextTools,
  createTrackTools,
  createUseSkillTool,
  createVaultTools,
  createVoiceGate,
  createWithdrawTool,
  listLoadableSkills,
  listVoices,
  sessionFilesRoot,
  toolNamesFor,
  withDecodedArgs,
  writeSessionFile,
  type AgentConnection,
} from '@qale/agent';
import { cheapAnswer, type CheapContext } from '../src/main/demo/cheap-answers.js';
import { createFakeAtlassian } from '../src/main/demo/fake-atlassian.js';
import { createFakeGoogleCalendar } from '../src/main/demo/fake-google-calendar.js';
import { shiftDay } from '../src/main/demo/replay-dates.js';
import type { WireMessage } from '../src/main/demo/replay-recordings.js';
import { ScriptEngine } from '../src/main/demo/script-engine.js';
import { expandTable, expandText, renderTurn } from '../src/main/demo/script-templates.js';
import {
  turnText,
  validateScenario,
  type Conversation,
  type Scenario,
  type ToolCall,
} from '../src/main/demo/scenario.js';
import { sourceName } from '../src/main/source-name.js';
import { agentConnections } from '../src/main/services/agent-connections.js';
import { makeOutbound, outboundConnections } from '../src/main/services/outbound-service.js';
import { SyncService } from '../src/main/services/sync-service.js';
import type { GoogleOAuthService } from '../src/main/services/google-oauth-service.js';
import type { SettingsService } from '../src/main/services/settings-service.js';

/** The site and the account the `vault-dev/` mirrors name. Neither exists. */
const DEMO_SITE_URL = 'https://rota.atlassian.net';
const DEMO_ACCOUNT_EMAIL = 'demo@rota.example';
const ATLASSIAN_PROVIDER = 'atlassian';
const GOOGLE_PROVIDER = 'google-calendar';

/** The three days the date-shift fix was proved on. */
const DEFAULT_OFFSETS = [0, 12, 65];

/**
 * The orders the sequence pass runs the scenarios in: forwards, backwards, and
 * two fixed shuffles. Fixed, so a failure is the same failure tomorrow.
 */
const SEQUENCE_ORDERS = [
  ['s1', 's2', 's3', 's4', 's5'],
  ['s5', 's4', 's3', 's2', 's1'],
  ['s4', 's2', 's5', 's1', 's3'],
  ['s3', 's5', 's1', 's4', 's2'],
];

/** The line every session's system prompt opens with, as far as the engine reads it. */
const SESSION_SYSTEM = 'You are Qale, working inside a workspace of notes.';

/**
 * A tool result that begins with one of these is a failure, whatever it says
 * after. Every one of them is a sentence the model is meant to read and correct
 * itself from, which a script cannot do: the turn after it was written against
 * the result the author expected.
 */
const FAILURE_PREFIXES = [
  'Rejected',
  'Refused',
  'Not withdrawn',
  'Not proposed',
  'Not found',
  'No skill named',
  'cannot read',
  'Unknown',
];

/** A drafting tool that worked says this. Anything else means no card was made. */
const AWAITING = 'Awaiting approval';

/** The drafting tools, which must always end in a card the PM approves. */
const DRAFTING = new Set([
  'draft_ticket',
  'draft_ticket_comment',
  'draft_page_update',
  'draft_calendar_event',
  'draft_calendar_reschedule',
  'draft_calendar_rsvp',
]);

export interface LintOptions {
  /** Where the scripts are. Absolute, or relative to the repo root. */
  dir: string;
  /** Only this scenario id. */
  scenario?: string;
  /** Days from the anchor to run at. */
  offsets: number[];
  /** The folder holding `vault-dev/`, `demo/` and `demo-samples/`. */
  repoRoot: string;
  /**
   * Also run the engine over every scenario in two orders, and the sequence
   * pass over every scenario in four orders with no reset between. Off for
   * one file.
   */
  engineCheck?: boolean;
}

/** One thing the lint found, with enough address to fix it. */
export interface Finding {
  scenario: string;
  offset: number;
  /** `drop turn 2 propose_update`, or as much of it as is known. */
  where: string;
  message: string;
}

export interface LintReport {
  errors: Finding[];
  warnings: Finding[];
  /** The whole report as it was printed, line by line. */
  lines: string[];
  scenarios: number;
}

// ---------------------------------------------------------------------------
// The workspace, built the way DemoService.reset builds it
// ---------------------------------------------------------------------------

export interface Workspace {
  root: string;
  path: string;
  ctx: UseCaseContext;
  connections: AgentConnection[];
  sync: SyncService;
  /** One sync run at the demo day's clock, the way the demo build runs one
   *  after every approved card. */
  tick: () => Promise<void>;
  containers: () => ReturnType<SyncService['outboundContainers']>;
  close(): void;
}

/**
 * Build one workspace at `offset`: `vault-dev/` copied and dated, opened with
 * the ports `VaultService.open` opens one with, the two fakes behind the
 * connectors, and one sync run so the calendar mirrors exist.
 *
 * The demo day is the anchor plus the offset. The sync reads the wall clock for
 * its window, so the clock is moved to that day while the tick runs. A lint at
 * offset 12 is asking what the demo looks like on the anchor's twelfth day, and
 * a window around the real today would pull an empty week.
 */
export async function buildWorkspace(repoRoot: string, offset: number): Promise<Workspace> {
  const root = mkdtempSync(join(tmpdir(), 'qale-demo-lint-'));
  const path = join(root, 'workspace');
  copyVault(join(repoRoot, 'vault-dev'), path);
  shiftVaultDates(path, offset);

  const day = shiftDay(ANCHOR, offset);
  const index = openIndex(join(root, 'index.db'));
  const appDb = new AppDb(join(root, appDbBasename(path)));
  const ctx: UseCaseContext = {
    vault: new FsVault(path),
    index,
    git: new GitAdapter(path),
    clock: { now: () => `${day}T09:00:00.000Z` },
    proposals: appDb.proposals,
    activity: appDb.activity,
    asks: appDb.asks,
    checks: appDb.checks,
  };
  await openVault(ctx);
  await runMigrations(ctx);

  const nowMs = Date.parse(`${day}T12:00:00Z`);
  const atlassian = createFakeAtlassian({
    fixturePath: join(repoRoot, 'demo', 'atlassian-fixture.json'),
    statePath: join(root, 'demo', 'atlassian.json'),
    dateOffsetDays: offset,
    siteUrl: DEMO_SITE_URL,
    now: () => nowMs,
  });
  const google = createFakeGoogleCalendar({
    fixturePath: join(repoRoot, 'demo', 'google-fixture.json'),
    statePath: join(root, 'demo', 'google.json'),
    dateOffsetDays: offset,
    now: () => nowMs,
  });
  const fetchImplFor = (providerId: string): FetchLike | undefined => {
    if (providerId === ATLASSIAN_PROVIDER) return atlassian.fetchImpl;
    if (providerId === GOOGLE_PROVIDER) return google.fetchImpl;
    return undefined;
  };

  // What `DemoService.connectFakes` writes into settings, as a stub: the two
  // credentials and nothing else. Every writer on it is a no-op, because a lint
  // has no settings file to keep.
  const settings = {
    listConnections: () => [{ connectionId: ATLASSIAN_PROVIDER, providerId: ATLASSIAN_PROVIDER }],
    getConnection: (id: string) =>
      id === ATLASSIAN_PROVIDER
        ? {
            providerId: ATLASSIAN_PROVIDER,
            fields: { siteUrl: DEMO_SITE_URL, email: DEMO_ACCOUNT_EMAIL, apiToken: 'demo' },
          }
        : null,
    getGoogle: () => ({ refreshToken: 'demo-refresh-token', email: DEMO_ACCOUNT_EMAIL }),
    setConnection: async () => {},
    clearConnection: async () => {},
    setGoogleEmail: async () => {},
  } as unknown as SettingsService;
  const oauth = {
    getAccessToken: async () => 'demo-access-token',
    ensureWriteScope: async () => {},
    connect: async () => {},
    disconnect: async () => {},
    cancel: () => {},
  } as unknown as GoogleOAuthService;

  ctx.outbound = makeOutbound(
    outboundConnections(settings, oauth, CONNECTOR_PROVIDERS, fetchImplFor),
  );
  const sync = new SyncService(
    () => ctx,
    () => appDb.sync,
    settings,
    oauth,
    () => {},
    CONNECTOR_PROVIDERS,
    fetchImplFor,
  );
  // What `DemoService.followSources` follows after a Reset: the one calendar the
  // fake Google serves, and every project and space the fake Atlassian lists. A
  // ticket card is refused outright while the workspace follows no project, so a
  // lint without this fails every `draft_ticket` in every script.
  await atClock(nowMs, async () => {
    await sync.refreshContainers(GOOGLE_PROVIDER);
    await sync.setFollow(GOOGLE_PROVIDER, google.primaryCalendarId(), true);
    for (const container of await sync.refreshContainers(ATLASSIAN_PROVIDER))
      await sync.setFollow(ATLASSIAN_PROVIDER, container.id, true);
    await sync.tick();
  });

  return {
    root,
    path,
    ctx,
    connections: agentConnections(settings, CONNECTOR_PROVIDERS, fetchImplFor),
    sync,
    tick: () => atClock(nowMs, () => sync.tick()),
    containers: () => sync.outboundContainers(),
    close: () => {
      index.close();
      appDb.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * The three one-time migrations `afterOpen` runs on every workspace it opens
 * (`handlers.ts`), in that same order. The lint has to run them too: a script
 * names paths, and a migration that moves a page renames the path the script
 * names. Without this the lint would pass on a seed the app rewrites the moment
 * it opens it, which is how `themes/` outlived its own move.
 *
 * On a seed the migrations have nothing left to do they write nothing, and
 * `migrations.test.ts` holds them to that.
 */
export async function runMigrations(ctx: UseCaseContext): Promise<void> {
  await migrateRunnableFolders(ctx);
  await migrateThemesToResearch(ctx);
  await migrateProductPagesToAbout(ctx);
}

/**
 * The search index, with the one failure a developer machine actually hits said
 * in words. `better-sqlite3` is native and loads under one ABI only, so a run
 * under the wrong runtime cannot open the index at all. `pnpm demo:lint` picks
 * the runtime that fits the build in this working copy (see
 * `scripts/run-with-sqlite.ts`), so this is reached only when neither node nor
 * Electron can load the module. The sqlite tests skip themselves over an ABI
 * mismatch; the lint cannot, because the index resolves every path a script
 * names.
 */
function openIndex(path: string): SqliteIndex {
  try {
    return new SqliteIndex(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ERR_DLOPEN_FAILED') throw err;
    throw new Error(
      `better-sqlite3 will not load in this runtime (node ${process.versions.node}` +
        `${process.versions.electron ? `, Electron ${process.versions.electron}` : ''}), ` +
        'so the lint cannot open the search index.\n' +
        'Run `pnpm install` in the repo root, then `pnpm demo:lint` again.',
    );
  }
}

/** Run `fn` with `Date.now` pinned to `ms`, whatever it does. */
async function atClock(ms: number, fn: () => Promise<void>): Promise<void> {
  const real = Date.now;
  Date.now = () => ms;
  try {
    await fn();
  } finally {
    Date.now = real;
  }
}

// ---------------------------------------------------------------------------
// The session, built the way AgentRuntime.createSession builds one
// ---------------------------------------------------------------------------

/** The skill file the workspace holds, else the built-in default. */
async function resolveSkill(ctx: UseCaseContext, name: string): Promise<Runnable> {
  let raw: string | null = null;
  for (const path of runnableCandidates(name)) {
    raw = await ctx.vault.readRaw(path);
    if (raw !== null) break;
  }
  return parseRunnable(raw ?? DEFAULT_SKILL_BY_NAME[name] ?? '', name);
}

export interface SessionTools {
  /** Every tool the session registered, by name. */
  registry: Map<string, ToolDefinition>;
  /**
   * The ones the skills in force turn on RIGHT NOW. Asked per call, not once:
   * a `use_skill` on turn 0 widens what turn 1 may do, which is the whole point
   * of the tool.
   */
  active(): Set<string>;
}

/**
 * The tool set a conversation really gets: the base skill opens the session and
 * the trigger's skill arrives on top of it, which is what the runtime does for
 * a kickoff and for a skill picked with `/` before typing. So an arrival
 * carries the filing tools and a plain typed Ask does not, and a script that
 * files a source from a typed session fails here.
 */
export async function sessionTools(
  ws: Workspace,
  sessionId: string,
  conversation: Conversation,
  cheap: CheapContext,
): Promise<SessionTools> {
  const ctx = ws.ctx;
  const base = await resolveSkill(ctx, BASE_SKILL_NAME);
  const harness = new SessionHarness(sessionId, base, ctx.clock.now());
  const skill = conversation.trigger.skill;
  if (skill && !isBaseSkillName(skill)) {
    const config = await resolveSkill(ctx, skill);
    if (config.body.trim()) harness.invokeSkill(config);
  }

  const voices = await listVoices(ctx);
  const gate = createVoiceGate(ctx, voices, harness);
  const filesRoot = sessionFilesRoot(ctx.vault.root(), sessionId);
  const canInvokeSkills = (await listLoadableSkills(ctx)).length > 0;
  const tools = withDecodedArgs([
    ...createVaultTools(ctx, harness),
    // Nobody is at the screen, so a question comes back dismissed. The lint
    // warns on `ask_user` separately; this only keeps the turn moving.
    createAskTool({ requestAnswer: async () => ({ answers: null }) }),
    createCheckClaimsTool(
      ctx,
      { match: async (_system, prompt) => cheapAnswer('claim', prompt, cheap) },
      harness,
    ),
    createEndQuietlyTool({ scheduled: () => false, endQuietly: () => {} }),
    createDeferralTool(ctx),
    ...createProposeTools(ctx, sessionId, harness, undefined, () => ({
      pmTurn: true,
      askAnswered: false,
    })),
    createWithdrawTool(ctx, sessionId, harness),
    ...createTextTools(gate),
    ...createDraftTools(ctx, sessionId, harness, gate, ws.containers),
    ...createFilingTools(ctx, harness, filesRoot),
    ...(canInvokeSkills ? [createUseSkillTool(ctx, harness)] : []),
    ...createSessionFileTools(filesRoot),
    ...createReadTools(ws.connections.flatMap((c) => c.readTools)),
    ...createTrackTools(
      (kind, externalId) => ws.sync.trackExternal(kind, externalId),
      (containerId, follow) => ws.sync.answerContainerOffer(containerId, follow),
    ),
  ]);

  const registry = new Map(tools.map((t) => [t.name, t]));
  return {
    registry,
    active: () =>
      new Set(
        toolNamesFor(harness, ws.connections, canInvokeSkills, !!ctx.outbound, false).filter((n) =>
          registry.has(n),
        ),
      ),
  };
}

/**
 * Put the drag-in material in the session folder, the way `arrival:ingest` does
 * it: one file per sample under `source/`, plus the `input.md` manifest. A
 * scripted `file_source` names those paths, and without them it has nothing to
 * file.
 */
export async function seedSessionFiles(repoRoot: string, filesRoot: string): Promise<void> {
  const samples = join(repoRoot, 'demo-samples');
  if (!existsSync(samples)) return;
  const taken = new Set<string>();
  const written: string[] = [];
  for (const name of readdirSync(samples).sort()) {
    if (name === 'README.md') continue;
    const file = `source/${sourceName(name, taken)}`;
    await writeSessionFile(filesRoot, file, readFileSync(join(samples, name), 'utf8'));
    written.push(file);
  }
  await writeSessionFile(
    filesRoot,
    'input.md',
    `# What arrived\n\n${written.map((f) => `- \`${f}\``).join('\n')}\n`,
  );
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

/** Every `{{…}}` in anything a scenario can hold. */
function templatesIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(...(value.match(/\{\{[^}]*\}\}/g) ?? []));
  else if (Array.isArray(value)) for (const v of value) templatesIn(v, out);
  else if (value && typeof value === 'object')
    for (const v of Object.values(value as Record<string, unknown>)) templatesIn(v, out);
  return out;
}

/** The message for a template the engine would leave on screen, or null. */
function templateFault(template: string, offset: number): string | null {
  const resolved = expandText(template, offset);
  if (resolved === template) return `${template} is not a template the engine knows`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resolved)) return `${template} resolves to "${resolved}"`;
  return null;
}

/** The first line of a TypeBox failure, said so a person can fix the file. */
function schemaFaults(schema: TSchema, input: unknown): string[] {
  return Value.Errors(schema, input)
    .slice(0, 4)
    .map((e) => `${e.instancePath || '/'}: ${e.message}`);
}

/** The text a tool handed back, whatever shape the result came in. */
function resultText(result: unknown): string {
  const content = (result as { content?: { text?: unknown }[] })?.content;
  const first = content?.[0]?.text;
  return typeof first === 'string' ? first : '';
}

/** The tools only use (id, params); the rest of pi's signature is unused here. */
function runTool(tool: ToolDefinition, input: unknown): Promise<unknown> {
  const execute = tool.execute as unknown as (
    id: string,
    params: unknown,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  return execute(`toolu_lint_${randomUUID().slice(0, 8)}`, input, undefined);
}

/** Does a `check_claims` call anywhere in the scenario reach this lookup key? */
function claimKeyIsReachable(scenario: Scenario, key: string, offset: number): boolean {
  const table = { [expandText(key, offset)]: 'HIT' };
  for (const conversation of scenario.conversations) {
    for (const turn of conversation.turns) {
      for (const call of renderTurn(turn, offset).tools) {
        if (call.name !== 'check_claims') continue;
        const claims = (call.input as { claims?: { claim?: unknown }[] }).claims ?? [];
        for (const claim of claims) {
          if (typeof claim?.claim !== 'string') continue;
          const answer = cheapAnswer('claim', `Claim: ${claim.claim}`, {
            lookups: { claims: table, summaries: {} },
            titleFor: () => undefined,
          });
          if (answer === 'HIT') return true;
        }
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

interface Loaded {
  id: string;
  file: string;
  scenario?: Scenario;
  /** Why it could not be read at all. */
  fatal?: string[];
}

/** Every `<id>.json` in the folder, parsed and shape-checked but never skipped. */
function loadAll(dir: string, only?: string): Loaded[] {
  if (!existsSync(dir)) return [];
  const out: Loaded[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json') || name.startsWith('_')) continue;
    const id = name.replace(/\.json$/, '');
    const file = join(dir, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      if (!only || id === only) out.push({ id, file, fatal: [`will not parse: ${message(err)}`] });
      continue;
    }
    const { errors } = validateScenario(parsed);
    // `--scenario s1` means the file or the id, because a half-written file may
    // not have a readable id yet.
    const scenario = errors.length === 0 ? (parsed as Scenario) : undefined;
    if (only && id !== only && scenario?.id !== only) continue;
    if (!scenario) {
      out.push({ id, file, fatal: errors });
      continue;
    }
    out.push({ id, file, scenario });
  }
  return out;
}

export async function lintScenarios(opts: LintOptions): Promise<LintReport> {
  const errors: Finding[] = [];
  const warnings: Finding[] = [];
  const lines: string[] = [];
  const dir = resolve(opts.repoRoot, opts.dir);
  const loaded = loadAll(dir, opts.scenario);

  const err = (scenario: string, offset: number, where: string, m: string): void => {
    errors.push({ scenario, offset, where, message: m });
  };
  const warn = (scenario: string, offset: number, where: string, m: string): void => {
    warnings.push({ scenario, offset, where, message: m });
  };

  if (loaded.length === 0) {
    lines.push(`No scenario files in ${dir}.`);
    return { errors, warnings, lines, scenarios: 0 };
  }

  for (const entry of loaded) {
    if (!entry.fatal) continue;
    for (const m of entry.fatal) err(entry.id, 0, 'file', m);
    lines.push(`${entry.id}  unreadable  ${entry.fatal.length} error(s)`);
  }

  const good = loaded.flatMap((l) => (l.scenario ? [l.scenario] : []));

  for (const offset of opts.offsets) {
    if (good.length === 0) break;
    const ws = await buildWorkspace(opts.repoRoot, offset);
    try {
      for (const scenario of good) {
        const wasErrors = errors.length;
        const wasWarnings = warnings.length;
        const counts = await lintScenario(scenario, ws, offset, opts.repoRoot, err, warn);
        const bad = errors.length - wasErrors;
        const soft = warnings.length - wasWarnings;
        const verdict =
          bad === 0 && soft === 0
            ? 'ok'
            : [bad > 0 ? `${bad} error(s)` : '', soft > 0 ? `${soft} warning(s)` : '']
                .filter(Boolean)
                .join(', ');
        lines.push(
          `${pad(scenario.id, 6)}${pad(offsetLabel(offset), 8)}` +
            `${pad(`${counts.conversations} conv`, 9)}${pad(`${counts.turns} turns`, 10)}` +
            `${pad(`${counts.calls} calls`, 10)}${verdict}`,
        );
      }
    } finally {
      ws.close();
    }
  }

  if (opts.engineCheck !== false && good.length > 0) {
    const offset = opts.offsets[0] ?? 0;
    for (const m of engineFindings(good, offset)) err(m.id, offset, 'engine', m.message);
    lines.push(`engine  both orders  ${good.length} scenario(s)`);
    for (const order of sequenceOrders(good)) {
      const wasErrors = errors.length;
      const counts = await lintSequence(good, order, opts.repoRoot, err);
      const bad = errors.length - wasErrors;
      lines.push(
        `${pad('sequence', 10)}${pad(order.join(','), 16)}` +
          `${pad(`${counts.conversations} conv`, 9)}${pad(`${counts.turns} turns`, 10)}` +
          `${pad(`${counts.calls} calls`, 10)}${bad === 0 ? 'ok' : `${bad} error(s)`}`,
      );
    }
  }

  return { errors, warnings, lines, scenarios: good.length };
}

/**
 * The fixed orders, cut to the scenarios that loaded, plus forwards and
 * backwards for a folder whose ids are not `s1` to `s5`.
 */
function sequenceOrders(scenarios: Scenario[]): string[][] {
  const ids = scenarios.map((s) => s.id);
  const known = new Set(ids);
  const fixed = SEQUENCE_ORDERS.map((order) => order.filter((id) => known.has(id))).filter(
    (order) => order.length === ids.length,
  );
  if (fixed.length > 0) return fixed;
  return [ids, [...ids].reverse()];
}

interface Counts {
  conversations: number;
  turns: number;
  calls: number;
}

type Report = (scenario: string, offset: number, where: string, message: string) => void;

/** One scenario, at one offset, against one workspace. */
async function lintScenario(
  scenario: Scenario,
  ws: Workspace,
  offset: number,
  repoRoot: string,
  err: Report,
  warn: Report,
): Promise<Counts> {
  const counts: Counts = { conversations: 0, turns: 0, calls: 0 };
  const cheap = cheapContextOf(scenario, offset);

  // Templates first, everywhere in the file: a lookup key or an `offScript`
  // line with a broken template never reaches a tool, so nothing else would
  // catch it.
  for (const template of new Set(templatesIn(scenario))) {
    const fault = templateFault(template, offset);
    if (fault) err(scenario.id, offset, 'templates', fault);
  }

  for (const key of Object.keys(scenario.lookups?.claims ?? {})) {
    if (!claimKeyIsReachable(scenario, key, offset))
      warn(
        scenario.id,
        offset,
        'lookups.claims',
        `no check_claims call in this scenario reaches "${key}"`,
      );
  }

  for (const conversation of scenario.conversations) {
    counts.conversations += 1;
    const skill = conversation.trigger.skill;
    if (skill && !isBaseSkillName(skill)) {
      const config = await resolveSkill(ws.ctx, skill);
      if (!config.body.trim())
        err(
          scenario.id,
          offset,
          `${conversation.id} trigger`,
          `no skill called "${skill}", so the session would open with none of its permissions`,
        );
    }

    // The `do` line is what the presenter types, so it has to carry one of the
    // words the trigger waits for, or what he is told to do never binds.
    const any = conversation.trigger.any;
    if (any && !any.some((word) => scenario.do.toLowerCase().includes(word.toLowerCase())))
      err(
        scenario.id,
        offset,
        `${conversation.id} trigger`,
        `none of trigger.any (${any.join(', ')}) is in the do line, so what it says to type never binds`,
      );

    // A last turn that calls a tool is not a last turn: the result comes back
    // and pi asks for another one, which is past the end of the script and gets
    // the off-script line.
    const last = conversation.turns[conversation.turns.length - 1];
    if (!last || !turnText(last).trim() || (last.tools ?? []).length > 0)
      warn(
        scenario.id,
        offset,
        conversation.id,
        'the conversation does not end on a text-only turn, so the session runs one more turn into the off-script line',
      );

    const run = await runConversation(
      scenario,
      conversation,
      ws,
      offset,
      repoRoot,
      cheap,
      err,
      warn,
    );
    counts.turns += run.turns;
    counts.calls += run.calls;
  }
  return counts;
}

/**
 * Every tool call of one conversation, in order, against the workspace, the
 * way a real session would make them. Shared by the per-scenario pass and the
 * sequence pass.
 */
async function runConversation(
  scenario: Scenario,
  conversation: Conversation,
  ws: Workspace,
  offset: number,
  repoRoot: string,
  cheap: CheapContext,
  err: Report,
  warn: Report,
  where: (index: number, call: ToolCall) => string = (i, call) =>
    `${conversation.id} turn ${i} ${call.name}`,
): Promise<{ turns: number; calls: number }> {
  const sessionId = randomUUID();
  const tools = await sessionTools(ws, sessionId, conversation, cheap);
  if (conversation.trigger.kind === 'skill')
    await seedSessionFiles(repoRoot, sessionFilesRoot(ws.ctx.vault.root(), sessionId));

  let turns = 0;
  let calls = 0;
  const drafted: { id: string; where: string }[] = [];
  for (const [i, turn] of conversation.turns.entries()) {
    turns += 1;
    const rendered = renderTurn(turn, offset);
    for (const call of rendered.tools) {
      calls += 1;
      const before = new Set(ws.ctx.proposals.list('pending').map((rec) => rec.id));
      await runCall(scenario, where(i, call), call, tools, offset, err, warn);
      for (const rec of ws.ctx.proposals.list('pending'))
        if (rec.kind === 'outbound' && !before.has(rec.id))
          drafted.push({ id: rec.id, where: where(i, call) });
    }
  }
  await approveOutbound(scenario, ws, offset, drafted, err);
  return { turns, calls };
}

/**
 * Approve every send the conversation drafted, one at a time, through the same
 * use case the app's approve button calls, with one sync run after each the way
 * the demo build runs one.
 *
 * A card that is refused never reaches the audience as a ticket or a page: it
 * reaches them as a red box. The drafted-against check is the one that fires
 * here, and it fires on what the sync writes into the mirrors, so nothing but
 * running the approvals in order finds it. The sends land in the fake Jira and
 * the fake Confluence, which is what the demo does too.
 */
async function approveOutbound(
  scenario: Scenario,
  ws: Workspace,
  offset: number,
  drafted: { id: string; where: string }[],
  err: Report,
): Promise<void> {
  for (const { id, where } of drafted) {
    const rec = ws.ctx.proposals.get(id);
    if (!rec) continue;
    const payload = (rec.payload ?? {}) as Record<string, unknown>;
    const card = [payload['action'], payload['targetId'] ?? payload['eventId']]
      .filter(Boolean)
      .join(' ');
    let result;
    try {
      result = await approveProposal(ws.ctx, id, undefined);
    } catch (thrown) {
      err(scenario.id, offset, `${where} approve`, `${card} threw: ${message(thrown)}`);
      continue;
    }
    if (!result.ok)
      err(
        scenario.id,
        offset,
        `${where} approve`,
        `${card} was refused: ${result.error ?? 'no reason given'}`,
      );
    try {
      await ws.tick();
    } catch (thrown) {
      err(
        scenario.id,
        offset,
        `${where} approve`,
        `the sync after ${card} threw: ${message(thrown)}`,
      );
    }
  }
}

/** The cheap-call context one scenario's lookups give. */
export function cheapContextOf(scenario: Scenario, offset: number): CheapContext {
  return {
    lookups: {
      claims: expandTable(scenario.lookups?.claims, offset),
      summaries: expandTable(scenario.lookups?.summaries, offset),
    },
    titleFor: () => undefined,
  };
}

/** One tool call: the name, the schema, the run, and what came back. */
async function runCall(
  scenario: Scenario,
  where: string,
  call: ToolCall,
  tools: SessionTools,
  offset: number,
  err: Report,
  warn: Report,
): Promise<void> {
  const tool = tools.registry.get(call.name);
  if (!tool) {
    err(scenario.id, offset, where, `no tool called "${call.name}"`);
    return;
  }
  if (!tools.active().has(call.name)) {
    err(
      scenario.id,
      offset,
      where,
      `this session does not have "${call.name}": its skill grants no permission for it`,
    );
    return;
  }
  const faults = Value.Check(tool.parameters, call.input)
    ? []
    : schemaFaults(tool.parameters, call.input);
  if (faults.length > 0) {
    err(scenario.id, offset, where, `input does not fit the schema: ${faults.join('; ')}`);
    return;
  }
  if (call.name === 'ask_user')
    warn(
      scenario.id,
      offset,
      where,
      'the next turn is served by index whichever option is picked, so it has to read well for every one',
    );

  let text: string;
  try {
    text = resultText(await runTool(tool, call.input));
  } catch (thrown) {
    err(scenario.id, offset, where, `threw: ${message(thrown)}`);
    return;
  }
  const failed = FAILURE_PREFIXES.find((prefix) =>
    text.toLowerCase().startsWith(prefix.toLowerCase()),
  );
  if (failed) {
    err(scenario.id, offset, where, oneLine(text));
    return;
  }
  if (DRAFTING.has(call.name) && !text.includes(AWAITING))
    err(scenario.id, offset, where, `no card was drafted: ${oneLine(text)}`);
}

// ---------------------------------------------------------------------------
// The engine, in two orders
// ---------------------------------------------------------------------------

/**
 * Every scenario driven through one engine, forwards and then backwards, with
 * a reset between scenarios and nothing pinned, the way one Reset and then one
 * scenario drives it. Each run plays the conversation as a real session would:
 * the first message, then a request per turn carrying the answers so far. Two
 * things have to hold. Every answer comes from the script, and the run before
 * it left no binding behind.
 */
function engineFindings(scenarios: Scenario[], offset: number): { id: string; message: string }[] {
  const out: { id: string; message: string }[] = [];
  const engine = new ScriptEngine({ offsetDays: offset, fallbackText: 'off script' });
  engine.load(scenarios);
  const forwards = [...scenarios];
  const backwards = [...scenarios].reverse();

  for (const order of [forwards, backwards]) {
    let previous: string | null = null;
    for (const scenario of order) {
      engine.reset();
      if (previous && engine.boundTo(previous))
        out.push({
          id: scenario.id,
          message: `a binding from the run before survived reset() ("${oneLine(previous)}")`,
        });
      for (const conversation of scenario.conversations) {
        const first = openingFor(scenario, conversation);
        previous = first;
        const system = systemFor(conversation, briefLine(conversation));
        for (const m of playThrough(engine, scenario, conversation, first, system, offset))
          out.push({ id: scenario.id, message: m });
      }
    }
  }
  return out;
}

/**
 * One conversation through the engine, turn by turn, as the requests a real
 * session sends. Returns what went wrong: a turn that did not come from the
 * script, one served with the wrong text, or an opening bound elsewhere.
 */
function playThrough(
  engine: ScriptEngine,
  scenario: Scenario,
  conversation: Conversation,
  first: string,
  system: string,
  offset: number,
): string[] {
  const out: string[] = [];
  const messages: WireMessage[] = [{ role: 'user', content: first }];
  for (const [i, turn] of conversation.turns.entries()) {
    const served = engine.answer({ system, messages });
    const wanted = renderTurn(turn, offset).text;
    if (i === 0) {
      const bound = engine.boundTo(first);
      if (bound && (bound.scenarioId !== scenario.id || bound.conversationId !== conversation.id))
        out.push(
          `${conversation.id} bound to ${bound.scenarioId}/${bound.conversationId} instead ("${oneLine(first)}")`,
        );
    }
    if (served.source !== 'script')
      out.push(`${conversation.id} turn ${i} came back as "${served.source}", not the script`);
    else {
      const got = served.response.content.find((b) => b.type === 'text')?.text ?? '';
      if (got !== wanted) out.push(`${conversation.id} turn ${i} served the wrong text`);
    }
    messages.push({ role: 'assistant', content: served.response.content });
    messages.push({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_lint', content: 'ok' }],
    });
  }
  return out;
}

/**
 * The first message the presenter's action sends for this conversation: the
 * kickoff the app composes for a skill, or the `do` line for anything typed,
 * because that line is what he is told to type. The conversation id is added
 * so two typed conversations in one scenario are two openings.
 */
function openingFor(scenario: Scenario, conversation: Conversation): string {
  if (conversation.trigger.kind === 'skill')
    return buildKickoff({
      skill: conversation.trigger.skill ?? BASE_SKILL_NAME,
      instruction: `Lint run for ${conversation.id}.`,
    });
  return `${scenario.do} [${conversation.id}]`;
}

/**
 * A system prompt the engine classifies the way it would a real one: the
 * child preamble for a child, else the session prompt with the brief of the
 * skill in force appended, which is what the runtime does when `/` picked one.
 */
function systemFor(conversation: Conversation, brief: string): string {
  if (conversation.trigger.kind === 'child') return CHILD_PREAMBLE;
  return brief ? `${SESSION_SYSTEM}\n\n${brief}` : SESSION_SYSTEM;
}

/** The brief line for a typed conversation's skill, with no workspace to read the file from. */
function briefLine(conversation: Conversation): string {
  const skill = conversation.trigger.skill;
  if (conversation.trigger.kind !== 'typed' || !skill || isBaseSkillName(skill)) return '';
  return buildSkillBrief(parseRunnable(DEFAULT_SKILL_BY_NAME[skill] ?? '', skill));
}

// ---------------------------------------------------------------------------
// The sequence: one Reset, then every scenario in one order, no reset between
// ---------------------------------------------------------------------------

/**
 * One workspace at offset 0, one engine with nothing pinned, and every
 * scenario's conversations in `order`: each opening goes through the engine
 * the way a real session's first request does, has to bind to its own
 * conversation, and then every tool call runs against the workspace the
 * earlier scenarios already wrote into. Errors carry the order. Warnings are
 * not repeated here: the per-scenario pass already said them once.
 */
async function lintSequence(
  scenarios: Scenario[],
  order: string[],
  repoRoot: string,
  err: Report,
): Promise<Counts> {
  const warn: Report = () => {};
  const offset = 0;
  const counts: Counts = { conversations: 0, turns: 0, calls: 0 };
  const label = `order ${order.join(',')}`;
  const engine = new ScriptEngine({ offsetDays: offset, fallbackText: 'off script' });
  engine.load(scenarios);
  const ws = await buildWorkspace(repoRoot, offset);
  try {
    for (const id of order) {
      const scenario = scenarios.find((s) => s.id === id);
      if (!scenario) continue;
      const cheap = cheapContextOf(scenario, offset);
      for (const conversation of scenario.conversations) {
        counts.conversations += 1;
        const first = openingFor(scenario, conversation);
        const brief = await realBrief(ws, conversation);
        const system = systemFor(conversation, brief);
        for (const m of playThrough(engine, scenario, conversation, first, system, offset))
          err(scenario.id, offset, `${label} engine`, m);
        const run = await runConversation(
          scenario,
          conversation,
          ws,
          offset,
          repoRoot,
          cheap,
          err,
          warn,
          (i, call) => `${label} ${conversation.id} turn ${i} ${call.name}`,
        );
        counts.turns += run.turns;
        counts.calls += run.calls;
      }
    }
  } finally {
    ws.close();
  }
  return counts;
}

/** The brief the runtime really appends for a typed conversation's skill, read from the workspace. */
async function realBrief(ws: Workspace, conversation: Conversation): Promise<string> {
  const skill = conversation.trigger.skill;
  if (conversation.trigger.kind !== 'typed' || !skill || isBaseSkillName(skill)) return '';
  return buildSkillBrief(await resolveSkill(ws.ctx, skill));
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

function offsetLabel(offset: number): string {
  return `${offset >= 0 ? '+' : ''}${offset}d`;
}

function pad(text: string, width: number): string {
  return text.length >= width ? `${text} ` : text + ' '.repeat(width - text.length);
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 220 ? `${flat.slice(0, 219)}…` : flat;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The same finding at several offsets is one line, with the offsets after it: a
 * `search` block that moved is one edit, not three.
 */
function group(findings: Finding[]): string[] {
  const byKey = new Map<string, { finding: Finding; offsets: number[] }>();
  for (const finding of findings) {
    const key = `${finding.scenario} ${finding.where} ${finding.message}`;
    const seen = byKey.get(key);
    if (seen) seen.offsets.push(finding.offset);
    else byKey.set(key, { finding, offsets: [finding.offset] });
  }
  return [...byKey.values()].map(({ finding, offsets }) => {
    const days = [...new Set(offsets)];
    // The same call twice in one turn is two findings at one offset; say how
    // many rather than printing the day twice.
    const each = offsets.length / days.length;
    const times = each > 1 ? `, ${each}×` : '';
    return (
      `  ${finding.scenario} ${finding.where} [${days.map(offsetLabel).join(' ')}${times}]\n` +
      `    ${finding.message}`
    );
  });
}

export function printReport(report: LintReport, offsets: number[]): void {
  console.log(`scenario  offset  shape and run at ${offsets.map(offsetLabel).join(', ')}`);
  for (const line of report.lines) console.log(line);
  // Counted after grouping: the same broken `search` block at three offsets is
  // one thing to fix, and calling it three warnings would say the file is
  // three times as wrong as it is.
  const warnings = group(report.warnings);
  const errors = group(report.errors);
  if (warnings.length > 0) {
    console.log(`\n${warnings.length} warning(s):`);
    for (const line of warnings) console.log(line);
  }
  if (errors.length > 0) {
    console.log(`\n${errors.length} error(s):`);
    for (const line of errors) console.log(line);
    console.log(`\nFAIL: ${errors.length} error(s) in ${report.scenarios} scenario(s).`);
    return;
  }
  console.log(
    `\nOK: ${report.scenarios} scenario(s) clean at ${offsets.map(offsetLabel).join(', ')}` +
      `${warnings.length > 0 ? `, ${warnings.length} warning(s)` : ''}.`,
  );
}

/** The nearest folder at or above `start` that holds `vault-dev/`. */
export function repoRootFrom(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'vault-dev'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no vault-dev/ above ${start}`);
    dir = parent;
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      scenario: { type: 'string' },
      offsets: { type: 'string' },
      dir: { type: 'string' },
    },
  });
  const repoRoot = repoRootFrom(import.meta.dirname);
  const offsets = values.offsets
    ? values.offsets
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n))
    : DEFAULT_OFFSETS;
  if (offsets.length === 0) throw new Error('--offsets needs at least one number');
  const report = await lintScenarios({
    repoRoot,
    dir: values.dir ?? join('demo', 'scenarios'),
    ...(values.scenario ? { scenario: values.scenario } : {}),
    offsets,
  });
  printReport(report, offsets);
  process.exitCode = report.errors.length > 0 ? 1 : 0;
}

// Run only as a command; the test imports `lintScenarios` instead.
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    await main();
  } catch (err) {
    // The whole run failed, not one script. Say what went wrong and nothing else:
    // a stack trace over an ABI mismatch reads as a bug in the lint.
    console.error(message(err));
    process.exitCode = 1;
  }
}
