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

1. **The opening.** A full-screen flow on first launch. Five short screens, one question each,
   under two minutes total. It collects the things the app genuinely needs (who you are, where your
   files live, the key, consent) and ends not on a form but on the first thing worth looking at.
2. **First steps.** A short list of real tasks on Home that teach the product by having it do its
   job: drop a transcript, decide on a proposal, prep for a meeting. Each checks itself off when the
   real thing happens, not when you click "next". This is also where skipped setup steps wait, so
   "finish onboarding" is never a separate mode, just an unchecked item.

### Design rules for the whole thing

- **One question per screen.** Enter advances everywhere. A person who types fast gets through the
  opening in about a minute.
- **Every ask says why, in one line.** "Your name, so the memory knows which promises are yours."
  Nothing is collected without the reason sitting next to the field.
- **Skippable means silent.** Anything the app can live without (the key, consent, calendar) has a
  visible skip. Skipping is recorded and the item reappears once in First steps. It never nags, no
  badge, no red dot.
- **Build toward a payoff.** The screens get shorter as you go, and the last one is not a form: it
  is your example week loading, or your own transcript being read. The suspense is real, because
  the thing being revealed is the actual product working.
- **Respect over confetti.** No "Awesome!", no fireworks, no mascot. A completed First step gets a
  quiet check and one line about what just happened. The reward is the product doing something
  real with your material.
- **The words are plain.** Every string in this flow follows the product copy rule: plain, human,
  no jargon. This is the first text a user ever reads from us.
- **Interruptible.** Quitting mid-flow resumes at the same step next launch. Every completed step
  is saved as it happens.

### The opening, screen by screen

**1. Hello.** The name, one sentence about what this is, one sentence about the deal ("it drafts,
you approve, everything stays in files you own"). A single button. This screen carries the visual
identity: the serif face (Fraunces), the warm palette, generous space. It should feel like the
cover of something, not a dialog.

**2. You.** Name and work email. The reason line: the memory needs to know which "you" appears in
meetings and which promises are yours. Feeds `identity.name` and the alias list in settings, the
same fields the Settings "You" section already edits.

**3. Your files.** Create a fresh workspace (we suggest a sensible default location and name) or
open an existing folder, Obsidian vaults included. The synced-folder check runs here: pointing at
iCloud or Dropbox gets one clear warning before proceeding (beta-launch ticket 14). This is the
one step that cannot be skipped.

**4. The key.** One field for the API key from the invite, with a "add it later" skip. On paste we
verify it with one cheap call so a typo fails here, not twenty minutes later inside a session.
BYOK per beta-launch ticket 3; we hand keys to beta users, so the copy says "paste the key from
your invite" rather than sending anyone to the Anthropic console.

**5. What leaves your machine.** The telemetry ask, in plain words, as a short literal list of the
events we send and a statement of what we never send (no titles, no paths, no note content, no
prompts). One switch, defaulted to on but genuinely a choice, and the same switch exists in
Settings afterwards. (Schema and transport are beta-launch ticket 5; this screen is just the
consent surface.)

**6. First light.** Three doors, one screen: **Load an example week** (a populated workspace,
dates slid to today, so every view has something in it), **Bring your own** (drop a transcript or
connect a calendar, straight into the real capture flow), or **Start empty**. Choosing the example
week is the suspense payoff: the vault loads, the notes index, and the app lands on a Home with a
real week on it. Choosing "bring your own" hands off to capture with the receipt strip doing its
job.

Then the shell appears, with the First steps card on Home.

### First steps

A card on Home, present until finished or dismissed. Six or so items, each a real action with
detection wired to the real event, each row a button that takes you to the right place:

| Step | What it teaches | Done when |
|---|---|---|
| Add your key | (only if skipped in the opening) | `hasAnthropicKey` flips true |
| Drop a meeting transcript | capture, arrival, the receipt | an arrival session completes on a transcript |
| Decide on a proposal | the approval loop, the Inbox | first accept or reject |
| Prep for a meeting | sessions working for you | a meeting-prep session completes |
| Ask your memory a question | chat over your own notes | a chat session with a user prompt completes |
| Tell it about your product | skills are files you edit | the about-us skill is edited (beta-launch ticket 29) |
| Connect your calendar | optional, marked as such | a Google account is connected |

Rules: checks are quiet, a completed row shows one line of what happened ("Read your transcript,
two proposals in the Inbox"). The card is dismissible as a whole at any time and never comes back.
When everything is done it retires itself after showing once in its finished state. If the user
loaded the example week, "drop a transcript" offers a sample file to drag, so the step is doable
without hunting for real material.

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

**Notes:**

---

## ONB-2. The opening frame

**Today:** nothing to build on beyond the `@pm/ui` Dialog pattern, which is wrong for this; the
opening is a takeover, not a dialog.

**Proposal:** one component owning the six screens: full-viewport layer inside the Shell root,
step transitions (slide or crossfade, fast, no bounce), Enter advances, Escape never exits (only
explicit skips do), progress shown as a quiet "2 of 6". Serif display type for screen titles, the
existing warm-clay palette, light and dark both. This is the ticket where the "top notch" bar
lives: it should be run through the Impeccable pass once functional. Build the frame with
placeholder screens first so ONB-3 through ONB-6 slot in independently.

**Decision:**

**Notes:**

---

## ONB-3. Screen: You

**Today:** `identity: { name, aliases }` already exists in settings with a working setter, and
Home's greeting plus people chips already resolve "You" from it.

**Proposal:** two fields, name and work email, writing to the existing identity setter (email goes
in as an alias; a later Google connect adds its own address alongside, same as today). Reason line
under the fields. Both optional to fill but the screen itself is not skippable, so an empty submit
is a deliberate "rather not say", not an accident.

**Decision:**

**Notes:**

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

**Notes:**

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

**Notes:**

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

**Notes:**

---

## ONB-7. Screen: First light, and the example week

**Today:** the demo machinery is dev-only: `scripts/refresh-demo.ts` copies `vault-dev/` to a
gitignored folder with dates slid to today. Nothing in the shipped app can produce a populated
workspace. (This was beta-launch ticket 17.)

**Proposal:** ship the example week as an app feature. Bundle the demo vault in resources, built
at package time through a strip list (drops `broken-demo` and anything else that only exercises a
code path) with the skill pack generated from `DEFAULT_SKILLS` rather than hand-copied; those two
prerequisites are beta-launch tickets 25 and 26 and stay there. On choosing the door, copy the
bundle into a real folder, slide dates relative to install day (port the shift logic from the
script into the main process), open it, and land on Home. The other two doors: "Bring your own"
opens the capture tray (or the calendar connect), "Start empty" just proceeds. Example-week
workspaces are marked in settings so we can offer "replace the example with a real workspace"
later without guessing.

**Decision:**

**Notes:**

---

## ONB-8. First steps

**Today:** nothing. The progressive-reveal system proves per-vault earned-state works, but it is
renderer-side; detection for these steps lives in the main process (sessions finishing, proposals
decided, settings changing).

**Proposal:** the card described above. Detection hooks in the main process where each event
already flows (session completion, proposal accept/reject, key set, identity edits, Google
connect), writing into the `onboarding.checklist` record from ONB-1; renderer subscribes through
the existing settings-changed push. Each row deep-links to the right surface using the existing
tab-opening actions. Includes the "sample transcript to drag" affordance when the example week is
loaded, sourced from the bundled `demo-samples`. Dismiss and retire rules as written above.

**Decision:**

**Notes:**

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

---

## ONB-10. The words

**Today:** first-run copy does not exist, and the product name is mid-rename (beta-launch
ticket 1; the rename must land first, the opening says the name more than any other surface).

**Proposal:** one pass over every string in the opening and First steps, written and reviewed as a
set so the voice is consistent: plain, short, no jargon, no exclamation marks, reasons next to
asks. Do this last, against the working flow, because copy written before the screens exist always
reads wrong inside them.

**Decision:**

**Notes:**

---

# Order

ONB-1 and ONB-2 first (state, then frame), then ONB-3 through ONB-6 in any order since they slot
into the frame independently. ONB-7 needs beta-launch tickets 25 and 26 first. ONB-9 is small and
independent, worth doing immediately. ONB-8 after the steps it points at exist. ONB-10 last.

Open dependencies from beta-launch: the rename (ticket 1) before any copy is final, the telemetry
platform (ticket 5) before ONB-6's switch sends anything, and the invite-code question (ticket 4):
if invite codes happen, the code field joins the opening as part of screen 4 and the key screen
may disappear entirely for gateway users.
