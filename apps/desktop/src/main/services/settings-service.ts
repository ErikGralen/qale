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
  skill: string;
  /** 0–6 (Sun–Sat). */
  dayOfWeek: number;
  /** 0–23 local hour. */
  hour: number;
  enabled: boolean;
  /** ISO of the last time this slot fired (for catch-up + due checks). */
  lastRun: string | null;
}

/**
 * First run, as a settings record (docs/onboarding.md ONB-1).
 *
 * It lives HERE rather than in the renderer because a packaged `file://` build
 * does not persist localStorage — the progressive-reveal machinery gets away
 * with that, an onboarding flag would not: it would run the opening at every
 * launch forever.
 */
export interface OnboardingRecord {
  finishedAt: string | null;
  step: string;
  done: string[];
  skipped: string[];
  checklist: Record<string, { at: string; line: string }>;
  dismissed: boolean;
  telemetry: boolean;
}

const ONBOARDING_DEFAULT: OnboardingRecord = {
  finishedAt: null,
  step: 'hello',
  done: [],
  skipped: [],
  checklist: {},
  dismissed: false,
  // On by default for invited beta users (we ask at invite time too), and a
  // real switch: off means nothing is sent.
  telemetry: true,
};

export interface PersistedSettings {
  vaultPath: string | null;
  /**
   * Which model new sessions open on. A session can be moved off it one at a
   * time (the composer's model picker), and that choice is remembered against
   * the session, not here.
   */
  modelId: string;
  anthropicKeyEnc: string | null;
  atlassian: { baseUrl: string; email: string; tokenEnc: string } | null;
  /** Google OAuth grant. Only the
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
  /** First run and what is left of it. Absent in files written before it existed. */
  onboarding?: OnboardingRecord;
  /**
   * Who this install is, for telemetry and nothing else (docs/telemetry-posthog.md
   * TEL-4). Minted once and never changed, including when consent is turned off
   * and back on. It is the `distinctId`; the name and work email ride alongside
   * as person properties, read from {@link PersistedSettings.identity}. A uuid
   * rather than the email because the email arrives on screen 2, after the app
   * has already launched, and can be edited or left blank — any of which would
   * fork one person into two.
   */
  installId?: string;
  /** Local MCP server: token-gated so the customer's Claude can query the memory. */
  mcpEnabled: boolean;
  mcpPort: number;
  mcpToken: string | null;
  /**
   * LEGACY — agent off switches now live in the agent file's frontmatter
   * (`agents/<name>/AGENT.md`, `enabled: false`). Kept optional so old settings files
   * parse; read once by the migration in handlers.ts, then cleared.
   */
  agents?: Record<string, boolean>;
}

const DEFAULTS: PersistedSettings = {
  vaultPath: null,
  // The current Opus, same price as 4.8, and better at the long agentic work
  // this product is. A settings file naming a model pi no longer carries still
  // opens: `resolveModel` steps down to this default, then to anything.
  modelId: 'claude-opus-5',
  anthropicKeyEnc: null,
  atlassian: null,
  google: null,
  schedules: [{ skill: 'weekly-update', dayOfWeek: 5, hour: 15, enabled: false, lastRun: null }],
  identity: { name: null, aliases: [] },
  onboarding: ONBOARDING_DEFAULT,
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
    // Whether the FILE carried an onboarding record, read before the defaults
    // are merged in. After the merge there is always one, so the grandfathering
    // check below would have nothing to go on.
    let hadOnboarding = false;
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
      hadOnboarding = !!parsed.onboarding;
      this.data = { ...DEFAULTS, ...parsed };
    } catch {
      this.data = { ...DEFAULTS };
    }
    // A schedule names a skill; it used to name a "session type". Carry settings
    // written before the rename over rather than silently losing the slot.
    this.data.schedules = this.data.schedules.map((s) => ({
      ...s,
      skill: s.skill ?? (s as { session_type?: string; sessionType?: string }).sessionType ?? 'weekly-update',
    }));
    // Everyone's settings file says `claude-opus-4-8`, because that was the
    // shipped default and nobody ever had a reason to change it. Carry that one
    // value forward to the new default: same family, same price, better at long
    // work. Any other model in there was a deliberate pick and is left alone.
    const carriedModel = this.data.modelId === 'claude-opus-4-8';
    if (carriedModel) this.data.modelId = DEFAULTS.modelId;
    // Mint the MCP token on first run (bearer secret for the local server).
    const mintedToken = !this.data.mcpToken;
    if (mintedToken) this.data.mcpToken = randomUUID().replace(/-/g, '');
    // And the telemetry install id, in the same breath and for the same reason:
    // it has to exist before the first thing that would report happens.
    const mintedInstall = !this.data.installId;
    if (mintedInstall) this.data.installId = randomUUID();
    const grandfathered = this.migrateOnboarding(hadOnboarding);
    if (carriedModel || mintedToken || mintedInstall || grandfathered) await this.persist();
  }

  /**
   * Fill in the onboarding record, and grandfather anyone who was already
   * using the app: an install with a workspace has already answered every
   * question the opening asks, so showing it would be an insult, not a
   * welcome. They still get the First steps card — that one is about the
   * product, not the setup. Returns whether anything was written.
   */
  private migrateOnboarding(hadOnboarding: boolean): boolean {
    if (hadOnboarding) {
      // Half-written records (a crash between two fields) fill in from the
      // defaults for whatever is missing rather than throwing at first read.
      this.data.onboarding = { ...ONBOARDING_DEFAULT, ...this.data.onboarding };
      return false;
    }
    this.data.onboarding = {
      ...ONBOARDING_DEFAULT,
      ...(this.data.vaultPath
        ? { finishedAt: new Date().toISOString(), step: 'first-light' as const }
        : {}),
    };
    return true;
  }

  getOnboarding(): OnboardingRecord {
    return (this.data.onboarding ??= { ...ONBOARDING_DEFAULT });
  }

  /**
   * Merge-patch the opening's progress. `done` also clears a prior skip: the
   * PM who waved past the key screen and came back to it has not skipped it.
   */
  async patchOnboarding(patch: {
    step?: string;
    done?: string;
    skipped?: string;
    finished?: boolean;
    dismissed?: boolean;
    telemetry?: boolean;
  }): Promise<void> {
    const current = this.getOnboarding();
    const done = patch.done ? [...new Set([...current.done, patch.done])] : current.done;
    const skipped = patch.done
      ? current.skipped.filter((s) => s !== patch.done)
      : patch.skipped
        ? [...new Set([...current.skipped, patch.skipped])]
        : current.skipped;
    this.data.onboarding = {
      ...current,
      done,
      skipped,
      ...(patch.step ? { step: patch.step } : {}),
      ...(patch.finished ? { finishedAt: current.finishedAt ?? new Date().toISOString() } : {}),
      ...(patch.dismissed !== undefined ? { dismissed: patch.dismissed } : {}),
      ...(patch.telemetry !== undefined ? { telemetry: patch.telemetry } : {}),
    };
    await this.persist();
  }

  /**
   * Stamp a First step, the first time it happens. Later repeats are ignored
   * on purpose: the row's line reports the moment it was earned, and a second
   * transcript must not rewrite what the first one said. Returns whether this
   * was the one that landed, so the caller only pushes when something changed.
   */
  async markFirstStep(id: string, line: string): Promise<boolean> {
    const current = this.getOnboarding();
    if (current.checklist[id]) return false;
    this.data.onboarding = {
      ...current,
      checklist: { ...current.checklist, [id]: { at: new Date().toISOString(), line } },
    };
    await this.persist();
    return true;
  }

  /**
   * The legacy agent-switch map, handed over exactly once: the caller migrates
   * any off switch into the agent file's frontmatter, and the map is cleared
   * here so the next launch has nothing to migrate.
   */
  async takeAgentOverrides(): Promise<Record<string, boolean> | undefined> {
    const overrides = this.data.agents;
    if (!overrides) return undefined;
    delete this.data.agents;
    await this.persist();
    return overrides;
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

  /** The telemetry distinct id (TEL-4). Always set after {@link load}. */
  getInstallId(): string {
    return (this.data.installId ??= randomUUID());
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

  async setSchedule(skill: string, patch: Partial<ScheduleEntry>): Promise<void> {
    const existing = this.data.schedules.find((s) => s.skill === skill);
    if (existing) Object.assign(existing, patch);
    else this.data.schedules.push({ skill, dayOfWeek: 5, hour: 15, enabled: false, lastRun: null, ...patch });
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
      console.error('[qale] OS keychain unavailable — storing secret base64-obfuscated, NOT encrypted');
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
