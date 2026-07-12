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
import { createVaultTools, createProposeTools } from './tools.js';
import { SESSION_TYPES, type SessionType } from './prompts.js';
import { PiUiBridge, type Chunk } from './bridge.js';

export interface AgentRuntimeConfig {
  vaultDir: string;
  /** Electron userData dir — pi auth/models/sessions live under here, off the vault. */
  userDataDir: string;
  modelId: string;
  apiKey: string | null;
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
    // A model change invalidates existing sessions (they were built with the old model).
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

  private async createSession(type: SessionType, id: string, ctx: UseCaseContext): Promise<SessionState> {
    if (!this.config || !this.authStorage || !this.modelRegistry) {
      throw new Error('agent runtime not configured');
    }
    const cfg = SESSION_TYPES[type];
    const model = this.resolveModel();

    const loader = new DefaultResourceLoader({
      cwd: this.config.vaultDir,
      agentDir: join(this.config.userDataDir, 'pi', 'agent'),
      // Full control: don't load the user's ~/.pi resources or the vault's AGENTS.md.
      systemPrompt: cfg.systemPrompt,
      noSkills: true,
      noPromptTemplates: true,
      noContextFiles: true,
      noThemes: true,
      noExtensions: true,
      systemPromptOverride: () => cfg.systemPrompt,
      agentsFilesOverride: () => ({ agentsFiles: [] }),
    });
    await loader.reload();

    const { session } = await createAgentSession({
      cwd: this.config.vaultDir,
      model,
      noTools: 'all',
      tools: cfg.tools,
      customTools: [...createVaultTools(ctx), ...createProposeTools(ctx, id)],
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
