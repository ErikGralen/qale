# Easier Qale: tickets

Split out of the 2026-09-02 direction note, "Making Qale easier". The one sentence behind all of
it: Qale asks the user to run a library in exchange for a memory, and the user wanted an AI with
better context.

The facts quoted here come from that note's three code passes over commit `4f12a71`. Nothing in
this file was re-verified against the code today.

Write your call under **Decision** ("build", "skip", "discuss…"). **Notes** is for anything the
build needs to know. Nothing gets built until its Decision field is filled in.

Order: section A is a prerequisite for section B. C, D and E are independent of each other.

---

## A. Before anything can be silent

### E-1. Git starts with the workspace

**What:** Git is opt-in today. One button inside a note's History panel turns it on, and nothing
calls it when a workspace is created. So a normal workspace has no history at all.

**Change:** Init the repo at workspace creation and commit on every write. Every "we can apply
this silently, it is reversible" argument in section B is false until this lands.

**Decision:**
Yes, and also prompt the user to install git if it isnt. or is there a way to package git in the install? 
**Notes:**
Built. `vault:create` makes the repo and the baseline commit before the PM sees the workspace, so
onboarding and the Settings form are both covered. Opening an existing folder still does not
auto-init, and `vault:initGit` stays for workspaces made before this. `gitInstallHint()` in
`packages/vault/src/git.ts` gives one install command per platform, shown in the new-workspace form
and in the History dialog; a machine with no git opens the workspace anyway. New `git:status`
channel. Fixed a bug in `commitPaths`: a rename committed the add and left the delete staged, so a
renamed note stayed in HEAD under both names. Git is NOT packaged with the installer. MinGit on
Windows was costed but not built, see "Left open by the build".

---

### E-2. Undo for an applied write

**What:** There is no undo for an applied proposal and no undelete in the app.

**Change:** One revert path, reachable from Activity (E-9), that puts a note back the way it was.
Needs E-1.

**Decision:**
yes
**Notes:**
Built. `revertNoteChange` in `packages/application/src/use-cases/restore.ts` and
`GitAdapter.pathsChangedWith` put the whole file back, frontmatter and all, written forward as a new
version. Covers edit, delete, create and rename. It throws when the hash belongs to another note, so
a wrong hash can never overwrite anything. Two doors: `history:revert` (path + hash) and
`activity:revert(id)`, which the Activity row uses so the renderer never handles a commit hash.
`GitPort.pathsChangedWith` is optional so test fakes still compile. No revert has ever run in the
app; the tests use real git repos in temp folders.

---

## B. Fewer judgements

### E-3. A write policy, not a switch on kind

**What:** There is no policy layer. Accepting a proposal is a flat switch on kind, called only
from a human click. A proposal already carries the kind, the proposing skill, the target path,
the note type, and whether the user asked for it or the agent inferred it. The rules below are
expressible without changing the data.

**Change:** One place that grades a write by the damage it can do and returns silent, grouped, or
always-ask.

| Situation | What happens |
|---|---|
| The user asked for it in chat | Applied, no card |
| Material arrived: a new note, or an append | Applied, no card |
| Material arrived: a patch over existing text, or a decision | One grouped card per intent |
| A todo is created, or its status changes | Always asks |
| Anything outbound: Jira, Confluence, a calendar invite | Always asks, one card per send |
| A delete | Always asks |
| The user stated a standing rule | Remembered, no card, shown in Activity |

Todos always ask because a promise is the user's word. Outbound and delete always ask because the
code has no compensating action for either.

**Decision:**
yes, 
**Notes:**
Built. `packages/domain/src/proposals/policy.ts` holds `writePolicy(facts) -> silent | grouped | ask`
plus the reason string a person can read. Every `propose_*` tool now goes through `fileProposal()` in
`packages/application/src/use-cases/proposals.ts`, which files the row, applies the silent ones and
writes the Activity row. The table is coded as ordered rules: outbound, delete, todo, rule file,
asked, `notes/`, new note or append, then patch or decision. Two departures from the table above. A
rule file only lands silently when the PM asked for it, so a rule the agent inferred still asks
(E-25 needs that). And an unasked write into `notes/` asks, because that folder is the PM's own
Documents (rule 6). Outbound keeps its own path through `mkCard`, which can only ever rule `ask`.

---

### E-4. Apply what the user asked for

**What:** A proposal already records that the PM asked for it. It still draws a card.

**Change:** Asked-for writes apply on the spot. The card was asking the user to confirm their own
instruction.

**Decision:**
yes, and also add a receipt in the chat like "created x" or "update y"
**Notes:**
Built. An asked-for write applies on the spot through the policy's `asked` rule. The receipt is the
first line of the tool result, `Applied: Created X`, composed by `appliedReceipt()` in
`packages/domain/src/proposals/activity.ts`. `SessionView.tsx` reads it back with
`readAppliedReceipt()` and prints one quiet line per applied write under the collapsed activity row,
so it shows without expanding anything. `SHARED_PREAMBLE` in `packages/agent/src/prompts.ts` no
longer tells the model that everything goes to a queue. The line has never been seen on screen.

---

### E-5. Apply arriving material

**What:** One transcript produces roughly 5 to 12 cards. Appends already re-place against the note
as it reads now and refuse duplicates, so the risky part is already handled.

**Change:** A new note and an append both apply silently. Activity carries the receipt.

**Decision:**
yes
**Notes:**
Built, in the same policy. A new note and an append-only update both return `silent`, so they apply
with no card and Activity carries the receipt. One limit to know: an unasked new note aimed at
`notes/` asks instead, because Documents is the PM's folder. Appends already re-place against the
note as it currently reads and refuse duplicates, and that code was not touched. Nothing was watched
arriving live, so nobody has seen what one transcript now costs in cards.

---

### E-6. One card per intent

**What:** Patches over existing text and decisions still need a human. Today they arrive as one
card each.

**Change:** Group them by what the user would say out loud. "Move ten tickets to Done, as agreed in
Tuesday's standup" is one row with ten lines under it, not ten cards. Expandable to handle items
one by one, or approve all.

The card also stops asking about filing. Type, tags, sources and path are stripped from the preview
today and cannot be edited there anyway, and the code already decides all four. Keeping the user
responsible for a schema they cannot see is where "I don't want to be responsible for
documentation" comes from.

**Decision:**
yes
**Notes:**
Built. `packages/domain/src/proposals/intent.ts` keys a group on the kind, the shape of the change
and the source it came from. Not the session: the Inbox already sections by session, so grouping
runs inside a section. The sentence is composed, never authored ("Set status to done on 2 tickets,
from Standup"). `components/inbox/IntentRow.tsx` draws it with the first three names, Approve all N,
Discard all, and a chevron that opens each member as its own row. The ruling is re-derived from the
card, never stored, so it cannot drift. Filing left the card: `FILING_KEYS` (type, tags, sources,
path, slug) is filtered out of the diff and the "Files as" chip is deleted. The Inbox cursor stops
on a group and never descends into it; members are reached with the mouse or Tab.

---

### E-7. Outbound: one card per send, full text, never batched

**What:** Nothing the agent sends to Jira, Confluence or a calendar can be taken back.

**Change:** Every send is its own card with the full text shown. E-6's grouping never applies here.

**Decision:**
Yes lets keep it like this, but in the future we might want to be able to group some stuff ehre as wel.. 
**Notes:**
No code changed. The path was checked instead: outbound cards are made by `mkCard`, one card per
draft call and one send per accept, and `writePolicy` can only return `ask` for `kind: 'outbound'`.
E-6's grouping only ever joins a card whose ruling is `grouped`, so a send cannot be batched by
accident and needed no second rule. The full text was already on the card. Grouping sends later is
not built and nothing in the code prepares for it.

---

### E-8. Standing rules land silently

**What:** A standing rule appends a bullet to the owning skill or to `_your-rules`.

**Change:** Remember it without a card. The Activity row is the only trace.

This is the cheapest thing in the list to get wrong and the hardest to notice later. See the open
question at the end.

**Decision:**
yes, but perhaps add some indication in the chat, like a simple "Added to rules" that isn't very visually loud
**Notes:**
Built. A stated rule appends its bullet and applies with no card. The chat shows the quiet line:
`Applied: Added to rules "…"`, from `appliedReceipt('remembered', …)`, printed by `SessionView.tsx`
in the same small type as the other receipts. One departure: the silence is gated on `asked`. A rule
file the agent wrote for itself asks, which is what lets E-25's conventions write-up reach a card.
Activity keeps the row either way, and it is revertible. Not seen on screen.

---

### E-9. Activity, the receipt

**What:** Nothing today shows what the agent did on its own, because until section B it never did
anything on its own.

**Change:** A list of what the agent did without asking. First person, past tense, every row
revertible. Not a place the user goes often, and not hidden either. It is the proof that the
silence was earned.

**Decision:**
yes, but stuff should be visible in the chat too (it already is i believe)
**Notes:**
Built. `app/ActivityView.tsx` lists what the agent did on its own, grouped by day, newest first. Each
row is the agent's own sentence, then the time, the page, the session, and the policy's reason on
hover. "Put it back" appears on hover or focus; a reverted row goes struck through and says "Put
back". Rows are stored by `packages/vault/src/activity-store.ts`, read over `activity:list`, and
reverted over `activity:revert(id)`, which runs E-2's code. The door is the last row on the rail,
called "Activity": below the scroll on a rule of its own, so no pin list can push it out of sight,
plus a ⌘K action and `QALE_OPEN=__activity`. It was a child row under Sessions until 2026-09-03,
where it read as a session; the page, the tab and ⌘K all say "Activity" now. No
`activity:changed` event: a silent write is a file change, so `vault:changed` already fires at that
moment. The chat side is E-4's receipt line, not a second surface here.

---

### E-10. Cap what can reach the queue

**What:** Nothing caps how many cards a session may emit. The librarian tops the queue back up to
8 pending cards every 30 minutes while the app is open, and meeting-prep adds one per synced
meeting. An ordinary week is an estimated 30 to 70 cards.

**Change:** A cap per session and a stop on the librarian top-up. Sections B and C should cut the
count on their own, so this is the backstop that keeps it cut.

**Decision:**
No, this would mean something might be missed or skipped that shuoldn't be. I think with our changes there shuoldnt be so many approvals. 
**Notes:**
NOT built, by your decision. No cap per session was added and the librarian's top-up is untouched:
`services/scheduler-service.ts` still tops the queue back to 8 pending cards every 30 minutes. The
write policy is what is expected to cut the count on its own, and nobody has counted a real week
yet. If the queue still floods after one, this is the ticket to reopen.

---

## C. Three surfaces

Everything the user sees belongs to one of three places: Calendar and Todos, Documents, and
Context. Calendar and Todos sit as siblings of the memory, not inside it.

The line that matters is not the note type. It is whether a human will ever open the thing twice.
Everything in the "never twice" set can be written for the agent and kept out of sight.

### E-11. Sidebar around the three surfaces

**What:** Roughly 35 to 40 distinct nouns reach the user: 12 tab kinds, 14 note types, 5 lifecycle
vocabularies, 5 proposal kinds, plus skills, agents and sessions as three similar-looking things.

**Change:** Redesign the sidebar around the three surfaces. This ticket is the shape; E-12 to E-18
are the contents.

**Decision:**
yea it should be similar to today. Home, Inbox, Calendar Todos, Sessions, then Documents(or Notes), then Context. Context is least important. please really think about this. 
**Notes:**
Built in your order: Home, Inbox, Calendar, Todos, Sessions, Documents, Memory. `RAIL_ORDER` in
`lib/nav.ts` is the order, and one `PlaceRow` component draws all seven. The first four are fixed;
the last three scroll, because Sessions and Memory carry live rows. The "New session" row is gone
and is now a `+` on the Sessions row (⌘↵); Documents has a `+` for a new note (⌘N); Memory keeps its
`+` menu, minus `note`. `CORE_RAIL`, the permanent meetings and notes sections, is deleted, so a
type only gets a pin section once it holds a pin. The pin model itself was not touched. 6 tests in
`apps/desktop/test/rail-order.test.ts`. The layout has never been seen on screen.

---

### E-12. Calendar gets its own screen

**What:** What is coming and what happened. Markdown underneath, but it should not feel like a
folder of notes.

**Change:** A shaped calendar screen, sibling to the memory.

**Decision:**
Yes, we already have something to work from, but the way we display the individual meeting should be improved
**Notes:**
Built. `app/CalendarView.tsx` is the screen: a week grid by default, a plain list one click away
("Coming up" / "Happened"), a drop target aimed at meetings, and the docked Ask composer. The
individual meeting is the real work: `components/MeetingDetail.tsx` reads standing, When, Who was
there, Recording, then Decided / Promised / Learned / Also linked off the note's own backlinks, then
the notes, then the verbs (Get the brief, Go through this meeting, Add transcript, Open the file).
The file is always one button away. Derivations live in `lib/meeting-read.ts` and read
`lib/note-status`, the same rules the week grid uses, so the two cannot disagree. Home's "N meetings
still to review" door now opens the Calendar. 14 tests in `test/calendar.test.ts`. Sync,
meeting-prep and the capture nudge were not touched. The panel has never been seen.

---

### E-13. Todos gets its own screen

**What:** What you owe and what you are waiting on. Same argument as E-12.

**Change:** A shaped todo screen, sibling to the memory.

**Decision:**
Yes, but we alreayd have one that is good. Perhaps what can be improved is the way we show the individual todo. 
**Notes:**
Built as the individual todo only; the list did not change. `components/TodoDetail.tsx` opens when a
row is pressed, instead of the markdown file, and ⌘click or middle-click still opens the file in a
tab. It answers who owes it, due (with Change date), promised or written down, who was there, the
body with the agent's own quote, then Mark done / Reopen, Help me handle this, Drop, Open the file.
`dueStanding()` in `lib/due-date.ts` and `todoAddedOn()` in `packages/domain/src/todos/index.ts` are
new and tested. Two gaps: nothing stores who a todo was promised TO, so the panel shows the source
meeting's participants instead, and a todo opened from Home, search or a wikilink still lands on the
note page. The date picker is a Radix Popover inside a Radix Dialog, which this app has never done
before, and it was never opened.

---

### E-14. Documents: the user's folders

**What:** Scratch notes, PRDs, specs, briefs. What the user writes in.

**Change:** Owned by the user, agent-assisted, never auto-written. Folders here, made by the user,
because folders are the one organising idea nobody needs taught. This is the only place where the
user's own structure means anything.

**Decision:**
Yes, keep it clean and simple
**Notes:**
Built. `app/DocumentsView.tsx` plus a pure `lib/documents.ts`: a folder rail read off the real paths
under `notes/`, the documents in the picked folder newest first, New document, SelectionBar, and a
scoped Ask composer. No facets, filters, counts, sort menu or second layout, and no drop target, so
material cannot land here. The screen filters by PATH, not by note type. `note:move(path, folder)`
runs end to end (`use-cases/notes.ts`, `packages/ipc`, `handlers.ts`), so "New folder" and a move
list work once documents are ticked. "Never auto-written" is now true: policy rule 6 makes an unasked
write into `notes/` ask. The `understanding/` notes moved out to their own folder so they can never
appear here; `spec` and `decode` stay, and both skills now send `asked`. Unseen on screen.

---

### E-15. Tags become the agent's

**What:** Tags are curated in three places in the UI while the agent already fills them.

**Change:** Take tags out of the user's hands. They keep working underneath.

**Decision:**
Yes, let's keep them mostly hidden but not entirely. I think they should be able to see them in the frontmatter details if the expand. 
**Notes:**
Built the way you asked. `FieldSpec.agentOwned` on `TAGS` in `state/properties-schema.ts` makes tags
read-only, and PropertiesBlock still renders them as chips, so they are there when the details are
expanded and nowhere else. No add, no remove, no vocabulary dropdown. Chips are gone from
`NoteList`, `TicketBoard` (cards and filter row), `MeetingWeek`, and the `FolderView` tag facet row.
`SelectionBar`'s bulk Tag popover is deleted, which also removed the only way a user could invent a
context. `TagInput` lost its suggestions and serves only `cares_about` on a person, which is the
PM's own words. On screen the word is now "Tags", not "Contexts" (⌘K, Composer hint). Tags keep
working underneath and the agent still writes them. `app-state.tsx` `tagNotes` is now dead code.

---

### E-16. Context: one entry point

**What:** Sources, decisions, insights, themes, customers, tickets and wiki mirrors sit on eight
shelves. They are what the agent reads to be useful, not what the user browses.

**Change:** One entry point. The honest label is "what I know and where I got it". "Context" is a
placeholder, not the name. See the open question at the end.

**Decision:**
Yea, but going into context we should still have them seperated. 
**Notes:**
Built. The entry point is called Memory, and the shelves stay separated inside it. `MEMORY_SHELVES`
is source, decision, insight, theme, customer, person. `MIRROR_SHELVES` is ticket and wikipage,
under a "Synced" group. Meetings and notes left the Memory page for Calendar and Documents. The page
copy was rewritten in plain words; the old text taught "the memory accretes" and "the durable things
worth solving, accreting evidence". The shelves themselves and `ContextView` were not restructured,
and nothing about how a shelf lists its notes changed. Never seen on screen.

---

### E-17. A person keeps a page, not a directory

**What:** A person page makes meeting prep good and holds what we last told them. A People
directory adds a shelf and earns nothing.

**Change:** Keep the page, reached from a meeting, a mention or search. Cut the directory. Pages
exist only for people who keep coming up.

**Decision:**
They can be in the context
**Notes:**
Nothing was cut, because there was no People directory in the rail to cut. Person is a shelf inside
Memory (`MEMORY_SHELVES`), which is what your answer asked for. The person page is unchanged and is
still reached from a meeting, a mention or search. No rule was added about which people earn a page;
that is still the agent's own call, on the same terms as before.

---

### E-18. A source keeps one address

**What:** An article the user drops turns into a source and a separate digest note.

**Change:** The summary sits at the top of the source, the original underneath. Nothing extra to
open, sync or maintain.

**Decision:**
yes
**Notes:**
Built. `file_source` takes a `summary`, the agent's own words for what the source says. It lands as
`## Summary` at the top of the source page, with `## Original` and the raw text underneath. The
`caption` parameter is gone; a screenshot uses the same `summary`. Two refusals name their fix: a
summary with `as: "meeting"`, and a summary on a call filing several sources at once. No summary
means the body is what arrived, so every source filed before this reads unchanged. NoteView folds
the original behind one line ("Show the original (1,240 words)"), split by `lib/source-body.ts`. The
arrival skill copy moved in both `defaults.ts` and `vault-dev/`, and now says never to propose a
note that only repeats what one source says. Two owed things: the `## Original` heading is spelled
in two files, because the renderer cannot import `@qale/application`, and a source still sits at
`processing: new` until a proposal cites it, even though it now arrives read. The fold is unseen.

---

## D. Noticing, instead of reviewing

The machinery for asking a question is done: it survives a quit, dedupes by content hash, replays
the answer into the session, and ranks above everything else. What is missing is anything that
notices something worth asking about. Nothing compares two notes, nothing joins a todo to a
ticket, and `processing: stale` is a value no code ever writes.

### E-19. Write out the claims when material lands

**What:** One cheap step every time material arrives. Not hard-coded checks.

**Change:** The run writes out the claims the material carries: who committed to what, dates,
owners, numbers, decisions.

**Decision:**
yes
**Notes:**
Built as skill prose, not as code. A "## Check what it claims" section now sits in the arrival skill
and in process-note, in both `packages/sessions/src/defaults.ts` and the `vault-dev/` mirror. It
says to write out what the material claims before proposing anything: who committed to what, dates,
owners, numbers, decisions, one claim per entry, in the words the source used. Nothing is
hard-coded; the run decides what the claims are. It calls E-20's `check_claims`, which is an
always-on tool, so the step is live in every session even where a skill has not named it.

---

### E-20. Look each claim up, and act on the answer

**What:** Each claim is looked up against what is already stored and comes back as one of four
things.

**Change:**

- Already known: nothing happens.
- New: filed silently.
- In conflict with what we hold: becomes a question.
- Implies something that is missing: becomes a question.

"A promise with nobody doing the work" falls out of the fourth case without anyone writing that
check. A question is short, about their world, and settled in one tap: "You said the date is 12 May
in one meeting and 19 May in another. Which is right?" Never about our filing.

This is where the "they get it" feeling comes from. The product answers back about the content of
the meeting, not about its own bookkeeping.

**Decision:**
yes, keep it smart and use would preferabbly use haiku here. If we want to verify a claim, it shouldn't look at ALL claims, perhaps just those that are linked to a specific page or has a speicif tag. 
**Notes:**
Built. `packages/agent/src/claims.ts` is the `check_claims` tool. Your scoping rule is enforced, not
suggested: a claim carries `about` (pages, plus one hop through what they link to and what links to
them) or a `tag`, and a claim with no scope is refused. Long notes go to the matcher as the lines
that share terms with the claim, short notes whole, and a long note that shares nothing is dropped.
Caps: 8 claims, 6 notes each, 4 lookups at a time. Verdicts are known, new, conflict and missing,
plus `unsure` for every fail-quiet path (no answer, a malformed answer, an invented path, nothing in
scope), and nothing may raise a question from an `unsure`. 20 tests. Nothing writes
`processing: stale`; that is still a value no code sets. No real model call has ever been made.

---

### E-21. Ration the questions

**What:** Noticing ten things must not mean asking ten questions.

**Change:** A rule for how many questions the skill may raise, and how it picks.

**Decision:**
Yes but shouldnt be hard limit if the questions are legitemetly needed and valuable
**Notes:**
Built as text, not a cap, which is what "no hard limit" asks for. `QUESTION_RATION` comes back with
the results, and only when something is askable at all. It aims for two, gives the test (does an
answer change what somebody does), bans questions about our own filing, and says plainly that more
is fine when each extra one earns it. This is the first version you asked for. It has never faced a
real transcript, so nobody knows yet whether a model reads "aim for two" as a target or a floor.

---

### E-22. Match claims on a cheap model

**What:** Matching claims is lookup, not judgement.

**Change:** Trial Haiku before Sonnet. It has to fail quiet: no match, no question. A confident
wrong question costs more than a missed one.

**Decision:**
yes
**Notes:**
Built. The lookup runs on `claude-haiku-4-5-20251001`. `matchModel` falls back to any haiku or flash
id, then to `cheapestModel`, so a Gemini workspace gets Flash and nothing errors; `completeCheaply`
in `runtime.ts` now takes a model picker. Failing quiet is structural: every unclear answer becomes
`unsure`, and an `unsure` can never raise a question. What is NOT done is the trial itself. No real
Haiku call was ever made, so whether it is reliable enough, the one thing this ticket exists to
learn, is still unknown.

---

### E-23. Test the swap before building it

**What:** The assumption under all of section D is that trial users accept a handful of good
questions a week where they reject thirty cards. It is an assumption, not a fact.

**Change:** Put both in front of two trial users and see.

**Decision:**
not sure what you mean. 
**Notes:**
NOT built, and it is not code. It is a research task: show two trial users today's card flood and
section D's questions, and see which one they accept. The whole of section B and section D rests on
the answer, and both were built without it. Worth running before more is spent on D.

---

## E. The agent sets itself up

The architecture is already here. Skills are markdown files whose body is the agent's instructions,
the user can read and edit them, standing rules append to them, and a conventions file per system
is created on demand. What is missing is the moment, and the agent proposing its own setup instead
of waiting to be told.

### E-24. The agent says what it plans to do

**What:** Onboarding is a checklist. It teaches the user our words and asks for work before it has
given anything.

**Change:** Once the agent has seen enough, from the connect sweep or the first few meetings, it
says what it plans to do in the user's terms: you have four or five meetings most weeks with the
same three teams, so I have set myself up to prepare you for each one and chase what people promise
you, I keep notes behind the scenes to do it, and I will ask the occasional question when something
does not add up. Then it shows what it wrote for itself, which the user can read and change.

This is the only version of onboarding here that teaches nothing, asks for nothing, and works on
day one before any meeting has happened. Every sentence in that pitch is also a promise the product
then has to keep.

**Decision:**
yes
**Notes:**
Built on Home, in the First steps slot: `<SetupPitch onChange={seed} />` shows the pitch when there
is one and the old checklist when there is not. `onboarding/setup-pitch.ts` is pure. It works out
the meeting rate over a four-week window and lets the two middle weeks decide the number, so one
quiet week and one conference week both lose their vote, then names the repeating series. Under four
meetings in the window it returns null and no pitch appears. No API key, no pitch. The four promises
are each gated on the file that keeps them (meeting-prep, librarian, commitment-check, arrival), and
a test bans our filing vocabulary from the lines. Rows open the file behind the promise, and one
line seeds the composer with "I'd rather you ", which lands as a standing rule. No new seeded skill
file was written, on purpose. "Seen" is per-workspace localStorage, not settings.json, and nothing
in main triggers the card: it reads the tree at mount. 17 tests. Never seen on screen.

---

### E-25. Read the team's conventions on connect

**What:** Same shape, for Jira and Confluence.

**Change:** On connecting, the agent reads recent tickets and pages in the projects the user
follows and writes up how this team writes a ticket: the template, the recurring labels, the tone,
what a good title looks like. It shows that once and asks whether it looks right. Cheap and fast,
on Sonnet, because it is reading and not reasoning.

**Decision:**
yes
**Notes:**
Built in `apps/desktop/src/main/services/sync-service.ts`, inside the kickoff the first look already
fires, and written up in full as CV-6 in `docs/conventions.md`. `conventionsJobs()` turns the
containers just read into one job per system, quoting the path, title, summary and `##` headings out
of the shipped template, so renaming a heading cannot leave the kickoff pointing at the old one. A
container that is empty, one the connector mirrors nowhere, and a calendar all drop out.
`conventionsBlock()` is the instruction: read about ten recent tickets per project and five pages
per space, then say how this team writes one, as one proposal per system, whether or not they want a
walkthrough. Beat three of tell-qale, which asked about conventions one rule at a time, is cut. It
reaches a card because a rule file the agent inferred now asks. Two gaps: the read is NOT pinned to
Sonnet, and Jira carries no `labels` and no `issueType`, so the one example the write-up uses cannot
be checked. Never run against the live site.

---

## F. What gets cut

Cut on screen first, and only later in the file format. The vault can keep precise words for the
agent while the screen stops teaching them.

### E-26. Drop the vocabularies that carry no logic

**What:** Of the five lifecycle vocabularies, two are structural (standing, commitment),
`processing` is two thirds real, and `relationship` and `stance` have no logic behind them at all.
`insight` is a note with required evidence and nothing branches on it.

**Change:** Take `relationship` and `stance` off the screen. Trim `processing` to the third that
does something.

**Decision:**
yes, we can keep some mostly hidden but still vaulable for the AI 
**Notes:**
Built the way you asked: off the screen, still in the files. `relationship` and `stance` are in
`HIDDEN_KEYS`, so their property rows, the fact strip and the theme stance badge are gone. The keys
stay in the files and the agent still reads and writes them (`prompts.ts`, `tools.ts` name them).
`processing` is trimmed to two options, later reworded to "Gone through / Not yet / Done"; a file
still holding `processing: stale` reads as its label instead of going blank. `FolderView`'s
lifecycle facet chips are now gated on the field not being hidden, so a themes folder stops grouping
by Exploring / Watching and a customers folder by Prospect / Churned. The "no logic" claim was
re-checked and holds: `ThemeDTO.stance` in `packages/ipc/src/dtos.ts` has no consumer at all and is
dead. The file format was not touched and no vault file was rewritten.

---

### E-27. Stop teaching our private language

**What:** Empty states carry lines like "the spine starts here" and "the durable things worth
solving, accreting evidence". We shipped a careful private language and teach it nowhere. This is
the Obsidian trap: a person wanted a notes app and got a research project about note-taking
systems.

**Change:** Rewrite every label and empty state in the user's words.

Generated note bodies run about 65 to 140 words and the shared prompt bans assistant-speak by name,
so "AI slop" is not about length. It is that the notes are uniform, arrive unasked, and are about
things the user already knows. Thirty short notes in one voice read as slop even when one of them
would pass alone. Section B is most of the fix; this ticket is the rest.

**Decision:**
YES SO MUCH YES
**Notes:**
Built, in three sweeps over the whole app. Gone: "the spine starts here", "the memory accretes",
"accreting evidence", "Dumped raw material", "working material", "Where your delivery truth lives",
and the Obsidian line on Home. "Librarian" is off the screen: the Inbox section is "Tidying up" and
the questions are "from Qale". "Subagents" is "Split the work up"; "Advanced checkpoint" is "Moved
to the next step". "Context" as the word for a tag is gone from ⌘K, the Composer hint and the scoped
composer. `state/properties-schema.ts` and `packages/domain/src/notes/lifecycle.ts` moved together
to "Gone through / Not yet / Done", and one test assertion moved with them. PRODUCT.md was rewritten
to match, including the write policy and Activity. Left alone on purpose: "superseded", and
"voice", "house rules" and "moment" on the Skills page, which defines each on screen. Nothing was
read on screen, so a string that now wraps badly would not have been caught.

---

### E-28. Retire the tab kinds the surfaces do not need

**What:** 12 tab kinds. Retiring one is already a cheap, solved operation in the code.

**Change:** Cut the kinds that section C leaves with nowhere to appear.

**Decision:**
Not really sure what you mean. 
**Notes:**
NOT built, because the premise was wrong. All 14 tab kinds were checked and every one still has a
live route, so retiring any of them would have broken a door. Two are close to orphaned and are the
ones to watch. `context`, the tag page, is now reached only by a tag chip and ⌘K, and E-15 took the
chips off most screens, which leaves ⌘K nearly alone. Do not retire it blind: ⌘K still reaches it.
The retire operation itself stays cheap if a surface really does lose its last door.

---

## Still open

Answer under each. These are not tickets yet.

**1. What is "Context" called, and is one entry point enough?**
Someone may want to browse decisions deliberately.

> Let's call it "Memory" and it's a single entry point, but then the user is presented with the different types. 

Built as: one rail row called Memory, with the types kept apart inside it (source, decision,
insight, theme, customer, person, plus a "Synced" group for tickets and wiki pages).

**2. Is a silent standing rule acceptable with only an Activity row behind it?**
Cheapest to get wrong, hardest to notice later. Blocks E-8.

> Like i said above, if it's created during a session we can add a small "Added to rules" that the user can review if they want

Built as: a quiet `Applied: Added to rules "…"` line in the chat and a revertible row in Activity.
A rule the agent inferred for itself still asks, so only a rule you stated lands silently.

**3. Is claim matching reliable enough on a cheap model?**
It has to fail quiet. Blocks E-22.

> Let's trial it. 

Built as: Haiku with a fallback to any cheap model, and an `unsure` verdict that can never raise a
question. The trial has not started; no real Haiku call has been made, so the question is still open.

**4. How is the question skill rationed?**
Blocks E-21.

> Not sure what you mean. Write the first version of it and i Can iterate on it. 

Built as: `QUESTION_RATION`, prose rather than a cap. Aim for two, ask more when each extra one
changes what somebody does, never ask about our filing. Edit the text to iterate.

---

## Left open by the build

What the build owed and did not pay, in the order that would spoil a demo first.

1. **Nothing is live-verified.** The app was never launched. The rail, the grouped card, the meeting
   panel, the todo panel, the source fold, the setup pitch and the Activity page have never been
   seen on screen. Everything below assumes that gets done first.
2. **The claim matcher has never made a real Haiku call.** `packages/agent/src/claims.ts` is green
   in tests and untested against a live model, which is the one thing E-22 was meant to trial.
3. **The demo workspace is rebuilt and this one is paid.** `pnpm refresh-demo` ran after the build:
   offset +47 days, lanes `1 overdue · 1 today · 1 upcoming · 2 someday · 2 waiting · 2 closed`, 111
   notes validate, every wikilink resolves, and the stale inbox DB is cleared. Re-run it if the
   canonical `vault-dev/` changes again. The run also fixed a bug in `scripts/refresh-demo.ts`: the
   lane summary matched only double-quoted dates, so every single-quoted `due:` read as no due and
   sat in Someday.
4. **Nothing is committed.** The whole build sits in the working tree: 99 tracked files changed and
   32 new ones untracked. An untracked `scratchpad/` folder at the repo root is build litter, not
   code, and should not go in.
5. **Jira carries no `labels` and no `issueType`** in `packages/atlassian/src/client.ts` or the
   shallow mirror, so E-25's conventions write-up cannot check the one example it uses.
6. **The E-25 read is not pinned to Sonnet.** It runs on the first look's model. Splitting them
   needs a second session fired from `handlers.ts` against `BACKGROUND_MODEL_ID`.
7. **The Inbox cursor stops on a grouped row and never descends into it.** Members are reached with
   the mouse or Tab. Fixing it means lifting the row's open state into `app/InboxView.tsx`.
8. **The todo date picker is untried.** A Radix Popover inside a Radix Dialog, in
   `components/TodoDetail.tsx`, which this app has never done before.
9. **A todo opened from anywhere else still lands on the note page.** Home, search and wikilinks go
   through `openDoc` in `state/app-state.tsx`, not through the new panel.
10. **The setup pitch has no trigger.** `onboarding/SetupPitch.tsx` reads the tree at mount, and
    "seen" is per-workspace localStorage rather than a field on `OnboardingDTO`.
11. **MinGit on Windows.** About 25 MB, the same redistributable VS Code ships, and it would mean
    history is never off on Windows. macOS keeps `xcode-select --install`. Not built, your call.
12. **The git install hint lives in two places** (`components/NewWorkspace.tsx` and the History
    dialog). Settings and onboarding could say it too.
13. **`processing: stale` is still written by nothing.** `check_claims` reads and writes nothing, so
    a conflict it finds never marks the note.
14. **A source stays at `processing: new`** until a proposal cites it, even though E-18 means it now
    arrives read. `lib/note-status.ts`.
15. **The `## Original` heading is spelled twice**, in `use-cases/arrival.ts` and
    `renderer/src/lib/source-body.ts`, because the renderer cannot import `@qale/application`.
16. **`process-note` proposes a rewrite of the PM's own scratch note** and still draws a card, now
    because of the `notes/` rule. If that should land silently the skill needs `asked`.
17. **Two dead symbols left behind:** `tagNotes` in `state/app-state.tsx` and `ThemeDTO.stance` in
    `packages/ipc/src/dtos.ts` (plus its line in `apps/desktop/src/main/dto.ts`).

---

## Two things the direction does not change

The product stays opinionated. A flexible folder-and-file setup the user shapes themselves is the
opposite of what this user wants. Customisation comes later, if at all.

The target user is not the PM who already built their own Claude Code brain. It is the one with no
time, energy or interest for that, who still wants the benefit. Their tolerance for a first hour
that returns nothing is near zero, and their tolerance for a system they must keep true is zero.
