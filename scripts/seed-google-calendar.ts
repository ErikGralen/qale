/**
 * Seed (and reset) a live Google Calendar with the Bord demo scenario, the
 * calendar-side counterpart of scripts/reset-atlassian.ts. One command both
 * populates a fresh demo account and resets it after a run: it deletes every
 * event this script has ever seeded (tagged with a private `qaleDemo` property)
 * inside the window, then recreates the cast, so run it as often as you like
 * and the calendar always converges to the same story.
 *
 * Why this exists: phases 2-4 of the Google Calendar integration (auto-prep,
 * capture-matching, participant resolution, outbound events) only come alive
 * when the shallow event index has real rows, which needs a real calendar. The
 * offline vault ships one static synced meeting so the chrome renders, but the
 * live features need this.
 *
 * What it seeds:
 *  - yesterday's **Brasserie Lund quarterly review**: the star. It is what the
 *    dropped transcript matches against;
 *  - the **fortnightly steering** (Thursdays) with the CPO, the two tech leads
 *    and the head of sales, which is what before-meeting auto-prep reads;
 *  - the upcoming **1:1 with the Bookings tech lead**, where the no-show fees
 *    stories are owed;
 *  - the **Sjögatan check-in** and **sprint planning**, so "the week fills
 *    itself in" is real and duplicate-free. Anything the vault already holds a
 *    hand-authored note for is NOT seeded: past = vault.
 *  Every attendee email matches a vault person note's `email`, so participant
 *  resolution turns them into `[[people/…]]` links on sync.
 *
 * The cast itself lives in scripts/lib/google-cast.ts, so this script and the
 * offline fixture builder (scripts/build-demo-google-fixture.ts) seed the same
 * week.
 *
 * Dates: the canonical scenario is anchored on 2026-07-17 (see
 * scripts/refresh-demo.ts). Every meeting is anchored there and slid by
 * (today − anchor) at runtime, so the live calendar tells the same "now" story
 * as the refreshed .vault-dev. Run both the same day.
 *
 * Auth: Google has no API-token path, so this runs the same loopback + PKCE
 * flow the app uses (a browser opens once for consent, write scope included).
 * The resulting refresh token is cached in .google-demo.json (gitignored, mode
 * 600); later runs reuse it silently. The OAuth client comes from
 * QALE_GOOGLE_CLIENT_ID / QALE_GOOGLE_CLIENT_SECRET (the same env the app needs,
 * docs/google-cloud-setup.md).
 *
 * By default it targets the PRIMARY calendar; pass --calendar to point it at a
 * specific one (by name or id) so your other calendars are never touched. It
 * only ever reads/writes the one calendar you name, and only deletes events it
 * seeded itself (the qaleDemo marker), never your real events.
 *
 *   pnpm seed-google-calendar --calendar="PM/PO Test"   # seed/reset that calendar
 *   pnpm seed-google-calendar --calendar="PM/PO Test" --dry   # print the plan, write nothing
 *   pnpm seed-google-calendar --calendar="PM/PO Test" --today=2026-09-01 --anchor=2026-07-17
 *   pnpm seed-google-calendar --calendar="PM/PO Test" --tz=Europe/Oslo
 *   pnpm seed-google-calendar --calendar="PM/PO Test" --no-reconcile  # leave the runtime vault alone
 *   pnpm seed-google-calendar                            # (no --calendar) targets primary
 *
 * The calendar can also come from QALE_GOOGLE_CALENDAR (and tz from QALE_GOOGLE_TZ),
 * so the chained `pnpm reset` (refresh-demo → reset-atlassian → this) can target
 * it without threading a flag through.
 *
 * Reconcile (default on): the runtime .vault-dev ships ONE pre-synced stub
 * meeting (provider: google-calendar) so the offline chrome renders. Against a
 * live calendar that stub would sit forever beside the real synced note, so the
 * reconcile step removes such stubs from .vault-dev; the live sync recreates
 * them for real on the next pull. The canonical vault-dev/ is NEVER touched.
 */
import { createServer, type Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { exec } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { platform } from 'node:os';
import {
  ANCHOR,
  CAST_MEETINGS,
  DEFAULT_TIMEZONE,
  DEMO_TAG,
  DEMO_TAGS,
  daysBetween,
  endTimeOf,
  shiftDate,
  type CastMeeting,
} from './lib/google-cast.ts';

const CREDS_FILE = '.google-demo.json';
const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
// Read (to resolve the target calendar by name) + event write. Same two scopes
// the app carries once outbound events are enabled.
const SCOPE =
  'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events';
const FLOW_TIMEOUT_MS = 3 * 60 * 1000;

const CLIENT_ID = process.env['QALE_GOOGLE_CLIENT_ID'] ?? '';
const CLIENT_SECRET = process.env['QALE_GOOGLE_CLIENT_SECRET'] ?? '';

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

interface Args {
  anchor: string;
  today: string;
  tz: string;
  /** Which calendar to seed: a name ("PM/PO Test"), an id, or "primary". */
  calendar: string;
  dry: boolean;
  save: boolean;
  reconcile: boolean;
  vault: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    anchor: ANCHOR,
    today: new Date().toISOString().slice(0, 10),
    tz: process.env['QALE_GOOGLE_TZ'] ?? DEFAULT_TIMEZONE,
    // --calendar wins; else QALE_GOOGLE_CALENDAR (so the chained `pnpm reset` can
    // target it without threading a flag); else the primary calendar.
    calendar: process.env['QALE_GOOGLE_CALENDAR'] ?? 'primary',
    dry: false,
    save: false,
    reconcile: true,
    vault: '.vault-dev',
  };
  for (const a of argv) {
    if (a === '--dry' || a === '--dry-run') args.dry = true;
    else if (a === '--save') args.save = true;
    else if (a === '--no-reconcile') args.reconcile = false;
    else if (a.startsWith('--anchor=')) args.anchor = a.slice(9);
    else if (a.startsWith('--today=')) args.today = a.slice(8);
    else if (a.startsWith('--tz=')) args.tz = a.slice(5);
    else if (a.startsWith('--calendar=')) args.calendar = a.slice(11);
    else if (a.startsWith('--vault=')) args.vault = a.slice(8);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

// ---------------------------------------------------------------------------
// OAuth: loopback + PKCE, refresh-token cached in .google-demo.json. Mirrors
// apps/desktop/src/main/services/google-oauth-service.ts, minus Electron.
// ---------------------------------------------------------------------------

interface Creds {
  refreshToken?: string;
}

function readCreds(credsPath: string): Creds {
  if (!existsSync(credsPath)) return {};
  try {
    return JSON.parse(readFileSync(credsPath, 'utf8')) as Creds;
  } catch {
    throw new Error(`${CREDS_FILE} exists but is not valid JSON — fix or delete it.`);
  }
}

function openBrowser(url: string): void {
  const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start ""' : 'xdg-open';
  exec(`${cmd} "${url}"`, () => {});
}

/** Run the browser consent flow once, returning a refresh token. */
async function runConsentFlow(): Promise<string> {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');

  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>(
    (res, rej) => {
      let redirect = '';
      const server: Server = createServer((req, resp) => {
        const url = new URL(req.url ?? '/', redirect || 'http://127.0.0.1');
        if (url.pathname !== '/oauth2/callback') {
          resp.writeHead(404).end();
          return;
        }
        const err = url.searchParams.get('error');
        const gotCode = url.searchParams.get('code');
        const ok = !err && gotCode && url.searchParams.get('state') === state;
        resp
          .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          .end(
            `<html><body style="font-family:system-ui;margin:3rem"><p>${ok ? 'Connected — you can close this tab and return to the terminal.' : 'Sign-in didn’t complete — close this tab and re-run.'}</p></body></html>`,
          );
        clearTimeout(timer);
        server.close();
        if (ok) res({ code: gotCode!, redirectUri: redirect });
        else
          rej(
            new Error(
              err === 'access_denied'
                ? 'Google access was declined.'
                : 'Google sign-in didn’t complete.',
            ),
          );
      });
      const timer = setTimeout(() => {
        server.close();
        rej(new Error('Google sign-in timed out — re-run.'));
      }, FLOW_TIMEOUT_MS);
      server.on('error', rej);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (!addr || typeof addr === 'string') {
          rej(new Error('Couldn’t open the local sign-in listener.'));
          return;
        }
        redirect = `http://127.0.0.1:${addr.port}/oauth2/callback`;
        const authUrl = new URL(AUTH_ENDPOINT);
        authUrl.search = new URLSearchParams({
          client_id: CLIENT_ID,
          redirect_uri: redirect,
          response_type: 'code',
          scope: SCOPE,
          state,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          access_type: 'offline',
          prompt: 'consent',
        }).toString();
        console.log(
          `\nOpening the consent page in your browser. If it doesn't open, visit:\n  ${authUrl.toString()}\n`,
        );
        openBrowser(authUrl.toString());
      });
    },
  );

  const body = new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const tokens = (await res.json()) as {
    refresh_token?: string;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !tokens.refresh_token) {
    throw new Error(
      `Token exchange failed: ${tokens.error_description ?? tokens.error ?? `HTTP ${res.status}`}`,
    );
  }
  return tokens.refresh_token;
}

/** Exchange a refresh token for a short-lived access token. */
async function accessTokenFrom(refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const tokens = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !tokens.access_token) {
    throw new Error(
      tokens.error === 'invalid_grant'
        ? `The saved Google token is no longer valid — delete ${CREDS_FILE} and re-run to reconnect.`
        : `Google token refresh failed: ${tokens.error_description ?? tokens.error ?? `HTTP ${res.status}`}`,
    );
  }
  return tokens.access_token;
}

// ---------------------------------------------------------------------------
// Minimal Calendar API client (Bearer token, JSON, plain-language errors).
// ---------------------------------------------------------------------------

interface GEvent {
  id: string;
  summary?: string;
  recurringEventId?: string;
  extendedProperties?: { private?: Record<string, string> };
}

interface GCalendar {
  id: string;
  summary?: string;
  summaryOverride?: string;
  primary?: boolean;
}

class Cal {
  private readonly token: string;
  /** The calendar every read/write targets — set once resolved (default primary). */
  calendarId = 'primary';
  constructor(token: string) {
    this.token = token;
  }

  private async req<T>(
    method: string,
    path: string,
    params: Record<string, string> = {},
    body?: unknown,
  ): Promise<T> {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${API}${path}${qs ? `?${qs}` : ''}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** Every calendar the account can see — used to resolve the target by name. */
  async calendarList(): Promise<GCalendar[]> {
    const out: GCalendar[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.req<{ items?: GCalendar[]; nextPageToken?: string }>(
        'GET',
        '/users/me/calendarList',
        { maxResults: '250', ...(pageToken ? { pageToken } : {}) },
      ).catch((err: Error) => {
        if (/HTTP 40[13]/.test(err.message)) {
          throw new Error(
            `Couldn't list your calendars (${err.message.split(':')[0]}). If you connected before this ` +
              `version, the saved grant lacks read scope — delete ${CREDS_FILE} and re-run to reconnect.`,
          );
        }
        throw err;
      });
      out.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return out;
  }

  /** Every event we've previously seeded (the `qaleDemo` marker), masters and
   *  one-offs; deleting a recurring master removes all its instances. Google
   *  ANDs repeated privateExtendedProperty values, so each tag needs its own
   *  query. Results are de-duplicated by event id. */
  async listSeeded(): Promise<GEvent[]> {
    const byId = new Map<string, GEvent>();
    for (const tag of DEMO_TAGS) {
      let pageToken: string | undefined;
      do {
        const page = await this.req<{ items?: GEvent[]; nextPageToken?: string }>(
          'GET',
          `/calendars/${encodeURIComponent(this.calendarId)}/events`,
          {
            singleEvents: 'false',
            showDeleted: 'false',
            maxResults: '250',
            privateExtendedProperty: `qaleDemo=${tag}`,
            ...(pageToken ? { pageToken } : {}),
          },
        );
        for (const e of page.items ?? []) byId.set(e.id, e);
        pageToken = page.nextPageToken;
      } while (pageToken);
    }
    return [...byId.values()];
  }

  /** `sendUpdates=none` on both writes: the cast are invented people at reserved
   *  domains, so any invite or cancellation Google mailed on our behalf comes
   *  straight back as a mailer-daemon bounce. Attendees still show on the event. */
  delete(eventId: string): Promise<void> {
    return this.req(
      'DELETE',
      `/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(eventId)}`,
      { sendUpdates: 'none' },
    );
  }

  insert(body: unknown): Promise<{ id: string; htmlLink?: string }> {
    return this.req(
      'POST',
      `/calendars/${encodeURIComponent(this.calendarId)}/events`,
      { sendUpdates: 'none' },
      body,
    );
  }
}

/** Resolve a `--calendar` value (a name like "PM/PO Test", an id, or "primary")
 *  to one calendar; error with the available names when it's ambiguous. */
function pickCalendar(cals: GCalendar[], wanted: string): GCalendar {
  const names = (c: GCalendar): string => c.summaryOverride ?? c.summary ?? c.id;
  if (wanted === 'primary') {
    const primary = cals.find((c) => c.primary);
    if (primary) return primary;
  }
  const byId = cals.find((c) => c.id === wanted);
  if (byId) return byId;
  const w = wanted.trim().toLowerCase();
  const byName = cals.filter((c) => names(c).trim().toLowerCase() === w);
  if (byName.length === 1) return byName[0]!;
  const list = cals.map((c) => `  • ${names(c)}${c.primary ? ' (primary)' : ''}`).join('\n');
  throw new Error(
    (byName.length > 1
      ? `More than one calendar is named "${wanted}" — pass its id instead.`
      : `No calendar named "${wanted}".`) + `\nCalendars on this account:\n${list}`,
  );
}

/** Build the events.insert body for one cast meeting at its shifted date. */
function eventBody(m: CastMeeting, date: string, tz: string, selfEmail: string): unknown {
  const endTime = endTimeOf(m.time, m.durationMin);
  // Organizer (accepted) + the guests: the same shape a real invite has, so the
  // qualifying heuristic (needs another human) holds. `self` is output-only —
  // Google stamps it per-reader, so the app sees it when it later pulls.
  const attendees = [
    { email: selfEmail, responseStatus: 'accepted' },
    ...m.attendees.map((email) => ({ email })),
  ];
  return {
    summary: m.title,
    description: m.description,
    start: { dateTime: `${date}T${m.time}:00`, timeZone: tz },
    end: { dateTime: `${date}T${endTime}:00`, timeZone: tz },
    attendees,
    extendedProperties: { private: { qaleDemo: DEMO_TAG } },
    ...(m.recurrence ? { recurrence: m.recurrence } : {}),
  };
}

// ---------------------------------------------------------------------------
// Runtime-vault reconcile: drop pre-synced stub meetings so the live sync owns
// them (no duplicate). Only the runtime copy is touched; canonical vault-dev/
// keeps the stub for offline chrome.
// ---------------------------------------------------------------------------

function reconcileVault(vaultRoot: string, dry: boolean): void {
  const meetingsDir = join(vaultRoot, 'meetings');
  if (!existsSync(meetingsDir)) {
    console.log(
      `  · ${vaultRoot} has no meetings/ — run \`pnpm refresh-demo\` first if you want a live-demo vault.`,
    );
    return;
  }
  let dropped = 0;
  for (const f of readdirSync(meetingsDir)) {
    if (!f.endsWith('.md')) continue;
    const p = join(meetingsDir, f);
    const fm = readFileSync(p, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
    if (/^provider:\s*["']?google-calendar["']?\s*$/m.test(fm)) {
      console.log(`  − drop pre-synced stub meetings/${f} (the live sync recreates it)`);
      if (!dry) rmSync(p);
      dropped++;
    }
  }
  if (dropped === 0) console.log('  · no pre-synced stub meetings to drop.');
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  for (const [label, v] of [
    ['--anchor', args.anchor],
    ['--today', args.today],
  ] as const) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${label} must be YYYY-MM-DD, got "${v}"`);
  }
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      'Set QALE_GOOGLE_CLIENT_ID and QALE_GOOGLE_CLIENT_SECRET (the same OAuth client the app uses — docs/google-cloud-setup.md).',
    );
  }

  const credsPath = resolve(join(import.meta.dirname, '..', CREDS_FILE));
  const creds = readCreds(credsPath);
  let refreshToken = process.env['GOOGLE_REFRESH_TOKEN'] ?? creds.refreshToken;
  if (!refreshToken) {
    console.log('No saved Google grant — starting the one-time consent flow.');
    refreshToken = await runConsentFlow();
    if (!args.dry || args.save) {
      writeFileSync(credsPath, `${JSON.stringify({ refreshToken }, null, 2)}\n`, { mode: 0o600 });
      console.log(`Saved the refresh token to ${CREDS_FILE} (gitignored).`);
    }
  }

  const offset = daysBetween(args.anchor, args.today);
  console.log(
    `Anchor ${args.anchor} → today ${args.today} (offset ${offset >= 0 ? '+' : ''}${offset} days, tz ${args.tz})` +
      `${args.dry ? '  (dry run — no writes)' : ''}`,
  );

  const cal = new Cal(await accessTokenFrom(refreshToken));

  // Resolve the target calendar by name/id, and the account email (the primary
  // calendar's id) for the event organizer. The seed only ever touches the one
  // calendar you name — none of your other calendars are read from or written to.
  const cals = await cal.calendarList();
  const target = pickCalendar(cals, args.calendar);
  const accountEmail = cals.find((c) => c.primary)?.id ?? target.id;
  cal.calendarId = target.id;
  const targetName = target.summaryOverride ?? target.summary ?? target.id;
  console.log(`Account ${accountEmail} · target calendar "${targetName}" (${target.id})\n`);

  // 1. Remove everything we seeded before (idempotent reset) — scoped to the
  //    target calendar, and only events carrying our own qaleDemo marker.
  const seeded = await cal.listSeeded();
  const masters = seeded.filter((e) => !e.recurringEventId); // deleting a master clears its instances
  console.log(`Calendar · "${targetName}"`);
  for (const e of masters) {
    console.log(`  − delete "${e.summary ?? e.id}"`);
    if (!args.dry) await cal.delete(e.id);
  }

  // 2. Recreate the cast at today-relative dates.
  const created: { title: string; url?: string }[] = [];
  for (const m of CAST_MEETINGS) {
    const date = shiftDate(m.date, offset);
    console.log(`  + create "${m.title}" on ${date} ${m.time}${m.recurrence ? ' (series)' : ''}`);
    if (args.dry) continue;
    const out = await cal.insert(eventBody(m, date, args.tz, accountEmail));
    created.push({ title: m.title, url: out.htmlLink });
  }

  // 3. Reconcile the runtime vault so the live sync owns the synced meetings.
  if (args.reconcile) {
    const vaultRoot = resolve(join(import.meta.dirname, '..'), args.vault);
    console.log(`\nVault reconciliation · ${args.vault}`);
    reconcileVault(vaultRoot, args.dry);
  }

  console.log(
    `\n✓ "${targetName}" seeded with the Bord scenario.` +
      `\n  Next: in the app, connect Google Calendar (Settings → Connections) and follow "${targetName}".` +
      '\n  Within a tick the week fills itself in; before-meeting preps the next steering.' +
      '\n  Re-run this any time to reset — it deletes what it seeded and recreates it.',
  );
}

main().catch((err: Error) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
