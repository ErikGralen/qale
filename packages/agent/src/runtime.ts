import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createAgentSession,
  AuthStorage,
  ModelRegistry,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from '@earendil-works/pi-coding-agent';
import { completeSimple } from '@earendil-works/pi-ai/compat';
import type { UseCaseContext } from '@pm/application';
import { AtlassianClient } from '@pm/atlassian';
import {
  createVaultTools,
  createProposeTools,
  createCheckpointTool,
  createDraftTools,
  createAtlassianTools,
  createUseSkillTool,
  listDynamicSkills,
  ATLASSIAN_TOOL_NAMES,
  VAULT_TOOL_NAMES,
  PROPOSE_TOOL_NAMES,
  DRAFT_TOOL_NAMES,
  CHECKPOINT_TOOL_NAME,
  USE_SKILL_TOOL_NAME,
  type TrackExternal,
} from './tools.js';
import {
  createSessionFileTools,
  listSessionFiles,
  readSessionFile,
  sessionFilesPrompt,
  sessionFilesRelRoot,
  sessionFilesRoot,
  SESSION_FILE_TOOL_NAMES,
  type SessionFileEntry,
} from './session-files.js';
import { SHARED_PREAMBLE } from './prompts.js';
import {
  parseSkill,
  buildSystemPrompt,
  buildSessionReceipt,
  SessionHarness,
  DEFAULT_SKILL_BY_TYPE,
  type SkillConfig,
} from '@pm/sessions';
import { PiUiBridge, type Chunk } from './bridge.js';
import { entriesToUiMessages, type UiMessage } from './history.js';

export interface AgentRuntimeConfig {
  vaultDir: string;
  /** Electron userData dir — pi auth/models/sessions live under here, off the vault. */
  userDataDir: string;
  modelId: string;
  apiKey: string | null;
  atlassian?: { baseUrl: string; email: string; token: string } | null;
  /**
   * Host callback behind the `track_external` tool — it reaches the sync engine,
   * which lives in the desktop main process, not here. Identity-stable, so it is
   * deliberately absent from `sameConfig`: swapping it must not tear down live
   * sessions the way a credential or model change does.
   */
  trackExternal?: TrackExternal;
}

export interface RunInput {
  sessionType: string;
  sessionId?: string;
  prompt: string;
}

export interface RunHandle {
  streamId: string;
  sessionId: string;
}

export interface ModelInfo {
  id: string;
  label: string;
}

/**
 * User-set shelf state: `active` (default), `done` (outcome landed), or
 * `dismissed` (won't be useful). Stored off the pi files in a sidecar map;
 * a new message on a closed conversation flips it back to active.
 */
export type SessionLifecycle = 'active' | 'done' | 'dismissed';

/** A past (or live) conversation, listed from the pi JSONL store. */
export interface ChatRef {
  id: string;
  sessionType: string;
  title: string;
  created: number;
  updated: number;
  messageCount: number;
  preview: string;
  lifecycle: SessionLifecycle;
}

/** Lifecycle signal — fired when a run starts and when it settles (any outcome). */
export interface SessionStatus {
  sessionId: string;
  sessionType: string;
  title: string;
  status: 'running' | 'settled';
  updated: number;
}

/** A session with a turn in flight right now. */
export interface LiveSession {
  sessionId: string;
  sessionType: string;
  title: string;
  streamId: string;
  startedAt: number;
}

interface SessionState {
  id: string;
  type: string;
  session: AgentSession;
  harness: SessionHarness;
  manager: SessionManager;
  unsubscribe: () => void;
  bridge: PiUiBridge | null;
  activeStreamId: string | null;
  /** First user prompt, truncated — the session's display title everywhere. */
  title: string;
  runStartedAt: number;
}

/** Marker entry stamped into each pi session file so listings know the skill. */
const META_ENTRY_TYPE = 'pm.session';

/**
 * Embeds pi in the main process in full-control mode (PLAN §3.3): its own
 * AuthStorage/SessionManager/SettingsManager paths (off the user's ~/.pi), a
 * DefaultResourceLoader that suppresses skills/prompts/AGENTS.md, and NO built-in
 * tools — only our vault-scoped custom tools.
 */
export class AgentRuntime {
  private config: AgentRuntimeConfig | null = null;
  private authStorage: AuthStorage | null = null;
  private modelRegistry: ModelRegistry | null = null;
  private atlassian: AtlassianClient | null = null;
  private readonly sessions = new Map<string, SessionState>();
  /** sessionId → in-flight createSession — two rapid runs must share one session. */
  private readonly creating = new Map<string, Promise<SessionState>>();
  private readonly streamToSession = new Map<string, string>();
  /** sessionId → shelf state; only non-active entries are stored. */
  private lifecycles: Record<string, SessionLifecycle> = {};
  /**
   * listChats() re-reads every transcript in full — cache the result keyed by a
   * cheap stat signature of the sessions dir so the frequent sidebar refresh
   * with nothing changed costs a readdir + stats, not N file reads.
   */
  private chatListCache: { sig: string; chats: ChatRef[] } | null = null;
  /** path → sessionType; the marker is stamped at creation and never changes. */
  private readonly sessionTypeCache = new Map<string, string>();
  /** Lifecycle hook — main pushes these to the renderer as `session:status`. */
  onStatus: ((status: SessionStatus) => void) | null = null;
  /** Fired when a session writes a working file — main pushes `session:files`. */
  onFilesChanged: ((sessionId: string) => void) | null = null;

  configure(config: AgentRuntimeConfig): void {
    // Re-applying identical settings must not kill live sessions mid-stream.
    if (this.config && sameConfig(this.config, config)) return;
    this.config = config;
    this.chatListCache = null;
    this.lifecycles = this.loadLifecycles();
    this.authStorage = AuthStorage.create(join(config.userDataDir, 'pi', 'auth.json'));
    if (config.apiKey) {
      // In-memory only — never written to disk (PLAN §2).
      this.authStorage.setRuntimeApiKey('anthropic', config.apiKey);
    }
    this.modelRegistry = ModelRegistry.create(this.authStorage, join(config.userDataDir, 'pi', 'models.json'));
    this.atlassian = config.atlassian
      ? new AtlassianClient(config.atlassian)
      : null;
    // A config change invalidates existing sessions (built with the old model/tools).
    this.disposeSessions();
  }

  isReady(): boolean {
    return !!this.config?.apiKey && this.listModels().length > 0;
  }

  listModels(): ModelInfo[] {
    if (!this.modelRegistry) return [];
    try {
      return this.modelRegistry.getAvailable().map((m) => ({ id: m.id, label: m.name }));
    } catch {
      return [];
    }
  }

  private resolveModel() {
    if (!this.modelRegistry || !this.config) throw new Error('agent runtime not configured');
    const available = this.modelRegistry.getAvailable();
    if (available.length === 0) throw new Error('No model available — set an Anthropic API key in Settings.');
    return available.find((m) => m.id === this.config!.modelId) ?? available[0]!;
  }

  /**
   * A short, human title for a titleless capture (a dropped transcript) — so it
   * files as `meetings/2026-07-20-nordkap-sso-checkin.md`, not a slug of its
   * first spoken line. One cheap non-streaming completion; strictly best-effort:
   * no key, no model, or any error returns null and the caller keeps its
   * heuristic title. Never throws into the capture path.
   */
  async generateTitle(text: string): Promise<string | null> {
    let model;
    try {
      model = this.resolveModel();
    } catch {
      return null;
    }
    const excerpt = text.replace(/\s+/g, ' ').trim().slice(0, 3000);
    if (excerpt.length < 40) return null;
    const context = {
      systemPrompt:
        'You title meeting notes. Reply with ONLY a short, specific title in Title Case ' +
        '(3–8 words) — the customer or topic, no quotes, no trailing punctuation, no preamble. ' +
        'Example: Nordkap SSO Go-Live Check-in',
      messages: [{ role: 'user' as const, content: `Transcript excerpt:\n\n${excerpt}`, timestamp: 0 }],
    };
    try {
      // pi-ai falls back to env vars without an explicit apiKey — pass the
      // configured key so a Settings-pasted key works in packaged builds (no
      // ANTHROPIC_API_KEY in the environment).
      const msg = await completeSimple(model as Parameters<typeof completeSimple>[0], context, {
        apiKey: this.config?.apiKey ?? undefined,
      });
      const out = (msg.content ?? [])
        .filter((c): c is { type: 'text'; text: string } => (c as { type?: string }).type === 'text')
        .map((c) => c.text)
        .join(' ');
      const title = out
        .replace(/^["'`\s]+|["'`.\s]+$/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 80)
        .trim();
      return title.length >= 2 ? title : null;
    } catch {
      return null;
    }
  }

  /**
   * One-shot, non-streaming completion for background judgments (the
   * librarian's page-contradiction checks). Returns null when no model/key is
   * configured — the caller treats that as "cannot judge, skip quietly".
   * Unlike generateTitle, API errors THROW: the sweep must know the judgment
   * didn't happen so it can retry next tick instead of recording a verdict.
   */
  async completeText(input: { system: string; prompt: string }): Promise<string | null> {
    let model;
    try {
      model = this.resolveModel();
    } catch {
      return null;
    }
    const context = {
      systemPrompt: input.system,
      messages: [{ role: 'user' as const, content: input.prompt, timestamp: 0 }],
    };
    const msg = await completeSimple(model as Parameters<typeof completeSimple>[0], context, {
      apiKey: this.config?.apiKey ?? undefined,
    });
    // completeSimple resolves (never rejects) on API failure, with an error
    // stop reason. Surface that as a throw — returning the empty text here
    // would be ledgered as a verdict and permanently suppress the check.
    if (msg.stopReason === 'error' || msg.stopReason === 'aborted') {
      throw new Error(msg.errorMessage ?? 'completion failed');
    }
    return (msg.content ?? [])
      .filter((c): c is { type: 'text'; text: string } => (c as { type?: string }).type === 'text')
      .map((c) => c.text)
      .join('\n');
  }

  /**
   * Resolve a session's skill by its declared `session_type`: the conventional
   * `skills/<type>.md` first, then any workspace skill file whose frontmatter
   * declares the type (a triggered skill's filename need not match), else the
   * built-in pack.
   */
  private async resolveSkill(type: string, ctx: UseCaseContext): Promise<SkillConfig> {
    const direct = await ctx.vault.readRaw(`skills/${type}.md`);
    if (direct) {
      const config = parseSkill(direct, type);
      if (config.name === type) return config;
    }
    for (const n of ctx.index.all()) {
      if (n.type !== 'skill') continue;
      const raw = await ctx.vault.readRaw(n.path);
      if (!raw) continue;
      const config = parseSkill(raw, n.slug);
      if (config.name === type) return config;
    }
    return parseSkill(DEFAULT_SKILL_BY_TYPE[type] ?? '', type);
  }

  private toolNamesFor(config: SkillConfig, atlassianActive: boolean, canInvokeSkills: boolean): string[] {
    const names = [...VAULT_TOOL_NAMES];
    if (config.tier === 'suggest' || config.tier === 'outbound') names.push(...PROPOSE_TOOL_NAMES);
    if (config.tier === 'outbound') names.push(...DRAFT_TOOL_NAMES);
    // A session that can pull in skills gets the checkpoint tool even when its
    // OWN skill declares no plan: the arriving skill's checkpoints would
    // otherwise gate output with no way to advance past the gate.
    if (config.checkpoints.length > 0 || canInvokeSkills) names.push(CHECKPOINT_TOOL_NAME);
    if (canInvokeSkills) names.push(USE_SKILL_TOOL_NAME);
    if (config.sessionFiles) names.push(...SESSION_FILE_TOOL_NAMES);
    if (atlassianActive) names.push(...ATLASSIAN_TOOL_NAMES);
    return names;
  }

  /**
   * Voice registers injected when a session drafts outbound (Skills v2). Driven by
   * each voice skill's forced binding rather than a filename regex: a `voice` skill
   * with a `mode: forced` binding (or none, for back-compat) is always in effect.
   */
  private async voiceGuides(ctx: UseCaseContext): Promise<string> {
    const voices = ctx.index.all().filter((n) => n.type === 'skill' && (n.frontmatter as Record<string, unknown>)['skill_kind'] === 'voice');
    const bodies: string[] = [];
    for (const g of voices) {
      const raw = await ctx.vault.readRaw(g.path);
      if (!raw) continue;
      const cfg = parseSkill(raw, g.slug);
      const forced = cfg.bindings.length === 0 || cfg.bindings.some((b) => b.mode === 'forced');
      if (!forced) continue;
      const note = await ctx.vault.readNote(g.path);
      if (!note) continue;
      // The binding's audience scope, stated where the model reads the register —
      // the Skills view describes this scoping, so the prompt must carry it too.
      const audiences = cfg.bindings.filter((b) => b.mode === 'forced' && b.audience).map((b) => b.audience);
      const scope = audiences.length > 0 ? ` (applies when drafting for ${audiences.join(', ')})` : '';
      // A voice file without a summary must not inject "### undefined" into
      // every outbound prompt — the skill name is always present.
      bodies.push(`### ${note.frontmatter.summary?.trim() || cfg.name}${scope}\n${note.body.trim()}`);
    }
    return bodies.length ? `\n\n## Voice guides (apply to outbound drafts)\n${bodies.join('\n\n')}` : '';
  }

  /**
   * The on-demand skill index (Sessions v2 Part 3.1): every guide AND every skill
   * with a `dynamic` binding, listed by name + summary so the model knows what it
   * can pull in via `use_skill` without paying for the bodies until one is
   * relevant. Returns null when nothing is loadable.
   *
   * Widening this from `skill_kind: guide` is what makes the Skills view stop
   * lying: `describeBinding` has always rendered "Available on demand" for a
   * dynamic binding, while a dynamic *session* skill was listed nowhere.
   */
  private async skillIndex(ctx: UseCaseContext, current: string): Promise<string | null> {
    const skills = (await listDynamicSkills(ctx)).filter((s) => s.config.name !== current);
    if (skills.length === 0) return null;
    const guides = skills.filter((s) => s.config.kind === 'guide');
    const sessions = skills.filter((s) => s.config.kind !== 'guide');
    const parts = [
      '\n\n## Skills available on demand',
      'Call `use_skill` with one of these names when the conversation turns into the work it describes. ' +
        'A session skill takes over how you work from that point on — its instructions, its checkpoints, ' +
        'and the cards it may produce. Load one rather than improvising a workflow it already describes.',
    ];
    if (sessions.length > 0)
      parts.push(sessions.map((s) => `- \`${s.config.name}\` — ${s.config.summary}`).join('\n'));
    if (guides.length > 0)
      parts.push(`Reference guides (read-only):\n${guides.map((g) => `- \`${g.config.name}\` — ${g.config.summary}`).join('\n')}`);
    return parts.join('\n');
  }

  /**
   * Seed the root `index.md` vault map into the session context (OKF §8, the
   * strongest of the three retrieval levers): because the map is compact (one
   * line per folder), injecting it means the agent starts every session already
   * holding the whole-vault orientation, then drills into folder maps via
   * `vault_read` — never spending a tool call just to find the map. Absent (a
   * fresh vault before the first librarian pass) contributes nothing.
   */
  private async vaultMap(ctx: UseCaseContext): Promise<string> {
    const raw = await ctx.vault.readRaw('index.md');
    if (!raw || !raw.trim()) return '';
    return `\n\n## Vault map (root index.md)\nYour orientation layer. Each folder also has its own index.md; read the relevant one, then vault_read the notes it points to.\n\n${raw.trim()}`;
  }

  /** Where the pi JSONL transcripts live — the machine replay store (off the vault). */
  private sessionsDir(): string {
    if (!this.config) throw new Error('agent runtime not configured');
    return join(this.config.userDataDir, 'sessions');
  }

  /** Shelf-state sidecar (off the pi files, so pi's store stays untouched). */
  private lifecycleFile(): string {
    if (!this.config) throw new Error('agent runtime not configured');
    return join(this.config.userDataDir, 'session-lifecycle.json');
  }

  private loadLifecycles(): Record<string, SessionLifecycle> {
    try {
      const parsed = JSON.parse(readFileSync(this.lifecycleFile(), 'utf8')) as Record<string, unknown>;
      const out: Record<string, SessionLifecycle> = {};
      for (const [id, v] of Object.entries(parsed)) {
        if (v === 'done' || v === 'dismissed') out[id] = v;
      }
      return out;
    } catch {
      return {};
    }
  }

  getLifecycle(sessionId: string): SessionLifecycle {
    return this.lifecycles[sessionId] ?? 'active';
  }

  setLifecycle(sessionId: string, lifecycle: SessionLifecycle): void {
    if (lifecycle === 'active') delete this.lifecycles[sessionId];
    else this.lifecycles[sessionId] = lifecycle;
    // Lifecycle lives in a sidecar, not the sessions dir — the dir signature
    // won't notice this change, so drop the cache by hand.
    this.chatListCache = null;
    try {
      writeFileSync(this.lifecycleFile(), JSON.stringify(this.lifecycles));
    } catch (err) {
      console.error('[pm] session lifecycle save failed:', err);
    }
  }

  /** pi names session files `<timestamp>_<id>.jsonl`; find by id, newest first. */
  private findSessionFile(sessionId: string): string | null {
    try {
      const files = readdirSync(this.sessionsDir())
        .filter((f) => f.endsWith(`_${sessionId}.jsonl`))
        .sort()
        .reverse();
      return files[0] ? join(this.sessionsDir(), files[0]) : null;
    } catch {
      return null;
    }
  }

  /** Read the pm.session marker stamped at creation (line 2 of the JSONL). */
  private readSessionType(file: string): string {
    const cached = this.sessionTypeCache.get(file);
    if (cached) return cached;
    try {
      for (const line of readFileSync(file, 'utf8').split('\n').slice(0, 6)) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line) as { type?: string; customType?: string; data?: { sessionType?: string } };
        if (entry.type === 'custom' && entry.customType === META_ENTRY_TYPE && entry.data?.sessionType) {
          // The marker is written once at creation — safe to cache forever.
          this.sessionTypeCache.set(file, entry.data.sessionType);
          return entry.data.sessionType;
        }
      }
    } catch {
      /* unreadable file — fall through */
    }
    return 'chat';
  }

  private async createSession(type: string, id: string, ctx: UseCaseContext): Promise<SessionState> {
    if (!this.config || !this.authStorage || !this.modelRegistry) {
      throw new Error('agent runtime not configured');
    }
    const model = this.resolveModel();

    // A session type is a skill file (PLAN-V2 §3.2): prompt + tool tier + gate.
    const skillConfig = await this.resolveSkill(type, ctx);
    const harness = new SessionHarness(id, skillConfig, ctx.clock.now());
    const voice = skillConfig.tier === 'outbound' ? await this.voiceGuides(ctx) : '';
    const skillIndex = await this.skillIndex(ctx, skillConfig.name);
    const vaultMap = await this.vaultMap(ctx);
    const filesRoot = sessionFilesRoot(this.config.vaultDir, id);
    const files = skillConfig.sessionFiles ? sessionFilesPrompt(sessionFilesRelRoot(id)) : '';
    const systemPrompt =
      buildSystemPrompt(SHARED_PREAMBLE, skillConfig) + voice + (skillIndex ?? '') + files + vaultMap;

    // The ask session gains the tracker seam (Jira/Confluence) when configured.
    const atlassianActive = type === 'ask' && this.atlassian;
    const canInvokeSkills = !!skillIndex;
    const toolNames = this.toolNamesFor(skillConfig, !!atlassianActive, canInvokeSkills);
    const customTools = [
      ...createVaultTools(ctx, harness),
      ...(skillConfig.tier !== 'observe' ? createProposeTools(ctx, id, harness) : []),
      ...(skillConfig.tier === 'outbound' ? createDraftTools(ctx, id, harness) : []),
      ...(skillConfig.checkpoints.length > 0 || canInvokeSkills ? [createCheckpointTool(harness)] : []),
      ...(canInvokeSkills ? [createUseSkillTool(ctx, harness)] : []),
      ...(skillConfig.sessionFiles
        ? createSessionFileTools(filesRoot, () => this.onFilesChanged?.(id))
        : []),
      ...(atlassianActive ? createAtlassianTools(this.atlassian!, this.config.trackExternal) : []),
    ];

    const loader = new DefaultResourceLoader({
      cwd: this.config.vaultDir,
      agentDir: join(this.config.userDataDir, 'pi', 'agent'),
      // Full control: don't load the user's ~/.pi resources or the vault's AGENTS.md.
      systemPrompt,
      noSkills: true,
      noPromptTemplates: true,
      noContextFiles: true,
      noThemes: true,
      noExtensions: true,
      systemPromptOverride: () => systemPrompt,
      agentsFilesOverride: () => ({ agentsFiles: [] }),
    });
    await loader.reload();

    // The JSONL is keyed by our session id: a chat survives restarts, and
    // resuming reopens the same file with its full model context (PLAN §Phase 3).
    const existingFile = this.findSessionFile(id);
    const manager = existingFile
      ? SessionManager.open(existingFile, this.sessionsDir(), this.config.vaultDir)
      : SessionManager.create(this.config.vaultDir, this.sessionsDir(), { id });
    if (!existingFile) manager.appendCustomEntry(META_ENTRY_TYPE, { sessionType: type });

    const { session } = await createAgentSession({
      cwd: this.config.vaultDir,
      model,
      noTools: 'all',
      tools: toolNames,
      customTools,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      resourceLoader: loader,
      sessionManager: manager,
      settingsManager: SettingsManager.inMemory(),
    });

    const state: SessionState = {
      id,
      type,
      session,
      harness,
      manager,
      bridge: null,
      activeStreamId: null,
      title: '',
      runStartedAt: 0,
      unsubscribe: () => undefined,
    };
    state.unsubscribe = session.subscribe((event) => {
      state.bridge?.handle(event);
    });
    this.sessions.set(id, state);
    return state;
  }

  /** File the session receipt to sessions/ — the human-auditable reads/writes ledger. */
  private async fileReceipt(state: SessionState, ctx: UseCaseContext): Promise<void> {
    if (state.harness.turns.length === 0 && state.harness.writes.length === 0) return;
    try {
      const files = state.harness.sessionFiles ? (await this.listFiles(state.id)).length : 0;
      const receipt = buildSessionReceipt(state.harness, ctx.clock.now(), undefined, files);
      const note = await ctx.vault.writeNote(receipt.path, receipt.frontmatter, receipt.body);
      ctx.index.reindex(note);
      await ctx.git.commitPaths([receipt.path], `session: ${state.harness.config.name}`);
    } catch (err) {
      console.error('[pm] session receipt filing failed:', err);
    }
  }

  /**
   * Start a run. Returns immediately with {streamId, sessionId}; chunks stream via
   * `emit(streamId, chunk)` (main pumps them over IPC). The terminal `finish`
   * chunk always fires — on success, error, or abort.
   */
  async run(
    input: RunInput,
    ctx: UseCaseContext,
    emit: (streamId: string, chunk: Chunk) => void,
  ): Promise<RunHandle> {
    if (!this.config?.apiKey) throw new Error('Set an Anthropic API key in Settings to chat.');
    const sessionId = input.sessionId ?? randomUUID();
    let state = this.sessions.get(sessionId);
    if (!state) {
      let pending = this.creating.get(sessionId);
      if (!pending) {
        pending = this.createSession(input.sessionType, sessionId, ctx).finally(() => {
          this.creating.delete(sessionId);
        });
        this.creating.set(sessionId, pending);
      }
      state = await pending;
    }
    // One turn at a time per session: a second run would reroute the live
    // bridge mid-stream and interleave pi prompts on the same session.
    if (state.activeStreamId) throw new Error('This conversation is still responding — wait or stop it first.');
    // A new message on a done/dismissed conversation reopens it.
    if (this.getLifecycle(sessionId) !== 'active') this.setLifecycle(sessionId, 'active');
    state.harness.beginTurn(input.prompt, ctx.clock.now());
    if (!state.title) state.title = truncate(input.prompt, 60) ?? state.type;

    const streamId = randomUUID();
    const bridge = new PiUiBridge((chunk) => emit(streamId, chunk));
    state.bridge = bridge;
    state.activeStreamId = streamId;
    state.runStartedAt = Date.now();
    this.streamToSession.set(streamId, sessionId);
    bridge.start();
    this.emitStatus(state, 'running');

    void state.session
      .prompt(input.prompt)
      .catch((err) => {
        emit(streamId, { type: 'error', errorText: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        bridge.finish();
        if (state.activeStreamId === streamId) {
          state.activeStreamId = null;
          state.bridge = null;
        }
        this.streamToSession.delete(streamId);
        this.emitStatus(state, 'settled');
        // File/refresh the session receipt after each settled turn.
        void this.fileReceipt(state, ctx);
      });

    return { streamId, sessionId };
  }

  private emitStatus(state: SessionState, status: SessionStatus['status']): void {
    this.onStatus?.({
      sessionId: state.id,
      sessionType: state.type,
      title: state.title,
      status,
      updated: Date.now(),
    });
  }

  /**
   * A session's working files (Sessions v2 Part 1) — what the right-panel tree
   * shows, filling live as the session writes. Off the index by construction, so
   * this is the only door to them; a session that never wrote returns [].
   */
  async listFiles(sessionId: string): Promise<SessionFileEntry[]> {
    if (!this.config) return [];
    return listSessionFiles(sessionFilesRoot(this.config.vaultDir, sessionId));
  }

  /** One session file's text, read-only. Null when it escapes the folder or is gone. */
  async readFile(sessionId: string, path: string): Promise<string | null> {
    if (!this.config) return null;
    return readSessionFile(sessionFilesRoot(this.config.vaultDir, sessionId), path);
  }

  /** Sessions with a turn in flight — the sidebar rail's running rows. */
  listLive(): LiveSession[] {
    const live: LiveSession[] = [];
    for (const state of this.sessions.values()) {
      if (!state.activeStreamId) continue;
      live.push({
        sessionId: state.id,
        sessionType: state.type,
        title: state.title,
        streamId: state.activeStreamId,
        startedAt: state.runStartedAt,
      });
    }
    return live;
  }

  /** name:mtime:size per transcript — changes iff a full re-list would differ. */
  private sessionsDirSignature(): string | null {
    try {
      const dir = this.sessionsDir();
      return readdirSync(dir)
        .filter((f) => f.endsWith('.jsonl'))
        .sort()
        .map((f) => {
          const s = statSync(join(dir, f));
          return `${f}:${s.mtimeMs}:${s.size}`;
        })
        .join('|');
    } catch {
      return null;
    }
  }

  /** All stored conversations for this vault, newest first. */
  async listChats(): Promise<ChatRef[]> {
    if (!this.config) return [];
    const sig = this.sessionsDirSignature();
    if (sig !== null && this.chatListCache?.sig === sig) return this.chatListCache.chats;
    let infos;
    try {
      infos = await SessionManager.list(this.config.vaultDir, this.sessionsDir());
    } catch {
      return [];
    }
    const chats = infos
      .filter((info) => info.messageCount > 0)
      .map((info) => ({
        id: info.id,
        sessionType: this.readSessionType(info.path),
        title: info.name ?? truncate(info.firstMessage, 64) ?? 'Untitled chat',
        created: info.created.getTime(),
        updated: info.modified.getTime(),
        messageCount: info.messageCount,
        preview: truncate(info.allMessagesText, 140) ?? '',
        lifecycle: this.getLifecycle(info.id),
      }));
    if (sig !== null) this.chatListCache = { sig, chats };
    return chats;
  }

  /** Replay a stored conversation as UI messages (live sessions read their open manager). */
  chatHistory(sessionId: string): UiMessage[] {
    const live = this.sessions.get(sessionId);
    if (live) return entriesToUiMessages(live.manager.buildContextEntries());
    const file = this.findSessionFile(sessionId);
    if (!file || !this.config) return [];
    const manager = SessionManager.open(file, this.sessionsDir(), this.config.vaultDir);
    return entriesToUiMessages(manager.buildContextEntries());
  }

  async deleteChat(sessionId: string): Promise<void> {
    const live = this.sessions.get(sessionId);
    if (live) {
      await live.session.abort().catch(() => undefined);
      live.bridge?.finish();
      live.unsubscribe();
      live.session.dispose();
      this.sessions.delete(sessionId);
      if (live.activeStreamId) this.streamToSession.delete(live.activeStreamId);
    }
    const file = this.findSessionFile(sessionId);
    if (file) rmSync(file, { force: true });
    if (this.lifecycles[sessionId]) this.setLifecycle(sessionId, 'active');
  }

  async abort(streamId: string): Promise<void> {
    const sessionId = this.streamToSession.get(streamId);
    if (!sessionId) return;
    const state = this.sessions.get(sessionId);
    if (!state) return;
    await state.session.abort().catch(() => undefined);
    state.bridge?.finish();
  }

  private disposeSessions(): void {
    for (const state of this.sessions.values()) {
      state.unsubscribe();
      state.session.dispose();
    }
    this.sessions.clear();
    this.streamToSession.clear();
  }

  dispose(): void {
    this.disposeSessions();
  }
}

function sameConfig(a: AgentRuntimeConfig, b: AgentRuntimeConfig): boolean {
  return (
    a.vaultDir === b.vaultDir &&
    a.userDataDir === b.userDataDir &&
    a.modelId === b.modelId &&
    a.apiKey === b.apiKey &&
    (a.atlassian?.baseUrl ?? null) === (b.atlassian?.baseUrl ?? null) &&
    (a.atlassian?.email ?? null) === (b.atlassian?.email ?? null) &&
    (a.atlassian?.token ?? null) === (b.atlassian?.token ?? null)
  );
}

function truncate(s: string | undefined, n: number): string | undefined {
  const flat = s?.replace(/\s+/g, ' ').trim();
  if (!flat) return undefined;
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}
