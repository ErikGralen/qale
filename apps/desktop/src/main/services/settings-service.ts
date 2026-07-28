import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

/**
 * Persisted app settings (PLAN §3.5 "primary app state"). Secrets (Anthropic key,
 * Atlassian token) are encrypted at rest with Electron safeStorage WHEN the OS
 * keychain is available — otherwise they are stored base64-obfuscated and the
 * Settings UI says so (`secretsEncrypted`). Only ever decrypted in the main
 * process — never sent to the renderer. Values are prefixed with their scheme
 * so an availability change between write and read can't produce garbage.
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
  /** Google OAuth grant (docs/google-calendar-integration.md §Auth). Only the
   *  long-lived refresh token persists — access tokens live in memory. `email`
   *  arrives with the first successful verify (the primary calendar's id). */
  google: { email: string | null; refreshTokenEnc: string; scopes?: string } | null;
  schedules: ScheduleEntry[];
  /**
   * Who the PO is. `name` is what their own participant row reads (an invite
   * carries an address, not a name); `aliases` are extra addresses that mean
   * "me" beyond the connected accounts — a work address the calendar grant
   * doesn't know about still has to resolve to "You".
   */
  identity: { name: string | null; aliases: string[] };
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
  google: null,
  schedules: [{ sessionType: 'weekly-update', dayOfWeek: 5, hour: 15, enabled: false, lastRun: null }],
  identity: { name: null, aliases: [] },
  mcpEnabled: false,
  mcpPort: 7717,
  mcpToken: null,
};

export class SettingsService {
  private data: PersistedSettings = { ...DEFAULTS };
  private readonly file: string;
  /** A stored secret failed to decrypt (keychain reset) — silent '' would read as "no key was ever entered". */
  private unreadable = false;

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

  // Tmp-file + rename: a crash mid-write must not lose vault path, keys,
  // schedules and the MCP token in one shot.
  private async persist(): Promise<void> {
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
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
    // Re-entering a secret is the recovery path; a still-broken second secret
    // re-raises the flag on its next read, before the flag reaches the UI.
    this.unreadable = false;
    await this.persist();
  }

  getAnthropicKey(): string | null {
    const key = this.data.anthropicKeyEnc ? this.decrypt(this.data.anthropicKeyEnc) : null;
    return key || null;
  }

  async setAtlassian(baseUrl: string, email: string, token: string): Promise<void> {
    this.data.atlassian = { baseUrl, email, tokenEnc: this.encrypt(token) };
    this.unreadable = false;
    await this.persist();
  }

  /** Disconnect: the credential must actually go away — a kept token would make
   *  "Disconnect" a lie (the quiet kind the review called out). */
  async clearAtlassian(): Promise<void> {
    this.data.atlassian = null;
    await this.persist();
  }

  getAtlassian(): { baseUrl: string; email: string; token: string } | null {
    if (!this.data.atlassian) return null;
    const token = this.decrypt(this.data.atlassian.tokenEnc);
    // An unreadable token is not a credential — a client built on '' would just
    // 401 later, far from the cause.
    if (!token) return null;
    return {
      baseUrl: this.data.atlassian.baseUrl,
      email: this.data.atlassian.email,
      token,
    };
  }

  async setGoogle(refreshToken: string, email: string | null, scopes?: string): Promise<void> {
    this.data.google = {
      email,
      refreshTokenEnc: this.encrypt(refreshToken),
      ...(scopes ? { scopes } : {}),
    };
    this.unreadable = false;
    await this.persist();
  }

  /** The verify probe learns who the grant belongs to after the browser flow. */
  async setGoogleEmail(email: string): Promise<void> {
    if (!this.data.google) return;
    this.data.google = { ...this.data.google, email };
    await this.persist();
  }

  /** Disconnect: the grant must actually go away (same honesty rule as Atlassian). */
  async clearGoogle(): Promise<void> {
    this.data.google = null;
    await this.persist();
  }

  getGoogle(): { email: string | null; refreshToken: string; scopes: string } | null {
    if (!this.data.google) return null;
    const refreshToken = this.decrypt(this.data.google.refreshTokenEnc);
    if (!refreshToken) return null;
    return { email: this.data.google.email, refreshToken, scopes: this.data.google.scopes ?? '' };
  }

  /** Merge-patch the PO's identity; a blank name clears it (back to "You"). */
  async setIdentity(patch: { name?: string | null; aliases?: string[] }): Promise<void> {
    const current = this.getIdentity();
    this.data.identity = {
      name: patch.name === undefined ? current.name : patch.name?.trim() || null,
      aliases: (patch.aliases ?? current.aliases)
        .map((a) => a.trim().toLowerCase())
        .filter((a, i, all) => a.length > 0 && all.indexOf(a) === i),
    };
    await this.persist();
  }

  /** Tolerates settings files written before identity existed (or half-written). */
  getIdentity(): { name: string | null; aliases: string[] } {
    const stored = this.data.identity;
    return {
      name: typeof stored?.name === 'string' && stored.name.trim() ? stored.name.trim() : null,
      aliases: Array.isArray(stored?.aliases)
        ? stored.aliases.filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
        : [],
    };
  }

  /**
   * Every address that means "me": the connected accounts (a calendar invite
   * carries the grant's own address) plus hand-added aliases. Lower-cased —
   * attendee emails are compared case-insensitively.
   */
  selfEmails(): string[] {
    const raw = [this.data.google?.email, this.data.atlassian?.email, ...this.getIdentity().aliases];
    return raw
      .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
      .map((e) => e.trim().toLowerCase())
      .filter((e, i, all) => all.indexOf(e) === i);
  }

  async setSchedule(sessionType: string, patch: Partial<ScheduleEntry>): Promise<void> {
    const existing = this.data.schedules.find((s) => s.sessionType === sessionType);
    if (existing) Object.assign(existing, patch);
    else this.data.schedules.push({ sessionType, dayOfWeek: 5, hour: 15, enabled: false, lastRun: null, ...patch });
    await this.persist();
  }

  /** Is at-rest encryption actually in effect (OS keychain reachable)? */
  secretsEncrypted(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  /** Did a stored secret fail to decrypt this run? The UI asks for re-entry instead of acting like no key exists. */
  secretsUnreadable(): boolean {
    return this.unreadable;
  }

  private encrypt(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      console.error('[pm] OS keychain unavailable — storing secret base64-obfuscated, NOT encrypted');
      return `b64:${Buffer.from(value, 'utf8').toString('base64')}`;
    }
    return `enc:${safeStorage.encryptString(value).toString('base64')}`;
  }

  private decrypt(enc: string): string {
    // Scheme-prefixed values decode by their own scheme; unprefixed values are
    // legacy writes that used whatever was available at the time.
    const scheme = enc.startsWith('enc:') ? 'enc' : enc.startsWith('b64:') ? 'b64' : 'legacy';
    const body = scheme === 'legacy' ? enc : enc.slice(4);
    const buf = Buffer.from(body, 'base64');
    if (scheme === 'b64') return buf.toString('utf8');
    if (scheme === 'legacy' && !safeStorage.isEncryptionAvailable()) return buf.toString('utf8');
    try {
      return safeStorage.decryptString(buf);
    } catch {
      this.unreadable = true;
      return '';
    }
  }
}
