# Five demo scenarios, any one, any order

Draft 2026-09-08. Replaces the flow chain in `docs/demo-flows.md` section 3 and the runbook script in
`docs/demo-runbook.md`. The machinery in `docs/demo-mode.md` stays as it is; this adds to it.

The ask: pick any of five scenarios, show one or all of them, in any order, with no scenario depending on
another. Today the demo is one chain. Flow 2 quotes the decision Flow 1 approved, Flow 4 needs Flow 1 and
Flow 3, Flow 5 summarises 1 to 4, and Flow 1 is what closes `SCH-231` in the fake Jira.

Write your call under **Decision** ("build", "skip", "discuss…"). Nothing gets built until its Decision field
is filled in.

---

## The three dependencies, and what each one costs to cut

**1. Story.** Flow 4's answer names people that Flows 1 and 3 wrote about. Fix: give each scenario its own
subject matter and seed every precondition in `vault-dev/`. The vault is already rich enough for most of it.
`todos/reply-marcus-swap-eta.md` and `todos/tell-fjord-sports-payroll-timeline.md` both read fine with no
Flow 1. Content work, not code.

The 2026-09-08 recordings measure it. Counting the dated file paths inside each flow's recorded tool calls,
and asking which of them exist in the seed:

| Flow | Dated paths it touches | Not in the seed | What it needs another flow to have made |
|---|---|---|---|
| 1, drop the transcript | 7 | 4 | nothing, it makes them |
| 2, commitment check | 4 | 3 | `decisions/…-h2-order-swaps-first`, `meetings/…-steering` |
| 3, paste the thread | 1 | 1 | nothing, it makes it |
| 4, who needs to know | 3 | 2 | `meetings/…-steering` |
| 5, weekly update | 3 | 2 | `decisions/…-h2-order-swaps-first`, `meetings/…-steering` |

Flow 3 is the only one that already stands alone. Flows 2, 4 and 5 each read at least one file that exists
only because flow 1 ran, and a recorded tool call naming a file that is not there fails on stage.

**2. Vault and tracker state.** Flow 4 wants `SCH-231` Done. Flows 1 and 2 want it In Progress. One vault
cannot be both. Until 2026-09-08 the fixture step `sch-231-done` carried `after: "first-write"`, so approving
Flow 1's first outbound card closed the epic. That was the hard coupling, and it is deleted (see below).

**3. Replay.** `replay-matcher.ts` compares the user side of the conversation, which includes tool results
read from the vault. A scenario that runs after another one reads a changed vault, the prefix stops matching,
and `MIN_PREFIX_RATIO` drops the run onto the fallback line partway through. Recorded tool calls are worse:
a recorded patch carries the exact old text, so a write into a file another scenario already changed fails.

So the promise has two halves. The content is recut so the five scenarios touch different things, and a
**Start** button per scenario guarantees the start state whatever happened before it.

---

## The five scenarios

One base vault. Each scenario is a trigger, a start state, and a payoff. None of them reads or writes what
another one produced.

### S1. The meeting produced actions

**Do:** drag `steering-h2-priorities.vtt` onto the window.
**Start state:** the base vault.
**Payoff:** a meeting page, a decision that supersedes `decisions/2026-05-18-h2-order-payroll-first` with the
offline-mode refusal on it, owned todos for Rebecca and Henrik, and three outbound cards (a comment on
`SCH-118`, a new `SCH` story for swap notifications, a patch to Roadmap H2).
**Owns:** the shift-swaps ordering, the H2 decision, `SCH-118`.
**Change from today:** it stops closing `SCH-231`.

### S2. I promised a date

**Do:** open Todos, "Tell Fjord Sports the payroll-export timeline" is overdue, click **Help me handle this**.
**Start state:** the base vault.
**Payoff:** `commitment-check` answers from the record. `PLT-77` blocks `SCH-125`, so the connector cannot
start yet; Oskar was told Q4 on the May call and asked whether that means October or December. A CS-voice note
he can send, and a card that logs what Fjord Sports was told.
**Owns:** payroll export, Fjord Sports, `SCH-125`, `PLT-77`.
**Change from today:** this is Flow 6 promoted. It carries the "PO as human API" beat that Flow 2 carried,
using the same skill, without needing Flow 1's decision.

### S3. The support thread

**Do:** copy `support-thread-brunos.md` and paste it into Home's bar.
**Start state:** the base vault.
**Payoff:** an insight on the shift-swaps theme with the thread as evidence and Bruno's as the customer, an
update to the Bruno's page, a comment on `SCH-231`, and a todo for Ulrika to tell Bruno's when it ships.
**Owns:** Bruno's Burgers, the March support thread, `SCH-231`'s comments.
**Change from today:** none.

### S4. Who needs to know

**Do:** type one sentence in Home: *"The approved-hours CSV export shipped. Who needs to know, and what do I
tell them?"*
**Start state:** the base vault. `SCH-121` is already Done in the seed, shipped 2026-06-24.
**Payoff:** each person with what they were told and when, all of it seeded: Fjord Sports were told Q4 on the
May call, Café Nord heard about payroll at the QBR, Jonas needs a support macro, and Kaffekopp churned last
year after asking for something that had already shipped. CS-voice messages, cards that log what each was told.
**Owns:** `SCH-121`, the customers' payroll expectations, Jonas.
**Change from today:** it moves off `SCH-231` onto `SCH-121`. That removes the dependency on S1 and S3, and
the story gets stronger rather than weaker. The thing shipped three weeks ago and
nobody told the customers who asked for it. That is the churn incident the research is built on.

**Decision (S4's subject):**

_Alternative: keep `SCH-231` and give S4 a start state that ships it Done. That brings back a mechanism just
deleted, S4 then always needs its Start button, and running S1 after it shows a roadmap argument about an epic
that is already finished._

### S5. The Friday update

**Do:** type `/` in Home, pick **Write the weekly update**.
**Start state:** the base vault.
**Payoff:** three drafts, one per audience: exec for Åsa, CS for customers, sales for Marcus. Everything in
them comes from the seeded week.
**Owns:** the weekly update page, the three voices.
**Change from today:** the recorded drafts cite only what the seed holds. They never say "the decision you
approved a minute ago".

**What is left over:** `todos/reply-marcus-swap-eta.md` stays in the vault as texture. It is what makes the
Todos list look lived in. It is not a scenario of its own, because S2 already shows that skill.

**Decision (the five):**

---

## Already done (2026-09-08)

**The scripted steps are deleted.** Settings → Demo had a "Script steps" section with two buttons that moved the
fake Jira on cue, and `sch-231-done` also fired on its own through `after: 'first-write'` when the first Flow 1
card was approved. Both were dependencies of the kind this doc removes. Gone: the Settings section, the
`demo:applyStep` channel and `DemoStepDTO`, `DemoInfo.steps`, `DemoService.steps()/applyStep()`, and the whole
step engine in `fake-atlassian.ts` (`FakeStep`, `FakeChange`, `requires`, `after`, `appliedStepIds`,
`applyAutoSteps`). The fixture was rebuilt without them. `pnpm test`, `check-types` and `lint` are green.

**A first take is recorded.** 36 files, all five flows, every conversation ending cleanly, no key or address
in any of them. Usable, not the keeper: flow 4's premise contradicts the tracker and the run needed three
answers to get past it (`docs/demo-runbook.md` lists them).

**The replay date shift was broken and is fixed.** It slid by the vault's whole offset from the anchor
instead of the distance from the record day, and it slid file paths as well as prose. All 89 date-bearing
paths in the recorded tool calls resolved to nothing, on every demo day including the record day. Now
`replay-dates.ts` masks paths and wikilinks, each recording carries the `offsetDays` it was made at, and the
server slides by the difference. All 89 resolve at offsets 0, 12 and 65. Two tests added, 534 green.

**The cold replay found a second one.** Both drops opened with the same sentence, so nothing on the
user side separated flow 1 from flow 3 at their first turn, and the tiebreak served flow 3's answers
to flow 1's transcript. The arrival kickoff now names the files it hands over, so the two
conversations differ from the first message. The two arrival recordings have to be made again.

This is also the second argument for DS-3. A pinned scenario would have had one arrival recording in
scope and could not have picked the wrong one, whatever the prompts said.

---

## The build

### DS-1. A scenario registry

**What:** the five scenarios as data, so the app, the runbook and the recorder read the same list.

**Change:** `demo/scenarios.json`, one entry each: `id`, `title`, the one line the presenter does, the sample
file it needs, and the recordings folder. Loaded by `DemoService`.

None of the five needs a tracker state the base fixture does not already have, so there is no start-state field.
If one turns out to need it, it comes back as something the scenario declares, not as a button.

**Decision:**

---

### DS-2. Recordings, one folder per scenario

**What:** re-recording one scenario must not touch the other four. Today a bad take costs the whole hour.

**Change:** `demo/recordings/<scenario-id>/*.json`. `_fallback.json` stays at the root.
`loadRecordings()` walks one level of subfolders and tags each recording with its scenario id. Files at the
root still load, so nothing existing breaks.

**Decision:**

---

### DS-3. A pinned scenario

**What:** the replay server knows which scenario is running, so it never answers from another one's
recordings.

**Change:** `demo:startScenario(id)` pins it. The matcher searches only that folder. Nothing pinned means
search everything, which is what a build with no Start pressed does today.

**Decision:**

---

### DS-4. Inside a pinned scenario, match on typed messages only

**What:** the fix that makes order stop mattering. Once the scenario is pinned, the field is small enough that
tool results add nothing to identification, and they are the thing that drifts.

**Change:** with a scenario pinned, `matchRequest` compares only the messages a person typed and uses the turn
index for the rest. With nothing pinned, today's rule stands (`MIN_PREFIX_RATIO`, tool results compared).

**Risk to name:** the recorded assistant turns carry tool inputs, and a recorded patch holds the exact old
text. If another scenario changed that file, the write fails on stage even though the match held. The disjoint
content is what prevents it; the Start button is what guarantees it.

**Decision:**

---

### DS-5. Start scenario: reset, then set the state

**What:** one button that puts the install at that scenario's start line, whatever the last demo did.

**Change:** `startScenario(id)` runs `DemoService.reset()`, pins the scenario, reopens the workspace. It is
today's `reset()` plus one line.

**Decision:**

---

### DS-6. Settings → Demo shows the five

**What:** five rows, each with its title, its one line, and **Start**. Underneath, **Reset** as it is today.

He opens this in front of customers, so it reads as a page of the app, not a debug panel. A row says what he
does ("drag the steering transcript onto the window"), not what the app does.

**Decision:**

---

### DS-7. Record one scenario at a time

**What:** `QALE_DEMO_RECORD=1 QALE_DEMO_SCENARIO=s3 pnpm desktop`. Press Start for that scenario, run it,
quit. The turns land in `demo/recordings/s3/`.

**Change:** the recorder takes the scenario id and writes into its folder. `QALE_DEMO_SCENARIO` is dev-only,
like every other `QALE_*` variable.

**Why it matters most:** a scenario is 5 to 10 minutes. A bad take costs 10 minutes, not an hour. A merge from
`main` that changes one skill costs a re-record of the scenarios that use it, not all of them.

**Decision:**

---

### DS-8. The content recut

**What:** the edits the five scenarios need in `vault-dev/`, the fixture and the samples.

1. ~~Drop the scripted steps.~~ Done 2026-09-08, see below.
2. Check `customers/fjord-sports.md`, `people/oskar-lind.md` and `insights/fjord-sports-expects-payroll-q4.md`
   carry enough for S2 to answer without S1.
3. Give S4 what it needs on `SCH-121`: what each customer was told about payroll and when, on the customer
   pages, with dates.
4. Rewrite `demo-samples/README.md` as five cards, one per scenario, in no order.

**Decision:**

---

### DS-9. The runbook

**What:** `docs/demo-runbook.md` becomes five short recording sessions instead of one chain, and the
cofounder's page becomes "pick the ones you want".

**Decision:**

---

## What this does not fix

- **Off-script questions.** DM-6 still answers with the fallback line. Pinning a scenario makes that more
  likely, not less: a question that would have matched another scenario's recording no longer can.
- **Merges from `main`.** Recordings still go stale when a skill or a prompt changes. DS-7 makes the re-record
  cheaper, not unnecessary.
- **Two scenarios at once.** One is pinned at a time. Running S1 and then S3 without pressing Start usually
  works, because they touch different files. It is not promised.

## Before any of this

The `demo` branch is mid-merge: `.git/MERGE_HEAD` is still there and six files sit at `UU`. The conflicts are
already resolved in the working tree, so everything builds and passes. The merge just needs committing.
