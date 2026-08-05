/**
 * Seed (and reset) a live Google Calendar with the Tavla demo scenario — the
 * calendar-side counterpart of scripts/reset-atlassian.ts. One command both
 * populates a fresh demo account and resets it after a run: it deletes every
 * event this script has ever seeded (tagged with a private `qaleDemo=tavla`
 * property) inside the window, then recreates the cast — so run it as often as
 * you like and the calendar always converges to the same story.
 *
 * Why this exists: phases 2–4 of the Google Calendar integration (auto-prep,
 * capture-matching, participant resolution, outbound events) only come alive
 * when the shallow event index has real rows — which needs a real calendar. The
 * offline vault ships one static synced meeting so the chrome renders, but the
 * live features need this.
 *
 * What it seeds:
 *  - a **weekly Nordkap check-in** (recurring) with Sara — the star: a past
 *    instance for series history, the upcoming one for before-meeting auto-prep,
 *    and the SCIM commitment that commitment-check offers to "raise there";
 *  - a handful of forward-looking meetings with no hand-authored vault twin
 *    (Kranelund pilot kickoff, Bergman & Falk security review, a Tom 1:1, a
 *    Fenno follow-up) so "the week fills itself in" is real and duplicate-free.
 *  Every attendee email matches a vault person note's `email`, so participant
 *  resolution turns them into `[[people/…]]` links on sync.
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
 * QALE_GOOGLE_CLIENT_ID / QALE_GOOGLE_CLIENT_SECRET (the same env the app needs —
 * docs/google-cloud-setup.md).
 *
 * By default it targets the PRIMARY calendar; pass --calendar to point it at a
 * specific one (by name or id) so your other calendars are never touched. It
 * only ever reads/writes the one calendar you name, and only deletes events it
 * seeded itself (the qaleDemo marker) — never your real events.
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
 * reconcile step removes such stubs from .vault-dev — the live sync recreates
 * them for real on the next pull. The canonical vault-dev/ is NEVER touched.
 */
import { createServer, type Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { exec } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { platform } from 'node:os';

const ANCHOR = '2026-07-17';
const CREDS_FILE = '.google-demo.json';
const DEMO_TAG = 'tavla'; // extendedProperties.private.qaleDemo — our own events only
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
// The desired calendar state. Each meeting is anchored on ANCHOR; `date` slides
// by (today − anchor) at runtime. Attendee emails match vault person notes so
// participant resolution links them. `recurrence` (optional) uses the event's
// date as DTSTART; singleEvents expansion on the app side gives every instance
// the same series.
// ---------------------------------------------------------------------------

interface CastMeeting {
  title: string;
  /** ANCHOR-relative date (YYYY-MM-DD) of the (first) occurrence. */
  date: string;
  /** Local wall-clock start, "HH:MM". */
  time: string;
  durationMin: number;
  /** Invitee emails (the seeded account is the organizer, not listed here). */
  attendees: string[];
  description: string;
  /** RRULE bodies, e.g. "RRULE:FREQ=WEEKLY;COUNT=5" — omit for a one-off. */
  recurrence?: string[];
}

const CAST: CastMeeting[] = [
  {
    // Starts at the UPCOMING instance (anchor+1), not in the past: the vault
    // already ships the hand-authored previous instance (2026-07-14, with the
    // decided content before-meeting reads), so a seeded past instance would be
    // a near-duplicate. Past = vault; upcoming + future = calendar.
    title: 'Nordkap check-in',
    date: '2026-07-18',
    time: '10:00',
    durationMin: 30,
    attendees: ['sara.lindqvist@nordkap.example'],
    description:
      'Weekly sync with Nordkap. Standing items: SSO go-live readiness, the SCIM timeline, procurement.',
    recurrence: ['RRULE:FREQ=WEEKLY;COUNT=4'],
  },
  {
    title: 'Kranelund exports pilot kickoff',
    date: '2026-07-20',
    time: '10:00',
    durationMin: 45,
    attendees: ['mikkel.sorensen@kranelund.example', 'johanna@tavla.example'],
    description: 'Kick off the scheduled-delivery exports pilot with Kranelund ops.',
  },
  {
    title: 'Bergman & Falk security review',
    date: '2026-07-23',
    time: '13:30',
    durationMin: 60,
    attendees: ['elin.vestergaard@bergmanfalk.example', 'david@tavla.example'],
    description: 'Vendor security review session: questionnaire walkthrough and evidence.',
  },
  {
    title: '1:1 with Tom',
    date: '2026-07-21',
    time: '15:00',
    durationMin: 30,
    attendees: ['tom@tavla.example'],
    description: 'Weekly 1:1. Auth migration, platform.',
  },
  {
    title: 'Fenno Energi architecture follow-up',
    date: '2026-07-29',
    time: '11:00',
    durationMin: 45,
    attendees: ['antti.korhonen@fennoenergi.example', 'david@tavla.example'],
    description: 'Follow up on the on-prem question: EU region, ISO 27001, DPA.',
  },
];

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
    tz: process.env['QALE_GOOGLE_TZ'] ?? 'Europe/Stockholm',
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
// Date shifting — same UTC day maths as refresh-demo.ts / reset-atlassian.ts.
// ---------------------------------------------------------------------------

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

function shiftDate(iso: string, offset: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + offset);
  return dt.toISOString().slice(0, 10);
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
   *  one-offs — deleting a recurring master removes all its instances. */
  async listSeeded(): Promise<GEvent[]> {
    const out: GEvent[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.req<{ items?: GEvent[]; nextPageToken?: string }>(
        'GET',
        `/calendars/${encodeURIComponent(this.calendarId)}/events`,
        {
          singleEvents: 'false',
          showDeleted: 'false',
          maxResults: '250',
          privateExtendedProperty: `qaleDemo=${DEMO_TAG}`,
          ...(pageToken ? { pageToken } : {}),
        },
      );
      out.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return out;
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
  const endMin = Number(m.time.slice(0, 2)) * 60 + Number(m.time.slice(3, 5)) + m.durationMin;
  const endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
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
  for (const m of CAST) {
    const date = shiftDate(m.date, offset);
    console.log(`  + create "${m.title}" on ${date} ${m.time}${m.recurrence ? ' (weekly)' : ''}`);
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
    `\n✓ "${targetName}" seeded with the Tavla scenario.` +
      `\n  Next: in the app, connect Google Calendar (Settings → Connections) and follow "${targetName}".` +
      '\n  Within a tick the week fills itself in; before-meeting preps the upcoming Nordkap check-in.' +
      '\n  Re-run this any time to reset — it deletes what it seeded and recreates it.',
  );
}

main().catch((err: Error) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
