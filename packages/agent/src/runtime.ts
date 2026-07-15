import { randomUUID } from 'node:crypto';
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
  ATLASSIAN_TOOL_NAMES,
  VAULT_TOOL_NAMES,
  PROPOSE_TOOL_NAMES,
  DRAFT_TOOL_NAMES,
  CHECKPOINT_TOOL_NAME,
} from './tools.js';
import { SHARED_PREAMBLE, type SessionType } from './prompts.js';
import {
  parseSkill,
  buildSystemPrompt,
  buildSessionReceipt,
  SessionHarness,
  DEFAULT_SKILL_BY_TYPE,
  type SkillConfig,
} from '@pm/sessions';
import { PiUiBridge, type Chunk } from './bridge.js';

export interface AgentRuntimeConfig {
  vaultDir: string;
  /** Electron userData dir — pi auth/models/sessions live under here, off the vault. */
  userDataDir: string;
  modelId: string;
  apiKey: string | null;
  atlassian?: { baseUrl: string; email: string; token: string } | null;
}

export interface RunInput {
  sessionType: SessionType;
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

interface SessionState {
  id: string;
  type: SessionType;
  session: AgentSession;
  harness: SessionHarness;
  unsubscribe: () => void;
  bridge: PiUiBridge | null;
  activeStreamId: string | null;
}

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

  configure(config: AgentRuntimeConfig): void {
    this.config = config;
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

  /** Resolve a session's skill: the workspace's `skills/<type>.md`, else built-in. */
  private async resolveSkill(type: SessionType, ctx: UseCaseContext): Promise<SkillConfig> {
    const raw = (await ctx.vault.readRaw(`skills/${type}.md`)) ?? DEFAULT_SKILL_BY_TYPE[type] ?? '';
    return parseSkill(raw, type);
  }

  private toolNamesFor(config: SkillConfig, atlassianActive: boolean): string[] {
    const names = [...VAULT_TOOL_NAMES];
    if (config.tier === 'suggest' || config.tier === 'outbound') names.push(...PROPOSE_TOOL_NAMES);
    if (config.tier === 'outbound') names.push(...DRAFT_TOOL_NAMES);
    if (config.checkpoints.length > 0) names.push(CHECKPOINT_TOOL_NAME);
    if (atlassianActive) names.push(...ATLASSIAN_TOOL_NAMES);
    return names;
  }

  /** Voice guides (skills/voice-*.md) injected when a session drafts outbound. */
  private async voiceGuides(ctx: UseCaseContext): Promise<string> {
    const guides = ctx.index.all().filter((n) => n.type === 'skill' && /(^|\/)voice-/.test(n.path));
    const bodies: string[] = [];
    for (const g of guides) {
      const note = await ctx.vault.readNote(g.path);
      if (note) bodies.push(`### ${note.frontmatter.summary}\n${note.body.trim()}`);
    }
    return bodies.length ? `\n\n## Voice guides (apply to outbound drafts)\n${bodies.join('\n\n')}` : '';
  }

  private async createSession(type: SessionType, id: string, ctx: UseCaseContext): Promise<SessionState> {
    if (!this.config || !this.authStorage || !this.modelRegistry) {
      throw new Error('agent runtime not configured');
    }
    const model = this.resolveModel();

    // A session type is a skill file (PLAN-V2 §3.2): prompt + tool tier + gate.
    const skillConfig = await this.resolveSkill(type, ctx);
    const harness = new SessionHarness(id, skillConfig, ctx.clock.now());
    const voice = skillConfig.tier === 'outbound' ? await this.voiceGuides(ctx) : '';
    const systemPrompt = buildSystemPrompt(SHARED_PREAMBLE, skillConfig) + voice;

    // The ask session gains the tracker seam (Jira/Confluence) when configured.
    const atlassianActive = type === 'ask' && this.atlassian;
    const toolNames = this.toolNamesFor(skillConfig, !!atlassianActive);
    const customTools = [
      ...createVaultTools(ctx, harness),
      ...(skillConfig.tier !== 'observe' ? createProposeTools(ctx, id, harness) : []),
      ...(skillConfig.tier === 'outbound' ? createDraftTools(ctx, id, harness) : []),
      ...(skillConfig.checkpoints.length > 0 ? [createCheckpointTool(harness)] : []),
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

    const { session } = await createAgentSession({
      cwd: this.config.vaultDir,
      model,
      noTools: 'all',
      tools: toolNames,
      customTools,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      resourceLoader: loader,
      sessionManager: SessionManager.create(this.config.vaultDir, join(this.config.userDataDir, 'sessions')),
      settingsManager: SettingsManager.inMemory(),
    });

    const state: SessionState = {
      id,
      type,
      session,
      harness,
      bridge: null,
      activeStreamId: null,
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
    state.harness.beginTurn(input.prompt, ctx.clock.now());

    const streamId = randomUUID();
    const bridge = new PiUiBridge((chunk) => emit(streamId, chunk));
    state.bridge = bridge;
    state.activeStreamId = streamId;
    this.streamToSession.set(streamId, sessionId);
    bridge.start();

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
        // File/refresh the session receipt after each settled turn.
        void this.fileReceipt(state, ctx);
      });

    return { streamId, sessionId };
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
