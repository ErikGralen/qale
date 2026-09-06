# The cold start, as it stands

From a fresh install to a memory worth asking. Written 2026-09-06 against the code, not the
docs. This is a map, not a plan: it says what runs, in what order, and where the route breaks.
The tickets come in a second doc once the seams below have a Decision each.

The docs that built the pieces: `docs/onboarding.md` (the opening and First steps),
`docs/product-understanding.md` (the follow picker and the interview), `docs/first-look-debrief.md`
(the knock after a connect), `docs/critical-mass.md` (the backlog ask and the arc),
`docs/arrival-agentic.md` (sources), `docs/librarian-agentic.md` and `docs/background-system.md`
(the tick). Each was written for its own piece. Nobody has read them end to end as one route
until now, and that is most of why it feels messy.

---

## The route in one table

| Stage | What starts it | What it writes into the workspace | Asks the model? | What the PM sees |
|---|---|---|---|---|
| 1. The opening | First launch, no `finishedAt` in settings | Identity, workspace path, key, connections, consent | Key verify only | Six screens: Hello, You, Files, Key, Connections, Telemetry |
| 2. Workspace creation | "Create it" on the Files screen | Fourteen type folders, git init + first commit, 9 skills, 2 agents, 2 voices | No | Nothing. It happens under the screen |
| 3. First maintenance pass | Workspace open, then every 5 min | Frontmatter normalize, `index.md` maps. With a key: summary + tags on every note | Haiku for labels | Nothing on day one. Activity rows for labels |
| 4. Home on day one | Opening finishes | Nothing | No | Greeting, New document / Add source, the First steps card, an empty composer. No starter chips until the workspace has content |
| 5. Calendar connect | Connections screen or Settings | One empty meeting note per event, 30 days back, 60 forward. People linked only if a person page already exists | No | Calendar fills. The empty-meeting strip on each past meeting page |
| 6. Jira or Confluence connect | Connections screen, Settings, or the First steps row | Nothing until the follow picker is confirmed | Footprint survey, no model | Follow picker: recommended containers ticked with a reason |
| 7. The first read | Follow confirmed; a 4 s debounce kicks a maintenance pass | Mirror notes under `tickets/<provider>/` and `wikipages/<provider>/`, one `sync:` commit | No | "Reading these now. When it has something to say, it knocks on Home" |
| 8. The knock | First clean sync of a connection, inside the tick | Nothing. One `tell-qale` session with a parked question | Yes, unattended | Sessions icon turns brand colour. First steps row flips to "It read your projects and has a question waiting" |
| 9. The debrief | The PM answers the question | Proposals: tracked tickets (no card), research pages, a "How we use Jira" conventions skill, understanding notes | Yes, interactive | The debrief conversation, hypothesis first, then the seed card |
| 10. Add sources | Drop, paste, folder, Add source button, meeting page | `sources/` silently. Meeting page, insights, decisions, todos as proposals. Over 5 files: a spawn card | Yes, unattended | Handoff line, batch count, then the session |
| 11. Tell it about the product | First steps row, or the knock's session | Understanding notes under `research/` as proposals | Yes, interactive | The interview, options at every fork |
| 12. Sessions the PM runs | Composer, skill picker, page buttons | Whatever the skill proposes | Yes | The session |
| 13. The librarian | The tick, at most once per 30 min, on Sonnet | Repairs as proposals, quiet questions | Yes, unattended | A Sessions row only when it has something |
| 14. Before a meeting | The tick, 60 min before a synced meeting | A `## Prep` section as a proposal | Yes, scheduled | The brief on the meeting page |
| 15. The weekly update | Friday 15:00, off by default | Drafts per voice | Yes, scheduled | Nothing unless switched on |

Stages 5 to 11 can happen in any order. Nothing gates on anything else, by design (CM-6: "rows
never block each other"). That is also why the route has no spine: every stage was built to
stand alone, so nothing carries the PM from one to the next except the order of rows on a card.

---

## Who fills the memory, and who decides

The product promise is "the memory has to visibly accrue". This is every writer, and what each
one needs from the PM before a byte lands.

| Writer | Lands on its own | Lands after a yes | Never |
|---|---|---|---|
| Calendar sync | Meeting shells, frontmatter patches | | Person pages, transcripts |
| Jira and Confluence sync | Mirror notes for followed containers, deep mirrors for anything the workspace links | | Anything the PM did not follow or link |
| Arrival | The source file under `sources/`, linked onto its meeting | Meeting page, insights, decisions, todos | A page in `notes/` |
| The debrief seed card | Tracked ticket notes (a read decision, no card) | Research pages, understanding notes, the conventions skill | Wiki pages, people, todos |
| The interview | | Understanding notes | |
| The librarian | | Link repairs, repoints, deletes | An unasked write |
| The summary pass | `summary`, `tags`, folder purposes, on every note including `notes/` | | |
| Index maps | Every `index.md` | | |
| PM sessions | What they asked for in chat | Everything else | |

Read across: on day one, with every connection made and no source dropped, the memory holds
meeting titles, ticket mirrors, and labels on all of them. Every page the agent authors is a
proposal. So the memory accrues at exactly the rate the PM says yes, and nothing on Home says how
many yeses are waiting.

One thing the policy says that the code does not do: `grouped` ("one card per intent, ten
tickets moved is one row with ten lines") falls through to `ask`. Ten rewrites are ten cards.
The comment in `policy.ts` says so; the Settings screen and PRODUCT.md say the grouped card
exists.

---

## The same route, as the PM meets it

**Minute 0 to 3.** Six screens. The Files screen is the one that cannot be skipped. Most people
skip the key (they have no key yet) and the connections (they do not trust us yet). Both come
back as First steps rows.

**Minute 3.** Home. A greeting, two buttons, and the First steps card in this order: key,
calendar, last month's meetings, Jira and Confluence, tell it about the product, decide on a
proposal, ask it something, prep for a meeting. The composer is empty and has no starter chips,
because the chips hide until the workspace has content. So the page says "do these eight
things" and the only door that does anything without a connection is "Add last month's
meetings", which needs a folder of transcripts most people do not have on hand. The row folds
open into six per-tool guides, which is the best help in the whole flow, and it is one line
under one row.

**Minute 5, calendar connected.** The calendar fills, a month back. Each past meeting page
carries the strip "Add transcript / Write what happened". Home does not change: the capture
nudge rows that used to sit in a "Waiting on you" list on Home have no surface any more. They
still build (`attention.ts` produces `capture` items) and they only count toward the Sessions
badge. So the one moment the product could say "14 meetings, none with notes, drop the folder"
is silent.

**Minute 8, Jira connected.** The follow picker is good: ticked rows with reasons, one confirm,
a receipt that promises a knock. The knock comes a minute or so later as a colour change on the
Sessions icon and a changed hint on the First steps row. If the PM is on Settings, which is where
the picker was, they see neither. Nothing on Home says "it read Nordkap's Jira and has a question"
except the row hint, and only while the First steps card is still showing (see seam 1).

**Minute 10, the debrief.** If they find it, it is the strongest thing in the product: named
epics, their own tickets, a hypothesis to confirm, then a seed card that tracks tickets with no
further cards. If they had dropped a backlog first, the debrief reads across meetings and tickets.
Nothing in the flow tells them to drop the backlog first, because the arc lives in a card whose
order they cannot see the reason for.

**Day 2.** The librarian runs, finds broken links and orphans, files a few repairs. The summary
pass labels everything. The meeting-prep agent briefs the next synced meeting. Every one of
these is a Sessions row, and Home is the same page as yesterday plus a greeting with a meeting
count. If they dismissed the pitch card, the First steps card is gone too, including the key row
and the connect rows they had not done.

**Week 2.** Nothing pulls them back. The capture nudge is a strip on a page they have to open.
The coach agent that would say "you added notes to 2 of 6 meetings" is not built (CN-5, CN-6).
The consolidation pass that would read the week's sessions and propose what the memory should
now say differently is not built (M5). The weekly update is off by default. So week 6 looks
like week 1 plus more mirrors, unless they kept dropping transcripts on their own.

---

## The clocks

Five clocks with five sets of rules. This is the "sweeps and runs" part of the mess.

| Clock | Interval | Runs on | Can park a question | Model |
|---|---|---|---|---|
| Maintenance tick | 5 min, plus one on open, plus one 4 s after a follow | Sync, normalize, first-look knock, librarian, labels, maps | | |
| Librarian | At most once per 30 min inside the tick, after a 5 min settle | Findings from the scan | Yes (`unattended`), one open question at a time | Sonnet 5 |
| Summary pass | Every tick, when a key exists | Notes with a stale or missing summary, untagged notes | No | Haiku 4.5 |
| Before-meeting sweep | Every tick, 60 min lead | One prep per synced meeting | No (`scheduled`) | App default |
| Weekly schedule | Friday 15:00, catch-up on launch | `weekly-update` only, off by default | No (`scheduled`) | App default |
| Codebase pull | 15 min, its own timer | Fast-forward the linked repo | | |

`unattended` and `scheduled` are two flags with one difference (may it park a question) and
the difference lives in comments. Arrival and the first-look knock are `unattended` with
`trigger: 'arrival'`; the librarian is `unattended` with `trigger: 'scheduled'`. The telemetry
folds all of that to three words.

Telemetry can see: `onboarding.step`, `connection.added`, `source.added`, `source.tool`,
`session.finished` (skill, trigger, duration band, failed, cards, asked), `card.decided`. It
cannot see whether the knock was answered, whether the seed card landed, how many notes the
memory holds, or whether anyone came back in week 2. There is no funnel to read.

---

## Where the route breaks

Numbered so the next doc can ticket them. Nothing here is decided.

**1. Two cards fight for the one slot on Home, and closing one kills the other.**
`SetupPitch` ("Here's what I plan to do", E-24) renders in the First steps slot when there is a
key and at least four dated meetings in a four-week window. Otherwise it renders `FirstSteps`.
Putting the pitch away sets `onboarding.dismissed`, which retires First steps for good,
including the unticked key and connect rows. A PM who connects a calendar, reads the pitch, and
closes it has no way back to "Connect Jira". The two cards were built three weeks apart for the
same moment and were never put next to each other.

**2. The knock has nowhere to land.** The picker promises "it knocks on Home". Home has no
waiting list (the flat "Waiting on you" from the Home redesign is gone; `waitingOnYou` only
feeds the Sessions badge count). What the PM gets is a coloured icon in the rail and a changed
hint on a First steps row that seam 1 may have removed. The capture nudge rows have the same
problem: built, counted, drawn nowhere except the strip on the meeting page itself.

**3. Two doors start the first interview, joined by a scan.** The First steps row opens a fresh
`tell-qale` session with "Let me tell you about the product". The knock fires a `tell-qale`
session with the read. FD-5 reconciles them by having the row look for an open `tell-qale`
question first. Press the row while the sync is still running and there are two interviews.

**4. The debrief can be lost for good.** `runFirstLookDebriefs` stamps every ready connection
`done` before it fires the session. If `fireSession` throws (no credit, a rejected key that
still counts as "a key exists", a provider outage), the failure is logged and the knock never
comes. The picker's promise was made a minute earlier.

**5. The arc is invisible.** CM-6 reordered First steps into calendar, backlog, Jira, debrief,
prep, on the theory that each makes the next better. The card shows eight rows with one-line
hints. Nothing says "do the backlog before Jira so the debrief can speak across both". The one
guide that would get a backlog out of Granola or Zoom is folded under one row. And the composer
starters, the only teaching on Home, hide until there is content, which is exactly when the PM
needs them least.

**6. The memory grows only as fast as the PM says yes, and nothing counts the yeses.** Every
page the agent authors is a proposal (arrival's meeting pages, the debrief's research pages, the
interview's understanding notes). The only silent authors are filing and labels. The Memory
footer shows "N unprocessed", which counts sources with `lifecycle: new | stale` and has
nothing to do with pending proposals, librarian findings, or how much the memory holds. The
First steps tally sentence ("Your memory now holds 31 meetings, 14 with notes...") is the one
honest count in the product and it renders once, when the card retires.

**7. `grouped` is `ask`.** See above. The Settings section "What Qale does on its own" and
PRODUCT.md both describe a card that does not exist. On the day the seed card lands 3 research
pages, that is 3 cards, and a backlog drop of 20 transcripts is 20 meeting cards plus their
insights and todos.

**8. Week two has no engine.** Three things were designed to pull the PM back and none is
built: the coach (CN-5, CN-6, docs/capture-nudge.md), the consolidation pass (M5,
docs/mvp-strategy.md, Decision blank), the watched folder (CM-8, declined until the tool
telemetry says which tools people use). What runs is the librarian (repairs), the labels, and
the before-meeting brief. The brief is the only one that produces value the PM did not ask for,
and it needs a calendar connection.

**9. A fresh workspace and the demo do not ship the same skills.** The Jira and Confluence
conventions skills exist as files in `vault-dev/` and are never seeded; a real workspace only
gets them if the debrief proposes them. `DEFAULT_NOTES` is empty and still spread into the seed
call. `incoming-request` is retired on open. The pitch card promises four behaviours gated on
files (meeting-prep, librarian, commitment-check, arrival) and the demo shows more.

**10. Three ledgers say "the librarian just ran".** `markLibrarianRun` in the check ledger, the
in-memory `agentLastRun` map, and the `librarianPasses` reentrancy map. The supersede reaction
stamps the first one directly and skips the settle. This is not a user-facing break, it is why
the cadence rules are hard to reason about.

**11. Nothing measures the route.** No event says the knock was answered, the seed card was
confirmed, the first proposal was approved (only `card.decided` with no "first" flag), or what
the memory holds after a week. The initiative cannot say where people fall off, so the first
build should probably be the funnel, not a fix.

---

## What the pieces already do well

Kept here so the next doc does not rebuild them.

- The opening: six screens, resumable, every skip comes back as a row.
- The follow picker: ranked, reasoned, one confirm, cached survey.
- The debrief: hypothesis first, cites everything, seed card with no per-ticket cards.
- Arrival: files silently, proposes the rest, folder drop works, batch counts.
- The per-tool guides under "Add last month's meetings".
- The librarian's calm: settle window, interval, one open question, quiet end.
- The write policy is one function and Settings renders from it.
- Every silent write is a commit with an Activity row and a revert.

---

## Open questions for the next doc

1. Is Home the place the route lives, or is it a session? The pitch card argues Home ("a
   session holds what needs a decision and this needs none"). The knock argues a session. The
   capture rows have neither.
2. One card or two on day one: merge the pitch into First steps, or make the pitch the finished
   state of First steps (it already has a tally sentence for that moment).
3. Should the first debrief wait for the backlog, or should the backlog ask come from the
   debrief ("I read your Jira. Do you have last month's transcripts? Drop the folder")? The
   second makes the arc a conversation instead of a card order.
4. Which of coach, consolidation, and the watched folder is the week-two engine. M5 is the one
   the research says is the missing organ. The coach is the cheapest.
5. Build `grouped`, or stop promising it.
6. What the funnel events are, and where a "memory size" number lives so week 6 can be
   compared with week 1 at all.
