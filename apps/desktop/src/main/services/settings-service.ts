import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

/**
 * Persisted app settings (PLAN §3.5 "primary app state"). Secrets (Anthropic key,
 * Atlassian token) are encrypted at rest with Electron safeStorage and only ever
 * decrypted in the main process — never sent to the renderer.
 */
/** A scheduled session slot (PLAN-V2 §3.5): fires on a weekly day/hour. */
export interface ScheduleEntry {
  sessionType: string;
  /** 0–6 (Sun–Sat). */
  dayOfWeek: number;
  /** 0–23 local hour. */
  hour: number;
  enabled: boolean;
  /** ISO of the last time this slot fired (for catch-up + due checks). */
  lastRun: string | null;
}

export interface PersistedSettings {
  vaultPath: string | null;
  modelId: string;
  anthropicKeyEnc: string | null;
  atlassian: { baseUrl: string; email: string; tokenEnc: string } | null;
  schedules: ScheduleEntry[];
  /** Local MCP server: token-gated so the customer's Claude can query the memory. */
  mcpEnabled: boolean;
  mcpPort: number;
  mcpToken: string | null;
}

const DEFAULTS: PersistedSettings = {
  vaultPath: null,
  modelId: 'claude-opus-4-8',
  anthropicKeyEnc: null,
  atlassian: null,
  schedules: [{ sessionType: 'weekly-update', dayOfWeek: 5, hour: 15, enabled: false, lastRun: null }],
  mcpEnabled: false,
  mcpPort: 7717,
  mcpToken: null,
};

export class SettingsService {
  private data: PersistedSettings = { ...DEFAULTS };
  private readonly file: string;

  constructor() {
    this.file = join(app.getPath('userData'), 'settings.json');
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      this.data = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<PersistedSettings>) };
    } catch {
      this.data = { ...DEFAULTS };
    }
    // Mint the MCP token on first run (bearer secret for the local server).
    if (!this.data.mcpToken) {
      this.data.mcpToken = randomUUID().replace(/-/g, '');
      await this.persist();
    }
  }

  async setMcp(patch: { enabled?: boolean; port?: number }): Promise<void> {
    if (patch.enabled !== undefined) this.data.mcpEnabled = patch.enabled;
    if (patch.port !== undefined) this.data.mcpPort = patch.port;
    await this.persist();
  }

  private async persist(): Promise<void> {
    await fs.writeFile(this.file, JSON.stringify(this.data, null, 2), 'utf8');
  }

  get(): PersistedSettings {
    return this.data;
  }

  async setVaultPath(path: string | null): Promise<void> {
    this.data.vaultPath = path;
    await this.persist();
  }

  async setModel(modelId: string): Promise<void> {
    this.data.modelId = modelId;
    await this.persist();
  }

  async setAnthropicKey(key: string): Promise<void> {
    this.data.anthropicKeyEnc = this.encrypt(key);
    await this.persist();
  }

  getAnthropicKey(): string | null {
    return this.data.anthropicKeyEnc ? this.decrypt(this.data.anthropicKeyEnc) : null;
  }

  async setAtlassian(baseUrl: string, email: string, token: string): Promise<void> {
    this.data.atlassian = { baseUrl, email, tokenEnc: this.encrypt(token) };
    await this.persist();
  }

  getAtlassian(): { baseUrl: string; email: string; token: string } | null {
    if (!this.data.atlassian) return null;
    return {
      baseUrl: this.data.atlassian.baseUrl,
      email: this.data.atlassian.email,
      token: this.decrypt(this.data.atlassian.tokenEnc),
    };
  }

  async setSchedule(sessionType: string, patch: Partial<ScheduleEntry>): Promise<void> {
    const existing = this.data.schedules.find((s) => s.sessionType === sessionType);
    if (existing) Object.assign(existing, patch);
    else this.data.schedules.push({ sessionType, dayOfWeek: 5, hour: 15, enabled: false, lastRun: null, ...patch });
    await this.persist();
  }

  private encrypt(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) return Buffer.from(value, 'utf8').toString('base64');
    return safeStorage.encryptString(value).toString('base64');
  }

  private decrypt(enc: string): string {
    const buf = Buffer.from(enc, 'base64');
    if (!safeStorage.isEncryptionAvailable()) return buf.toString('utf8');
    try {
      return safeStorage.decryptString(buf);
    } catch {
      return '';
    }
  }
}
