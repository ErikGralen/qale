# Onboarding

The whole first-run experience, from double-clicking the app for the first time to the moment the
product has done something real for you. Written 2026-08-02 against the code as it stands. This doc
absorbs tickets 16, 17 and 18 from `docs/beta-launch.md`; those now point here.

**How to use this doc.** Same convention as beta-launch: one ticket per thing, write your call under
**Decision**, fill **Notes** as each one lands.

**What exists today.** Nothing. There is no onboarding, first-run or welcome code anywhere in the
app. First launch renders the full shell (tabs, sidebar, right rail) around a single card that says
"Open workspace…" (`Home.tsx` `NoWorkspace`). The API key is buried in Settings, identity (name +
email aliases) is a Settings section nobody is told about, telemetry does not exist, and the demo
workspace is a dev script pointed at a gitignored folder.

---

## The shape of it

Two halves, deliberately different in character:

1. **The opening.** A full-screen flow on first launch. Six short screens, one question each, a
   couple of minutes total (less if you skip the connections). It collects the things the app
   genuinely needs (who you are, where your files live, the key, what it may read, consent) and
   then gets out of the way.
2. **First steps.** A short list of real tasks on Home that teach the product by having it do its
   job: drop a transcript, decide on a proposal, prep for a meeting. Each checks itself off when the
   real thing happens, not when you click "next". This is also where skipped setup steps wait, so
   "finish onboarding" is never a separate mode, just an unchecked item.

### Design rules for the whole thing

- **One question per screen.** Enter advances everywhere. A person who types fast gets through the
  opening in about a minute.
- **Every ask says why, in one line.** "Your name, so the memory knows which promises are yours."
  Nothing is collected without the reason sitting next to the field.
- **Skippable means silent.** Anything the app can live without (the key, the connections,
  consent) has a visible skip. Skipping is recorded and the item reappears once in First steps. It
  never nags, no badge, no red dot.
- **Build toward a payoff.** The screens get shorter as you go, and the payoff is not inside the
  opening at all: it is your own transcript being read, or your own week arriving from the calendar
  you just connected, once the app is in front of you. Nothing in the workspace is ever fake, so
  the suspense is real: the thing being revealed is the product working on your material.
- **Respect over confetti.** No "Awesome!", no fireworks, no mascot. A completed First step gets a
  quiet check and one line about what just happened. The reward is the product doing something
  real with your material.
- **The words are plain.** Every string in this flow follows the product copy rule: plain, human,
  no jargon. This is the first text a user ever reads from us.
- **Interruptible.** Quitting mid-flow resumes at the same step next launch. Every completed step
  is saved as it happens.
- **Reversible.** Every screen after the first has a quiet Back above the title. It only moves the
  marker: what a screen already wrote stays written, and the three screens that took something (your
  name, the folder, the key) show what they hold when you land on them again, so going back is how a
  typo in your own address gets fixed rather than a way to lose an answer.

### The opening, screen by screen

**1. Hello.** The name, one sentence about what this is, one sentence about the deal ("it drafts,
you approve, everything stays in files you own"). A single button. This screen carries the visual
identity: the serif face (Fraunces), the warm palette, generous space. It should feel like the
cover of something, not a dialog.

**2. You.** Name and work email. The reason line: the memory needs to know which "you" appears in
meetings and which promises are yours. Feeds `identity.name` and the alias list in settings, the
same fields the Settings "You" section already edits.

**3. Your files.** Create a fresh workspace (we suggest a sensible default location and name) or
open an existing folder. The synced-folder check runs here: pointing at iCloud or Dropbox gets one
clear warning before proceeding (beta-launch ticket 14). This is the one step that cannot be
skipped.

The Obsidian line says "put this folder inside your vault", not "open your vault". Opening a vault
as the workspace root was the earlier copy and it promised something we do not do: structure is
folder-shaped here (`typeForDir` types a note by its folder, `ensureScaffold` writes our fourteen
folders into whatever root is chosen, the librarian owns the root `index.md`), so a real vault gets
our tree dropped on top of it, keeps none of its own folders in navigation, and loses its root
`index.md` on the first librarian pass. A subfolder gives the honest half of the promise: their
notes untouched, ours plain markdown they can still edit in Obsidian.

**4. The key.** One field for the API key from the invite, with a "add it later" skip. On paste we
verify it with one cheap call so a typo fails here, not twenty minutes later inside a session.
BYOK per beta-launch ticket 3; we hand keys to beta users, so the copy says "paste the key from
your invite" rather than sending anyone to the Anthropic console.

**5. What it may read.** The connections: Jira + Confluence, and Google Calendar. Both optional,
both skippable, and the screen says why in one line: the memory is only as good as the material it
can see, and this is where most of a PM's material already lives. Each provider is one row.
Google is a browser sign-in; Atlassian is site URL, email and API token, verified on save (this is
the existing Settings → Connections machinery, in a first-run frame).

Connecting is not the finish line. Nothing is followed by default, so a connection with no
projects, spaces or calendars picked does nothing at all. The moment a connection verifies, the
row expands into its container list and asks the second question: which of these should it watch?
Keep that list short and honest: the ones this person actually works in on top, ticked, each with
the reason it is being recommended, and everything else folded away behind one line. Nothing is
followed until they confirm. The same list lives in Settings afterwards, so a hasty choice here is
cheap to change.

The reading is one-way at this point. Nothing is written back to Jira, Confluence or the calendar
without an approval, and the screen says so plainly, because "connect your Jira" reads as scary
until you know that.

**6. What leaves your machine.** The telemetry ask, in plain words, as a short literal list of the
events we send and a statement of what we never send (no titles, no paths, no note content, no
prompts). One switch, defaulted to on but genuinely a choice, and the same switch exists in
Settings afterwards. (Schema and transport are beta-launch ticket 5; this screen is just the
consent surface.)

Then the shell appears, with the First steps card on Home.

There is no seventh screen. Getting the first piece of material in used to be one (First light,
ONB-7), and it is a First steps row instead: the workspace still starts empty, the ask is still
made, but it is made by the app once someone is in it rather than as the last gate of a setup
flow. Same words, better moment.

### First steps

A card on Home, present until finished or dismissed. Six or so items, each a real action with
detection wired to the real event, each row a button that takes you to the right place:

| Step                       | What it teaches                  | Done when                                                                    |
| -------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| Add your key               | (only if skipped in the opening) | `hasAnthropicKey` flips true                                                 |
| Drop a meeting transcript  | capture, arrival, the receipt    | an arrival session completes on a transcript                                 |
| Decide on a proposal       | the approval loop, the Inbox     | first accept or reject                                                       |
| Prep for a meeting         | sessions working for you         | a meeting-prep session completes                                             |
| Ask your memory a question | chat over your own notes         | a chat session with a user prompt completes                                  |
| Tell it about your product | you talk, it drafts, you approve | the first understanding card is accepted (docs/product-understanding.md U-4) |
| Connect your calendar      | (only if skipped in the opening) | a Google account is connected and one calendar is followed                   |
| Connect Jira or Confluence | (only if skipped in the opening) | an Atlassian site is connected and one project or space is followed          |

The two connection rows are the main reason First steps exists as a second chance rather than a
nag. Most people will skip them in the opening, because on day one they have no reason to trust
the app with their work systems yet, and the honest answer to that is to ask again after the
product has proven itself on a transcript, not before. So the rows sit there quietly, each one
line, each opening Settings → Connections at the right provider. A row that was never skipped
because it was done in the opening simply does not appear.

Half-done counts as not done: a connection that verified but has nothing followed leaves the row
unchecked, with the line reading "Connected, but nothing picked to watch yet". Otherwise someone
ends up with a green tick and an app that reads nothing.

Rules: checks are quiet, a completed row shows one line of what happened ("Read your transcript,
two proposals in the Inbox"). The card is dismissible as a whole at any time and never comes back.
When everything is done it retires itself after showing once in its finished state. Since the
workspace starts empty, "drop a meeting transcript" is the row that unblocks most of the others,
so it sits first and says what counts as a transcript. There is no sample file to fall back on by
design: the first thing in the workspace should be the user's own.

---

# Tickets

## ONB-1. Onboarding state and gating

**Today:** no first-run flag of any kind. The nearest analogue, the progressive-reveal machinery,
lives in localStorage, and packaged `file://` builds do not persist localStorage. So renderer
storage is off the table for this.

**Proposal:** an `onboarding` record in `settings.json` via `SettingsService`: current step,
per-step completed/skipped, a `finishedAt`, and the First steps checklist state. Exposed through
the settings DTO, mutated through one IPC channel. The Shell renders the opening as a full-screen
layer when `finishedAt` is unset (it must render with `vault === null`, unlike the drag overlay,
which is gated on vault). Resume lands on the first incomplete step. Existing users, that is any
install that already has a `vaultPath`, are grandfathered: flag set on migration, they never see
the opening, but they do get the First steps card.

**Decision:**
yes
**Notes:**
Built. `onboarding` record in `settings.json` (`OnboardingRecord` in settings-service):
`finishedAt`, `step`, `done`, `skipped`, `checklist`, `dismissed`, `telemetry`. One mutation
channel, `settings:setOnboarding`. Grandfathering keys off whether the FILE carried a record, read
before the defaults are merged in — merging first makes "absent" and "present" indistinguishable,
which silently broke it the first time. New push event `settings:changed` carries the whole DTO,
so a First step ticks the moment the thing happens.

---

## ONB-2. The opening frame

**Today:** nothing to build on beyond the `@qale/ui` Dialog pattern, which is wrong for this; the
opening is a takeover, not a dialog.

**Proposal:** one component owning the opening's screens: full-viewport layer inside the Shell root,
step transitions (slide or crossfade, fast, no bounce), Enter advances, Escape never exits (only
explicit skips do), progress shown as a quiet "2 of 6". Serif display type for screen titles, the
existing warm-clay palette, light and dark both. This is the ticket where the "top notch" bar
lives: it should be run through the Impeccable pass once functional. Build the frame with
placeholder screens first so ONB-3 through ONB-6 and ONB-11 slot in independently. One wrinkle for
the frame: the connections screen (ONB-11) is the one step that can hand off to the browser and
come back, so the frame has to survive losing and regaining focus mid-step.

**Decision:**
yes
**Notes:**
Built. `onboarding/Opening.tsx`: full-viewport layer inside the Shell root, gated on
`settings && !finishedAt` so no shell flashes first. Enter is one listener that clicks the
screen's `[data-opening-primary]`, which means each screen's disabled rules are obeyed for free;
Escape is swallowed. Shared `Screen` shell (serif title, one-line why, footer) and `SkipLink`.
Resume lands on the stored step, falling back to the first unanswered one. Impeccable pass not
run yet.

Back added later: the frame hands a `back` down through a context, so the shared `Screen` shell
draws the link and no screen can forget it (and none can draw it on screen one). It patches `step`
only — nothing written is taken back — and You, Files and the key screen each read what is stored
when they mount, so a second visit shows the answer instead of an empty field.

---

## ONB-3. Screen: You

**Today:** `identity: { name, aliases }` already exists in settings with a working setter, and
Home's greeting plus people chips already resolve "You" from it.

**Proposal:** two fields, name and work email, writing to the existing identity setter (email goes
in as an alias; a later Google connect adds its own address alongside, same as today). Reason line
under the fields. Both optional to fill but the screen itself is not skippable, so an empty submit
is a deliberate "rather not say", not an accident.

**Decision:**
yes
**Notes:**
Built. Two fields into the existing identity setter (email goes in as an alias). Not
skippable, both fields optional. A failed settings write still advances: nobody gets stranded on
screen two of the opening.

---

## ONB-4. Screen: Your files

**Today:** `vault:pick` opens the OS dialog and any folder works; `ensureScaffold` plus
`ensureDefaultSkills` already make a new folder usable. There is no "create with a suggested
default" path and no synced-folder check anywhere.

**Proposal:** two buttons. **Create** makes a folder at a sensible default (something like
`~/Documents/<AppName>`) with one click, showing the path and letting them change it. **Open**
is today's picker, with copy that welcomes existing Obsidian vaults. Add the synced-folder
detection (iCloud, Dropbox, OneDrive path patterns) and a plain warning that lets them proceed
anyway; the check lives in the main process so Settings can reuse it later. This closes
beta-launch ticket 14.

**Decision:**
yes
**Notes:**
Built. `vault:suggestPath` / `vault:checkPath` / `vault:create`. The sync check runs
BEFORE the folder is created, and resolves the deepest existing ancestor with realpath first —
with "Desktop & Documents in iCloud" on, `~/Documents` IS a symlink into the iCloud container and
the literal path says nothing. Warning is overrulable ("Use it anyway"). Closes beta-launch 14.

2026-08-04: the "welcomes existing Obsidian vaults" copy is withdrawn. It invited a root we handle
badly (see the screen-3 note above). The line now points Obsidian users at a folder inside their
vault instead. The Open button is unchanged: anyone who knows what they are doing can still pick
any folder.

---

## ONB-5. Screen: The key

**Today:** the key field exists only in Settings. Nothing validates a key when it is saved; a bad
key surfaces later as a failed session.

**Proposal:** the same masked field, plus a verify-on-save: one minimal API call, spinner, clear
success or "that key did not work" inline. Skip is a text link, not a button, and records
`skipped` so First steps picks it up. Keep the Settings field as is; both go through
`settings:setAnthropicKey`. The verify call belongs in the main process next to the key store and
can be reused by Settings.

**Decision:**
yes
**Notes:**
Built. `settings:verifyAnthropicKey` in main (`services/verify-key.ts`): one
`/v1/models?limit=1` call, no tokens spent. A network failure is kept separate from a bad key, and
a 429 passes — the key is fine, the account is busy. Settings still saves without verifying.

---

## ONB-6. Screen: What leaves your machine

**Today:** no telemetry exists (beta-launch ticket 5, platform still undecided). Consent has
nowhere to live.

**Proposal:** build the consent surface now against a no-op sink: the literal event list rendered
from the same allowlist the sender will use (one source of truth, so the screen can never claim
less than we send), a "we never send" line, one switch stored in settings, mirrored in Settings
with the same wording. When ticket 5 picks a platform, the sender reads this switch and ships.
Consent defaults to on for invited beta users (we ask at invite time too, per ticket 5) but the
switch is real and off means nothing is sent.

**Decision:**
yes, but we dont currently have a way to track files so this will just be mocked in the beginning.
**Notes:**
Built as the consent surface over a no-op sink, per the decision. The event list lives
in `@qale/ipc` (`telemetry.ts`) and both the opening screen and Settings render FROM it, so the
screen can never promise less than a future sender sends. `telemetryAllows()` is the guard that
sender will call. Nothing is sent today.
Built against a no-op sink, as decided. The sink is now specified: PostHog Cloud EU, in
`docs/telemetry-posthog.md`. One thing that ticket hands back here (TEL-6): `telemetry` defaults to
true from first launch, so with a real sender attached we would send from someone who has not
reached this screen yet. The sender buffers until this screen is answered rather than the screen
changing.

---

## ONB-7. Screen: First light

**Today:** the demo machinery is dev-only: `scripts/refresh-demo.ts` copies `vault-dev/` to a
gitignored folder with dates slid to today. Nothing in the shipped app can produce a populated
workspace. (This was beta-launch ticket 17.)

**Original proposal (rejected):** ship the example week as an app feature, bundling the demo vault
in resources and copying it into a real folder with dates slid to install day.

**Proposal:** the workspace starts empty and stays the user's own. Two doors, no bundle, no demo
vault in the app at all. **Drop something in** opens the capture tray in the flow, so the last
thing that happens in the opening is their own material being read; the handoff line from ONB-9
carries it from there. **Start empty** just proceeds to the shell, which is a legitimate choice
and not a lesser one, especially for someone who connected a calendar on screen 5 and will find
their week already waiting.

Consequences worth noting: nothing here depends on beta-launch tickets 25 and 26 any more, so
this ticket is unblocked and much smaller. `vault-dev` stays what it is, a dev and demo fixture,
and never ships. And an empty Home is now a first-run surface a real user sees, so its empty
state has to be written for that moment rather than treated as an edge case.

**Decision:**
No let's keep their workspace empty in the beginnig.
**Notes:**
Built as decided: no example week, no bundle, nothing in `resources`. Two doors, "Add
something now" (into the real capture tray) and "Start empty", and the screen says outright that
the workspace starts empty. `vault-dev` stays a dev fixture. Home's day-one invitation now stands
down while First steps is on the page, since both taught the same move.

**2026-08-07: the screen is gone.** The decision above stands (empty workspace, no bundle), but
it does not need a screen of its own. The ask was already a First steps row saying the same thing,
so the opening now ends on telemetry and the transcript ask waits on Home. `FirstLight.tsx` is
deleted and `first-light` is out of `OPENING_STEPS`, which makes the opening six screens.

---

## ONB-8. First steps

**Today:** nothing. The progressive-reveal system proves per-vault earned-state works, but it is
renderer-side; detection for these steps lives in the main process (sessions finishing, proposals
decided, settings changing).

**Proposal:** the card described above. Detection hooks in the main process where each event
already flows (session completion, proposal accept/reject, key set, identity edits, connection
verified, container followed), writing into the `onboarding.checklist` record from ONB-1;
the two connection rows read the same connection and follow state ONB-11 writes, so a connection
made straight from Settings months later still ticks the row; renderer subscribes through
the existing settings-changed push. Each row deep-links to the right surface using the existing
tab-opening actions. No sample-material affordance, per ONB-7: every row is waiting on something
the user actually does, so the transcript row has to explain what counts as one. Dismiss and
retire rules as written above.

**Decision:**
yes
**Notes:**
Built. `onboarding/FirstSteps.tsx` on Home. Detection is main-side, off the events
that already fire: `arrival:ingest` / `capture:ingest` for the transcript, accept/reject for the
card, `agent.onStatus` (which now carries `skill`) for the prep and the question, `note:save`
under `skills/_about-us/` for the last (repointed 2026-08-07 to the first accepted understanding
card; see docs/product-understanding.md U-4). Three rows are DERIVED from live state rather than
stamped — the key and the two connections — which is what makes "only if skipped in the opening"
need no bookkeeping and lets a connection made from Settings months later still tick. Half-done
connections stay unticked and say why.

---

## ONB-9. The post-capture handoff

**Today:** after a drop, nothing tells the user a session is running or where the cards will
appear. The receipt strip exists but only speaks after arrival finishes. (This was beta-launch
ticket 18.)

**Proposal:** one line, shown the moment a capture is submitted: "Reading your meeting. Watch it
here", pointing at where the session and its proposals will land. Cheap, and it closes the loop
the whole product is built on. Worth doing early because both onboarding doors that involve real
material ("Bring your own", the transcript First step) depend on this moment not being silent.

**Decision:**
Yes implement this. (Carried over from beta-launch ticket 18.)

**Notes:**
Built. `components/CaptureHandoff.tsx` in the rail slot, raised the instant the tray
is submitted (not when it resolves — the wait is the silent moment) and handed over to the
receipt. Verified: it appears during the ingest and the receipt replaces it.
yes
---

## ONB-10. The words

**Today:** first-run copy does not exist, and the product name is mid-rename (beta-launch
ticket 1; the rename must land first, the opening says the name more than any other surface).

**Proposal:** one pass over every string in the opening and First steps, written and reviewed as a
set so the voice is consistent: plain, short, no jargon, no exclamation marks, reasons next to
asks. Do this last, against the working flow, because copy written before the screens exist always
reads wrong inside them.

**Decision:**
yes
**Notes:**
Done as a pass over the whole set. No em dashes anywhere in product copy, no
exclamation marks, a reason line next to every ask. The opening names the product once, on the
cover. Placeholder names were pulled (a stranger's name in an empty field is the first thing they
read).

---

## ONB-11. Screen: What it may read (connections)

**Today:** connections are complete and working, but they are the most buried thing in the app.
Settings → Connections (`ConnectionsSettings.tsx`) already does all of it: providers rendered from
their auth schema, Google through a browser OAuth round trip, Atlassian through site URL plus
email plus API token, verified on save, then a container list per connection (Jira projects,
Confluence spaces, calendars) with a follow checkbox each. Nothing is followed by default, and
`syncNow` runs the moment something is followed. A first-run user is never told any of this
exists, so the most common shape of a disappointing first week is a memory with nothing to read.

**Proposal:** a first-run screen over the existing machinery, not a second implementation. Reuse
`ConnectForm` and the container list, with the settings chrome stripped and a first-run frame
around them: one row per provider, connect inline, and on success the container list unfolds in
place so the follow choice happens in the same breath as the connect. Requirements:

- **The screen is skippable as a whole, and each provider is skippable on its own.** Skip records
  per provider, so First steps can ask about Jira without asking about Google again.
- **Recommend, with the reason, and confirm before following anything.** Amended 2026-08-07 by
  docs/product-understanding.md FL-2. The rule used to read "preselect nothing", and it was written
  against silently following everything; a PM with forty Jira projects will not thank us for a
  helpful "all". A ticked box with a stated reason beside it ("you edited 12 pages here, the last
  one 3 days ago") and one explicit confirm is a different thing: they can check it, and nothing is
  followed until they press the button. Where there is no footprint to rank by, or the survey
  fails, it falls back to the flat unticked list this rule originally described.
- **Say the read-only part out loud.** One line: it reads, and anything written back goes through
  an approval first. This is the sentence that decides whether people connect at all.
- **The OAuth round trip has to survive the app losing focus** and the user cancelling in the
  browser; `cancelOAuth` already exists, wire it to the skip.
- **A failed verify never blocks the flow.** Inline error, skip stays available, move on.
- **Google connect also yields an email address**: fold it into the identity aliases from ONB-3
  rather than asking again.

Nothing new in the backend. If this ticket needs main-process work at all, it is only whatever the
onboarding state from ONB-1 needs to record per-provider skips.

**Decision:**
yes
**Notes:**
Built. `onboarding/screens/Connections.tsx`, over the existing `connections` client
and provider descriptors. Per-provider skips recorded as `connections:<providerId>`; the container
list unfolds in place and says "Pick at least one" while nothing is ticked; the
read-only line is on the screen; `cancelOAuth` is wired to "Stop waiting". A failed verify is
inline and never blocks. The follow list after a live connect is unverified — it needs real
credentials.

2026-08-07: the list is now the shared `components/FollowPicker.tsx` recommendation card (see
docs/product-understanding.md FL-2), used by this screen and by Settings.

---

# Order

ONB-1 and ONB-2 first (state, then frame), then ONB-3 through ONB-6 and ONB-11 in any order since
they slot into the frame independently; ONB-11 is the cheapest of them, since it is a reframe of
working code. ONB-7 is now small and blocked on nothing, but it wants ONB-9 done first, since with
no example week the drop is the whole payoff. ONB-9 is small and independent, worth doing
immediately. ONB-8 after the steps it points at exist. ONB-10 last.

Open dependencies from beta-launch: the rename (ticket 1) before any copy is final, the telemetry
platform (ticket 5) before ONB-6's switch sends anything, and the invite-code question (ticket 4):
if invite codes happen, the code field joins the opening as part of screen 4 and the key screen
may disappear entirely for gateway users.
