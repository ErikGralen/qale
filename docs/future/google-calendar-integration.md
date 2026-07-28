# Google Calendar integration — the calendar as the skeleton of the memory

> **Status 2026-07-27: Phase 1 BUILT** (auth + mirror; fixture-tested, not yet
> live-verified against a real Google account — the manual checklist is in
> `docs/google-cloud-setup.md`, which also documents the Cloud project setup
> still to be done). Code map: domain `event-mirror.ts` (planMeetingMirror +
> MEETING_SYNC_FIELDS + zMeeting sync fields), connector
> `packages/connectors/src/google-calendar/`, main `google-oauth-service.ts`
> (loopback+PKCE), sync-service multi-connection refactor + meeting patcher,
> sync-store event rows + `sync_series`, Connections UI oauth button + calendar
> rows, meeting-page glyph + cancelled strikethrough. Deliberate choices during
> the build: first connect auto-follows the primary calendar (the magic moment;
> unfollow stays one click); outbound payload schema deferred to phase 4 (the
> codebase rule "never advertise an action without an executor" beat the Area A
> bullet); PM-deleted synced notes tombstone via their dangling `note_path` —
> the engine never recreates them.
>
> **Status 2026-07-28: Phase 2 BUILT** (time-aware sessions; jobs 2 & 3). The
> shallow event index is now read by two surfaces, both in `sync-service.ts`:
> `agenda(fromMs,toMs)` (padded ISO query, precise in-JS instant filter — only
> events promoted to a meeting note) and `matchMeetingForCapture(now)` (pure
> `rankCaptureMatch`: in-progress › just-ended › soonest-upcoming). **Auto-prep**
> — `SchedulerService` gained a `beforeMeetingSweep` hook; `handlers.ts` runs it
> each tick, firing `before-meeting` on synced meetings starting within the hour
> that have no `## Prep` and no pending before-meeting card (in-memory
> once-per-run guard, gated on an API key). Delivery is the meeting page, never
> an Inbox ping. **Capture matching** — new `capture:matchMeeting` IPC; the
> CaptureDialog offers "Attach to <title> · ended N min ago" as the default vs
> "New meeting"; `ingestCapture` gains `attachTo`, routing to the new
> `attachTranscriptToMeeting` use-case (files the transcript as a source, links
> it onto the existing note via the meeting-mutable `transcript`/`status` fields,
> machine-owned scheduling fields and body untouched) — no duplicate meeting.
> Ranking pinned by `apps/desktop/test/capture-match.test.ts`.
>
> **Status 2026-07-28: Phases 3 & 4 BUILT** (fixture-tested; the live Google
> write path is not yet exercised against a real account). **Phase 3 (job 4):**
> `zPerson` gained `email`; `planMeetingMirror` takes a `participants` override
> and `sync-service.resolveParticipants` maps attendee emails → `[[people/…]]`
> where a person note carries a matching `email` (unmatched stay plain). The
> `commitment-check` skill + `handleTodoSeed` now read the meeting horizon and
> prefer "raise it there" on an upcoming meeting page over a cold nudge. Demo
> cast carry emails. **Phase 4 (outbound events):** `google-calendar` provider +
> `create_event`/`update_event`/`respond_to_event` actions + calendar fields in
> `zOutboundPayload` (per-action superRefine); the connector `execute()` is
> implemented (events.insert/patch, RSVP reads-then-patches so it never drops
> other guests); OAuth grew `CALENDAR_WRITE_SCOPE` + `ensureWriteScope()`
> (incremental consent, granted scopes persisted in settings), run by the
> composite `makeOutbound` just before a Google write — the "Google asks now"
> moment. Three `draft_calendar_*` tools (outbound tier); `draftSnapshot` +
> `findOutboundMirror` extended to the synced meeting note so reschedule/RSVP get
> the drafted-against-stale guard for free; `after-meeting` drafts a concrete
> follow-up event. Tests: `packages/domain/test/outbound-calendar.test.ts`,
> `execute *` in the connector suite, participants-override in the mirror suite.
> The IPC↔domain union lock (`dto.ts`) forced the mirrored `@pm/ipc` additions.

> Design plan, written 2026-07-27. Second connector after Jira/Confluence
> (`docs/jira-confluence-integration.md`); reuses the `Connector` interface, the sync
> engine, the Connections UI, and the outbound draft-approve path. The genuinely new
> pieces are **OAuth** (Google has no paste-a-token path) and an **ownership-split
> mirror** (calendar events land in `meeting` notes, which — unlike tickets — the PM
> writes in). Google Drive and Gmail ride the same auth plumbing later; scoped notes
> on their cost at the end.

## The user and the job

The PM's calendar already knows their week. The memory doesn't — today every meeting
note exists because the PM (or the demo seeder) typed it. That's backwards: the
calendar is the one external system that is *always* current, because other people
maintain it for you. Every meeting-shaped feature we've built — before-meeting briefs,
after-meeting capture, series history, commitment-check's "you're seeing Sara
tomorrow" — currently runs on notes the PM had to remember to create.

Jobs to be done, in the PM's words:

1. **"My meetings should just be there."** Today: create a meeting note by hand or
   the brief has nowhere to live. With sync: the Thursday Nordkap check-in exists in
   the vault the moment it exists in Google Calendar, with date, time, attendees, and
   its series lineage already correct.
2. **"Prep me before the meeting, without me asking."** `before-meeting` needs to know
   a meeting is *coming* — which only the calendar knows. Synced events give the
   scheduler a real horizon: brief prepared on the meeting page an hour out, per the
   inbox stance (nudges live in their owning view, never interval sweeps).
3. **"When I capture a transcript, know which meeting it was."** After-meeting capture
   can match the drag-in to the event that just ended instead of asking.
4. **"Connect who I meet with what I owe them."** Attendee emails resolve to people
   notes; commitment-check sees "promise to Sara due Friday + meeting with Sara
   tomorrow" and proposes handling it there.
5. **"Show me my day against my commitments."** The shallow event index gives any
   surface (sidebar, briefs, weekly update) an honest agenda without opening Google.

Same shape as before: reconciliation between what the PM knows and what an external
system says. But the calendar is special — it's the *time spine*. Meetings are
already the app's core note type; this integration makes them appear and stay true
without any new habit.

## Design principles (inherited, plus one new)

- **Reads are silent and free; writes are draft-and-approve, forever.** Pulling events
  never asks, never pings. Creating/updating/responding to events is a later phase
  and only ever an outbound card.
- **Nudges live in their owning view.** An upcoming meeting's brief lives on the
  meeting page. A cancelled meeting shows on the meeting note. Never Inbox rows.
- **Never expose plumbing.** No "sync tokens", no OAuth error codes, no scopes UI.
  The PM sees "Connected as erik@…", "synced 4 min ago", "reconnect".
- **New: the machine owns scheduling truth; the PM owns meaning.** A ticket mirror is
  immutable-locally. A meeting note can't be — it's where the PM's notes, transcript
  links, and decisions live. So ownership splits *by field*, not by file (below).

## Auth: OAuth installed-app flow (researched 2026-07-27)

Google offers no API-token path; OAuth 2.0 is mandatory. Unlike Atlassian's 3LO
(which forced us to API tokens because it demands a confidential client secret),
**Google explicitly supports public desktop clients**: loopback redirect + PKCE, with
the embedded client "secret" officially treated as non-confidential. So the sign-in
UX we couldn't have for Atlassian, we get here:

1. Connections → "Connect Google Calendar" → main process starts a one-shot HTTP
   listener on `http://127.0.0.1:<ephemeral port>` and opens the system browser
   (`shell.openExternal`) to Google's consent page with PKCE challenge.
2. User consents; Google redirects to the loopback with a code; we exchange it
   (code + verifier) for access + refresh tokens; the listener closes; the browser
   tab says "you can close this".
3. Refresh token stored exactly like the Atlassian token — `safeStorage`-encrypted
   (`enc:`), base64 fallback, honest about which (per the secret-storage stance).
   Access tokens are ephemeral, refreshed in memory, never persisted.

**Scope: `calendar.readonly` only in v1.** Add write scope only when outbound events
ship (incremental consent — Google supports adding scopes to an existing grant).

Google Cloud project facts that shape the product (verified 2026-07-27):

- `calendar.readonly` is a **sensitive scope**. Unverified apps work but show a
  "Google hasn't verified this app" interstitial (Advanced → Continue) and cap at
  **100 users**. Fine for now; full verification (privacy policy page, demo video,
  weeks of review) is a ship-to-strangers problem, not a build problem.
- **Never leave the project in "Testing" status**: refresh tokens then expire every
  7 days and users re-auth weekly. Set publishing status to **"In production"
  (unverified)** from day one — tokens live until revoked.
- Even in production, Google can revoke tokens (user revokes at myaccount.google.com,
  password change on some account types, 6-month inactivity). So `auth-expired` is a
  designed-for quiet state, same as Atlassian token expiry: Connections health line
  shows "Google connection expired — reconnect", one click re-runs the flow, the
  mirror serves stale data meanwhile. Never a modal, never an Inbox card.
- The client ID (and non-secret "secret") ship in the app binary; that's sanctioned
  for installed apps. One Google Cloud project owned by us, all users share it.
  Setup checklist for the project itself → `docs/google-cloud-setup.md` (to write
  during the build, like `jira-demo-setup.md`).

### Drive and Gmail later — what the plumbing buys and what it doesn't

The OAuth service built here (browser flow, PKCE, token store, refresh, reconnect UX)
is provider-level, not calendar-level: adding Drive or Gmail is *adding a scope and a
connector*, zero new auth machinery. But the scopes are not equal citizens:

- **Drive: use `drive.file`** (access only to files the app created or the user
  explicitly picked) — it's in Google's *recommended* tier, no verification burden,
  and honestly matches our likely job (attach/read specific docs, not crawl the
  corpus). **Avoid `drive.readonly`** — it's *restricted* tier.
- **Gmail read scopes are restricted**: public distribution requires an annual
  third-party CASA security assessment — real money, real lead time. Works fine
  unverified at small scale, but don't promise Gmail features without pricing this.

## The model: events become meeting notes, with split ownership

No new note type. A qualifying calendar event materializes as the existing
`type: meeting` note (`meetings/YYYY-MM-DD-<slug>.md`), because everything downstream
— briefs, series history, capture, commitment-check — already speaks meeting. New
frontmatter on synced meetings: `provider: google-calendar`, `external_id` (event
id), `calendar` (container), `remote_updated`, `url` (open-in-Google-Calendar),
`event_status` (`confirmed | tentative | cancelled`).

**The ownership split, precisely.** The sync engine may create meeting notes and may
update *only these fields* on them: `date`, `time`, `duration_minutes`,
`participants`, `series`, `event_status`, `external_id`, `remote_updated`, `url`.
It sets `summary` (event title) at creation and never touches it again — the PM may
sharpen it. It **never touches the body**, which belongs to the PM (notes, decisions,
transcript links) from the first keystroke. This is the one deliberate departure from
the "mirrors are immutable" rule, and it's field-scoped so the invariant stays
checkable: the mirror writer for meetings is a *frontmatter patcher*, not a file
writer.

Consequences that keep it honest:

- **Reschedule** upstream → `date`/`time` update in place; the filename keeps its
  original date slug (links don't break; the frontmatter is truth, per existing
  convention). Freshness spine sees the change, so a brief prepared for the old
  time goes stale — exactly right.
- **Cancellation** → if the PM never wrote in the note (body still empty), the note
  is deleted; if they did, it stays with `event_status: cancelled` and renders
  struck-through in lists. Human content is never machine-deleted.
- **Recurring events** → Google's `recurringEventId` maps to the existing `series`
  slug (stable, derived once per recurrence). This is quietly the biggest win:
  `before-meeting`'s previous-instance lookup, which today depends on hand-typed
  `series` fields, becomes automatic and correct for every synced series.

### Scope: which events deserve a note

Nobody wants a note per focus block. Same two-tier scoping as Atlassian, adapted:

1. **Followed calendars** (the containers): the PM picks which calendars sync —
   typically "primary", maybe a team calendar. Everything on a followed calendar
   lands in the **shallow index** (`sync_items`): title, start/end, attendees,
   status, event id. That powers agenda surfaces and capture-matching, costs no
   vault files.
2. **Meeting notes are created** only for events that look like meetings: **at least
   one other human attendee** (not a room/resource), **not declined by the PM**, and
   within the sync horizon. Everything else — solo blocks, holds, all-day OOO —
   stays shallow. A shallow event can be promoted by hand ("track this") from its
   agenda row; a created note is never demoted by the engine.

Sync horizon: ~7 days back (catch capture for recent meetings) to ~60 days forward.
The horizon slides each tick; notes created inside it persist after it passes.

### Pull mechanics (only as far as they shape UX)

- Piggyback the existing 5-minute scheduler tick. Google Calendar's `events.list`
  hands us a **`syncToken`** — a native incremental cursor that returns only changed/
  cancelled events since last pull, including cancellations of recurring instances.
  It slots into the per-container high-water-mark column as-is. On `410 GONE`
  (expired token) the engine does a silent windowed re-list; costs one fuller pull,
  no user-visible anything.
- `singleEvents=true`: Google expands recurrences into instances for us — no local
  RRULE math, and instance-level edits/cancellations come through correctly.
- Offline / revoked: mirror keeps serving; "synced 4h ago" in Settings and on hover;
  `auth-expired` health → reconnect button. Never blocking, never Inbox.
- Timezones: store what Google sends (RFC3339 with offset); render in system zone.
  All-day events carry `date` only, no `time`.

## Where it shows up: surfaces and scenarios

No new top-level view. Tavla cast throughout; job numbers in parens.

### The week fills itself in (job 1)

Erik connects Google Calendar, follows "primary". Within a tick, this week's
meetings exist: `2026-07-30-nordkap-checkin.md` with Sara Lindqvist in
`participants`, `series: nordkap-checkin` inherited from the recurrence, and last
month's instances already threaded as history. The sidebar's live-note auto-pin
(per the pin rework: system only ever adds) surfaces today's meetings; the PM never
typed any of them.

### The brief that's simply ready (job 2)

The scheduler sees the check-in starting in an hour and runs `before-meeting`
against the note that already exists — previous instance via `series`, delivery
delta via the Jira mirror, open commitments involving Sara. The brief sits on the
meeting page when the PM opens it. No ping, no Inbox; the meeting page is the
owning view.

### Capture knows where it belongs (job 3)

At 15:04 the PM drags in a transcript. The capture dialog's default is no longer a
guess: the shallow index says the 14:00–15:00 slot was the Nordkap check-in, so it
offers "Attach to Nordkap check-in (ended 4 min ago)" first. One confirm instead of
a search.

### People and promises converge (job 4)

Attendee emails resolve against people notes (match on an `email` frontmatter field;
unmatched externals render as plain emails — creating person notes stays a human
gesture, possibly a librarian suggestion later). Commitment-check, asked to help with
the overdue "SCIM timeline answer for Sara", now sees a meeting with Sara tomorrow
and proposes "raise it there" with the brief pre-seeded — instead of drafting a
cold email.

### Outbound, later: the calendar as a write target (phase 4)

`after-meeting` drafts "Book 30 min follow-up with Tom next week" as an outbound
card (`provider: google-calendar`, `action: create_event`), body previewed as the
invite. Approve → connector `execute()` → event created, link-back appends the
event to the meeting note. Rescheduling and RSVP-on-behalf are the same shape.
Requires the write scope via incremental consent — which is itself a designed
moment: the PM is asked by *Google* exactly when the app first tries to write.

## Connector mapping

`packages/connectors/src/google-calendar/`, implementing the existing interface:

- `id: 'google-calendar'`; container kind: `calendar` (the calendarList).
- `verifyAuth()` → `calendarList.get('primary')` with a fresh access token.
- `listContainers()` → `calendarList.list` (id, summary, primary flag).
- `pullChanges(container, mark)` → `events.list` with `syncToken` (or windowed
  initial pull); returns event changes + new token as the high-water mark.
- `fetchFull()` → trivial for events (list payload is already full); exists for
  interface symmetry.
- `mapStateCategory()` → `confirmed → open`, `tentative → open`, `cancelled → done`
  (the generic enum matters little here; `event_status` carries the real signal).
- `execute(payload)` → phase 4: `create_event`, `update_event`, `respond_to_event`.

One structural addition: the provider descriptor grows an auth-field kind —
`{ kind: 'oauth' }` alongside the existing text fields — so the Connections form
renders a "Connect with Google" button instead of inputs. The descriptor stays the
single source of the auth UI, as designed.

## Phasing

1. **Auth + mirror.** OAuth service (loopback flow, token store, reconnect),
   connector, followed calendars, shallow index, meeting-note creation with the
   ownership split, series mapping, Connections UI with the oauth field kind.
   *Jobs 1 and 5; zero write risk; the visible magic moment.*
2. **Time-aware sessions.** ✅ BUILT (2026-07-28) — Scheduler horizon from the
   shallow index: `before-meeting` auto-prep on the meeting page; capture-dialog
   matching (attach-to-synced-meeting instead of a duplicate). *Jobs 2 and 3.*
3. **People + commitments.** ✅ BUILT (2026-07-28) — Email→person resolution on
   `participants`; commitment-check reads the meeting horizon. *Job 4.*
4. **Outbound events.** ✅ BUILT (2026-07-28) — Write scope via incremental
   consent; `create_event` / `update_event` / `respond_to_event` cards through
   `OutboundPort.execute`; drafted-against-stale banner reuses the existing
   snapshot compare. Fixture-tested; live write path not yet exercised.

## Work areas

Same seam discipline as the Atlassian build; A first, then parallel.

### A. Domain (`packages/domain`)

- `zMeeting` gains optional sync fields (`provider`, `external_id`, `calendar`,
  `remote_updated`, `url`, `event_status`); the machine-owned-fields list becomes an
  exported constant the mirror patcher and tests share.
- Outbound payload: `google-calendar` provider + event actions (schema only; phase 4
  executes).
- Provider descriptor: `oauth` auth-field kind.

### B. OAuth service (main process, new)

- Loopback + PKCE flow, token exchange/refresh, `safeStorage` persistence,
  revocation-aware health reporting. Provider-agnostic surface (Drive/Gmail reuse).
  The one genuinely new subsystem — isolate and test it hard (fake Google endpoint
  in tests; the real consent flow gets a manual checklist in
  `docs/google-cloud-setup.md`).

### C. Connector (`packages/connectors/src/google-calendar/`)

- The interface implementation above; `syncToken` handling incl. `410` re-list;
  attendee/resource classification; fixture-tested like the Atlassian adapter.

### D. Sync engine (main)

- Register the second connector in `reconfigure()`/`tick()` (the loop is already
  provider-agnostic).
- **The meeting mirror patcher**: frontmatter-only updates on the machine-owned
  fields, note creation for qualifying events, cancellation rule (delete only if
  body untouched), never-demote. This is the delicate part — it's the first writer
  that shares a file with the human.

### E. Frontend (renderer)

- Connections: "Connect with Google" button flow (waiting state while the browser
  round-trips), connected-account line, calendar picker, reconnect on
  `auth-expired`.
- Agenda affordances: today's meetings from the shallow index where surfaces
  already want them (sidebar live section, capture dialog default).
- Synced-meeting chrome: quiet provider glyph + open-in-Calendar on the meeting
  page; struck-through cancelled rows.

### F. Sessions & scheduler

- `before-meeting` auto-prep trigger from the event horizon (owning-view delivery,
  respecting the no-sweeps stance); capture matching; commitment-check horizon
  context; email→person resolution (with the librarian suggesting person-note
  creation as a later nicety).

## Demo

`vault-dev` can't ship a live Google account. Two-layer approach: fixture-driven
connector tests for the engine, plus **`scripts/seed-google-calendar.ts` — BUILT
2026-07-28** (`pnpm seed-google-calendar`, mirroring `reset-atlassian`). It runs the
same loopback+PKCE consent flow the app uses (browser once; refresh token cached in
gitignored `.google-demo.json`; OAuth client from `PM_GOOGLE_CLIENT_ID/SECRET`), then
converges the primary calendar to the Tavla cast — a weekly Nordkap check-in with Sara
plus a few forward-looking meetings whose attendee emails match the person notes so
participant resolution links them. Anchored on 2026-07-17 and slid to today (same maths
as `refresh-demo`); idempotent by a private `pmDemo=tavla` marker (delete-tagged →
recreate), so it doubles as the after-demo reset. `--reconcile` (default) drops the
runtime `.vault-dev` pre-synced stub meeting so the live sync owns it without a
duplicate; `--dry`/`--anchor`/`--today`/`--tz` as usual. Offline (no live account) the
seeded meeting notes in `vault-dev/meetings/` still carry sync frontmatter so the UI
chrome is demoable. Google Cloud project setup + this script's usage: `docs/google-cloud-setup.md`.

**Nobody gets mail.** Every Google Calendar write — the seed script's insert/delete and
the connector's `create_event` / `update_event` / `respond_to_event` — carries
`sendUpdates=none` (2026-07-28). Two reasons, and the product one comes first: what pm
sends outward is what the PM approved in a card, so Google mailing the guest list an
invite or a cancellation on our behalf would be a second, unreviewed outbound channel.
The demo reason is the one that bit: the cast are invented people, so every seeded event
sent a real invite that bounced back as a mailer-daemon report. Belt and braces, the
cast now live at RFC 2606 reserved domains (`sara.lindqvist@nordkap.example`,
`…@kranelund.example`, `…@tavla.example`) — obviously fake, never routable. Attendees
still appear on the event, they're simply not emailed. If a future flow genuinely wants
Google to invite people, that's a per-payload opt-in, not a change to the default.

## Open questions

- **Qualifying heuristic misses**: 1:1s where the other party is a room-less
  external, interview panels, webinars the PM only watches. Ship the simple rule,
  watch what it gets wrong; promotion-by-hand is the escape hatch.
- **`summary` drift**: event renamed upstream after the PM edited the note title —
  we chose PM-wins; is a quiet "renamed upstream to X" hover hint worth it?
- **Multiple Google accounts** (work + consulting): same posture as multiple
  Atlassian sites — out of scope v1, but the Connections model is already plural;
  don't paint the token store into a single-account corner (key by account email).
- **Declined-then-reaccepted events**: note was never created (declined) — creation
  on re-accept is just the next tick; but note *was* created, then PM declines —
  keep or cancel-rule? Lean: treat like cancellation.
- **Event descriptions in the vault**: bodies can contain dial-ins and private
  context. Vault is local-first so this is fine, but the shallow index should not
  leak descriptions into surfaces that render outside the vault (MCP answers cite
  meeting notes, not raw index rows).
