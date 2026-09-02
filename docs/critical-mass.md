# Critical mass

How the workspace gets enough sources in the first hour that the agents have something to work
with. Written 2026-08-31 against the code as it stands.

**The problem.** The opening, First steps, the follow picker and the first-look debrief are all
built, and together they produce a workspace that fills at the speed of the user's calendar: one
meeting at a time. Everything the product promises rests on accumulated memory, and week one is
the week that decides whether there is a week six. After a complete onboarding with every
connection made, the workspace holds tracked tickets, a few themes, empty meeting shells, and the
understanding notes if they did the interview. Zero transcripts. Zero notes. The first "ask your
memory" question hits a memory that knows ticket names and meeting titles and nothing else. The
product reads as "please paste a transcript", which is exactly what it must not be.

**The observation.** The sources for critical mass already exist on day one. They are just not in
the app:

- Last month's transcripts sit in a folder, in Zoom, in Granola, or in Google Drive as Meet
  auto-transcripts.
- The calendar's past 30 days already sync in as meeting notes (`HORIZON_BACK_DAYS = 30`), so the
  shells those transcripts belong to are already on the shelf.
- Arrival already matches a transcript to its meeting by content, and already spawns one skim per
  piece, so a pile is not a new problem.
- Jira and Confluence are already read and debriefed (docs/first-look-debrief.md).
- Their own notes sit in an Obsidian vault, a Notion export, or a NOTES.md.

So the move is one sentence: **onboarding should ask for the backlog, not for the next meeting.**
Today every surface asks in the singular ("drop a meeting transcript") and the plural is where
the value is. A single transcript proves the loop works. Thirty days of transcripts makes the
memory worth asking.

**The fun part.** The payoff moment this doc is built around: the calendar puts a month of empty
meetings on the shelf, the user drops one folder, and the shells fill in front of them. That is
the product demonstrating its whole point (the memory accreting) in the first ten minutes, with
their own sources, and nothing fake anywhere. Respect over confetti still binds: the reward is
watching real work happen, not an animation about it.

**How to use this doc.** Same convention as onboarding and first-look-debrief: one ticket per
thing, your call under **Decision**, what landed under **Notes**.

---

## The arc

First steps today is a flat checklist. This doc reorders it into an arc, where each step makes
the next one better and the last one is the payoff:

1. **Connect the calendar.** The skeleton appears: 30 days back, 60 forward. Cheapest connection,
   lowest stakes, biggest instant change to an empty Home.
2. **Drop the backlog.** One folder of last month's transcripts and notes. Arrival files
   everything and matches transcripts to the shells the calendar just created.
3. **Connect Jira and Confluence.** The first look reads the projects (built).
4. **The debrief.** Now it can speak across sources: what the meetings say, what the tickets say,
   and where they agree. The interview starts from a real picture instead of a blank page.
5. **Prep the next meeting.** The payoff row. With a month of sources behind it, the prep is
   good, and "week one" already looks like week six was promised to look.

Nothing here adds a gate or a wizard. The opening stays six screens. The arc lives in First
steps order, in copy, and in what happens after a connect.

---

## CM-1. Ask for the backlog, in the plural

**Today:** every capture ask is singular. The First steps row says "Drop a meeting transcript"
and its hint explains what counts as one. The post-onboarding door says "Add something now". The
capture tray takes any number of files, and a dropped folder already works (App.tsx `onDrop`,
AR-14), but nothing ever tells the user that.

**Proposal:** rewrite the asks to invite the pile, and say the folder trick out loud, because
nobody tries dropping a folder unless told they can:

- The First steps row becomes "Add last month's meetings". Hint: "Transcripts, notes, exports.
  Drop the whole folder in one go, it sorts them out." Detection unchanged (an arrival session
  completing still ticks it).
- The row also says where to look, because "I don't have transcripts" is usually "I don't know
  where they are": one folded line naming the usual places (Zoom saves recordings to
  `~/Documents/Zoom`, Granola and Otter export from their history, Meet transcripts land in
  Drive).
- The empty-meeting capture block on a past meeting page keeps its singular copy. That surface
  is about one meeting and the plural would be wrong there.

No sample data, same as ONB-7 decided: the first thing in the workspace stays the user's own.

**Decision:**
Yea sure, im just not very sure that people have folders of transcripts ready to go. We should be able to guide them through it more, like specific guides for granola or whatever. We can also perhaps use this to capture what they are using for tools (data analytics in posthog)

**Notes:** Built 2026-08-31, in `renderer/src/onboarding/FirstSteps.tsx` and
`renderer/src/lib/first-steps.ts`.

- **The ask.** The row is "Add last month's meetings", and its hint is "Transcripts, notes,
  exports. Drop the whole folder in one go." Notes are named on purpose, which is CM-4's other
  half. Detection did not move: an arrival session completing still stamps the row.
- **Where they live.** Under the row, folded, sits "Where do your meetings live?". It opens into
  six chips (Granola, Zoom, Google Meet, Otter, Microsoft Teams, and "Somewhere else, or
  nowhere"), and picking one shows two or three sentences on getting the transcripts out as
  files. The guides name the place, never the button: an export menu is renamed every other
  release and a wrong instruction is worse than a general one. The last chip is the answer for
  someone who records nothing, and it says their own notes count.
- **Which tool.** Picking a chip sends `source.tool` with the tool id and nothing else. It is
  on the allowlist in `@qale/ipc`, so both consent surfaces list it without an edit, and the
  word filter drops anything that is not one of the six. The renderer reaches main through one
  new channel, `telemetry:meetingTool`, built exactly like `telemetry:view`: one word, folded
  away main-side if it is not ours. Consent is the sender's call, as before, so a switch that is
  off sends nothing. One event per tool per sitting, because opening the same guide twice is the
  same fact.
- The empty-meeting block on a meeting page was not touched.

Tested: `apps/desktop/test/first-steps.test.ts` covers the guides, the tool ids matching the
allowlist words, and the filter dropping a tool nobody wrote down. Not verified: the app was
never launched, so the fold, the chips and the guide text are unseen, and no test drives the
main-side handler.

---

## CM-2. The backfill receipt

**Today:** a drop raises the capture handoff line ("Reading your meeting. Watch it here"), then
the receipt speaks when arrival finishes. Both were written for one file. Arrival spawns one skim
per piece, so twenty files work, but the user watches a single line for several minutes and the
receipt at the end is the only accounting. Nothing warns them that twenty files is a real model
spend either.

**Proposal:** make the pile legible at both ends.

- **Before:** when the tray holds more than a handful of files, the submit button says the
  number: "Read 24 files". One line under it says this takes a few minutes and runs in the
  background. No confirmation dialog beyond that, the button itself is the confirmation.
- **During:** the handoff line counts: "Reading 24 files. 9 filed, 3 matched to meetings." The
  numbers already exist as spawn results; this is plumbing them to the one line the user is
  watching. This is the "shells filling up" moment, so it should not be silent.
- **After:** the receipt sums the batch: "24 files read. 14 matched to meetings on your calendar,
  6 filed as notes, 4 already there." Duplicates counted plainly, not hidden, because a backlog
  drop will contain duplicates and "already there" is the honest word.

**Decision:**
Yes, would also like to add a model selector in the add source screen, defaulting to sonnet 5.0

**Notes:** Built 2026-08-31. Four files or more is a pile, and the wording for all three moments
lives in one file, `renderer/src/lib/source-batch.ts`.

- **Before.** The tray's button says "Read 24 files" once the drop is a pile, and one line under
  it says it takes a few minutes and runs in the background. Three files or fewer read as before.
  No dialog was added: the button is the confirmation.
- **During.** The session's background banner counts instead of saying it is busy: "Reading 24
  files. 9 filed, 3 matched to meetings." A count only appears once something has been filed, so
  the first minute reads as "Reading 24 files." rather than as a row of zeros.
- **After.** The banner's line is replaced under the transcript by one sentence: "20 files read.
  14 matched to meetings on your calendar, 6 filed as notes."
- **Where the numbers come from.** `file_source` now tells its caller what it filed
  (`SourceFiled` in `packages/agent/src/filing.ts`), the runtime passes that on as
  `onSourceFiled`, and main counts each drop down in `arrivalBatches` and pushes the row as
  `arrival:progress`. Nothing is counted until the write has happened, so a refused filing never
  moves the line, and a spawned child cannot file at all, so the parent's calls are the whole
  count. `matched` is a filing that named `attach_to`, which is exactly "this joined a meeting the
  calendar already held".
- **Model selector.** The tray borrows the composer's `ModelPicker` (three new optional props for
  the wording; the session's own strings are unchanged) and opens on `sourceModelId(provider)`:
  Sonnet 5 on Anthropic, Gemini 3.6 Flash on Google, so a Gemini-only workspace never gets a dead
  Claude id. The pick rides on `arrival:ingest` and pins the arrival session. Main resolves the
  same default when no model is sent, so both ends agree.

Two deviations from the ticket. **"Already there" is not shipped.** Nothing detects a duplicate,
so a piece the run read and chose not to file is counted as "4 not filed" and no more; why it was
skipped is the session's own reply to make. Inventing "already there" renderer-side is the one
thing the counts may not do. **The counts are in memory in main.** A batch does not survive a
quit, so a session reopened tomorrow shows the reply and no summary line.

Tested: `apps/desktop/test/source-batch.test.ts` (9 tests, the three lines and the per-provider
default) and `packages/agent/test/filing-count.test.ts` (3 tests, including a refused write and a
session that may not file). Whole suites green: 246 desktop, 254 agent, 193 domain, 162
application, 47 sessions, 58 connectors, 6 markdown, 38 vault with 10 skipped (better-sqlite3 ABI
on this machine). `pnpm check-types` and `pnpm lint` pass.

Not verified: the app was never launched, so the picker inside the tray dialog, the counting
banner and the closing sentence are unseen. Nothing tests the main-side counter or the push
either; the tested half is the wording and the hook that feeds it.

---

## CM-3. Meet transcripts through the Google connection

**Today:** the calendar connector reads events only. For a Meet-based company, Google already
holds the exact thing we ask the user to go find: auto-transcripts in Drive, linked from the
calendar event. We sync the event, ignore the link, then ask the user to locate the same
transcript by hand.

**Proposal:** the zero-effort version of CM-1, behind one explicit consent.

- An optional Drive read scope on the Google connection. Never requested silently: the connect
  flow asks for calendar only, and the transcript offer is a separate "allow" moment that states
  what it reads (files linked from your meetings, nothing else).
- After the calendar's first sync, if events in the window carry transcript attachments, one
  card: "14 of your past meetings have transcripts in Google Meet. Read them?" One confirm.
  Accepted, the files arrive through arrival as received sources, matched to their meetings by
  the event that linked them, so the matching is exact rather than inferred.
- From then on it is standing behavior for followed calendars: a new meeting's transcript arrives
  on the next sync, no drop needed. That closes the capture loop permanently, not just for the
  backlog, and it is the difference between an app you feed and an app that is simply up to date.

This is the biggest ticket in the doc and the only one with real new machinery (a scope, a Drive
client, an attachment reader). It is also the single strongest critical-mass move we can make:
connect one account, approve one card, and a month of meetings arrives with their transcripts.
Zoom and Teams companies get CM-1 instead; their exports are files on disk, which the folder drop
already handles.

**Decision:**
No, lets skip this until we can confirm users have this setup.
**Notes:** Not built, per the decision. CM-1's `source.tool` telemetry event is how we learn
whether users are on Meet at all; revisit when it says so.

---

## CM-4. Bring your old notes

**Today:** the Files screen tells Obsidian users to put the workspace inside their vault, which
protects their notes but also walls them off: nothing ever reads them. The interview asks the
user to say everything out loud while their own written record sits one folder up.

**Proposal:** an invitation, not an importer. The backlog ask (CM-1) already accepts notes; this
ticket is about saying so and about provenance.

- The CM-1 row's hint names notes explicitly, and the interview gains one fork: "Do you keep
  notes from before? Drop the folder and I will read them." Dropped notes go through arrival,
  land under sources, and get cited by the understanding drafts like anything else.
- Provenance needs one care: these are notes the user wrote, arriving through the received-
  source door. Arrival should record them as the user's own writing that arrived as a source,
  so a citation reads "your note from March" rather than implying a third-party source. If the
  frontmatter cannot carry that today, this ticket is where it learns to.
- No conversion, no migration, no folder mirroring. The notes stay where they live; the workspace
  keeps a read copy under sources. Anything smarter (watching the vault, syncing edits) is out.

**Decision:**
yes

**Notes:** The skill half is built 2026-08-31. The First steps hint is somebody else's half of
this ticket and is not covered here. That half landed with CM-1 the same day: the row's hint
reads "Transcripts, notes, exports. Drop the whole folder in one go.", and the guide for people
who record nothing says their own notes count.

- **The fork.** `TELL_QALE_SKILL` ("Options at every fork") gains one `ask_user` call, once per
  session: "Do you keep notes from before? Drop the folder in and I will read them", with three
  options (drop a folder in / nothing worth reading / skip for now). It says the word folder on
  purpose, the same reason CM-1 does: nobody tries dropping one unless told they can. No new
  tool and no new machinery; it is the fork pattern the skill already uses everywhere else.
- **Provenance rides on `origin`.** The field exists, it is free text, it is written straight to
  frontmatter and nothing branches on it, so it can carry "this is theirs" without a new key.
  `ARRIVAL_SKILL` gains one paragraph under "File": their own writing still lands under
  `sources/` and never in `notes/`, `origin` is set to their own name, and a citation then reads
  "your note from March". The `file_source` description in `packages/agent/src/filing.ts` and
  the `origin` doc comment in `packages/application/src/use-cases/arrival.ts` were widened to
  match, or the tool schema would have kept telling the model the field is only for somebody
  else's meeting. Copy the model reads, not a gate.

No frontmatter machinery and no validation was added, as the ticket asked. Both skill bodies are
mirrored into `vault-dev/`, which `packages/sessions/test/defaults-sync.test.ts` enforces.

Tested: `packages/sessions/test/sessions.test.ts` asserts the fork wording and the own-writing
paragraph. 47 sessions tests and 251 agent tests pass. Not verified: nothing runs the skill, so
whether the model actually sets `origin` on a dropped note is unproven.

---

## CM-5. One debrief, speaking across sources

**Today:** the first-look knock is armed per connection with no provider filter
(`firstLookReads`), so a calendar connect gets a debrief whose skill copy is written for epics
and tickets. Two connections made in the same onboarding can owe two separate knocks. And the
debrief reads only the sync index: a backlog of transcripts dropped ten minutes earlier is
invisible to it.

**Proposal:** one first look over everything that arrived in the first hour.

- **One knock.** When more than one connection is armed, the debrief session gets both reads in
  one kickoff and the question names the whole haul: "I read Nordkap's Jira and your calendar."
  The arming machinery already stamps per connection; this is batching at the point where
  `runFirstLookDebriefs` fires, not new state.
- **Meetings are a source.** The skill's First look section learns to speak about the calendar
  and the filed transcripts: who the user actually meets, which topics recur, what the meetings
  and the tickets agree on. "Checkout Rewrite is in 9 tickets and came up in 4 of your meetings
  this month" is a hypothesis no single source can produce, and it is the sentence that makes
  the interview feel like talking to something that did its homework.
- **The debrief waits for the backlog.** If an arrival batch is running when the knock would
  fire, hold the knock until it settles. A debrief that reads the index five minutes before the
  transcripts land wastes its one opening.
- The seed card stays tickets and themes. Meetings and people already have their own doors
  (calendar sync, people chips) and do not need seeding.

**Decision:**
yes

**Notes:** Built 2026-08-31.

- **One knock.** `runFirstLookDebriefs` (`apps/desktop/src/main/handlers.ts`) drains every ready
  read, stamps them all done, and fires ONE `tell-qale` session.
  `firstLookInstruction` (`apps/desktop/src/main/services/sync-service.ts`) takes the list now:
  one opening line that counts the connections, one block per connection naming the site and its
  containers, one closing line pointing at the skill's section. Stamp-before-fire is unchanged,
  and so are the guards for no key and for a workspace that has already told it.
- **Meetings are a source.** The `## First look` section of `TELL_QALE_SKILL` reads the calendar
  and the filed transcripts beside the tickets and pages, and beat two says where two sources
  agree ("Checkout Rewrite is in 9 tickets and came up in 4 of your meetings this month"). Every
  rule the section already carried is still in it: one parked question, write nothing and propose
  nothing in beat one, hypothesis first, every claim cites its source, never read the debrief
  back into a note. The heading is untouched, because the kickoff points at it by name.
- **The debrief waits for the backlog.** `sessionTrigger` became `sessionRuns` and carries the
  skill beside the trigger. That map already lives from the moment a run is fired until it
  settles, so it answers "is an arrival running" with no new state. While one runs, nothing is
  stamped and nothing fires, and the next maintenance tick tries again.

The seed card is untouched (FD-4 stands). No fingerprint was appended for the changed skill body:
the shipped-versions ledger went with SK-1, so a workspace that already holds a skill keeps its
own copy and there is no upgrade path left to feed.

Tested: `apps/desktop/test/first-look.test.ts` gains a two-connection case (both sites named,
calendar events counted, one closing line), and the single-read case moved to the array
signature. `packages/sessions/test/sessions.test.ts` asserts the calendar bullet and the
agreement line. 237 desktop tests and 47 sessions tests pass.

Not verified: the hold itself. `runFirstLookDebriefs` is a closure inside `registerHandlers` with
no seam, so the in-flight guard is typechecked and read, never run. The conversation still needs
a live site, a key and a person, the same as FD-3.

---

## CM-6. First steps becomes the arc

**Today:** First steps is ordered with the transcript drop first and the connections last (they
are "only if skipped" rows). Each row teaches one feature; no row says what it unlocks for the
next.

**Proposal:** reorder to the arc and make each hint name its payoff.

1. Connect your calendar. "Your meetings appear, a month back and two ahead."
2. Add last month's meetings (CM-1). "The more it has read, the better every answer gets."
3. Connect Jira or Confluence. "It reads your projects, then comes back and tells you what it
   found."
4. Tell it about your product. Opens the waiting debrief when there is one (FD-5, built).
5. Decide on a proposal. Usually ticks itself during 2 to 4.
6. Prep for a meeting. "This is what all of it was for." The row points at the next real meeting
   on the calendar once one exists.

The key row and the telemetry row keep their current only-if-skipped behavior. Detection does not
change for any row; this is order and copy. One rule worth keeping from today: rows never
block each other. The arc is a suggestion of order, not a sequence lock, and someone who starts
at step 3 loses nothing.

**Decision:**
ye but i dont like the phrasing "This is what all of it was for." - sounds like we only do meeting prep

**Notes:** Built 2026-08-31 in `FirstSteps.tsx`, with the order itself in
`renderer/src/lib/first-steps.ts` so it can be read and tested without a window.

- **The order.** `FIRST_STEP_ORDER` is the arc: key, calendar, last month's meetings, Jira and
  Confluence, tell it about your product, decide on a proposal, ask your memory, prep for a
  meeting. Ticked rows still sink. A row nobody named, which is any connector we have not met,
  sorts to the end rather than to the front.
- **The two rows the ticket did not name.** The key stays first, because nothing runs without
  it, and it is only ever visible to somebody who skipped it in the opening. "Ask your memory
  something" is still a row and is not in the ticket's list, so it sits between the proposal and
  the prep: every named row keeps its named neighbour, and the payoff row stays last.
- **The hints.** Calendar: "Your meetings appear, a month back and two ahead" (30 back, 60
  forward, which is what the connector reads). Jira and Confluence: "It reads your projects,
  then tells you what it found." Proposal, renamed to "Decide on a proposal": "Nothing is
  written to your workspace until you say yes."
- **The prep row.** "Prep for a meeting", hint "It briefs you from everything it has read so
  far". That names the payoff of the whole arc without claiming the product is a prep tool. The
  no-meetings branch is unchanged in spirit: connect a calendar or add a meeting.
- The rows still block nothing, and no detection moved.

Deviation: the row does not name the next real meeting. The tree carries the dates, so it is
cheap, but the hint is a single truncating line and a meeting title in it would be cut off more
often than not. Left generic, as the ticket allowed.

Tested: `apps/desktop/test/first-steps.test.ts` asserts the arc order, the key first, the prep
last, and an unknown row sorting to the end. Not verified: the card was never seen on screen.

---

## CM-7. The tally when First steps retires

**Today:** when everything is done, the card shows once in its finished state and retires. The
finished state says the steps are done, not what the user now has.

**Proposal:** the finished card is one sentence of inventory instead of a checklist of ticks:
"A month of memory: 31 meetings, 14 with transcripts, 12 people, 4 themes, 2 decisions." Counts
come from the index, so the sentence is true at the moment it renders. Then the card retires as
today. This is the "show the memory growing" design principle applied to the one moment where
the growth just happened. No streaks, no badges, and the sentence never appears again.

**Decision:**
yes

**Notes:** Built 2026-08-31. `firstStepsTally` in `renderer/src/lib/first-steps.ts` writes the
sentence; `FirstSteps.tsx` draws it in place of the rows on the card's last showing.

- **The sentence.** "Your memory now holds 31 meetings, 14 with notes, 2 people, 4 themes and 2
  decisions." The lead-in is not "A month of memory", because a workspace two days old would
  make that a lie; what it holds is true whenever it renders.
- **The counts are read, never stored.** They come off the vault tree the renderer already
  holds, so no IPC was added. "With notes" is a meeting the workspace can read something from: a
  transcript arrived, or somebody wrote in it. That is the `captured` flag the meeting lists
  already use, and it is why the segment says "with notes" rather than "with transcripts", which
  would count typed notes as transcripts.
- A count of zero loses its segment. One of a thing reads as one of a thing. If every count is
  zero the sentence is dropped and the ticks stand, so the card can never say nothing at all.
- The retire behaviour is untouched: shown once, gone when the page is left, and the sentence
  never returns.

Tested: `apps/desktop/test/first-steps.test.ts` (the full sentence, the dropped zero, the
singulars, and an empty workspace). Not verified: the card was never seen on screen, so the
finished state's spacing is unchecked.

---

## CM-8. The watched folder

**Today:** capture is a deliberate act, every time. For a Zoom or Granola user, transcripts keep
landing in the same folder forever, and the product's memory depends on the user remembering to
ferry each one over. The capture nudge exists because they forget.

**Proposal:** a standing drop. In Settings (and offered once, after the first backlog drop
succeeds, as a quiet row): "Transcripts keep landing in a folder? Point me at it." New files in a
watched folder arrive through the ordinary arrival path, exactly as if dropped, with the same
receipts. Filing is the one thing the agent already does without asking, because putting handed-
over a source on the right shelf is carrying out an instruction; a folder the user pointed at is
the same instruction given once. Watch only the top level, ignore files that predate the
watch (the backlog was CM-1's job), and one Settings row shows what is watched with an off
switch.

This overlaps CM-3: a Meet company gets continuous capture from the connection, a Zoom company
gets it from the folder. Both exist because neither covers the other.

**Decision:**
not right now, unless users have this setup. 
**Notes:** Not built, per the decision. Same signal as CM-3: the `source.tool` event will say
which tools are real before this is worth building.

---

## Not doing

- **No sample or demo data in the product.** ONB-7 settled it and every ticket here respects it:
  critical mass comes from the user's real backlog, not from a fake week.
- **No new opening screens.** The opening stays six screens. Everything here lives in First
  steps, the tray, the connections, and the debrief.
- **No auto-follow and no silent scopes.** CM-3's Drive read is a separate, explicit allow.
  Nothing is read that was not named.
- **No wiki-page mirroring and no seed expansion.** The seed card stays tickets and themes
  (first-look-debrief "Not doing" stands).
- **No progress theater.** Counts and receipts, in plain sentences, only while true. No meters,
  no streaks, no celebration screen.

---

## Order

CM-1 first: it is copy, it is cheap, and every other ticket lands better once the asks are
plural. CM-2 with it, since a backlog ask without a backlog receipt is a silent five minutes.
CM-6 and CM-7 next, both small, both renderer-side. CM-5 after those, so the debrief the arc
points at is the cross-source one. CM-3 and CM-8 are the two real features; CM-3 is the bigger
win and the bigger build, and it should be scoped against a real Google account before the
Decision is made. CM-4 rides inside CM-1 and the interview and can land whenever.
