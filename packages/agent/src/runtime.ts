import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import type { UseCaseContext } from '@pm/application';
import { AtlassianClient } from '@pm/atlassian';
import {
  createVaultTools,
  createProposeTools,
  createCheckpointTool,
  createDraftTools,
  createAtlassianTools,
  createUseSkillTool,
  ATLASSIAN_TOOL_NAMES,
  VAULT_TOOL_NAMES,
  PROPOSE_TOOL_NAMES,
  DRAFT_TOOL_NAMES,
  CHECKPOINT_TOOL_NAME,
  USE_SKILL_TOOL_NAME,
} from './tools.js';
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
  private readonly streamToSession = new Map<string, string>();
  /** sessionId → shelf state; only non-active entries are stored. */
  private lifecycles: Record<string, SessionLifecycle> = {};
  /** Lifecycle hook — main pushes these to the renderer as `session:status`. */
  onStatus: ((status: SessionStatus) => void) | null = null;

  configure(config: AgentRuntimeConfig): void {
    this.config = config;
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

  private toolNamesFor(config: SkillConfig, atlassianActive: boolean, hasGuides: boolean): string[] {
    const names = [...VAULT_TOOL_NAMES];
    if (config.tier === 'suggest' || config.tier === 'outbound') names.push(...PROPOSE_TOOL_NAMES);
    if (config.tier === 'outbound') names.push(...DRAFT_TOOL_NAMES);
    if (config.checkpoints.length > 0) names.push(CHECKPOINT_TOOL_NAME);
    if (hasGuides) names.push(USE_SKILL_TOOL_NAME);
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
      bodies.push(`### ${note.frontmatter.summary}${scope}\n${note.body.trim()}`);
    }
    return bodies.length ? `\n\n## Voice guides (apply to outbound drafts)\n${bodies.join('\n\n')}` : '';
  }

  /**
   * The guide index (Skills v2): every `skill_kind: guide` file listed by name +
   * summary so the model knows what it can pull in via `use_skill`, without paying
   * for the bodies until one is relevant. Returns null when there are no guides.
   */
  private guideIndex(ctx: UseCaseContext): string | null {
    const guides = ctx.index.all().filter((n) => n.type === 'skill' && (n.frontmatter as Record<string, unknown>)['skill_kind'] === 'guide');
    if (guides.length === 0) return null;
    const lines = guides.map((g) => `- \`${g.slug.split('/').pop()}\` — ${g.summary}`);
    return `\n\n## Guides available on demand\nCall \`use_skill\` with a guide name to load it when relevant:\n${lines.join('\n')}`;
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
    try {
      for (const line of readFileSync(file, 'utf8').split('\n').slice(0, 6)) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line) as { type?: string; customType?: string; data?: { sessionType?: string } };
        if (entry.type === 'custom' && entry.customType === META_ENTRY_TYPE && entry.data?.sessionType) {
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
    const guides = this.guideIndex(ctx);
    const systemPrompt = buildSystemPrompt(SHARED_PREAMBLE, skillConfig) + voice + (guides ?? '');

    // The ask session gains the tracker seam (Jira/Confluence) when configured.
    const atlassianActive = type === 'ask' && this.atlassian;
    const toolNames = this.toolNamesFor(skillConfig, !!atlassianActive, !!guides);
    const customTools = [
      ...createVaultTools(ctx, harness),
      ...(skillConfig.tier !== 'observe' ? createProposeTools(ctx, id, harness) : []),
      ...(skillConfig.tier === 'outbound' ? createDraftTools(ctx, id, harness) : []),
      ...(skillConfig.checkpoints.length > 0 ? [createCheckpointTool(harness)] : []),
      ...(guides ? [createUseSkillTool(ctx)] : []),
      ...(atlassianActive ? createAtlassianTools(this.atlassian!) : []),
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
      const receipt = buildSessionReceipt(state.harness, ctx.clock.now());
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
    const state = this.sessions.get(sessionId) ?? (await this.createSession(input.sessionType, sessionId, ctx));
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

  /** All stored conversations for this vault, newest first. */
  async listChats(): Promise<ChatRef[]> {
    if (!this.config) return [];
    let infos;
    try {
      infos = await SessionManager.list(this.config.vaultDir, this.sessionsDir());
    } catch {
      return [];
    }
    return infos
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

function truncate(s: string | undefined, n: number): string | undefined {
  const flat = s?.replace(/\s+/g, ' ').trim();
  if (!flat) return undefined;
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}
