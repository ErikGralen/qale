import { MEETING_SYNC_FIELDS, type CalendarProvider, type EventStatus } from './frontmatter.js';
import { slugify } from './slug.js';

/**
 * Calendar-event → meeting-note mirror logic.
 * Pure decision functions — the sync engine feeds it a pulled event
 * plus the note as it exists on disk and applies whatever comes back. This is the
 * first mirror writer that shares a file with the human, so the rules live here
 * where they are testable:
 *
 * - the machine owns scheduling truth (MEETING_SYNC_FIELDS), the PM owns meaning
 *   (`summary`/`title` after creation, the body always);
 * - notes are created only for events that look like meetings (another human
 *   attendee, not declined);
 * - a created note is never demoted and never deleted by the engine;
 *   cancellation is a state the note carries (`event_status: cancelled`).
 */

export interface EventAttendee {
  email?: string;
  /** Display name when the provider knows one. */
  name?: string;
  /** Meeting room / equipment — never a participant. */
  resource?: boolean;
  /** This attendee is the connected account (the PM). */
  self?: boolean;
  response?: 'accepted' | 'declined' | 'tentative' | 'needsAction';
}

/** One synced event, provider-normalized. `start`/`end` are RFC3339 with offset
 *  for timed events, bare "YYYY-MM-DD" for all-day ones. */
export interface SyncedCalendarEvent {
  external_id: string;
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  event_status: EventStatus;
  attendees: EventAttendee[];
  /** Google's recurringEventId — maps to the meeting `series` slug. */
  recurring_event_id?: string;
  remote_updated: string;
  url: string;
}

/**
 * Which events deserve a note: anything on the calendar the PM hasn't declined.
 * Solo blocks, holds and all-day OOO count — a day is largely made of them, and
 * a week view that hides them isn't showing the week. Cancelled events never
 * qualify for CREATION; cancellation of an existing note is handled by the plan.
 *
 * This used to also require another human attendee, which quietly dropped every
 * solo entry on a real calendar and made the sync look broken.
 */
export function eventQualifies(event: SyncedCalendarEvent): boolean {
  if (event.event_status === 'cancelled') return false;
  if (selfDeclined(event)) return false;
  return true;
}

/**
 * At least one attendee who is neither a room nor the PM. NOT a note-worthiness
 * test (see {@link eventQualifies}) — it's the line between a meeting and a
 * block, which is what the before-meeting agent gates on. Nobody wants a prep
 * session written for their cleaning slot.
 */
export function hasOtherAttendee(event: SyncedCalendarEvent): boolean {
  return event.attendees.some((a) => !a.resource && !a.self);
}

function selfDeclined(event: SyncedCalendarEvent): boolean {
  return event.attendees.some((a) => a.self && a.response === 'declined');
}

/** Human participants for the `participants` field — the PM and rooms excluded,
 *  display name preferred, email kept when that's all the provider has. */
export function eventParticipants(event: SyncedCalendarEvent): string[] {
  const out: string[] = [];
  for (const a of event.attendees) {
    if (a.resource || a.self) continue;
    const label = a.name?.trim() || a.email?.trim();
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

/** Local-zone date/time parts for the frontmatter (store what Google sends,
 *  render in system zone). All-day events carry `date` only, no `time`. */
export function eventDateParts(event: SyncedCalendarEvent): {
  date: string;
  time?: string;
  duration_minutes?: number;
} {
  if (event.allDay) return { date: event.start.slice(0, 10) };
  const start = new Date(event.start);
  if (Number.isNaN(start.getTime())) return { date: event.start.slice(0, 10) };
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  const time = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  const end = event.end ? new Date(event.end) : null;
  const duration =
    end && !Number.isNaN(end.getTime()) && end.getTime() > start.getTime()
      ? Math.round((end.getTime() - start.getTime()) / 60_000)
      : undefined;
  return { date, time, ...(duration !== undefined ? { duration_minutes: duration } : {}) };
}

/** Stable series slug for a recurrence, derived once when first seen (the
 *  engine persists it against `recurring_event_id`; title drift can't move it). */
export function deriveSeriesSlug(event: SyncedCalendarEvent): string {
  return slugify(event.title) || 'meeting';
}

/** Filename for a newly created meeting note: meetings/YYYY-MM-DD-<slug>.md.
 *  The slug keeps its original date after reschedules — frontmatter is truth. */
export function meetingPathForEvent(event: SyncedCalendarEvent): string {
  const { date } = eventDateParts(event);
  return `meetings/${date}-${slugify(event.title) || 'meeting'}.md`;
}

export type MeetingMirrorPlan =
  /** Nothing to do (doesn't qualify, or the note already matches). */
  | { action: 'skip' }
  /** Create the note (engine picks/uniquifies the path via meetingPathForEvent). */
  | { action: 'create'; frontmatter: Record<string, unknown> }
  /** Rewrite frontmatter (machine fields merged over the existing), keep body. */
  | { action: 'patch'; frontmatter: Record<string, unknown> };

/**
 * Decide what the mirror patcher does for one event. `existing` is the meeting
 * note currently bound to this event (by external_id), or null.
 */
export function planMeetingMirror(input: {
  event: SyncedCalendarEvent;
  /** Calendar (container) id, e.g. "primary". */
  calendar: string;
  provider: CalendarProvider;
  /** Resolved series slug for the event's recurrence, when it has one. */
  seriesSlug?: string;
  /** Participants override: when the engine has resolved attendee emails to
   *  `[[people/…]]` wikilinks (job 4), pass them here — otherwise the pure
   *  `eventParticipants` labels (name/email) are used. */
  participants?: string[];
  existing: { frontmatter: Record<string, unknown>; body: string } | null;
}): MeetingMirrorPlan {
  const { event, existing } = input;
  const machine = machineFields(input);

  if (!existing) {
    if (!eventQualifies(event)) return { action: 'skip' };
    return {
      action: 'create',
      frontmatter: {
        type: 'meeting',
        title: event.title,
        summary: event.title,
        provider: input.provider,
        ...machine,
      },
    };
  }

  // Declined-after-creation leans cancellation (open question resolved in the
  // design doc): the meeting stopped being the PM's, same as it stopping.
  // The note stays either way — the engine never deletes what the PM can see,
  // it just marks the meeting cancelled and lets the views recede it. It goes
  // back to confirmed only when the event itself un-cancels (or the PM undoes
  // the decline), because that's what `machine` carries.
  if (event.event_status === 'cancelled' || selfDeclined(event)) {
    machine['event_status'] = 'cancelled';
  }

  // Never-demote: a note whose event stopped qualifying still gets its machine
  // fields kept true. PM-owned fields survive because `machine` never carries
  // summary/title/body — checked against MEETING_SYNC_FIELDS below.
  const next: Record<string, unknown> = { ...existing.frontmatter };
  let changed = false;
  for (const [key, value] of Object.entries(machine)) {
    if (!(MEETING_SYNC_FIELDS as readonly string[]).includes(key) && key !== 'provider') {
      continue; // belt-and-braces: the invariant the tests pin down
    }
    if (JSON.stringify(next[key]) !== JSON.stringify(value)) {
      next[key] = value;
      changed = true;
    }
  }
  return changed ? { action: 'patch', frontmatter: next } : { action: 'skip' };
}

/** The machine-owned field values for an event — exactly MEETING_SYNC_FIELDS
 *  (plus `provider`, which only matters at creation and never changes after). */
function machineFields(input: {
  event: SyncedCalendarEvent;
  calendar: string;
  seriesSlug?: string;
  participants?: string[];
}): Record<string, unknown> {
  const { event } = input;
  const participants = input.participants ?? eventParticipants(event);
  return {
    ...eventDateParts(event),
    ...(participants.length ? { participants } : {}),
    ...(input.seriesSlug ? { series: input.seriesSlug } : {}),
    event_status: event.event_status,
    external_id: event.external_id,
    calendar: input.calendar,
    remote_updated: event.remote_updated,
    // Cancellation stubs can arrive URL-less; never write an empty url.
    ...(event.url ? { url: event.url } : {}),
  };
}
