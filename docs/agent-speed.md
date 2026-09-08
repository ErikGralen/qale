# Agent speed: tickets

Status: written 2026-09-07 against the working tree, reviewed the same day by six readers
against the code. AS-1, AS-2, AS-4 and AS-5 built 2026-09-08 (see "Built" below). AS-3 was
dropped on a wrong premise. Nothing is committed and no model has run since the build. Tickets
were renumbered in the review: the stats script and the thinking level kept AS-1 and AS-2,
the rest moved.

**The problem.** Erik reports that one short meeting transcript, dropped into the app, takes up
to ten minutes before the proposals appear. The one run we measured took six. That run (pi
session `2026-09-07T17-57-27-784Z_*.jsonl` under `Qale Demo Dev/sessions/`, since deleted by
`pnpm refresh-demo`) took 368 seconds over 22 model calls. The model wrote 32,321 output
tokens on `claude-sonnet-5`. 21,376 of them (66%) were thinking. The rest, 10,945 tokens, is
the proposals and the prose. The worst single turns were 59 seconds and 4,889 thinking tokens
to emit one `file_source` call, 55 seconds and 4,488 thinking tokens for six `vault_read`
calls, and 45 seconds and 3,930 thinking tokens for one `vault_list` call. The first proposal
reached the screen five minutes in.

Throughput was 88 tokens per second, measured per turn from the message timestamps in that
file, and 88 to 98 on other Sonnet runs on disk. 32,321 tokens at 88 a second is 367 seconds,
so the model's writing accounts for the wall time within the error of the measurement. The
stats script (AS-1) now prints the residual, wall time minus the sum of the per-turn model
time, and on the first run it measured the residual was 0.0 seconds. So on that one run,
nothing outside the model cost time. One run is a measurement, not a proof across runs, and
the residual is printed every time so it stays measured.

**The gap between six minutes and ten.** The measured run asked no question. An unattended
arrival that does ask parks on a card and waits for a human with no timeout. That is not a
defect (the question is on Home, see AS-3), but it is time the PM reads as the run being slow.
The maintenance tick also fires at least once during a six-minute run and puts up to 25 cheap
model calls and possibly a second agent session on the same key (AS-4). Neither shows up in
the token counts. AS-1 reports every `ask_user` gap; it cannot report the tick, because the
app writes no log file.

**The cause of the six minutes.** `createSession` and `runChild` in
`packages/agent/src/runtime.ts` call `createAgentSession` without a `thinkingLevel`. pi then
uses its default, `medium` (`core/defaults.js:1`), and every session file under every `Qale*`
userData folder logs `{"type":"thinking_level_change","thinkingLevel":"medium"}` at creation
and nothing else. So every session and every fan-out child thinks at medium on every turn,
including a turn that only lists a directory. The rest goes on reading (113 seconds, 20
`vault_read` calls, 13k thinking tokens) and on writing ten proposals one turn at a time (84
seconds over five turns).

**The floor.** The tickets on thinking and turn count cannot go below the 10,945 tokens of
proposals and prose, which is about 124 seconds at 88 tokens a second. No version of this plan
reaches one minute. Getting there needs a faster model (AS-6) or fewer proposals (AS-7), and
both are decisions, not physics.

**The goal.** Time to the first proposal, not total wall time. That is the number the PM
feels. Today it is about 300 seconds. The joint target of AS-2, AS-5 and AS-8 is under 90.

**How to use this doc.** Same convention as critical-mass and index-maps: one ticket per thing,
in implementation order, your call under **Decision**, what landed under **Notes**. Every
ticket says what it buys in seconds off the 368-second run, what it costs in debt, and whether
it can be built blind or needs a live model run. Nothing here can be proven by unit tests
alone, so AS-1 comes first and every later ticket is measured with it.

## Built 2026-09-08

AS-1, AS-2, AS-4 and AS-5 are built. AS-3 was dropped: the surface it asked for already
exists, and the rule it offered fights docs/fewer-approvals.md. `pnpm test` passes in 8 of 8
packages with 0 failures (`packages/vault` skips 12 tests on the known better-sqlite3 ABI
mismatch, which predates this work). `pnpm check-types` passes 11 of 11. Nothing is committed.
Nothing is live-verified: no model has run since the build, so no ticket's speed claim is
tested, and the `medium` baseline that AS-2's quality check compares against does not exist
yet. The four tickets landed before the baseline they are meant to be measured against.

Where the build corrected the tickets:

1. **The stats script reads pi's `parseSessionEntries`, not `loadEntriesFromFile`.** The
   latter is declared but not reachable: pi's `exports` map publishes only `.` and
   `./rpc-entry`. Same parse, no hand-rolled JSON.
2. **There is no maintenance tick column.** The app writes no log file
   (`apps/desktop/src/main/log.ts`: console plus a small in-memory ring buffer), and no
   logging was added. AS-4's effect has to be checked by comparing the residual on drops that
   span a tick against drops that do not.
3. **The thinking level is scoped by skill, not by flags.** The trigger never reaches the
   runtime, and the first look sends the same flags as a drop. `thinkingLevelFor({ skill,
   scheduled, unattended })` gives `low` only when the skill is `arrival` and the run is
   unattended or scheduled. Fan-out children get `low`. Everything else stays `medium`.
4. **The maintenance pause is scoped by skill too.** `trigger: 'arrival'` also covers the
   first-look debrief and the supersede reaction, so `runInFlight(ARRIVAL_AGENT_NAME)` is the
   guard.
5. **The skill copy fixed a contradiction the ticket missed.** "Check what it claims" opened
   with "Before you propose anything from a source", which would have fought the new File
   rule. It now uses the same phrase as the tool description.

Real output from the stats script on a real 87.7-second session: 10 model calls, 6,693 output
tokens, 2,319 thinking (35%), residual 0.0 seconds, setup 4.5 seconds. On a chat that had
parked on a question it reported a 311-second answer gap and a 99% residual from the chat
sitting open between turns, which is the shape a slow drop would have if it asked.

Owed: `pnpm refresh-demo`, a `medium` baseline captured and copied out of the sessions folder
before the refresh deletes it, then three drops at `low`. See Order.

---

## What is already right, so nobody re-litigates it

- **Tool calls already run in parallel.** pi defaults to `toolExecution: "parallel"`
  (`pi-agent-core/dist/agent-loop.js:287-294`). Only `ask_codebase` declares `sequential`
  (`codebase.ts:281`). The model does batch (six `vault_read` calls in one message in the
  measured run). Nothing to win here, and one thing to be careful of (AS-5).
- **Source drops already pick the fast model.** `sourceModelId` in
  `packages/domain/src/models/index.ts` opens the tray on the provider's second row, which is
  Sonnet. Opus measures 50 to 79 tokens a second. Chats open on Opus, and that is right for a
  conversation.
- **The prompt is cached.** About 40k tokens (13k of system text, 27k of tool schemas for 41
  tools) come back as `cache_read_input_tokens` on every turn.
- **One run per drop.** All 22 model calls happen inside one `session.prompt()`
  (`runtime.ts:2017`), nothing awaited between them.
- **Nothing runs twice.** The session namer is gated on `!input.scheduled && !input.unattended`
  (`runtime.ts:1985-1987`), so a drop never names itself. `runSummaryPass` is a separate tick,
  not part of the arrival session (but see AS-4).
- **Card copy is deterministic.** `domain/src/proposals/card-copy.ts` writes every card; no
  model call is spent on it.
- **IPC costs zero.** `fireSession` passes `() => {}` as the emit callback
  (`handlers.ts:1055`), so an arrival run streams nothing to the renderer.
- **The index is not a cost.** `reindex` in `packages/vault/src/sqlite-index.ts:165` is
  synchronous, incremental and sub-millisecond. The watcher is debounced 450 ms and excludes
  session working files (`watcher.ts:55, 95`).
- **`check_claims` and the namer already think nothing.** Both go through `completeCheaply`
  (`runtime.ts:1139`) to `completeSimple`, which passes no `reasoning`. `ask_codebase` runs
  the `claude` binary and has no pi thinking level at all. Nobody needs to "fix" them.

**Where the tool boundaries do cost time.** "Every gap is 0.0 seconds" is close, not exact:

- `check_claims` runs up to 8 Haiku lookups across 4 lanes (`claims.ts:551`), each after
  `gatherScope` reads up to 6 notes. Real seconds inside one boundary.
- Every write commits. `commitPaths` (`packages/vault/src/git.ts:317`) spawns one `git add`
  per path, then `git status`, then `git commit`, awaited inside the tool. `file_source` with
  `attach_to` commits twice (`notes.ts:180, 240`). A full drop runs roughly 25 to 45 git
  processes, about 1 to 2.5 seconds in total.
- `createSession` awaits `resolveSkill`, `houseRules`, `skillIndex`, `listVoices`,
  `vaultMap`, `tagsSeed` and `movedSeed` before the first model call. The last one runs
  `git log --since=7.days --name-only` over the whole vault (`runtime.ts:1542`,
  `git.ts:279`). Tens to a few hundred milliseconds, growing with history. AS-1 prints it
  once; it does not earn a ticket.
- A small fix, not a ticket: `headCommit` runs `git log --follow` over a file's whole history
  only to take element zero (`proposals.ts:243-248`, `git.ts:181-208`), inside every silently
  applied proposal. It gets slower every week. `-n 1` fixes it.

---

## AS-1. The stats script: numbers from the session file

**Today:** every number above came from reading a pi session file by hand. Nothing in the
repo prints them, so a change to the thinking level or the skill copy cannot be checked
except by feel.

**Change:** one pure function, one script, one package entry.

- `packages/agent/src/session-stats.ts`: `sessionStats(entries)` takes the entries pi's own
  `loadEntriesFromFile(filePath)` returns (`session-manager.d.ts:169`), the same shape
  `entriesToUiMessages` in `history.ts:46` already consumes. No hand-rolled JSON parsing. It
  returns:
  - wall time, model calls, output tokens, thinking tokens (`usage.reasoning` per assistant
    message) and thinking as a percentage of output;
  - throughput per turn from the message timestamps, and the residual: wall time minus the
    sum of the per-turn model time. This is the number that says whether anything outside
    the model costs time;
  - time to the first `propose_*` call, and the count of `propose_*` calls by kind;
  - the time after the first proposal (wall time minus time to first proposal), so AS-9 has a
    measurable trigger;
  - whether the run parked on an `ask_user` card, and for how long (AS-3);
  - the five slowest turns with their thinking counts;
  - the time between the first user message and the first model call (the `createSession`
    cost above).
- `scripts/session-stats.ts`: finds the newest session file in a sessions folder (default:
  the demo dev userData, override with a path), reads the app log for maintenance tick times
  in that window (AS-4), and prints the table. Add a `session-stats` entry to the root
  `package.json` in the form every other script uses (`node --disable-warning=... scripts/
  session-stats.ts`), so it runs as `pnpm session-stats`. `pnpm tsx` does not work here: the
  root has no `tsx`, and the header comment in `refresh-demo.ts` that says otherwise is wrong.
- The package entry: `packages/agent/package.json` exports only `"."`, and its
  `comment:exports` field describes a `./slots` exception that was deleted. Give the parser its
  own subpath, `"./session-stats"`, so nothing that imports `@qale/agent` (the Electron main
  bundle included) drags it in. Rewrite the stale comment. Add `@qale/agent` as a root
  dependency and run `pnpm install`. This is a first: no script in `scripts/` imports a
  workspace package today.
- The recipe, as a comment at the top of the script: `pnpm refresh-demo`, open the runtime
  demo vault, drop `demo-samples/` transcript number one, wait for the run to end, `pnpm
  session-stats`. Same fixture every time, so the runs compare. `refresh-demo` deletes every
  session file in that folder, so copy a reference run somewhere safe before refreshing if you
  want to reproduce a number later.

Not automated: the drop. Driving the app headless needs a vault, settings and a key
bootstrapped outside Electron, and the app already does all of that.

**Done when:** the script prints a full table for whatever fixture run is on disk when it is
built, and the test in `packages/agent/test/session-stats.test.ts` checks every field against
a fixture built with pi's `SessionManager.create()` and `.appendMessage()`, the way
`history.test.ts:29-49` does. Not a hand-typed session file: a typed one drifts from pi's real
shape, and that shape is the one thing the parser must not get wrong.

**Buys:** 0 seconds. It is what makes every other ticket checkable.
**Debt:** low. One pure function, one script, one export subpath, one root dependency.
**Build blind:** yes.

**Decision:** build.

**Notes:** Built 2026-09-08. `packages/agent/src/session-stats.ts` behind a new
`"./session-stats"` export subpath, `scripts/session-stats.ts`, a `session-stats` entry in
the root `package.json`, `@qale/agent` as the first root dependency for a script, and the
stale `comment:exports` rewritten. Six tests in `packages/agent/test/session-stats.test.ts`.

Two things differ from the ticket. `loadEntriesFromFile` is declared in pi's
`session-manager.d.ts` but not exported from the package root, and importing it throws. The
parser reads the file and hands the text to pi's exported `parseSessionEntries`, which does
the same parse. And there is no maintenance tick column: the app writes no log file
(`apps/desktop/src/main/log.ts`), and none was added. AS-4 has to be checked another way.

First real output: an 87.7-second session, 10 model calls, 6,693 output tokens, 2,319
thinking (35%), residual 0.0 seconds (0% of wall time), setup 4.5 seconds. Against a workspace
file with proposals it reported the first proposal at 109.7 seconds and 87.4 seconds after
it. Against a chat that had parked on a question it reported a 311-second answer gap and a
99% residual.

---

## AS-2. Set the thinking level, and lower it for a source drop

**Today:** neither `createAgentSession` call passes `thinkingLevel`. Qale passes
`SettingsManager.inMemory()` (`runtime.ts:1732`, `:2441`), so pi falls through to `medium`
(`sdk.js:121-123`). For `claude-sonnet-5` and `claude-opus-5` (both `forceAdaptiveThinking`)
pi maps the level to an effort sent as `output_config.effort` beside `thinking:
{type:"adaptive"}` (`anthropic-messages.js:597-611, 766-776`): `minimal` and `low` -> `"low"`,
`medium` -> `"medium"`, `high` -> `"high"`. `off` sends `thinking: {type:"disabled"}`.
`session.setThinkingLevel` is public and clamps to the model (`agent-session.js:1275-1294`).

**Change:** one function and two call sites, scoped to the arrival run and the fan-out child.

- `thinkingLevelFor({ scheduled, unattended })` in `runtime.ts`, beside `startedByNobody`
  (`runtime.ts:798`), which already takes that shape. Typed as `'low' | 'medium'`, importing
  nothing: `ThinkingLevel` is not importable (`pi-coding-agent` exports only
  `ThinkingLevelChangeEntry`, pi-ai's copy has no `off`, and the full union lives in
  `pi-agent-core`, which `@qale/agent` does not depend on).
- Both `createAgentSession` calls pass a level. The arrival session gets `low`; `runChild`
  passes `low` for every child.
- The level is chosen per run from the `unattended` and `scheduled` flags the run already
  carries (`runtime.ts:1958-1961`). `run()` calls `session.setThinkingLevel` immediately after
  `applyModel`, not before: `setModel` re-clamps the level itself (`agent-session.js:1194-1205`),
  so a call before it would be overwritten by a model switch.
- A PM who answers a parked `ask_user` card does not change the level. `askThePm` parks inside
  the tool call (`runtime.ts:1622`), so the answer resumes the same run. Only a new message
  through `agent:run` (`handlers.ts:2557`) starts a run with the flags cleared, and that run
  gets `medium`.
- One caller has a hole: `fireSupersedeReactions` (`handlers.ts:2375`) fires a librarian run
  with `{ trigger: 'arrival' }` and neither flag, so it reads as a chat. Add `unattended:
  true` there. Every other call site carries a flag (`handlers.ts:357`, `:466`, `:1146`,
  `:2271`, `scheduler-service.ts:77`; `scheduler-service.ts:53` is "Run now", correctly a
  person).

**Scope.** `low` lands on the arrival run and the fan-out child, and nowhere else in this
ticket. The quality check below covers three arrival outcomes and nothing else. A librarian
that files a little worse degrades silently and looks exactly like nothing happening. Widening
`low` to the librarian, the first look and the meeting sweep is a separate decision:

**Decision (widen to the other unattended runs):**

**Why `low` and not `off`.** Extraction quality is the product, and `off` is a different
product. There is also a request-shape reason: `off` disables thinking while the history still
carries signed thinking blocks. `low` and `medium` are the same adaptive request with a
different effort, and `convertMessages` replays thinking blocks with their signature whatever
the current level (`anthropic-messages.js:838, 896-935`), so switching between them is safe.
One more fact: `minimal` and `low` both map to effort `"low"`, so on Sonnet there is nothing
between `low` and `off`. If `low` disappoints, there is no cheaper knob. The fallback is
`medium`, and AS-5 and AS-8 carry the win.

Not a skill frontmatter field. `KNOWN_KEYS` in `packages/sessions/src/runnable.ts` is six keys
on purpose and every unknown key is flagged on the Skills page. A thinking level is plumbing
about a run, not a fact about the skill.

**Google provider:** both shortlist models are reasoning models in pi's catalogue, and pi maps
the level through each model's `thinkingLevelMap` (`providers/data/google.json`,
`api/google-generative-ai.js:239-250`). `gemini-3.6-flash` sends `LOW`. `gemini-3.1-pro-preview`
has no `LOW`-to-`HIGH` middle: `medium` clamps up to `HIGH`, which is what already happens
today, and `low` sends `LOW`. The effect on a Gemini run is unmeasured.

**Quality check, which is the whole risk:** the `medium` baseline is whatever AS-1 recorded
before this lands. Three new drops of the same fixture at `low`. Compare proposal count by
kind, then read the proposals. The three things that must not get worse: the transcript
matches the right calendar meeting, every "I'll do X" becomes a todo with the verbatim quote,
and each decision names its decider. If `low` loses one of those, the arrival goes back to
`medium` and this ticket keeps only the explicit default and the child level. Say which in
Notes.

**Files:** `packages/agent/src/runtime.ts` (both `createAgentSession` calls, `run()` after
`applyModel`, `thinkingLevelFor`), `apps/desktop/src/main/handlers.ts:2375`,
`packages/agent/test/` (a test for `thinkingLevelFor`).

**Done when:** a fresh drop (not a reopened chat: resuming a session file writes no row unless
the level changes, `sdk.js:232-237`) logs `"thinkingLevel":"low"` at creation, a chat logs
`medium`, and the stats script shows the thinking count on the fixture.

**Buys:** 100 to 160 seconds on the measured run, where thinking was 66% of output. That is the
top of the range on disk: the nine sessions there sit at 9, 20, 20, 22, 28, 37, 43, 59 and
66%. A run with less thinking buys less. Measure it.
**Debt:** medium. It adds a concept the codebase does not have (a thinking level), a mapping
from run kind to level, and a second per-run settings path beside `applyModel`.
**Build blind:** the plumbing, yes. The number and the quality check need live runs.

**Decision:** build, scoped to the arrival run and the fan-out children. The widening
decision above stays open.

**Notes:** Built 2026-09-08. `thinkingLevelFor({ skill, scheduled, unattended })` in
`runtime.ts`, exported, beside `nobodyStarted`. A local `type ThinkingLevel = 'low' |
'medium'`, importing nothing; all three type sources were checked and the ticket's reasoning
held.

The scope is by skill, not by flags, and that corrects the ticket. `fireSession` builds
`RunInput` from `scheduled`, `unattended`, `automatic`, `modelId` and `skill`, and keeps
`trigger` in its own `sessionRuns` map, so the trigger never reaches the runtime. The first
look (`handlers.ts:357`) sends flags identical to a drop. Scoping by flags would have put the
first look on `low`, which the scope section forbids. So `low` needs `skill ===
ARRIVAL_AGENT_NAME` and `scheduled || unattended`. No new concept was added.

The level goes to `createAgentSession` only for a new session file. On a resume pi restores
the level from the file's last row, and pi appends nothing at creation when a
`thinking_level_change` row already exists, so passing it again would leave that row stale.
`run()` then appends a change row if the level differs. `runChild` passes `low` for every
child. `setThinkingLevel` runs immediately after `applyModel`, with a comment on why the order
matters. A comment in `completeCheaply` says it is not a session and has nothing to lower.
`fireSupersedeReactions` now passes `unattended: true`; its skill is `librarian`, so its
level stays `medium`, as intended.

Five tests in `packages/agent/test/thinking-level.test.ts`: a drop gets `low`, the PM writing
back gets `medium`, the first look, the librarian and the meeting sweep get `medium`, a chat
gets `medium`, and the result is never `off`.

Not verified: no drop has run at `low`. The quality check is owed, and the `medium` baseline
it compares against has to be captured first.

---

## AS-3. An unattended arrival can wait forever on a question (dropped)

Dropped 2026-09-08. The ticket assumed a parked question is invisible, and it is not. The
reasoning is kept below because it is worth having written down.

**Today, as the ticket read it:** `askThePm` short-circuits only on `scheduled` (`ask.ts:670`). A drop passes
`unattended: true`, not `scheduled` (`handlers.ts:2270`), so `ask_user` writes a card and
returns a promise that settles only when the PM answers, skips, or stops the run. No timeout.
The arrival skill invites a question in five places:

- the meeting match ("ask with the candidates and 'a new meeting' as options");
- a meeting that may not be theirs ("If that is not clear, ask");
- a person with no page ("ask before creating one");
- a claim conflict ("can earn one short question");
- a decision with no clear decider ("ask before drafting").

So a run that asks anything waits for a human, and no thinking level makes it faster. The
measured run asked nothing. A run that did would read as "ten minutes" and leave no trace in
the token counts. AS-1 prints whether a run parked and for how long, which settles whether
this is Erik's case.

**Two ways to fix it, and this doc does not pick:**

1. **A surface.** A parked arrival question becomes a row on Home that cannot be missed, with
   the card one click away. The run still waits, but the wait is the PM's and is visible.
   Needs a Home row, an IPC event, and a place in `first-steps`/"Waiting on you" (docs/home.md).
   Medium debt.
2. **A rule.** The arrival skill says: on a run nobody is watching, file the best guess, say
   what was assumed in the proposal's rationale ("Assumed:"), and ask nothing. The
   UNATTENDED_RULES in `prompts.ts:405` already carry the "Assumed:" convention and a budget of
   two questions; this sets the arrival's budget to zero. Instructions over machinery, costs
   nothing to build, and the PM corrects the assumption on the card in the same pass. The risk
   is a transcript filed against the wrong meeting when two candidates fit, which the card's
   "Based on" line has to make obvious.

**Files:** option 1: `apps/desktop/src/renderer` (Home), `packages/ipc`, `handlers.ts`.
Option 2: `packages/sessions/src/defaults.ts` and `vault-dev/skills/arrival/SKILL.md`, which
must move together, and `prompts.ts` if the budget line moves.

**Done when:** on a fixture whose transcript fits two calendar candidates, the run either
ends with a proposal carrying "Assumed:" (option 2) or the parked question is on Home within a
second of being asked (option 1).

**Buys:** 0 seconds on a run that never asks. Up to the whole wait on a run that does. Unknown
until AS-1 says which runs park.
**Debt:** option 1 medium, option 2 none.
**Build blind:** option 1's plumbing, yes. Option 2 needs a live run.

**Decision:** drop it, and measure first.

**Notes:** Not built. Both options fell to facts the ticket missed.

Option 1 already exists. `buildAttention`
(`apps/desktop/src/renderer/src/lib/attention.ts:234-256`) ranks parked questions first,
keyed by session id, and `waitingOnYou` (`attention.ts:160`) puts them in Home's "Waiting on
you" list. An arrival's question is not `offered`, so it shows in brand tone, not muted.

Option 2 fights docs/fewer-approvals.md, which has shipped. That work replaces approval cards
with questions on purpose, and bounds an unattended run at two asks. It also put this line
into the `ask_user` description: "Asking is cheaper than a wrong write and cheaper than a
card, so ask when a five-second answer settles it." A rule that arrival asks nothing would
undo that for the flow most cards come from.

AS-1 now reports every `ask_user` gap, so a few real drops will say whether slow runs park at
all. If they do, the follow-up is smaller than either option here. After a drop the PM is
looking at the tray or the session, not Home, so the arrival's own progress surface should say
"waiting on your answer" instead of reading as work in progress. That is the shape of the
follow-up, not a ticket to build now.

---

## AS-4. Pause the maintenance tick while an unattended arrival runs

**Today:** `MAINTENANCE_TICK_MS = 5 * 60 * 1000` (`apps/desktop/src/main/agents.ts:23`). A
368-second run spans at least one tick. `runMaintenance` (`handlers.ts:368`) then awaits, in
order:

- connector sync;
- `normalizeVaultFrontmatter`, writes plus a commit;
- the first-look debrief, which can fire a whole `tell-qale` session;
- the librarian scan, and a librarian session if 30 minutes have passed;
- `runSummaryPass`, a serial loop of up to 20 document calls plus 5 folder calls on Haiku
  (`packages/application/src/use-cases/summaries.ts:758-786`);
- `generateIndexFiles`, with another commit.

That is up to 25 serial cheap-model calls, and possibly a second agent session, on the same
API key, in the middle of the drop. pi cannot see it, so it is invisible in the session file.
It is also what would push an account into rate limiting, and rate limiting would make 88
tokens a second look like a property of Sonnet when it is a property of a busy account.

**Change:** one flag and one condition. While an arrival run is live (from `fireSession` with
`trigger: 'arrival'` to its `finish`), `runMaintenance` returns early. The guard shape already
exists: `maintenanceInFlight` at `handlers.ts:368`. The next tick after the run ends catches
up, which is what the tick already does after app open.

**Files:** `apps/desktop/src/main/handlers.ts`.

**Done when:** the stats script shows no maintenance tick inside the run window on the
fixture, and the tick after the run runs the summary pass as before.

**Buys:** maybe nothing, maybe tens of seconds. The stats script's residual and the tick times
say which. Even at nothing, it removes one variable from every later measurement.
**Debt:** low. One boolean, one early return.
**Build blind:** yes. The number needs live runs.

**Decision:** build.

**Notes:** Built 2026-09-08. One line in `runMaintenance` in `handlers.ts`, after the
existing `maintenanceInFlight` guard: `if (runInFlight(ARRIVAL_AGENT_NAME)) return
Promise.resolve();`.

Scoped by skill, not by trigger, and that corrects the ticket. Two other call sites fire under
`trigger: 'arrival'`: the first-look debrief (skill `tell-qale`) and the supersede reaction
(skill `librarian`). Following the ticket literally would have paused the tick for both. The
first-look debrief needs no exclusion anyway: it is only ever called from inside
`runMaintenance`, so the outer guard already covers it.

No new bookkeeping. It reuses the file's `sessionRuns` map and `runInFlight(skill)` helper.
`agent.onStatus`'s `settled` branch deletes the entry unconditionally, and `emitStatus(state,
'settled', ...)` fires from a `.finally()` in `runtime.ts` on every exit path, so the flag
cannot leak.

Not tested, and owed. `runMaintenance` lives inside `registerHandlers`, a 2,700-line closure
that imports `electron` at module scope, and no test imports `handlers.ts` for that reason.
`runInFlight` is an unexported closure. A real test needs a live Electron harness or a
refactor that pulls the logic into an injectable module. No test was written that would prove
nothing. The effect is also unmeasured: the stats script has no tick column (see AS-1), so the
check is the residual on drops that span a tick against drops that do not.

---

## AS-5. Skill copy: the meeting page first and alone, proposals together, bounded reading

**Today:** the arrival skill orders the work Read, File, Read what is worth reading, Check what
it claims, Produce. The model follows it: 113 seconds of reading, then `check_claims`, then
ten proposals over five turns. The first proposal lands five minutes in. Five turns of
proposals carry five turns of thinking at the top of each.

**Change:** three edits to the skill text in both copies, plus one tool description. This is
instructions over machinery: fix what the model reads, add no gate.

1. **The meeting page goes first, and alone.** The sentence that says so already exists, in
   `## File` (`defaults.ts:103-105`, `SKILL.md:55-57`), with a matching bullet in Produce
   (`defaults.ts:169`, `SKILL.md:123`). Both move above the claims check. The sentence also
   gains "on its own", and without that it would ship a bug. Proposals in one message run in
   parallel. `propose_todo` calls `validateEvidence` before its first `await`
   (`tools.ts:1818-1823`). `propose_meeting` reaches `ctx.proposals.create` only after two
   awaits (`tools.ts:1345, 1379`). So a todo citing a meeting page proposed in the same
   message always checks before the meeting's row exists, gets `unresolved evidence targets`
   (`domain/src/proposals/index.ts:503-506`), and is rejected. Ten proposals in one message
   is fine. Ten including the meeting page is a batch of rejections.
2. **The rest together.** Once the model knows what the source forces, it proposes it all in
   one message. What this removes is the thinking at the top of each extra turn.
3. **Bounded reading.** The root `index.md` is in the prompt (`runtime.ts:1298-1302`). The
   folder maps are not, and cost one `vault_read` each. The rule: open the folder maps first,
   then the pages the source names, five at the outside, and do not open a page to confirm
   what its map line already says. Keep only the bound and the "do not re-read" line;
   `SHARED_PREAMBLE` (`prompts.ts:23-28`) already says the rest, and a second copy of a
   shared rule drifts. Note that "five" now means two things in the file (`defaults.ts:127`
   says "Up to five pieces"), so the two sentences must not sit near each other.

The wording, checked against the file's own voice:

In `## File`, replacing `defaults.ts:103-105` / `SKILL.md:55-57`:

> Only the source files itself. Every page this session writes is a proposal, the meeting page
> included. Propose the meeting page first, as soon as you have read the source and the
> meetings map, and before you check the claims. Send it on its own and read the answer: the
> todos and the decisions cite the page it reports, and a citation only resolves once the
> meeting proposal has gone.

In `## Produce`, a new sentence after the first paragraph (`defaults.ts:150-152` /
`SKILL.md:103-105`):

> Once you know what the source forces, propose it all together rather than one at a time. The
> meeting page is the exception: it goes first, on its own.

In `## Read`, replacing the second paragraph (`defaults.ts:82-83` / `SKILL.md:34-35`):

> Then only the memory it touches. Open the `index.md` of each folder first: customers, people,
> meetings, research, decisions, and `tickets/` for any ticket it names. Then read the pages the
> source actually names, five at the outside. A one-line description in a map is enough to
> place a page; open the page only when what you write depends on the words in it.

In `claims.ts:569-570`, the tool description says "Call it once, after you have read the
material and before you propose anything from it". That reaches the model on every turn and
contradicts the reorder. Replace the end with "before you propose the todos and the decisions
from it". (`promptGuidelines` at `claims.ts:603` is dead on Qale's custom-prompt path,
`runtime.ts:1709`, so editing it changes nothing.)

**Why the reorder is safe.** A meeting page always waits for the PM: `meetings/` is the PM's
sphere (`policy.ts:108`), so `writePolicy` returns `ask` (`policy.ts:250-255`). `check_claims`
never asks the model to retract anything; a conflict comes back as a line plus the question
ration (`claims.ts:441-462, 470-490`). If a conflict lands on something already in the
write-up, `withdraw` (`tools.ts:2529`) covers it and `duplicatePending` does not block the
corrected re-proposal.

**One risk.** `propose_meeting` guards only its own exact slug (`tools.ts:1341-1346`). A
calendar page with a different title does not collide, so the model can propose a duplicate.
That is why the File wording says "and the meetings map" before the meeting page goes: the
map is read before the page is proposed, and the Read wording lists meetings among the folders
to open first. Edits 1 and 3 agree on that order.

**Reach.** `ensureDefaultSkills` (`handlers.ts:629`) seeds only what is missing
(`defaults.ts:47-49`). The copy change reaches new workspaces and the demo. An installed
workspace keeps its own arrival file until the PM edits it.

**Quality check:** same three things as AS-2, plus one: a todo proposed after the claims check
must not duplicate an existing todo. The todo bullet keeps "check existing todos first".

**Files:** `packages/sessions/src/defaults.ts`, `vault-dev/skills/arrival/SKILL.md`,
`packages/agent/src/claims.ts`. Run `pnpm refresh-demo` after, so the runtime vault carries
the new copy.

**Done when:** on the fixture, the first `propose_*` call is the meeting page, alone in its
message, and it lands before the claims check. The proposals after it arrive in one or two
messages, and none is rejected for unresolved evidence.

**Buys:** thinking averages about 970 tokens a turn, roughly 11 seconds. Five proposal turns
to two saves about 33 seconds, and that is the top of the range and only before AS-2 lands.
After AS-2 the marginal buy is 10 to 25 seconds. First proposal: this ticket alone moves it
from about 300 seconds to roughly 150 to 180. Under 90 needs AS-2 and AS-8 with it.
**Debt:** low. Two prose files and one tool description.
**Build blind:** no. Copy is only checkable by a live run against the stats script.

**Decision:** build.

**Notes:** Built 2026-09-08 in both copies of the arrival skill and the `check_claims` tool
description. The parallel-execution race was verified again before the wording went in.
`propose_todo` calls `validateEvidence` at `tools.ts:1819` before its first await at 1826.
`propose_meeting` reaches the row-creating `propose()` only at 1374. `resolves`
(`tools.ts:848`) accepts a citation only when the note is on disk or a pending card would
create it.

Wording that differs from the ticket:

- The Read paragraph says "the memory pages the source actually names", not "the pages", so
  its "five" cannot be read as the "Up to five pieces" of source three sections later.
- The File paragraph says "once that proposal exists", not "once the meeting proposal has
  gone", because "has gone" reads two ways.
- "Check what it claims" opened with "Before you propose anything from a source", which the
  ticket and the reviewers both missed, and which would have fought the new File rule and the
  new tool description. It now reads "Before you propose the todos and the decisions from a
  source", the same phrase as the tool description, so the model reads one wording in both
  places.
- The "Who was in it" bullet moved up with the meeting page bullet. It sets `participants` on
  the meeting proposal, and the proposal is refused without them, so leaving it under
  Commitments would have stranded it.
- The Produce bullet order is now: meeting page, who was in it, decisions, commitments, hub
  updates, external consequences.

`process-note` still says "Before you propose anything" and was left alone: it proposes no
meeting page, so there is no conflict.

Not verified: no drop has run on the new copy, and `pnpm refresh-demo` has not been run, so
the runtime demo vault still carries the old file.

---

## AS-6. Run the fixture on Haiku, and decide from the numbers

**Today:** the tray opens on Sonnet (`sourceModelId`). `claude-haiku-4-5` is already wired and
reachable: `CLAIM_MATCH_MODEL` (`claims.ts:55`) names it, and pi's catalogue routes it whatever
the picker shortlist shows. Haiku costs $1 in and $5 out against Sonnet's $2 and $10, and runs
faster. It is not adaptive; it uses a thinking budget. Nobody has run an arrival on it.

Two decisions live here, and they are not the same one:

1. **Run the fixture on Haiku three times** (and, on a Google workspace, on `gemini-3.6-flash`
   once). Not a product decision: it is a measurement, ten minutes each with AS-1 in place,
   and the only thing in this plan with a real chance of buying more than a minute, because
   it moves the 124-second floor.
2. **Put Haiku on the picker shortlist**, so `sourceModelId` picks it. That is a product
   decision, taken from the numbers in step 1 and a read of the proposals. The shortlist in
   `models/index.ts` is short on purpose, and its comment says why.

**How to run it:** the tray already accepts a model id (`arrival:ingest` takes `modelId`,
`handlers.ts:2160`). For the experiment, pass the Haiku id through whatever the tray's model
picker exposes, or through a one-line dev override. No code needs to change to measure.

**Quality check:** the same three arrival outcomes as AS-2, read by hand on three runs.
Haiku's likely failures are a missed decider and a paraphrased quote where the skill asks for
a verbatim one.

**Files:** for step 1, none. For step 2, `packages/domain/src/models/index.ts` and its test.

**Done when:** three Haiku runs are in Notes with their stats-script tables and a one-line
verdict on the proposals, and Decision says whether the shortlist changes.

**Buys:** unknown. If Haiku's throughput is roughly double Sonnet's, the floor halves and the
run could reach about 90 seconds after AS-2 and AS-5. If the proposals degrade, it buys
nothing and the answer is no.
**Debt:** step 1 none. Step 2 low: one row in a table.
**Build blind:** no.

**Decision:**

**Notes:**

---

## AS-7. Does a one-transcript drop need ten proposals?

**Today:** for one meeting the skill asks for all of this:

- decisions, with decider and reason;
- every commitment as a todo, with a verbatim quote;
- the meeting page, carrying the whole write-up and the participants;
- hub updates for actions, open questions and things not being done;
- `last_told` entries on the people pages;
- external consequences;
- tags.

Before that it asks the model to read the house rules list, check the customer and people
pages for anyone waiting, and read `skills/jira/SKILL.md` before drafting a ticket. The measured run produced
ten proposals and 10,945 tokens of visible output, about 124 seconds at 88 tokens a second.
AS-2 to AS-5 cannot go below that. This ticket can.

**The question:** if a one-transcript drop only needs the meeting page, the decisions and the
todos, the visible output roughly halves and so does the floor. The hub updates, the
`last_told` entries and the external consequences could wait for a later pass (the librarian,
or the PM asking), or could stay. This doc does not choose; it is the product deciding what a
drop is for.

**If the answer is fewer:** the change is skill copy in both files. The Produce section for "a
meeting you were in" keeps its first three bullets and moves the rest under a heading that
says when they apply (a drop with an instruction asking for them, or a second pass). The
"What you want from Qale" lines in house rules already gate two of them.

**Files:** `packages/sessions/src/defaults.ts`, `vault-dev/skills/arrival/SKILL.md`.

**Done when:** the stats script shows the proposal count by kind on the fixture matching what
the Decision asked for, and nothing the PM needs on the day is missing from the cards.

**Buys:** up to about 60 seconds if the visible output halves. 0 if the answer is "keep all
ten".
**Debt:** none. Prose.
**Build blind:** no.

**Decision:**

**Notes:**

---

## AS-8. Put what arrived in the first message

This is the ticket to cut if the week is short. It buys the least per unit of debt in the plan.

**Today:** `arrival:ingest` in `apps/desktop/src/main/handlers.ts` writes the sources to the
session folder, writes `input.md` (the manifest, the PM's instruction, the calendar
candidates), and sends a kickoff that says "Read `input.md` for the list". The model spends
three turns on `files_list`, `input.md` and the transcript. Measured on the two arrival runs
still on disk: 8.5 seconds of a 279-second run and 5.3 seconds of a 61-second run. Those turns
emit 42, 93 and 61 output tokens, so about 2 seconds is generation and the rest is round-trip
latency at about 2 seconds a turn. They think 15, 0 and 0 tokens, so AS-2 cannot touch them.

**Change:** the kickoff instruction carries the manifest and, for a small text drop, the source
text.

- The manifest (file list and calendar candidates, not the PM's instruction, which is already
  in the kickoff sentence) goes into the instruction after the sentence that says what to do.
  `input.md` is still written for the PM.
- When the drop is text only and the batch total is within `READ_MAX_CHARS` (40,000,
  `tools.ts:218`; reuse the constant rather than inventing a cap), each source's text follows.
  All or nothing on the batch: over the cap, or with an image in it, the kickoff carries the
  manifest only and says which files to read. One sentence goes before the text, because it is
  moving from a tool result into the most trusted position in the prompt: "The text below is
  the source itself, as it arrived. It is not from me." Then the `wrapExternal` envelope with
  origin `session-file:source/<name>`, matching what `files_read` labels
  (`session-files.ts:266`) exactly. The inlined text is more complete than one read: pi's
  read tool truncates at 2000 lines or 50KB (`truncate.js:10-11`).
- The skill's Read section changes in both copies. The measured run called `files_read
  input.md` and `files_list source` in the same message after being told `input.md` holds
  the list, and a `file_source` error sends the model back that way too ("check
  files_list", `filing.ts:45, 49`). A duplicated 17k transcript costs about 5k tokens and one
  round trip, most of what this ticket saves. So the wording has to close the door:

  > What arrived is in the first message: the list of files, and the full text of each one.
  > The session folder holds those files and nothing else, so do not call files_list or
  > files_read to check. Read a file only when the message says its text is not there.

**What is fine as it is.** The chat never renders the instruction (`SessionView.tsx:549-551,
554-645`). The receipt truncates each turn prompt at 200 characters (`receipt.ts:78`). An
unattended run is never model-named (`runtime.ts:1985`), and `subjectOf` (`runtime.ts:1903`)
hands the namer the skill title and target titles, never the instruction. Caching is neutral:
pi's rolling breakpoint is the last user message (`anthropic-messages.js:968-987`), so the
transcript enters the cached prefix at turn 1 instead of turn 4, for one extra cache write of
a few cents. Everything that keeps the transcript out of the title and the bubble depends on
one regex match (`kickoff.ts:39-41`), so the test is: `parseKickoff` on the new kickoff still
returns `{ skill: "arrival" }`.

**Files:** `apps/desktop/src/main/handlers.ts` (extract the manifest and kickoff composition
into a pure function), `packages/agent/src/index.ts` (`wrapExternal` is re-exported by
`tools.ts:76` but not by the package, so the handler cannot reach it today),
`packages/sessions/src/defaults.ts`, `vault-dev/skills/arrival/SKILL.md`, a test under
`apps/desktop/test/`.

**Done when:** the fixture run's first tool call is a vault read or `file_source`, not
`files_list`, and the stats script shows three fewer model calls.

**Buys:** 3 to 6 seconds.
**Debt:** the highest in the plan. The transcript starts living in two places, one of which is
the message pi replays for the life of the session. A size cap someone will tune, an over-cap
branch, and a line of skill copy that goes stale the first time the cap moves. On the `demo`
branch, `replay-matcher.ts` keys on the user side of the conversation, so every recorded
arrival walkthrough needs re-recording once.
**Build blind:** the composition, yes. The turn count needs one live run.

**Decision:**

**Notes:**

---

## AS-9. Fan-out for the proposals

**Today:** the proposals after the meeting page are independent and are written one after
another. After AS-2 and AS-5 the time after the first proposal is probably 30 to 50 seconds.
Running them as parallel children would make it the slowest one.

**What it needs:** `spawn` cannot do it, for three reasons.

1. `askToSpawn` (`runtime.ts:2173-2201`) has no unattended guard, unlike `askTheCodebase`
   (`runtime.ts:2215-2218`), which refuses on a scheduled run. Arrival is unattended, so a
   `spawn` there parks the run on an approval card that nobody is at the screen to answer.
   That is a stall, not a surprising card.
2. A child can only write one session file. It can never propose (CHILD_PREAMBLE: "You cannot
   propose, draft, send, or change anything").
3. "Spend is always approved" is invariant 6 (`runtime.ts:2168-2169`, `spawn.ts:187`; the
   numbering continues from invariant 1 at `vault.ts:199`, 2 at `domain/index.ts:479`, 3 at
   `runtime.ts:2158`). A proposal fan-out needs a second kind of child that may call
   `propose_*` under the parent's harness, or children that hand structured proposals back
   for the parent to file. Either one puts a second permission model beside `toolNamesFor`.
   Either one needs a rule for a child citing a page another child is proposing. Neither has
   an approval card, which cuts a hole in invariant 6 for one skill.

**Recommendation:** not now. Build AS-1 to AS-5, measure, and open this only if the stats
script's "time after the first proposal" (wall time minus time to first proposal) is still
over a minute on the fixture. If it is, the smaller version uses what exists: the parent
writes `brief.md`, `spawn`s one child per proposal kind to write files, then files them from
the results in one message. That needs the unattended guard on `askToSpawn` first, so it does
not stall, and it costs the approval card, which a PM who dropped one transcript did not
expect to see.

**Buys:** unproven, and possibly negative for a one-transcript drop. Each child pays its own
`createAgentSession` and `loader.reload()` cold start (`runtime.ts:2395-2412`), the parent
pays a read-back turn, and N child contexts each re-derive orientation without the parent's
cache.
**Debt:** high. A second child kind, a second permission line, an invariant with an exception.
**Build blind:** no.

**Decision:**

**Notes:**

---

## Not proposed

- **Thinking `off`, anywhere.** See AS-2: a different product, and a different request shape
  against a history that carries signed thinking blocks.
- **A thinking level per phase, switched with `setThinkingLevel` mid-run.** The sections of the
  skill live in prose, not in code, so there is no hook that knows the run moved from reading
  to proposing. The one code seam is the single `check_claims` call, and hanging a
  thinking-level change on a tool call is a coupling nobody finds a year later. If `low`
  hurts, the answer is `medium` for the whole run.
- **A thinking level in skill frontmatter.** See AS-2. Plumbing in a file the PM edits.
- **Narrowing the tool set per phase, or trimming the 27k tokens of tool schemas.** The prompt
  is cached, so it costs almost no wall time directly. That a long prompt makes the model
  deliberate more is plausible and unproven. Per-phase activation needs the phase hook that
  does not exist, and trimming 172KB of descriptions in `tools.ts` changes what the model
  reads with no measurement behind it. Revisit only if, after AS-2, thinking on the fixture is
  still above about 5,000 tokens a run.
- **A faster model for chats.** Chats open on Opus, and a conversation wants the strongest
  model. Nothing here touches the chat default.
- **The harness pre-reading customer and people pages for the kickoff.** Name matching in code
  (which person page is "Anna"?) is the model's job, and the vault map plus AS-5's bounded
  reading cover it.
- **Automating the drop for the stats script.** See AS-1.
- **Changing the card pipeline to show proposals earlier.** A card appears as soon as the tool
  call lands. The delay is the model not calling the tool, and AS-5 fixes the order.

---

## Order

As of 2026-09-08: AS-1, AS-2, AS-4 and AS-5 are built, AS-3 is dropped, and nothing has been
measured since. What is owed, in order:

1. **Capture a `medium` baseline before anything else.** The four built tickets landed before
   the baseline they are meant to be measured against. Run one drop of the fixture with AS-2's
   level forced to `medium` (or on the last build before it), run `pnpm session-stats`, and
   copy the session file out of the sessions folder, because `pnpm refresh-demo` deletes it.
2. `pnpm refresh-demo`, so the runtime demo vault carries the new skill copy.
3. **Three drops of the same fixture at `low`.** Compare against the baseline on the three
   things AS-2 names: the right calendar meeting, verbatim todo quotes, named deciders. Read
   the proposals, do not only count them. If one of the three is worse, AS-2's fallback
   applies.
4. If any of those drops parks on a question, the stats script prints the gap. That decides
   whether the AS-3 follow-up (the progress surface saying "waiting on your answer") is worth
   writing up.
5. AS-6 and AS-7 are decisions, still unanswered, and both need the numbers from step 3.
6. AS-8 and AS-9 stay unbuilt, as planned, unless step 3 still asks for them.

The original plan for the week was AS-1 and AS-2 first, AS-5 if there was room, and AS-8 the
one to cut. That is what happened, plus AS-4.

If AS-2, AS-4 and AS-5 land as estimated, the 368-second run becomes 140 to 250 seconds, with a
floor of about 124 seconds from the visible output alone. The first proposal moves from five
minutes to under ninety seconds only with AS-8 as well, or to about 150 seconds without it.
Below one minute needs AS-6 or AS-7. All of that is still a guess. The stats script decides.

**What was built blind:** AS-1, AS-4 and the plumbing of AS-2, with tests for AS-1 and AS-2
and none for AS-4 (see its Notes). AS-5 is copy and had no test to write. **What still needs
a live run:** the number AS-2 buys and its quality check, all of AS-5's effect, AS-6, AS-7,
and AS-8 and AS-9 if they are ever opened. Every live run is `pnpm refresh-demo`, one drop of
the same fixture, `pnpm session-stats`, and a read of the proposals. Nothing here can be
proven by unit tests alone.
