import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  defaultModelId,
  llmProvider,
  modelForProvider,
  workspaceLanguage,
  type LanguageTag,
  type LlmProvider,
} from '@qale/domain';
import { retryWhileLocked } from '@qale/vault';
import { registerSecretValue } from '../log.js';

/**
 * Persisted app settings (PLAN §3.5 "primary app state"). Secrets (Anthropic key,
 * Atlassian token) are encrypted at rest with Electron safeStorage WHEN the OS
 * has a secret store to offer. Otherwise they are stored base64-obfuscated and
 * the Settings UI says so (`secretsEncrypted`). Only ever decrypted in the main
 * process — never sent to the renderer. Values are prefixed with their scheme
 * so an availability change between write and read can't produce garbage.
 *
 * What safeStorage is underneath differs by platform, and both differences are
 * visible to the user, so the copy in Settings names neither:
 *
 * - **macOS**: the login keychain. Available once the user is logged in, and it
 *   can PROMPT (the "Qale wants to use your confidential information" dialog),
 *   which is why a decrypt failing is an ordinary state here and not a
 *   catastrophe: the user pressed Deny, and the re-entry path below is what they
 *   land in.
 * - **Windows**: DPAPI. It never prompts, so the user sees nothing at all in the
 *   normal case, but it is bound to the Windows account and the machine. Carry
 *   `settings.json` to another PC, or restore a profile backup into a different
 *   account, and every stored secret decrypts to a hard failure with no dialog
 *   and no way back. Same landing place, same fix: `unreadable` goes true and
 *   Settings asks for the keys again.
 *
 * The two are worth writing down together because they produce the SAME state
 * from opposite causes, and that state (rather than any keychain) is what the
 * app and its copy talk about.
 *
 * Every credential that passes through here is also handed to the log scrubber
 * ({@link registerSecretValue}), so it is blanked out of a log line by value and
 * not just by shape.
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
 * does not persist localStorage — the sidebar's pin set gets away with that, an
 * onboarding flag would not: it would run the opening at every launch forever.
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
   * Whose API answers: Anthropic or Google. One at a time, never both, and no
   * fallback between them. Absent in files written before the choice existed,
   * which all named Anthropic by having nowhere else to go.
   */
  provider?: LlmProvider;
  /**
   * Which model new sessions open on. A session can be moved off it one at a
   * time (the composer's model picker), and that choice is remembered against
   * the session, not here. Always a model of the CHOSEN provider: switching
   * provider carries this to the new provider's default (see {@link setProvider}).
   */
  modelId: string;
  /**
   * Both keys are kept, only the chosen provider's is used. Somebody trying
   * Gemini for a week should not have to find their Anthropic key again to come
   * back, and a key nobody is using reaches nothing: the runtime is only ever
   * handed the one in force.
   *
   * `geminiKeyEnc` is named for the API, not the company. `google` on this
   * record is already the Calendar grant, and one word for two credentials is
   * how the wrong one gets cleared.
   */
  anthropicKeyEnc: string | null;
  geminiKeyEnc?: string | null;
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
  /**
   * What this workspace is written in (OW5), as a bare language tag: "sv", not
   * "sv-SE". State, not a guess each run makes from whatever it happened to
   * read. The LANGUAGE part only, deliberately: sv-SE and sv-FI are the same
   * language, so moving country must not read as switching language and quietly
   * restate the setting. Derived once from the OS locale on first run (see
   * {@link load}) and the PM's own from that moment on.
   *
   * Absent in files written before it existed; {@link getLanguage} answers for
   * those, and English is the floor.
   */
  language?: string;
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
  provider: 'anthropic',
  // The current Opus: the best of the shortlist at the long agentic work this
  // product is. A settings file naming a model pi no longer carries still
  // opens: `resolveModel` steps down to this default, then to anything.
  modelId: defaultModelId('anthropic'),
  anthropicKeyEnc: null,
  geminiKeyEnc: null,
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
  /** A stored secret failed to decrypt (see the class comment); a silent '' would read as "no key was ever entered". */
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
      skill:
        s.skill ??
        (s as { session_type?: string; sessionType?: string }).sessionType ??
        'weekly-update',
    }));
    // The provider, and the model that has to belong to it. Settled together
    // because they are one fact: a Claude id under a Gemini key is not a
    // preference, it is a session that cannot start. Files written before the
    // choice existed name no provider and get Anthropic, which is the only one
    // they could ever have been using.
    //
    // A model that has dropped off the shortlist (every older Opus and Sonnet,
    // and the dated snapshots pi still carries) carries to the provider's
    // default rather than staying. It would otherwise sit in the settings file
    // selecting nothing in a picker that no longer lists it.
    const provider = llmProvider(this.data.provider);
    const settledModel = modelForProvider(provider, this.data.modelId);
    const carriedModel = this.data.provider !== provider || this.data.modelId !== settledModel;
    this.data.provider = provider;
    this.data.modelId = settledModel;
    // Mint the MCP token on first run (bearer secret for the local server).
    const mintedToken = !this.data.mcpToken;
    if (mintedToken) this.data.mcpToken = randomUUID().replace(/-/g, '');
    // Whether it was just minted or read off disk, the log must never print it
    // (a dev flag does exactly that on purpose).
    registerSecretValue(this.data.mcpToken);
    // And the telemetry install id, in the same breath and for the same reason:
    // it has to exist before the first thing that would report happens.
    const mintedInstall = !this.data.installId;
    if (mintedInstall) this.data.installId = randomUUID();
    // The workspace language, taken from the OS locale exactly ONCE (OW5). From
    // then on it is the PM's setting: a laptop that changes region, or a machine
    // this workspace is copied onto, must never restate what they write in.
    // Region is dropped on the way in and on the way back out, so a stored
    // "sv-SE" settles to "sv" and stops looking like a change every launch.
    const storedLanguage = this.data.language;
    this.data.language = workspaceLanguage(storedLanguage ?? app.getLocale());
    const settledLanguage = this.data.language !== storedLanguage;
    const grandfathered = this.migrateOnboarding(hadOnboarding);
    if (carriedModel || mintedToken || mintedInstall || settledLanguage || grandfathered)
      await this.persist();
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
        ? { finishedAt: new Date().toISOString(), step: 'telemetry' as const }
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
  //
  // The rename retries while the destination is locked. On Windows, replacing an
  // existing file fails outright with EPERM/EBUSY if anything holds it open, and
  // antivirus opens `settings.json` the instant it is rewritten. Settings are
  // saved on nearly every interaction (a toggle, a schedule, an onboarding step),
  // so this is the write that meets a scanner most often, and losing it means the
  // user's change silently does not stick.
  private async persist(): Promise<void> {
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    await retryWhileLocked(() => fs.rename(tmp, this.file));
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

  /** Whose API answers. Always a provider we carry, whatever is on disk. */
  getProvider(): LlmProvider {
    return llmProvider(this.data.provider);
  }

  /**
   * Point the workspace at the other provider. The model moves with it: their
   * own model stays if it is theirs, and their default takes over if it is not.
   * Neither key is touched, so switching back needs no second paste.
   */
  async setProvider(provider: LlmProvider): Promise<void> {
    this.data.provider = provider;
    this.data.modelId = modelForProvider(provider, this.data.modelId);
    await this.persist();
  }

  /** What this workspace is written in. Always a language, never a locale. */
  getLanguage(): LanguageTag {
    return workspaceLanguage(this.data.language);
  }

  /**
   * Change the workspace language. Only what gets WRITTEN from here on: nothing
   * on disk is touched, and notes already written in the old language stay in it
   * (the agent detects that per note rather than trusting this).
   */
  async setLanguage(language: string): Promise<void> {
    const next = workspaceLanguage(language);
    if (next === this.data.language) return;
    this.data.language = next;
    await this.persist();
  }

  /**
   * Store one provider's key. It does not choose the provider: pasting a Gemini
   * key while the workspace runs on Claude saves it and changes nothing, which
   * is what lets the opening ask for the key and the choice in either order.
   * An empty value clears that key, so "remove" needs no second call.
   */
  async setKey(provider: LlmProvider, key: string): Promise<void> {
    const value = key.trim();
    registerSecretValue(value);
    const stored = value ? this.encrypt(value) : null;
    if (provider === 'google') this.data.geminiKeyEnc = stored;
    else this.data.anthropicKeyEnc = stored;
    // Re-entering a secret is the recovery path; a still-broken second secret
    // re-raises the flag on its next read, before the flag reaches the UI.
    this.unreadable = false;
    await this.persist();
  }

  getKey(provider: LlmProvider): string | null {
    const enc = provider === 'google' ? this.data.geminiKeyEnc : this.data.anthropicKeyEnc;
    const key = enc ? this.decrypt(enc) : null;
    // Decryption is where a stored secret first becomes a value we hold, so it
    // is where the scrubber has to hear about it: settings written on an
    // earlier run never pass through the setter again.
    registerSecretValue(key);
    return key || null;
  }

  /** The key the agent actually runs on: the chosen provider's, and only that. */
  getActiveKey(): string | null {
    return this.getKey(this.getProvider());
  }

  async setAtlassian(baseUrl: string, email: string, token: string): Promise<void> {
    registerSecretValue(token);
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
    registerSecretValue(token);
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
    registerSecretValue(refreshToken);
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
    registerSecretValue(refreshToken);
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
    const raw = [
      this.data.google?.email,
      this.data.atlassian?.email,
      ...this.getIdentity().aliases,
    ];
    return raw
      .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
      .map((e) => e.trim().toLowerCase())
      .filter((e, i, all) => all.indexOf(e) === i);
  }

  async setSchedule(skill: string, patch: Partial<ScheduleEntry>): Promise<void> {
    const existing = this.data.schedules.find((s) => s.skill === skill);
    if (existing) Object.assign(existing, patch);
    else
      this.data.schedules.push({
        skill,
        dayOfWeek: 5,
        hour: 15,
        enabled: false,
        lastRun: null,
        ...patch,
      });
    await this.persist();
  }

  /** Is at-rest encryption actually in effect (the OS has a secret store)? */
  secretsEncrypted(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  /**
   * Did a stored secret fail to decrypt this run? The UI asks for re-entry
   * instead of acting like no key exists. True after a Deny on macOS and after a
   * settings file arrives from another Windows account or machine (DPAPI), which
   * is the same dead end and takes the same fix.
   */
  secretsUnreadable(): boolean {
    return this.unreadable;
  }

  private encrypt(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      console.error('[qale] no OS secret store: storing secret base64-obfuscated, NOT encrypted');
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
