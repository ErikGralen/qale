import { z } from 'zod';
import { zOutboundPayload } from '@pm/domain';
import type { EventAttendee, EventStatus, StateCategory } from '@pm/domain';
import type {
  Connector,
  ConnectorProvider,
  ContainerKind,
  EventChange,
  ExecuteResult,
  ExternalContainer,
  FetchLike,
  FullItem,
  PullResult,
  VerifyResult,
} from '../types.js';

/**
 * Google Calendar connector (docs/google-calendar-integration.md §Connector
 * mapping): calendars → `calendar` containers, events → `event` shallow changes
 * that the sync engine materializes as `meeting` notes. Auth is a callback —
 * the main-process OAuth service owns tokens/refresh; the connector only ever
 * sees a fresh access token, so it stays fixture-testable with a stub supplier.
 *
 * Incremental pulls ride Google's native `syncToken` (stored as the container's
 * high-water mark verbatim — it's an opaque cursor, not a timestamp). On `410
 * GONE` (expired token) the pull silently re-lists the window; that costs one
 * fuller pull, and the engine's upserts are idempotent anyway.
 */

/** The grant is gone (revoked / expired refresh token) — distinctly NOT a
 *  network failure; verifyAuth maps it to the quiet `auth-expired` state. */
export class CalendarAuthError extends Error {
  constructor(message = 'Google authorization expired') {
    super(message);
    this.name = 'CalendarAuthError';
  }
}

export interface GoogleCalendarAuth {
  /** A currently-valid access token (the OAuth service refreshes as needed);
   *  throws {@link CalendarAuthError} when the grant is revoked/expired. */
  getAccessToken(): Promise<string>;
}

/** Not a form schema — Google auth is a browser flow, not pasted fields. The
 *  Connections UI renders an oauth button from the provider descriptor. */
export const googleCalendarAuthSchema = z.custom<GoogleCalendarAuth>(
  (v) => typeof (v as GoogleCalendarAuth | null)?.getAccessToken === 'function',
);

const API = 'https://www.googleapis.com/calendar/v3';

/** Sync horizon (§Scope): recent past for capture-matching, ~2 months ahead. */
const HORIZON_BACK_DAYS = 7;
const HORIZON_FORWARD_DAYS = 60;

/** Calendar-noise event types that never belong in the index. */
const SKIPPED_EVENT_TYPES = new Set(['workingLocation', 'birthday']);

interface GoogleEventTime {
  date?: string;
  dateTime?: string;
}

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  eventType?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  originalStartTime?: GoogleEventTime;
  attendees?: {
    email?: string;
    displayName?: string;
    resource?: boolean;
    self?: boolean;
    responseStatus?: string;
  }[];
  recurringEventId?: string;
  updated?: string;
  htmlLink?: string;
}

interface EventsPage {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

/** Google never mails the guest list on our behalf. Everything written here was
 *  drafted by an agent and approved by the PM inside pm; Google's own invite and
 *  cancellation mail would be a second, unreviewed outbound channel — and with a
 *  demo cast of made-up addresses it is just a stream of mailer-daemon bounces.
 *  Attendees still land on the event, they simply aren't emailed about it. */
const NO_GUEST_MAIL = 'sendUpdates=none';

class GoogleCalendarConnector implements Connector {
  readonly id = 'google-calendar';
  readonly providers: Partial<Record<ContainerKind, string>> = {
    calendar: 'google-calendar',
  };

  constructor(
    private readonly auth: GoogleCalendarAuth,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {}

  private async request(path: string, params: Record<string, string>): Promise<Response> {
    const token = await this.auth.getAccessToken();
    const qs = new URLSearchParams(params).toString();
    const res = await this.fetchImpl(`${API}${path}${qs ? `?${qs}` : ''}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.status === 401) throw new CalendarAuthError();
    return res;
  }

  private async requestJson<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const res = await this.request(path, params);
    if (!res.ok) throw new Error(`Google Calendar ${res.status} for ${path}`);
    return (await res.json()) as T;
  }

  /** Write request (outbound events, phase 4) — POST/PATCH with a JSON body.
   *  Same 401 → auth-expired mapping as reads; surfaces the API error body so a
   *  failed card returns to the Inbox with something the PM can act on. */
  private async mutate(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<GoogleEvent> {
    const token = await this.auth.getAccessToken();
    const res = await this.fetchImpl(`${API}${path}?${NO_GUEST_MAIL}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.status === 401) throw new CalendarAuthError();
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Google Calendar ${res.status} for ${method} ${path}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }
    return (await res.json()) as GoogleEvent;
  }

  /** RFC3339 timed value → {dateTime}; bare "YYYY-MM-DD" → all-day {date}. */
  private eventTime(value: string): GoogleEventTime {
    return value.includes('T') ? { dateTime: value } : { date: value };
  }

  /** A create_event with no end: 30 min for a timed event, same day for all-day. */
  private defaultEnd(start: string): GoogleEventTime {
    if (!start.includes('T')) return { date: start };
    const ms = Date.parse(start);
    return { dateTime: Number.isNaN(ms) ? start : new Date(ms + 30 * 60_000).toISOString() };
  }

  async verifyAuth(): Promise<VerifyResult> {
    try {
      const primary = await this.requestJson<{ id: string; summary?: string }>(
        '/users/me/calendarList/primary',
      );
      // The primary calendar's id IS the account email.
      return {
        ok: true,
        health: 'ok',
        identity: { displayName: primary.summary ?? primary.id, email: primary.id },
      };
    } catch (err) {
      if (err instanceof CalendarAuthError) {
        return { ok: false, health: 'auth-expired', error: err.message };
      }
      return {
        ok: false,
        health: 'unreachable',
        error: err instanceof Error ? err.message : 'Google Calendar unreachable',
      };
    }
  }

  async listContainers(): Promise<ExternalContainer[]> {
    const out: ExternalContainer[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.requestJson<{
        items?: { id: string; summary?: string; summaryOverride?: string; primary?: boolean }[];
        nextPageToken?: string;
      }>('/users/me/calendarList', pageToken ? { pageToken } : {});
      for (const item of page.items ?? []) {
        out.push({
          kind: 'calendar',
          id: item.id,
          name: item.summaryOverride ?? item.summary ?? item.id,
        });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    // Primary first — it's the one nearly everyone follows.
    return out.sort((a, b) => Number(b.id.includes('@')) - Number(a.id.includes('@')) || a.name.localeCompare(b.name));
  }

  async pullChanges(
    container: ExternalContainer,
    sinceHighWaterMark: string | null,
    opts?: { now?: number },
  ): Promise<PullResult> {
    const now = opts?.now ?? Date.now();
    const path = `/calendars/${encodeURIComponent(container.id)}/events`;
    const base = { singleEvents: 'true', maxResults: '250' };

    const collect = async (
      firstParams: Record<string, string>,
    ): Promise<{ events: GoogleEvent[]; syncToken: string | null; gone: boolean }> => {
      const events: GoogleEvent[] = [];
      let syncToken: string | null = null;
      let pageToken: string | undefined;
      do {
        const res = await this.request(path, {
          ...firstParams,
          ...(pageToken ? { pageToken } : {}),
        });
        if (res.status === 410) return { events: [], syncToken: null, gone: true };
        if (!res.ok) throw new Error(`Google Calendar ${res.status} for ${path}`);
        const page = (await res.json()) as EventsPage;
        events.push(...(page.items ?? []));
        pageToken = page.nextPageToken;
        if (page.nextSyncToken) syncToken = page.nextSyncToken;
      } while (pageToken);
      return { events, syncToken, gone: false };
    };

    const windowed = (): Record<string, string> => ({
      ...base,
      timeMin: new Date(now - HORIZON_BACK_DAYS * 86_400_000).toISOString(),
      timeMax: new Date(now + HORIZON_FORWARD_DAYS * 86_400_000).toISOString(),
    });

    let result = sinceHighWaterMark
      ? await collect({ ...base, syncToken: sinceHighWaterMark })
      : await collect(windowed());
    // Expired sync token: silent windowed re-list, one fuller pull, no drama.
    if (result.gone) result = await collect(windowed());

    const nowIso = new Date(now).toISOString();
    const changes = result.events
      .filter((e) => !SKIPPED_EVENT_TYPES.has(e.eventType ?? 'default'))
      .map((e): EventChange => toEventChange(e, container.id, nowIso));
    return { changes, highWaterMark: result.syncToken ?? sinceHighWaterMark };
  }

  async fetchFull(_kind: ContainerKind, externalId: string): Promise<FullItem> {
    // Events are shallow-complete: the list payload already carries everything
    // the mirror uses. Present for interface symmetry only.
    throw new Error(`events have no deep fetch (${externalId})`);
  }

  mapStateCategory(rawState: string): StateCategory {
    return rawState === 'cancelled' ? 'done' : 'open';
  }

  /**
   * Outbound events (phase 4) — the card-acceptance layer hands the stored
   * payload here after the OAuth service has secured the write scope. Re-validate
   * (the same schema the draft tool filed against), then route by action. Only
   * ever called on approval; never by an agent tool.
   */
  async execute(payload: unknown): Promise<ExecuteResult> {
    const parsed = zOutboundPayload.safeParse(payload);
    if (!parsed.success) {
      throw new Error(`invalid google-calendar payload: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    }
    const p = parsed.data;
    if (p.provider !== 'google-calendar') {
      throw new Error(`google-calendar connector received a ${p.provider} payload`);
    }
    const calendarId = encodeURIComponent(p.calendarId?.trim() || 'primary');

    if (p.action === 'create_event') {
      const ev = await this.mutate('POST', `/calendars/${calendarId}/events`, {
        summary: p.title,
        description: p.body,
        start: this.eventTime(p.start!),
        end: p.end ? this.eventTime(p.end) : this.defaultEnd(p.start!),
        ...(p.attendees?.length ? { attendees: p.attendees.map((email) => ({ email })) } : {}),
      });
      return { externalId: ev.id, url: ev.htmlLink ?? '' };
    }

    if (p.action === 'update_event') {
      const eventId = encodeURIComponent(p.eventId!);
      const body: Record<string, unknown> = {};
      if (p.title) body['summary'] = p.title;
      if (p.body) body['description'] = p.body;
      if (p.start) body['start'] = this.eventTime(p.start);
      if (p.end) body['end'] = this.eventTime(p.end);
      const ev = await this.mutate('PATCH', `/calendars/${calendarId}/events/${eventId}`, body);
      return { externalId: ev.id, url: ev.htmlLink ?? '' };
    }

    if (p.action === 'respond_to_event') {
      // RSVP on behalf of the connected account: a PATCH replaces the whole
      // attendees array, so read the event, flip the one matching attendee, and
      // write the list back — never dropping the other guests.
      const eventId = encodeURIComponent(p.eventId!);
      const current = await this.requestJson<GoogleEvent>(`/calendars/${calendarId}/events/${eventId}`);
      const wanted = p.attendeeEmail!.trim().toLowerCase();
      const attendees = (current.attendees ?? []).map((a) =>
        a.email?.trim().toLowerCase() === wanted ? { ...a, responseStatus: p.responseStatus } : a,
      );
      if (!attendees.some((a) => a.email?.trim().toLowerCase() === wanted)) {
        attendees.push({ email: p.attendeeEmail!, responseStatus: p.responseStatus });
      }
      const ev = await this.mutate('PATCH', `/calendars/${calendarId}/events/${eventId}`, { attendees });
      return { externalId: ev.id, url: ev.htmlLink ?? '' };
    }

    throw new Error(`unsupported google-calendar action: ${p.action}`);
  }
}

/** Provider-normalize one event. Cancelled instances arrive as stubs (id +
 *  status, little else) — fields fall back to empty and the sync engine merges
 *  them over the shallow row it already holds. */
export function toEventChange(e: GoogleEvent, containerId: string, nowIso: string): EventChange {
  const startRaw = e.start?.dateTime ?? e.start?.date ?? e.originalStartTime?.dateTime ?? e.originalStartTime?.date ?? '';
  const allDay = Boolean(e.start?.date ?? (!e.start?.dateTime && e.originalStartTime?.date));
  const status: EventStatus =
    e.status === 'cancelled' ? 'cancelled' : e.status === 'tentative' ? 'tentative' : 'confirmed';
  const attendees = (e.attendees ?? []).map((a): EventAttendee => ({
    ...(a.email ? { email: a.email } : {}),
    ...(a.displayName ? { name: a.displayName } : {}),
    ...(a.resource ? { resource: true } : {}),
    ...(a.self ? { self: true } : {}),
    ...(a.responseStatus
      ? { response: a.responseStatus as NonNullable<EventAttendee['response']> }
      : {}),
  }));
  const end = e.end?.dateTime ?? e.end?.date;
  return {
    kind: 'event',
    container: containerId,
    external_id: e.id,
    title: e.summary ?? '',
    start: startRaw,
    ...(end ? { end } : {}),
    allDay,
    event_status: status,
    attendees,
    ...(e.recurringEventId ? { recurring_event_id: e.recurringEventId } : {}),
    remote_updated: e.updated ?? nowIso,
    url: e.htmlLink ?? '',
  };
}

export const googleCalendarConnector: ConnectorProvider<GoogleCalendarAuth> = {
  id: 'google-calendar',
  label: 'Google Calendar',
  authSchema: googleCalendarAuthSchema,
  create: (creds, opts) => new GoogleCalendarConnector(creds, opts?.fetchImpl),
};
