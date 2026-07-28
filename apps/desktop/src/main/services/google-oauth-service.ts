import { createServer, type Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { shell } from 'electron';
import { CalendarAuthError } from '@pm/connectors';
import type { SettingsService } from './settings-service.js';

/**
 * Google OAuth for installed apps (docs/google-calendar-integration.md §Auth):
 * loopback redirect + PKCE, the flow Google sanctions for public desktop
 * clients — the embedded client "secret" is officially non-confidential. The
 * surface is provider-level, not calendar-level: Drive/Gmail later are a scope
 * string and a connector, zero new auth machinery here.
 *
 * Lifecycle: `connect()` runs the browser round-trip and persists ONLY the
 * refresh token (safeStorage-encrypted via SettingsService); access tokens are
 * ephemeral, refreshed in memory, never written anywhere. A revoked/expired
 * grant surfaces as {@link CalendarAuthError}, which the sync engine renders as
 * the quiet `auth-expired` health state — never a modal, never an Inbox card.
 */

/** v1 scope: read-only. Write scope arrives with outbound events (phase 4) via
 *  incremental consent. `openid email` is deliberately absent — identity comes
 *  from the primary calendar probe, no extra scope to consent to. */
export const CALENDAR_SCOPES = 'https://www.googleapis.com/auth/calendar.readonly';

/** Event read+write — requested only when the first outbound event is pushed
 *  (phase 4), via incremental consent. Google shows the extra-permission page at
 *  exactly that moment; the reconnect returns a grant covering both scopes. */
export const CALENDAR_WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
/** Full read/write also satisfies the write requirement (some grants carry it). */
const CALENDAR_FULL_SCOPE = 'https://www.googleapis.com/auth/calendar';
export const CALENDAR_RW_SCOPES = `${CALENDAR_SCOPES} ${CALENDAR_WRITE_SCOPE}`;

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** How long the loopback listener waits for the browser round-trip. */
const FLOW_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * The app's Google Cloud OAuth client (docs/google-cloud-setup.md). Shipping
 * these in the binary is sanctioned for installed apps; env vars override for
 * development. Empty = this build can't run the flow, and connect() says so
 * in plain language instead of opening a broken consent page.
 */
const CLIENT_ID = process.env['PM_GOOGLE_CLIENT_ID'] ?? '';
const CLIENT_SECRET = process.env['PM_GOOGLE_CLIENT_SECRET'] ?? '';

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  /** Space-delimited scopes the user actually granted — persisted so a later
   *  write can tell whether incremental consent is still needed. */
  scope?: string;
  error?: string;
  error_description?: string;
}

export class GoogleOAuthService {
  private accessToken: { token: string; expiresAt: number } | null = null;
  private pending: { server: Server; abort: (reason: Error) => void } | null = null;

  constructor(
    private readonly settings: SettingsService,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  isConfigured(): boolean {
    return CLIENT_ID.length > 0;
  }

  hasGrant(): boolean {
    return this.settings.getGoogle() !== null;
  }

  /**
   * Run the full browser consent flow: loopback listener → system browser →
   * code exchange (PKCE) → refresh token persisted. Resolves when the grant is
   * stored; rejects on timeout, denial, or {@link cancel}.
   */
  async connect(scopes: string = CALENDAR_SCOPES): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error(
        'This build has no Google client configured — set PM_GOOGLE_CLIENT_ID (see docs/google-cloud-setup.md).',
      );
    }
    this.cancel(); // one flow at a time; a stale listener must not eat the redirect

    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(16).toString('base64url');

    const code = await this.waitForCode(state, scopes, challenge);
    const body = new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: this.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    });
    const res = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const tokens = (await res.json()) as TokenResponse;
    if (!res.ok || !tokens.refresh_token || !tokens.access_token) {
      throw new Error(
        `Google sign-in didn't complete: ${tokens.error_description ?? tokens.error ?? `HTTP ${res.status}`}`,
      );
    }
    // Persist the granted scopes (Google echoes what the user actually approved)
    // so a later write knows whether it still needs incremental consent.
    await this.settings.setGoogle(
      tokens.refresh_token,
      this.settings.getGoogle()?.email ?? null,
      tokens.scope ?? scopes,
    );
    this.accessToken = {
      token: tokens.access_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    };
  }

  /** Has the grant been extended to calendar writes yet? */
  hasWriteScope(): boolean {
    const granted = (this.settings.getGoogle()?.scopes ?? '').split(/\s+/);
    return granted.includes(CALENDAR_WRITE_SCOPE) || granted.includes(CALENDAR_FULL_SCOPE);
  }

  /**
   * Ensure the grant can write events, running incremental consent if not — the
   * designed moment where Google (not us) asks the PM for the extra permission,
   * exactly when the app first tries to write. Throws if there's no grant to
   * extend, or if the PM declines/cancels the consent.
   */
  async ensureWriteScope(): Promise<void> {
    if (!this.hasGrant()) throw new CalendarAuthError('No Google account is connected.');
    if (this.hasWriteScope()) return;
    await this.connect(CALENDAR_RW_SCOPES);
    if (!this.hasWriteScope()) {
      throw new Error('Google didn’t grant calendar write access — the event was not created.');
    }
  }

  /** Abort a pending browser flow (the PM closed the tab / clicked cancel). */
  cancel(): void {
    if (!this.pending) return;
    const { abort } = this.pending;
    this.pending = null;
    abort(new Error('Google sign-in was cancelled.'));
  }

  /**
   * A currently-valid access token for connectors, refreshing when within 30s
   * of expiry. Throws {@link CalendarAuthError} when the grant is gone
   * (revoked at myaccount.google.com, expired, or never made).
   */
  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt - 30_000 > Date.now()) {
      return this.accessToken.token;
    }
    const grant = this.settings.getGoogle();
    if (!grant) throw new CalendarAuthError('No Google account is connected.');
    const body = new URLSearchParams({
      refresh_token: grant.refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
    });
    const res = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const tokens = (await res.json().catch(() => ({}))) as TokenResponse;
    if (!res.ok || !tokens.access_token) {
      this.accessToken = null;
      // invalid_grant = revoked/expired refresh token — the designed-for quiet
      // state. Anything else (network, 5xx) stays a plain error → unreachable.
      if (tokens.error === 'invalid_grant') throw new CalendarAuthError();
      throw new Error(
        `Google token refresh failed: ${tokens.error_description ?? tokens.error ?? `HTTP ${res.status}`}`,
      );
    }
    this.accessToken = {
      token: tokens.access_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    };
    return this.accessToken.token;
  }

  /** Disconnect: best-effort revoke upstream, then the grant actually goes away. */
  async disconnect(): Promise<void> {
    const grant = this.settings.getGoogle();
    this.accessToken = null;
    if (grant) {
      await this.fetchImpl(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(grant.refreshToken)}`, {
        method: 'POST',
      }).catch(() => {});
    }
    await this.settings.clearGoogle();
  }

  // -------------------------------------------------------------------------

  private redirectUri = '';

  /** One-shot loopback listener on an ephemeral port; resolves with the auth
   *  code once Google redirects back, then closes. */
  private waitForCode(state: string, scopes: string, challenge: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', this.redirectUri);
        if (url.pathname !== '/oauth2/callback') {
          res.writeHead(404).end();
          return;
        }
        const finishPage = (line: string): void => {
          res
            .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            .end(`<html><body style="font-family:system-ui;margin:3rem"><p>${line}</p></body></html>`);
        };
        const err = url.searchParams.get('error');
        const code = url.searchParams.get('code');
        if (err || !code || url.searchParams.get('state') !== state) {
          finishPage('Sign-in didn’t complete — you can close this tab and try again from the app.');
          settle(() => reject(new Error(err === 'access_denied' ? 'Google access was declined.' : 'Google sign-in didn’t complete.')));
          return;
        }
        finishPage('Connected — you can close this tab and return to the app.');
        settle(() => resolve(code));
      });

      const timer = setTimeout(() => {
        settle(() => reject(new Error('Google sign-in timed out — try Connect again.')));
      }, FLOW_TIMEOUT_MS);

      const settle = (done: () => void): void => {
        clearTimeout(timer);
        if (this.pending?.server === server) this.pending = null;
        server.close();
        done();
      };

      server.on('error', (err) => settle(() => reject(err)));
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          settle(() => reject(new Error('Couldn’t open the local sign-in listener.')));
          return;
        }
        this.redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`;
        this.pending = { server, abort: (reason) => settle(() => reject(reason)) };
        const authUrl = new URL(AUTH_ENDPOINT);
        authUrl.search = new URLSearchParams({
          client_id: CLIENT_ID,
          redirect_uri: this.redirectUri,
          response_type: 'code',
          scope: scopes,
          state,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          // offline + consent: a refresh token EVERY time, not just the first
          // grant — reconnect must never come back access-token-only.
          access_type: 'offline',
          prompt: 'consent',
        }).toString();
        void shell.openExternal(authUrl.toString());
      });
    });
  }
}
