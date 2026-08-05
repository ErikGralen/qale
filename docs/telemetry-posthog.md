# Telemetry: PostHog Cloud EU

The sink behind the consent screen. Written 2026-08-02, against the code as it stands. This closes
`docs/beta-launch.md` ticket 5 ("Need to evaluate what platform we can use for this... Will do this
in a separate session"), and it is the missing half of `docs/onboarding.md` ONB-6, which shipped the
promise without anything behind it.

**How to use this doc.** Same convention as beta-launch and onboarding: one ticket per thing, write
your call under **Decision**, fill **Notes** as each one lands. TEL-1 is yours and blocks the rest.

---

## What exists today

**Status: TEL-2 through TEL-8 built 2026-08-03. TEL-1, the PostHog account itself, is still open and
is the only thing between this and real data.** Every ticket's Notes says what landed. The table
below is how things stood when the plan was written, kept because the tickets read against it.

The consent half is built and shipping. The sending half does not exist at all.

| Piece | Where | State |
|---|---|---|
| The event allowlist, in plain words | `packages/ipc/src/telemetry.ts` | Built. Seven events, each with the sentence the screen shows. `TELEMETRY_NEVER` is the other half of the promise. |
| `telemetryAllows(consented, event)` | same file | Built, and nothing calls it. |
| The consent screen (ONB-6) | `apps/desktop/src/renderer/src/onboarding/screens/Telemetry.tsx` | Built. Renders the allowlist, so it can never promise less than we send. |
| The Settings mirror | `SettingsView.tsx`, "What leaves your machine" | Built, same list, same words. |
| The switch, persisted | `onboarding.telemetry` in `settings.json` (`SettingsService`) | Built. Defaults to true. |
| A sender | nowhere | Missing. |
| An install id | nowhere | Missing. |

There is also a precedent worth copying rather than reinventing: `src/main/log.ts` scrubs every log
line on the way into the ring buffer (paths, hosts, note slugs, addresses, anything key-shaped), and
`src/main/diagnostics.ts` is versions, booleans and counts only. Telemetry holds itself to the same
bar, and reuses `redactLogLine` for the one place a string could still carry the user's world: a
stack trace.

---

## The shape of it

**The sender lives in main, and only in main.** Three reasons, all of them decisive:

1. Packaged builds run under `connect-src 'self'` (`src/main/index.ts`, `contentSecurityPolicy()`).
   A renderer cannot post to PostHog without punching a hole in the policy, and the policy is worth
   more than the convenience.
2. Every event we want already flows through main: sessions settle in `handlers.ts`, cards are
   decided there, capture lands there, connections verify there. The renderer would have to be told
   things it does not currently need to know.
3. One process, one allowlist check, one place to audit. The project key never enters the renderer
   bundle.

The single exception is "which views get opened", which only the renderer knows. That gets one
narrow channel that accepts a view kind from a fixed union, never a free string (TEL-5).

**Who a person is: a named beta user.** `distinctId` is an `installId`, a uuid minted once and kept
in `settings.json`, and the name and work email from the opening ride along as person properties
(TEL-4). That is a deliberate choice for a hand-picked beta, and it costs us the word "anonymous" on
the consent screen, which has to change in the same commit. What still never leaves is everyone
else: no participant, no person mentioned in a note, no workspace name, no title, no path.

**Off means off.** Consent false sends nothing, queues nothing, and drops whatever was queued. And
nothing at all is sent before the person has seen screen 6 on a first run (TEL-6). That was a real
bug in the default when this was written: `telemetry: true` is live from the first launch, before
anyone has been asked. The sender now holds rather than sends across that whole window, and the
answer either releases the backlog or clears it.

**Considered and skipped: session replay.** Asked and answered 2026-08-03, so it does not need
asking again. Masking does not settle it here the way it would in most apps, because in this product
the content is the interface: the sidebar is note titles, the editor is their writing, the cards are
the agent's proposals. Mask all of that and the recording shows nothing the event stream does not
already say. Masked is also not absent, since rrweb keeps the length and word shape of what it
hides. And a masked video is still a video of their screen going to a third party, which is a
harder promise to defend than "counts and booleans" for the one claim the product leans on hardest.
The cheaper version of what replay would have bought is already in the plan: the `view.opened`
stream read in order is a click path, and the scrubbed log tail already rides along in diagnostics.

---

# Tickets

## TEL-1. Account and project setup

This one is yours, and it blocks everything else. None of it is code.

1. **Sign up on EU cloud, at `https://eu.posthog.com`.** Pick the EU region at organisation
   creation. PostHog Cloud EU is a separate instance (AWS `eu-central-1`, Frankfurt) with separate
   accounts and separate data. There is no moving an org between US and EU afterwards, so getting
   this right at signup is the whole point.
2. **One project.** The free tier gives us one, so dev runs and beta installs share it. That is
   fine, and TEL-2 says how they stay apart. Project token, recorded here because it is a
   write-only client key that ships inside the app anyway:
   `phc_nuZqzoKWu4gCTrY5gET7e9JghV72K9rcvF5HDUw7z7Lp`. Never a **personal** API key, which is a
   different thing and reads everything.
3. **Add an internal-users filter rule: `env = dev`.** `Settings -> Project -> Filter out internal
   and test users`. With one project this is the thing that keeps my clicking out of your numbers,
   and it applies to insights without throwing the events away, so a broken dev run is still
   debuggable.
4. **Turn the web-facing products off.** No session replay (decided above), no web analytics, no
   surveys, no toolbar. We send server-style events from Electron main; none of that machinery
   applies, and leaving it on invites a future "just add posthog-js" that would break the promise
   on the screen.
5. **Turn Error tracking on**, that is where `app.crashed` lands.
6. **Sign the DPA** and read the sub-processor list (`Settings -> Organization -> Legal` on EU
   cloud). If we publish anything privacy-facing for the beta, PostHog EU goes on it by name.
   Note this now matters more than it did an hour ago: with TEL-4 we send a name and a work
   address, so what PostHog holds for us is personal data rather than counts.
7. **Set data retention** to the shortest thing that answers our questions. For a beta, a year is
   generous.
8. **Check the free tier against our volume.** Twenty beta users producing a handful of events a
   day is nothing; this should cost zero. Worth setting a billing limit anyway so a loop bug cannot
   invoice us.

**Decision:**
PostHog Cloud EU, one project on the free tier, token above. Session replay skipped.

**Notes:**

---

## TEL-2. Where the key lives, and keeping dev out of the numbers

**Today:** the Google client id sets the pattern. `google-oauth-service.ts` reads
`QALE_GOOGLE_CLIENT_ID` from `process.env` with `?? ''`, and an empty value means this build simply
cannot do the thing, said in plain language rather than failing weirdly. `.env` and `.env.*` are
gitignored, `.env.example` is not.

**Proposal:** the same shape, plus the one-project problem.

- `QALE_POSTHOG_KEY`, empty by default. Empty means this build sends nothing, ever, regardless of
  consent.
- `QALE_POSTHOG_HOST`, defaulting to `https://eu.i.posthog.com`. Hardcoding the EU host as the
  default is deliberate: a missing env var must not silently fall back to PostHog's US default,
  which is what the library does on its own.
- The token is baked in at build time by exporting the var before `electron-builder`, same as
  Google. Note it in the build steps wherever ticket 6's packaging notes end up.

**Sharing one project with dev, in three layers.** The first one does most of the work:

1. **Dev sends nothing unless asked.** With `QALE_POSTHOG_KEY` unset, a dev run has no sender at
   all. So the answer to "do we turn it off for most test sessions" is that it is already off, and
   turning it on is the deliberate act. Nothing to remember, nothing to undo.
2. **When we do test the pipeline, everything is stamped.** `QALE_POSTHOG_DEV=1` puts `env: 'dev'`
   on every event and prefixes the distinct id with `dev-`, so both the events and the person are
   obviously ours at a glance. Beta builds stamp `env: 'beta'`. Every event carries one or the
   other, never neither, so a missing stamp can never read as real.
3. **The project filters `env = dev` out of insights** (TEL-1 step 3). Belt and braces on top of
   layers 1 and 2, and it keeps the events around for debugging rather than discarding them.

Worth knowing about the token: PostHog project keys are write-only and meant to ship in clients, but
ingestion is unauthenticated, so anyone who pulls it out of the asar can post junk events to our
project. For a twenty-person beta that is noise, not risk, and the fix if it ever happens is a new
key in the next build.

**Decision:**

**Notes:**
Built 2026-08-03. `QALE_POSTHOG_KEY` / `QALE_POSTHOG_HOST` / `QALE_POSTHOG_DEV`, EU host hardcoded as
the default. Layer 1 verified against a local stand-in sink: a run with no key made zero requests.
Layer 2 verified: with `QALE_POSTHOG_DEV=1` every event carried `env: 'dev'` and the distinct id came
out as `dev-<uuid>`. Layer 3 (the project-side internal-users filter) is yours, in TEL-1.

**Corrected 2026-08-04. The "baked in at build time by exporting the var" line above was wrong, and
the same bug had already shipped into Google.** `process.env['QALE_POSTHOG_KEY']` in the main process
is a RUNTIME lookup — electron-vite does not inline `process.env` for main — and a Mac app launched
from Finder inherits launchd's minimal environment, not the shell that built it. So the value was
empty in every packaged build no matter what was exported before `electron-builder`. Telemetry would
never have sent a single event from the dmg, and `QALE_GOOGLE_CLIENT_ID` was empty the same way,
which meant **Google Calendar was dead in the packaged app**, reporting "this build has no Google
client configured". Neither fails loudly, which is what would have made it expensive: it reads as a
broken integration, not a build problem.

Two fixes, both needed, because they cover different halves:

- `apps/desktop/electron.vite.config.ts` now `define`s `__QALE_*__` constants from the build
  environment, read in one place (`src/main/build-env.ts`) with a `process.env` fallback for dev.
  Vite's `define` only substitutes the dot form, so the bracket-notation reads had to go. The
  accessors are functions rather than constants: a module-level constant in a shared module is read
  once per process, which broke the telemetry test that re-imports its module to check the dev stamp.
- `turbo.json` declares the three `QALE_POSTHOG_*` vars in `globalEnv`. Turbo 2 defaults to strict
  env mode, so an undeclared var is stripped before the task starts and `pnpm desktop` would have
  seen nothing even with the key exported.

Verified both directions: a build with `QALE_POSTHOG_KEY=phc_TESTKEY123` has the literal in
`out/main/index.js`, a build with a clean environment has zero occurrences and keeps the
`process.env[envName]` fallback for dev.

**Where the values come from: a repo-root `.env`.** Nothing needs exporting. The build config loads
it with `process.loadEnvFile` (Node's own, no dependency) and substitutes the values, so
`pnpm --filter @qale/desktop dmg` and `pnpm desktop` both pick them up. `.env` is gitignored,
`.env.example` is committed and documents every var. Real environment variables beat the file, so a
one-off `QALE_POSTHOG_DEV=1 pnpm dev` still overrides, and a CI secret would too.

Verified: with only a `.env` present and nothing exported, the values land in `out/main/index.js`;
with a shell value set as well, the shell value wins and the file's does not appear.

**The dmg carries whatever was in `.env` at build time, so rebuild after changing it.** Today's dmg
was built with no `.env` at all, so it sends nothing and cannot do Google.

---

## TEL-3. The sender

**Today:** nothing. `telemetryAllows` has no caller.

**Proposal:** `apps/desktop/src/main/telemetry.ts`, one small service, `posthog-node` under
`apps/desktop` dependencies (a real node module, so the existing `externalizeDepsPlugin` rule leaves
it external and electron-builder packs it; nothing to change in `electron.vite.config.ts`).

Rules it has to hold:

- **One entry point**, `telemetry.send(event, props)`. It checks `telemetryAllows(consent, event)`
  from `@qale/ipc` and drops anything else on the floor. The allowlist stays the one source of
  truth, which is the reason it was put in the leaf package both sides import.
- **Properties are allowlisted per event, not by convention.** Extend `TelemetryEventSpec` with a
  `props` map naming each property and its shape (number, boolean, or a fixed set of strings).
  Anything not named is dropped before the call. This is the rule that makes "a future event cannot
  leak a note title by accident" true in code rather than in a comment.
- **It can never affect the thing it observes.** Fire and forget, every path catches, no caller ever
  awaits it. Same discipline as `markFirstStep` in `handlers.ts`, and for the same reason.
- **Global properties on every event:** app version (`appVersion()` from diagnostics), platform,
  arch, packaged or dev run. Counts and enums only, as everywhere else.
- **`disableGeoip: true`.** We do not want a city column, and we should not have one. Worth being
  honest with ourselves though: PostHog's edge still sees the request IP, as any HTTP sink would.
  What we control is that we do not ask it to turn that into a location and store it.
- **No autocapture of any kind.** Exceptions are sent explicitly, scrubbed, by us (TEL-5).
- **Batching:** the library's defaults are right for a desktop app (batch of 20, flush every 10s).
  Do not persist a queue to disk. Losing a handful of events when someone force-quits is fine, and a
  disk queue is another file holding user-shaped data that would need its own scrubbing story.
- **Shutdown is bounded.** `dispose()` in `index.ts` already runs under a 5 second quit watchdog.
  The flush gets its own short timeout inside that, so a dead network cannot slow a quit.

**Decision:**

**Notes:**
Built 2026-08-03 as `apps/desktop/src/main/telemetry.ts`, `posthog-node` 5.47.3. Per-event property
allowlist lives in `packages/ipc/src/telemetry.ts` as `TelemetryPropSpec` + `filterTelemetryProps`,
so the screen and the sender read one list. `disableGeoip: true` confirmed on the wire
(`$geoip_disable: true` in the captured payload). Shutdown is bounded at 1.5s inside the existing 5s
quit watchdog, and a sink that never answers was tested with mocked timers.

---

## TEL-4. Who sent it: named beta users

**Today:** no stable id of any kind. `settings.json` mints an MCP token with `randomUUID()`, which
is the pattern and the place. The opening's screen 2 already collects a name and a work email into
`identity`, so the answer is in the app already.

**Decided:** events are attributable to a named person, not an anonymous install. Say so plainly
rather than dressing it up: for a hand-picked beta where we know everyone by name and can email
them, "which user hit this" is the question worth answering, and an anonymous stream cannot.

**Proposal:**

- **`installId`**, a uuid in `PersistedSettings`, minted on first load next to `mcpToken`. It stays
  the `distinctId` for every event.
- **Name and work email ride as person properties** (`$set`), refreshed on each launch from
  `identity`. In PostHog the person list then reads as people rather than uuids, and every insight
  can be broken down by them.

Why not use the email as the `distinctId` directly, which is the obvious move: the email arrives
later than the first event (screen 2 comes after the app has launched), and it can be edited or
left blank. Any of those would fork one person into two or strand the early events. An id that is
minted before anything happens and never changes has neither problem, and `$set` gets us the same
readable person list. Someone who skips screen 2 stays anonymous until they fill it in, and then
their whole history gains a name at once.

- **Also `$set`:** app version, platform, whether a key is set, which connectors are connected, a
  note-count bucket. All of it already passes the diagnostics bar.
- **A reinstall makes a new person.** With twenty users that is fine and mildly informative. Merging
  them properly means PostHog's alias machinery, which is easy to get subtly wrong and not worth it
  at this size.
- **Never the Anthropic key, or a hash of it.** A beta code was the other option, but it needs a
  field the opening does not have, and it is account-shaped in exactly the way beta-launch ticket 4
  said no to. The email is already collected and is a better join key than a code we would have to
  keep a table for.
- **Add an `Install` row to `buildDiagnostics`** anyway, so a pasted bug report points straight at
  its own event stream.
- Consent turned off and back on keeps the same id.

**This changes what the consent screen has to say, and that is not optional.** `TELEMETRY_NEVER`
currently promises "Your name, your address, or anyone else's". As of this decision that sentence is
false. It becomes: we send your name and work email, so we know which beta user hit which bug, and
we never send anyone else's. Both surfaces render the list, so they update themselves once the
strings change (TEL-7). Shipping the sender before that copy change would be the one genuinely bad
outcome available here, so they land in the same commit.

**Decision:**
Yes, per user by name and work email.

**Notes:**
Built 2026-08-03. `installId` minted in `settings.json` beside `mcpToken`; name and work email
`$set` from `identity` (email is the first alias). Verified on the wire: `$set` carried exactly
`name`, `email`, `hasKey`, `google`, `atlassian`, `notes`, `env` and nothing else, and the note
count arrived as the band `21-100` rather than 89. Diagnostics gained an `Install` row.

---

## TEL-5. Wiring the events

**Today:** every one of these moments already has a line of code in main. None of them report.

**Proposal:** hang each event off the signal that already fires, never off a second ledger that
could disagree with it (the rule the First steps work landed on, and it held up).

| Event | Fires at | Properties |
|---|---|---|
| `app.launched` | `index.ts`, after `onReady()` | first run, opening finished, has key, connectors connected, note-count bucket |
| `app.crashed` | `uncaughtException`, `unhandledRejection`, `render-process-gone`, `child-process-gone` | error name, message, scrubbed stack, which process |
| `session.finished` | `handlers.ts` `agent.onStatus`, `status === 'settled'` (~line 610) | skill (known names, else `custom`), trigger (manual, scheduled, arrival), duration bucket, failed, cards proposed bucket |
| `card.decided` | `proposals:accept` / `proposals:reject` (~1343, ~1352) | decision, card kind, edited, age bucket |
| `material.added` | the capture handlers (~1046 single, ~1255 batch) | kind, count bucket, started a session |
| `connection.added` | Google connect success, Atlassian verify success | provider, followed-container count bucket |
| `onboarding.step` | `settings:setOnboarding` | step id, done or skipped or finished |

Two things to settle inside this ticket:

**The stack trace.** It is the only string in the whole scheme that can carry the user's world:
absolute paths through their home directory, and in a dev run their file names. Send it through
`redactLogLine` first, which already replaces paths, hosts, note slugs and addresses. If that leaves
the stack useless, the fallback is frame function names only, no files. Decide by looking at one
real scrubbed stack.

**Which views get opened.** Beta-launch ticket 5 wanted this ("does anyone ever open Memory"), and
it is the one question the current allowlist cannot answer, because the allowlist has no such event
and only the renderer knows. Adding it means one IPC channel, `telemetry:view`, taking a view kind
from a fixed union and nothing else. I think it is worth it: it is the cheapest read on whether half
the product is dead weight. It also adds one line to the consent screen, automatically, because the
screen renders the list ("Which parts of the app you open, never what is in them").

**Decision:**

**Notes:**
Built 2026-08-03. All eight events wired at the call sites that already existed. Two honest gaps,
both left visible rather than faked:
- **`failed` is always false.** `SessionStatus` in `packages/agent/src/runtime.ts` carries no
  outcome, so there is nothing to read on the settle path. Making it real means the runtime
  carrying the outcome; until then the accept-versus-reject rate is the only quality signal we get.
- **`duration` is omitted, not guessed,** when a session has no recorded start (one that spanned a
  relaunch). The trigger is threaded through `fireSession`'s options.
`view.opened` verified end to end: a fresh profile opens on `home`, navigating to the Inbox sends
one `inbox`, and a re-render sends nothing.

---

## TEL-6. Consent, and the gap before it is given

**Today:** `telemetry` defaults to `true` and is live from the very first launch, before screen 6
has been shown. With a sender attached, that means we would send `app.launched` and a run of
`onboarding.step` events from a person who has not been asked yet. That is exactly the kind of small
lie the ONB-6 comment sets out to prevent, and it is invisible until there is a sender, which is now.

**Proposal:**

- **Nothing is sent while the opening is unfinished and screen 6 has not been answered.** Buffer in
  memory during the opening; on reaching screen 6, either flush what is buffered (consent on) or
  drop it (consent off). An install grandfathered past the opening (`finishedAt` set on migration)
  sends from launch, since it kept the default it was given.
- **The switch is live in both places.** Flipping it off stops the sender and drops the queue in the
  same tick. Flipping it on starts from that moment and never backfills.
- **Off stops crash reports too.** They are on the list, so they are covered by the same switch, and
  there is no "but errors are different" exception.

**Decision:**

**Notes:**
Built 2026-08-03, and the hole turned out to be wider than this ticket described. Settings load a
moment after the process does, so there was a window where an early crash would have been dropped
rather than held. The sender now distinguishes "consent is false" from "consent has not been read
yet" (`consentKnown`): anything raised before the first `setConsent` waits with the rest of the
backlog, and the answer either releases it or clears it. Verified live: with `telemetry: false` in
settings, a full run with a valid key and real navigation made zero requests.

---

## TEL-7. Saying who receives it

**Today:** both surfaces say "anonymous usage and crash reports" and list the events, which is good,
but they never say who gets them. "Anonymous, to somebody" is a weaker promise than it looks. And
after TEL-4 the word "anonymous" is simply wrong.

**Proposal:** three string changes, all of them in `packages/ipc/src/telemetry.ts` and both surfaces
follow, since they render the list.

1. **Drop "anonymous" from the switch label.** It becomes usage and crash reports, and the line
   underneath says they are tied to your name so we can tell who hit what.
2. **Rewrite the `TELEMETRY_NEVER` name line.** From "Your name, your address, or anyone else's" to
   the true version: your name and work email so we know which beta user hit which bug, never anyone
   else's, and never anyone who appears in your notes or meetings. That last clause is the one that
   actually matters to a PM, and it stays true.
3. **Name the processor.** One sentence: it goes to PostHog, on servers in Europe, and nowhere else.

If TEL-5 adds `view.opened`, its line appears on both surfaces on its own.

Also: if a privacy note ships with the beta invite, PostHog EU is named there as a processor.

**Decision:**

**Notes:**
Built 2026-08-03. "Anonymous" is off the switch, `TELEMETRY_IDENTITY` leads the "what we send" list
in full colour on both surfaces, and `TELEMETRY_PROCESSOR` closes both. The standing line became
"Nothing from your notes or meetings. Only whether the app worked, and who it stopped working for,
so we can fix what breaks before you have to tell us." The old "Nothing you write, ever" was the
overclaim: the name and email are things they typed into screen 2.

---

## TEL-8. Proving it

**Today:** nothing to prove.

**Proposal:**

- Tests in `apps/desktop/test/` (`tsx --test`): an event not on the allowlist is refused; every
  event is refused when consent is off; an unnamed property is dropped from a permitted event; a
  scrubbed stack contains no path, address or slug; every event carries an `env` stamp; the only
  address that can reach a person property is the one in `identity`.
- A live check: run with `QALE_POSTHOG_KEY` and `QALE_POSTHOG_DEV=1` set, do the seven things, watch
  them arrive in the activity feed stamped `dev`, and confirm the internal-users filter hides them
  from insights.
- A packaged check: build, confirm `posthog-node` is in the asar, confirm the key made it in, and
  confirm that with consent off the activity feed stays empty for the whole session.
- The quit path: pull the network, quit, confirm the app still exits inside the watchdog.

**Decision:**

**Notes:**
Built 2026-08-03. `apps/desktop/test/telemetry.test.ts`, 28 tests, suite green at 78. Beyond the
list above it pins that a caller cannot forge the `env` stamp, that the backlog is bounded at 100,
and that a crash carrying a home-directory path, a note filename, an address and a key-shaped
string leaks none of them.

The live check ran against a local stand-in for PostHog rather than the real project, so the
payloads could be read rather than trusted, and so nothing reached your project before TEL-1 exists.
What still needs doing once TEL-1 is done: point a dev run at the real EU project and confirm the
events land and that the internal-users filter hides them.

---

# Order

TEL-1 is yours and blocks everything. Then TEL-2, TEL-3 and TEL-4 together (config, sender, id),
which is where most of the work is. TEL-5 next, one event at a time, each one a two-line change at a
call site that already exists. TEL-6 straight after, because until it lands we are sending from
people who have not been asked. TEL-7 is copy and can go any time after TEL-1 confirms the region.
TEL-8 last, but the allowlist tests can be written alongside TEL-3.

Nothing here touches the onboarding work in flight except TEL-7's one sentence and TEL-6's gating of
`onboarding.step`. The screens, the switch and the allowlist all stay as they are.
