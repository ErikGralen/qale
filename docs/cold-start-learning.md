# The cold start, the learning

Third round, 2026-09-06. Erik rejected the hard-coded facts pass and the fixed question ladder
in `docs/cold-start-path.md` and `docs/cold-start-asking.md`: "I don't like this having hard
coded passes." He wants an assistant that learns as much as it can on its own from whatever
arrives, then asks to learn more, with questions that impress and questions that probe for
context without feeling like homework, and not only during onboarding.

Five agents got the identical brief on different models (Sonnet, two Opus, two Fable) to see
where they would differ. They differed less than expected. This doc is the convergence, then
what they disagreed on. Nothing here is decided.

What this replaces: the facts pass, the floors, the five question kinds, and the getting-started
session. What it keeps from the earlier rounds: give first, the value test, the ask budget, the
never-ask windows, the Next card on Home, the seven sights, the funnel events.

---

## The idea

Qale keeps one honest page about what it knows, what it is guessing, what it cannot see, and
what it has asked. Noticing is free: every read the app already pays for leaves a one-line
"wondering" behind. One agent, fuelled by new material and never by a clock, reads the
wonderings against its page, tightens the page, and asks at most one question, the one whose
answer changes what Qale does next. The page is the interface: the PM reads it to see what
Qale thinks, edits it to steer, and every question card links back to the line it came from.

No kinds, no floors, no ladder. The only gates are context-free facts: did new material land,
did the things an open line cites change. Everything else is instructions the model reads.

---

## The page

`research/what-i-know.md`, title "What I know", an ordinary note in Memory. Four sections in
prose, one screen long, tighten-only:

- **What I am sure of.** Each line cites a source and the PM's word that confirmed it. A line
  with no citation is dropped on the next pass.
- **What I am guessing.** Bets, each with the evidence behind it: "Checkout Rewrite is the
  main thing this quarter (23 tickets moved, named in 6 of 41 meetings)."
- **What I cannot see.** Named blanks, each with a guess at where the answer lives: "no
  pricing anywhere, probably a deck or a page in PROD."
- **What I asked and what you said.** A dated log, skips included.

Three rules hold it honest, all in the agent file:

1. The page holds claims about Qale's own coverage, never claims about the world. A fact about
   the product goes to the page that owns it (`research/product.md`, a customer, a person) as a
   proposal, exactly as today.
2. A line moves from guessing to sure only on the PM's word (an answer, an approval, a
   correction in chat) or when two independent sources agree, and then it names both. A line
   whose only source is a Qale-authored page can never move up. That is M5's provenance rule,
   and it is the whole defence against the agent believing itself.
3. The page lands silently, with a commit, an Activity row and Put back. This is one narrow
   carve-out from "nothing lands without a yes", and it is safe because of rule 1. Settings'
   "What Qale does on its own" gets the row.

---

## Noticing is free

Two sources of wonderings, neither a new read:

- **The summary pass.** The Haiku call that already opens every new note to write a summary
  and tags gets one more output: the one thing this note takes for granted that the workspace
  cannot explain. One sentence, in the note's words, stored as a `wondered` row in the reason
  ledger, anchored to the note. A derived label, so it lands like the tags beside it. Cost: a
  few tokens on a call already made.
- **Every session's closing beat.** One line in the shared preamble: before you finish, write
  down the one thing you now wonder that you could not settle. The run holds the context
  already. Sessions note; they never ask. Twenty arrival children each wondering something is
  twenty lines, not twenty voices.

---

## The agent

A second agent beside the librarian. Working name: the apprentice. The name on screen is
Erik's call.

**Trigger.** The tick asks two arithmetic questions before spending anything: has the set of
wonderings changed since my last run, and have the things any open line on my page cites
changed (a fingerprint over the paths a line names, the same diff the librarian runs for
links). Both are context-free, so both may be gates, and they are the only gates. A quiet
workspace never fires it. The PM typing in Documents is not fuel.

**Two turns, the first one cheap.** A Haiku triage over the change list: paths, summaries,
tags, the new wonderings, its own page. The instruction is written to end quietly: if nothing
here touches a line on my page, stamp the ledger and stop. Only when triage says something
moved does the expensive turn (Sonnet, the librarian's background model) open the notes, its
page, and the week's session files. Most weeks the cheap turn is the whole spend.

**What it does in the expensive turn.** Read its page first. Close lines the new material
settles, with the citation. Sharpen bets. Move a blank to guessing when a source now covers
it. Then, if the ask slot is free and nothing on the calendar is within the quiet window, ask
at most one question. Then write the page and end with the receipt.

**The asking rule, in the agent file, and it is the whole rule:**

> Ask the shortest question that fixes the line whose being wrong would cost the most next
> week. Ask only when the answer is the last thing standing between you and something you
> would then do, and say what that is in the question. If the payoff is "then I would know",
> delete the question. A bet beats a survey. When the answer is a document rather than a
> fact, ask for the document: drop it, paste the link, or name the space and I read it. A no
> writes as much as a yes. Read your own log first: a skip with unchanged evidence is an
> answer.

**Questions it could produce, from the Tavla workspace.** Three that notice something:

> Kranelund's page says they are still on the old pricing. The March decision moved everyone
> to usage-based, and every Kranelund ticket since cites the new plan. Stale page, or is
> Kranelund the exception? The wrong one is what I would put in Friday's brief.

> Two decisions three weeks apart give different cutover dates for the Bergman migration, and
> neither supersedes the other. Which one is live?

> Kranelund has the Monday-report problem that lost Rondo, and they are looking at Insikt. I am
> reading them as the account most at risk this quarter, above the Nordkap renewal. Wrong?

Three that probe for context without homework:

> My picture of the product is built entirely from your Jira tickets, so it is a list of parts,
> not a product. Is there a deck or a one-pager you would hand a new hire? Drop it in and I do
> the reading.

> Everything I hold about pricing came out of you talking in meetings. Nothing written. Rate
> card, pricing page, the deck you send? Paste a link or name the space.

> I can see who you meet. I cannot see who decides. When Bergman & Falk push a date, whose yes
> ends it? A name is enough.

Every one names its material and its payoff. None asks the PM to write anything.

**What it writes.** Its page, silently. Facts, as proposals into the pages that own them.
Questions, through the existing ask card, parked, one at a time. When a question is about how
a source reads ("In Progress on our board means parked"), the answer proposes a rule on the
conventions skill through the standing-instruction path.

---

## Calm and cheap, without floors

Everything here exists already and none of it is a floor.

- **No fuel, no run.** The set comparison and the citation fingerprint are the gates.
- **One open question app-wide** for anything the PM did not start. `librarianAsks` widens
  from one agent name to the maintenance set. While either waits, neither asks.
- **The quiet window.** No unowed ask from the prep lead before a synced meeting until 15
  minutes after it ends, off the agenda query the prep sweep already runs. Nothing on the
  first open after three days away.
- **Seven-day expiry and the quiet week after a decline**, the librarian's constants.
- **The page is the anti-repetition machine.** Its log holds every question, answered,
  corrected or skipped, and the model reads it first. A deferral line ("waiting for a second
  source on this") replaces a counter. After three skips on one line the next run offers to
  stop, with "Stop asking about this" as the yes, which proposes a house-rules bullet.
- **Restraint is copy**, in the librarian's proven words: raise the one most valuable, leave
  the rest, this runs again, end quietly.

---

## How the PM sees and steers it

The page is the interface. Open it to see what Qale thinks it knows. Strike a guess and the
question dies. Write "true" beside one and it moves up. Add a blank and the next run chases
it. Write "we do not do roadmaps" under a line and the run proposes a house rule. Every
question card carries "Why this" as a link into the page, a payoff line, and three doors:
answer, not now, stop asking about this. The agent file is editable like the librarian's, with
the same on/off switch. Activity shows every page write with Put back. The Next card on Home
draws the parked question as its top row and the page as one door.

---

## The cold start under this design

The path's minute-by-minute stays, with the machinery under it swapped:

- **Calendar syncs.** The meeting shells arrive. The summary pass labels them and leaves
  wonderings ("this series repeats weekly and nothing is written from it"). The apprentice
  fires on the new set, reads the calendar and the month maps the index already generates,
  writes its first page (what it can see: who they meet, what repeats, what is empty; what it
  cannot see: everything else, with a guess where each lives), and asks its first question,
  which on an empty workspace is the backlog ask in their month's own words. No facts pass:
  the numbers come from the index maps and the model's read.
- **The folder lands.** Arrival files, each child leaves a wondering, the apprentice fires on
  the new set, tightens the page, and asks about the one promise or gap the transcripts raised.
- **Jira reads.** The first-look knock becomes an apprentice run with the read as fuel. The
  seed card stays as the pattern for "track these, ticked".
- **Day 9.** The same agent, the same page, one line longer in "sure of" and one shorter in
  "cannot see". The weekly consolidation pass (M5) stays a separate mandate: it changes what
  the memory says, the apprentice changes what Qale knows about its own coverage.

The getting-started session goes. Continuity comes from the page, not from a transcript, so
each apprentice run is a short session and nothing needs re-entering. The First steps rows
(key, calendar, Jira, backlog) stay on Next as doors, because they are settings, not knowledge.

---

## What the five disagreed on

They agreed on: one page Qale owns with sure/guessing/cannot-see/asked; fuel not clock;
sessions note but never ask; one open question app-wide; the page as the steering surface; ask
only when the answer changes what Qale does next and say the payoff; ask for the document,
never the essay; a bet beats a survey; no kinds, no floors.

**Second agent or the librarian.** Four picked a second agent (own mandate, own toggle, own
model; "a run told to repair links and form a worldview does the cheap half and skims the
other"). Sonnet picked the closing beat writing the page and the librarian distributing from a
second worklist, to avoid a second file and a second thing that can ask. The four win on
mandate clarity, and Sonnet's worry is met by sharing the tick, the ledger shape and the one
ask slot.

**Where the wonderings come from.** Opus A put it on the summary pass (cheapest, already
reading every note). Three put it on the closing beat. Both are free, so both.

**The trigger.** Fable B: new material off the ledger. Fable A: the git diff since last run.
Opus A: the wondering set changed. Sonnet: the citations of an open line moved. Opus B: a
cheap triage turn first. The convergence takes the two set comparisons as the gate and the
triage turn as the spend control.

**Where the page lives.** Four said `research/`, one said the agent's own folder. `research/`,
because the PM must open and edit it, and the librarian and the summary pass then police it
like any page.

---

## Build

1. The agent file, seeded like the librarian, with the ending-quietly rule first and the
   asking rule above. Two days, almost all words.
2. `wondered` as one more output of the summary pass, stored as a reason row. Half a day.
3. The closing-beat line in the shared preamble and the tool argument that records it. Half a
   day.
4. The trigger in the tick: wondering set changed or an open line's citations moved, reusing
   the librarian's plan and settle shape and its ledger. One to two days.
5. The cheap triage turn with a model override. Half a day.
6. The page: seeded on first run, the silent carve-out in the policy, the Settings row, the
   "sure of" block seeded into every session's context beside "Tags in use", labelled as a
   reading. One day.
7. The ask slot widened to the maintenance set, the calendar quiet window, the three-day rule.
   One day.
8. The question card: payoff line, "Why this" link, "Stop asking about this" door. One day.
9. Delete: the facts pass and floors from the path, the getting-started session, the
   first-look knock as a separate `tell-qale` fire (it becomes fuel). Half a day.
10. Telemetry: `ask.decided` with answered, corrected, skipped, stopped; the page's line counts
    on `memory.measured`. Half a day.

About eight days, against the path's nine for the facts pass and ladder it replaces.

---

## How it fails

- **It asks real, boring questions.** Every gap is genuine and none matter. Guard: the payoff
  rule (draft the next action before the question is allowed), and the page, where a boring
  question is visible and strikeable before it is asked.
- **It believes itself.** Its page is its own writing, so each run confirms the last. Guard:
  every line names a source path, a Qale-authored page can never lift a line above guessing,
  and only "sure of" lines are seeded into other sessions.
- **The page becomes a second memory.** Guard: coverage claims only, one screen, tighten
  only, and the librarian flags a line with a claim and no link as a finding, so the two
  agents police each other.

---

## Decisions this doc needs

1. A second agent, not a librarian mandate.
2. The silent carve-out for its own page under `research/`.
3. Wonderings from both the summary pass and the closing beat.
4. The facts pass, the ladder and the getting-started session are dropped in favour of this.
5. The agent's name on screen.
