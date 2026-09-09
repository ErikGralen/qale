# Demo mode: a build that answers the same way every time

First draft 2026-09-05. Stage 1 BUILT the same day on branch `demo` (commit ebc13a0), per Erik's
"start implementation". Stage 2 (the Brevik scenario, docs/demo-flows.md) is not started.

The cofounder needs a Qale he can install and demo without a key, a network, or a good day at
the model. He drops a transcript, the app waits a few seconds, and the same answer comes out
every time. The rest of the product works as it does today. He can reset the demo, and the
reset puts the files back and moves every date to today. Jira and Confluence are mocked.

The work lives on a branch (`demo`). Nothing here lands on `main`.

Two stages. **Stage 1** is the machinery: the build flag, the replay server, the fake tracker,
Reset. It is scenario-free and can be built and verified now, with a throwaway recording of
the existing `demo-samples/` drops. **Stage 2** is the demo scenario itself: the walkthrough,
possibly a re-cut vault, the real recordings, the tweaks. Stage 2 is not prepared yet and is
not part of this draft beyond the runbook in DM-10. Nothing in stage 1 depends on what the
scenario turns out to be.

The facts below come from one code pass on 2026-09-05 over the uncommitted working tree.

Write your call under **Decision** ("build", "skip", "discuss…"). **Notes** is for anything the
build needs to know. Nothing gets built until its Decision field is filled in.

---

## The idea in one paragraph

The product does not change. A demo build talks to a **local replay server** instead of
Anthropic. During one real run of the demo we **record** every model response the server saw.
After that the server **replays** them: for each request it finds the recorded conversation
with the same prefix and returns the next recorded turn, paced so it looks live. Tools run for
real against the real vault, so every proposal card, diff, todo and Activity row is produced by
the same code as in production. Jira and Confluence are a fake `fetch` behind the existing
connector seam, fed from a fixture that already matches the static mirrors in `vault-dev/`.
Reset copies the bundled vault back, slides the dates, and clears the app state, which is what
`pnpm refresh-demo` does today, moved into the app.

---

## What exists that this builds on

- **The vault is already a demo.** `vault-dev/` is the Tavla scenario anchored on 2026-07-17.
  `scripts/refresh-demo.ts` copies it, slides every date by (today − anchor), validates links,
  and clears the per-vault app DB, the search index and the pi session receipts
  (`clearAppState`). It is dependency-free on purpose. The shift logic can move into a shared
  module the app imports.
- **The drop-in material exists.** `demo-samples/` holds the two transcripts, the messy standup
  paste and three chat prompts. They use relative time words so they never go stale.
- **The Jira/Confluence mirrors are static and offline.** `vault-dev/tickets/jira/PAY-*.md` and
  `vault-dev/wikipages/confluence/*.md` point at `tavla.atlassian.net`, a host that does not
  exist. `scripts/reset-atlassian.ts` knows the whole cast (issues, statuses, labels, comments,
  page bodies). The fixture for the fake can be generated from the same source.
- **One seam for the model.** Every model call goes through pi's `ModelRuntime`
  (`packages/agent/src/runtime.ts`, `configure()`): the two `createAgentSession` calls (chat
  and spawned children) and `completeSimple` for the cheap jobs (naming, summaries,
  `check_claims`). Every pi `Model` carries a `baseUrl` (`pi-ai/dist/types.d.ts`). Point it
  at `http://127.0.0.1:<port>` and nothing else in the agent package changes.
- **One seam for Jira/Confluence.** `atlassianConnector.create(creds, { fetchImpl })` takes a
  `FetchLike`. `SyncService.credentialFor()` is the one place that calls it. The probe, the
  pulls, `fetchFull` and outbound `execute` all go through that one function.
- **A build-time flag mechanism.** `build-env.ts` reads constants that
  `electron.vite.config.ts` bakes in from `BAKED_ENV`. A packaged Mac app has no shell
  environment, so the demo flag has to be baked the same way, not read from `process.env`.
- **A gate the fake has to pass.** `fireSession` refuses to start a session without
  `settings.getActiveKey()`, and `arrival:ingest` tells the PM to set a key. The demo build
  needs a key on file. Any non-empty string works, since the replay server ignores it.
- **The clocks.** `SchedulerService` ticks every 5 minutes (`MAINTENANCE_TICK_MS`) and runs
  connector sync, the librarian, the summary pass and meeting prep. Each of those calls the
  model.

---

## A. The build

### DM-1. A separate app identity, from one flag

**What:** `QALE_DEMO=1 pnpm dmg` produces "Qale Demo" with appId `ai.qale.demo`. Separate
userData, separate keychain item, separate dock icon. Installing it beside the real Qale
changes nothing in the real Qale.

**Change:** Add `QALE_DEMO` to `BAKED_ENV` and a `isDemoBuild()` reader in `build-env.ts`.
`electron-builder.yml` gets a second config (or an env-switched `productName`/`appId`). The
dmg bundles `vault-dev/`, `demo-samples/`, the recordings and the Atlassian fixture as
`extraResources`.

**Decision:** build (Erik, 2026-09-05)

**Notes:** Built. `electron-builder.demo.yml` extends the main config (`Qale Demo`, `ai.qale.demo`, extraResources → `demo-assets/`). Scripts `dmg:demo`, `package:demo`, `dev:demo`. Dev name is `Qale Demo Dev`. The dmg itself has NOT been built; `process.resourcesPath` resolution is untested.

---

### DM-2. First launch lands in the demo, no onboarding

**What:** The 7-screen opening asks for a workspace, a key, a name and connections. In the demo
build all of that is known.

**Change:** On first launch of a demo build, before the window opens: run Reset (DM-8), then
write settings: `vaultPath` = the demo workspace (`<userData>/workspace`), provider
`anthropic` with key `demo`, the Atlassian connection with site `tavla.atlassian.net`, email
and token `demo`, onboarding `finishedAt` set, telemetry off, the PM's identity set to the
scenario's PM. The Home page opens on the Tavla vault.

**Decision:** build (Erik, 2026-09-05)

**Notes:** Built in `demo/demo-service.ts` `firstLaunch()`. Identity left unset (the vault has no PM person note). Telemetry forced off in `telemetry.ts`. Live-verified once on scratch userData: no opening, workspace open, Jira/Confluence rails present. Telemetry stays off in demo, always. A demo in front of a customer must not send
events under the cofounder's install id.

---

### Building the Windows demo installer

Answers open question 3. `pnpm --filter @qale/desktop run win:demo` builds it, but that
needs Windows (see the `windows` job comment in `build-installers.yml`), so the way to get
one is the workflow: on GitHub, Actions → Build installers → Run workflow, tick the `demo`
checkbox, Run. It downloads as `qale-demo-windows`, an unsigned `Qale Demo-Setup-...exe`
that installs beside a real Qale with no secrets baked in.

Unsigned means SmartScreen. Tell the recipient before they run it: click "More info", then
"Run anyway". Same click path as the real installer, documented in `electron-builder.yml`'s
`win:` block.

---

## B. The model

### DM-3. A local replay server that speaks the Anthropic Messages API

**What:** An HTTP server in the main process, on a free localhost port, that accepts
`POST /v1/messages` (streaming and non-streaming) and `GET /v1/models`. In demo mode every pi
`Model` gets its `baseUrl` set to that server. Nothing in `packages/agent` knows.

**Change:** New `apps/desktop/src/main/demo/replay-server.ts`. `AgentRuntime.configure()`
takes an optional `baseUrl` override in its config (one new field), applied to every model it
resolves. Two modes, picked at startup:

- **Replay** (the shipped build): answer from the recordings (DM-4). Never touches the network.
- **Record** (dev only, `QALE_DEMO_RECORD=1` with a real key): forward each request to
  `api.anthropic.com`, stream the answer back, and write the request and the full response to
  the recordings folder.

**Decision:** build (Erik, 2026-09-05)

**Notes:** Built: `demo/replay-server.ts` + `replay-*.ts`. Pi's anthropic provider uses the official SDK with `baseURL: model.baseUrl`, so the runtime spreads `{ ...model, baseUrl }` in `resolveModel` and the cheap path (`AgentRuntimeConfig.baseUrl`). `verifyProviderKey` short-circuits in demo. Record mode (`QALE_DEMO_RECORD=1`) is built but NOT exercised. The server also has to answer `/v1/models` so `verifyProviderKey` passes if it
ever runs. Bind to `127.0.0.1` only.

---

### DM-4. Routing: a trigger kind, the skill in force, and the turn index

**What:** The text-matcher below was replaced 2026-09-09 by a script engine
(`docs/plan-demo-replay.md`), because a matcher that reads tool results breaks whenever the
vault, a skill or a proposal id differs from the day something was recorded. A scenario is now
data, `demo/scenarios/s1.json` to `s5.json`, not a bank of recordings to score. Nothing typed is
compared, ever, so a typo or a paraphrase changes nothing.

**Original change (superseded):** Each recording was one conversation. Requests were normalised
(UUIDs, dates, timestamps and long digit runs replaced with placeholders) and matched against
every recording's requests by longest common prefix, ties broken on the system prompt, and the
recorded turn at `assistantCount` served.

**What runs now:** every request is one of two kinds.

- **A cheap single-turn call** (naming a session, a claim check, a document summary, a folder
  purpose) is answered by rule, from `cheap-answers.ts`, classified on the first line of its
  system prompt. A claim or a summary the running scenario names in its `lookups` gets that
  exact line; anything else gets a quiet default (`NEW | - | -` for a claim nobody named, the
  document's own first sentence, cut to 160 characters, for a summary nobody named).
- **A session turn** is routed. The engine takes the first user message, strips the card-state
  wrapper the runtime adds from the second turn on, and classifies it: a kickoff names a skill
  (`kind: skill`), a spawned child's system prompt says so (`kind: child`), anything else was
  typed (`kind: typed`) under whichever skill was in force. The skill in force is read off the
  system prompt: every skill that arrived in the session is appended as a brief that opens with
  `## Skill now in force: <name>` (`buildSkillBrief`), the last one wins, and none means the
  base skill, `ask`, which the runtime never appends. That classification decides which
  conversation the session is: the first free one, in every scenario in id order, whose
  trigger fits. A `skill` trigger fits on the skill name. A `typed` trigger fits on the skill
  in force when it names one (`trigger.skill`) and on the words it lists when it lists any
  (`trigger.any`, case-insensitive substrings, one is enough). Once bound, that opening always
  returns to the same conversation. The turn served is `turns[n]`, `n` being the number of
  assistant messages the request already carries, same rule as before.

  So the presenter picks the scenario by what he does. A drop is S1 (arrival), "Brief me" is
  S1 (meeting-prep), a bare weekly-update pick is S5, a plain paste with "offline" in it is S3
  (the script's first turn calls `use_skill` for `commitment-check`, a moment the `/` picker
  does not offer), a line under Iterate on something is S4, and a plain question with
  `SCH-121` or "who needs to know" in it is S2. One Reset before the demo (DM-9), then any
  subset in any order, each once,
  with no reset between. There is no Start button and nothing pinned. `ScriptEngine.pin()`
  exists for the lint, which runs one scenario alone with it; nothing in the app calls it.

Beyond `trigger.any`, the typed text is fingerprinted (`normalise()`: UUIDs, dates, timestamps
and long digit runs replaced) only so the same opening keeps returning to the same binding
across turns. Its content is not otherwise read, so what Erik types or pastes never has to match
the script.

**Dates.** A script is written in anchor time, the same 2026-07-17 frame as `vault-dev/`. At
serve time every plain date slides by today's offset, the rule `replay-dates.ts` already had (a
path or a wikilink never slides on its own). A script can also write `{{today}}`,
`{{today+7}}`, `{{today-1}}` or `{{date:2026-07-16}}` for a value that has to land on a specific
demo-day date: a calendar-mirror path, a `sources/` page `file_source` wrote today. Nothing
inside a template slides twice: it resolves to a final value, that value is hidden behind a
marker while the rest of the text takes the ordinary slide, then it is put back untouched.

**When nothing fits:** DM-6.

**Decision:** build (Erik, 2026-09-05); the matcher above replaced by the script engine (Erik,
2026-09-09, `docs/plan-demo-replay.md`).

**Notes:** Built: `scenario.ts` (the `Scenario`/`Conversation`/`Turn` types and the loader),
`script-engine.ts` (routing, binding, off-script), `script-templates.ts` (templates and the date
slide), `cheap-answers.ts` (the four rule answers, importing the real prompts from `@qale/agent`
so a wording change on `main` is a change here too). `replay-matcher.ts` and its test are
deleted; the date-shift tests moved to `replay-dates.test.ts`.

One gap against the plan as drafted: the naming call for a kickoff session does not read the
conversation's own `title` field. Nothing on a kickoff's first message ties it to a bound
conversation the way a typed session's `First message:` text does, so it falls back to the page
the skill was pointed at, then the skill's own name. `ScriptEngine.pin()` on an unknown scenario
id logs an error and keeps the current pin rather than clearing it; only the lint pins.
`validateScenario()` checks shape only and returns `{ errors }`; whether a tool exists, a
template resolves, or the `do` line carries one of `trigger.any` is the lint's job
(`pnpm demo:lint`, DM-10).

---

### DM-5. Pacing

**What:** A recorded answer that arrives in 30 ms looks fake. "It waits 5 seconds" was the
ask.

**Change:** Three constants in the replay server: `FIRST_TURN_DELAY_MS = 5000` before the first
byte of a conversation's first turn, `TURN_DELAY_MS = 1200` before every later turn, and a
text stream rate of roughly 400 characters per second. Tool-call turns get the turn delay and
then emit whole. The recording carries no timing.

**Decision:** build (Erik, 2026-09-05)

**Notes:** Built with the three constants as written (`DEFAULT_PACING`).

**Superseded 2026-09-09.** The fixed constants above are the pre-script-engine numbers. The
script engine paces per turn instead (DM-4): 1500 ms before a tools-only turn, 2500 ms before a
turn with text, 3000 ms for a conversation's first turn, unless the script's own `turn.pause`
says otherwise. A scenario that should feel like a long think sets `pause` on its turns; S3 waits
about five seconds before each of its turns. Text still streams at 400 characters a second, now with ±25% jitter on each
delta so it does not read as a metronome (`DEFAULT_PACING` in `replay-server.ts`, the jitter in
`replay-sse.ts`).

---

### DM-6. When nothing matches: off script

**What:** The cofounder types, or the model goes, somewhere none of the five scripts covers.

**Change:** A request goes off script in two cases: no conversation's trigger fits and nothing
is free to bind, or a session is already bound but has run past the last turn its conversation
defines. Either way the engine answers with one fixed text block, `end_turn`, and binds and
advances nothing, so the same opening asked again after a Reset is free to bind.

The line it answers with: for a bound session past its script, the scenario's own `offScript`
text if it has one (each of the five carries the same customer-safe line: "That is outside what
this demo can show. The five things it can do are listed in Settings, under Demo."), templates
resolved the same as any turn; for an opening nothing fits, the line in
`demo/recordings/_fallback.json` (the same sentence); failing that, one built into the server.

Alternative: if the demo build also has a real key on file, forward unmatched requests live.
Costs a key on his machine and a network. Not built.

**Decision:** build (Erik, 2026-09-05); the line is per scenario as of 2026-09-09.

**Notes:** Built: the `offScript()` path in `script-engine.ts`. `demo/recordings/_fallback.json`
still exists and is still editable, and still answers when a scenario carries no `offScript` of
its own. No live fallback, no real key involved.

---

### DM-7. The clocks stop

**What:** The 5-minute tick would call the model for the librarian, the summary pass and
meeting prep. None of those requests match a recording unless we record the tick too, and
the fallback text would then be filed as a summary.

**Change:** In demo mode `SchedulerService.start()` does not start the interval and does not
run the launch catch-up. "Run now" still works, so a librarian run can be demoed if we record
one. Connector sync runs once at launch and once after any Jira/Confluence write, called
directly, so the fake tracker's changes still show up.

**Decision:** build (Erik, 2026-09-05)

**Notes:** Built: `scheduler.start()` skipped in demo; one `syncService.tick()` at launch and after each accepted proposal. If we want the "Qale tidied up while you were away" moment in the demo, record one
librarian run and add a "Run librarian" step to the script.

---

## C. Jira and Confluence

### DM-8. A fake Atlassian behind the connector seam

**What:** The connector talks REST. We give it a `fetchImpl` that never leaves the process.

**Change:** New `apps/desktop/src/main/demo/fake-atlassian.ts`: an in-memory store of Jira
issues (the `PAY` cast: keys, summaries, descriptions, statuses, labels, assignee, links,
comments) and Confluence pages (the `Product` space: "Enterprise Onboarding", "Product weekly
update", bodies as storage XHTML). A router over the handful of endpoints the connector uses:
`myself`, `serverInfo`, JQL search, issue get, transitions, create issue, add comment, CQL
search, page get, page update with version, space list. Writes mutate the store, and the
store is written to `<userData>/demo/atlassian.json` so a relaunch keeps them until Reset.

The fixture (`demo/atlassian-fixture.json`) is generated once by a script that reads the cast
out of `scripts/reset-atlassian.ts` and the bodies out of `vault-dev/`. Dates in it are anchored
and slid at load, like everything else.

`SyncService.credentialFor()` calls `provider.create(fields, { fetchImpl: demoFetch })` when
the build is a demo build. One branch, one file.

**Decision:** build (Erik, 2026-09-05)

**Notes:** Built: `demo/fake-atlassian.ts` (735 lines), fixture from `scripts/build-demo-fixture.ts` (re-run after cast or mirror changes; nothing runs it for you), cast moved to `scripts/lib/atlassian-cast.ts`. `SyncService` takes `fetchImplFor` as its 7th constructor arg. Tests drive the real connector against the fake. The scripted steps this once carried (a ticket moved to Done on cue, and one that fired itself on the first approved write) were deleted on 2026-09-08: they were the coupling that made the flows an ordered chain (docs/demo-scenarios.md). The static mirrors already carry `tavla.atlassian.net` and the `PAY-*` keys, so no
reconcile step is needed. That is the whole reason to fake the API instead of pointing at the
live demo site. Google Calendar is faked the same way; see "Google Calendar in demo builds"
below.

---

## Google Calendar in demo builds

The demo build's calendar is a fixture too, behind the same `fetchImpl` seam. `demo/google-fixture.json`
holds the Rota week in Google's own event shape, generated from `scripts/lib/google-cast.ts` (the cast
`pnpm seed-google-calendar` pushes to a live account) by `pnpm build-demo-google-fixture`. Re-run that
after a change to the cast; nothing runs it for you.

`apps/desktop/src/main/demo/fake-google-calendar.ts` answers the token refresh, the calendar list and
`events.list/get/insert/patch`, slides every date by (today − 2026-07-17) at load, and persists writes
(a created event, an RSVP) to `<userData>/demo/google.json` until Reset. First launch writes the grant
itself and follows the one calendar, so Connections reads "connected" with no OAuth client, no browser
and no client id.

What is not faked: real Google auth (`connect()` still refuses in a build with no client), and the
scheduler. Meeting prep runs only from Run now, and answers with the canned reply until that turn is
recorded (DM-7).

## D. Reset

### DM-9. Reset demo, from Settings

**What:** One button that returns the whole install to the start of the script, dated today.

**Change:** Settings → a "Demo" section that exists only in the demo build, with **Reset demo**.
It does, in order:

1. Stop every running session and dispose the agent runtime.
2. Close the workspace.
3. Delete `<userData>/workspace` and copy the bundled `vault-dev/` there, then slide every date
   by (today − 2026-07-17). This is `refresh-demo.ts`'s shift and validate logic, moved into a
   shared module (`packages/domain` or a new `scripts/lib`) that both the script and the app
   import.
4. Clear the app state the script clears today: the per-vault app DB, the search index, the pi
   session files. Also the renderer's Local Storage (tabs, pins), which the script cannot
   reach. Also the vault's `.git`, which step 3 already removed. The default pins go back on
   when the reloaded window finishes loading (`DemoService.seedPins`).
5. Reset the fake Atlassian store to the fixture.
6. Reset the replay server's state (it holds none beyond the loaded recordings).
7. Reopen the workspace.

The same routine runs on first launch (DM-2). A confirm dialog first, since it throws away
whatever he did in the last demo.

**Decision:** build (Erik, 2026-09-05)

**Notes:** Built: `DemoService.reset()`; Settings → Demo tab (`DemoSettings.tsx`) with Reset (inline confirm), a read-only list of the five scenarios (title and `do` line) as a reminder, and Open demo files (`~/Desktop/Qale demo files/`). The step buttons were deleted on 2026-09-08; the per-scenario Start button was added and deleted on 2026-09-09, because the engine picks the scenario from what the presenter does (DM-4) and Reset is pressed once before a demo. Shift logic now lives in `@qale/domain/demo` (`packages/domain/src/demo/shift.ts`), shared with `refresh-demo.ts` (dry output byte-identical). Unit-tested against temp dirs; the button was NOT clicked in a live window. Open point: the reset workspace has no `.git`, so "put it back" is unavailable during a demo. The demo files he drags in have to be somewhere he can find them. Reset also copies
`demo-samples/` to `~/Desktop/Qale demo files/`, and the Demo section has an "Open demo
files" button.

**The rail's pins.** The pin set is the renderer's, one Local Storage key per workspace
(`qale.favorites.v1:<path>`, `app-state.tsx`). A demo that opens on an empty rail says nothing
about what the PO is working in, so `DemoService` writes that key from the main process on every
`did-finish-load`, and only when the workspace has no pin set at all: six paths, in
`DEFAULT_PINS`. That keeps one way to pin in the product. The list is two documents
(`notes/h2-capacity`, `notes/swap-rules`), the two Jira epics (`SCH-118`, `SCH-231`) and the two
Confluence pages (`roadmap-h2`, `product-weekly-update`). No meeting is on it: Calendar is a
meeting's home and the rail refuses the type (`isPinnable`, docs/sidebar-ia.md SB-1), so the
upcoming Café Nord QBR prep is opened from Calendar (docs/demo-runbook.md).

---

## E. The authoring workflow

### DM-10. Author a script: record once, draft, edit, lint, run cold

**What:** How the five files under `demo/scenarios/` get made and stay right. A script ships;
a recording is only ever a draft of one, and editing it costs minutes, not a re-record.

**Change:**

1. Reset, then run the scenario once in record mode, same as before:
   `QALE_DEMO=1 QALE_DEMO_RECORD=1 pnpm desktop` with a real Anthropic key in Settings. The
   replay server proxies to Anthropic and writes every turn into `demo/recordings/`.
2. `pnpm demo:draft --scenario s1 --from demo/recordings/<file>.json` runs
   `script-from-recording.ts`. It keeps each assistant turn's text and tool calls, drops read
   tools (`vault_read`, `vault_list`, `vault_grep`, `files_*`, the connector reads) and
   `check_claims` unless told to keep them, drops thinking blocks, un-slides every date by the
   recording's own offset so the file reads in anchor time, and turns a path or wikilink dated
   within two weeks of the record day into a `{{today}}` or `{{date:X}}` template. It writes
   `demo/scenarios/s1.json` with `draft: true` and prints what it could not make stable by
   itself: a proposal id, a Jira page id, a value reused from the previous tool result, a
   `withdraw_proposal` call.
3. Edit the file by hand. There is no "request side" any more, so any field may change:
   sharpen the text, cut a card, fix a `search` block, remove what the draft flagged. A typed
   conversation gets the skill it is typed under (`trigger.skill`, `ask` for none) and a word
   or two the `do` line makes the presenter type (`trigger.any`).
4. `pnpm demo:lint` (`apps/desktop/scripts/lint-scenarios.ts`), headless, no Electron, no model.
   Per scenario, at three date offsets (0, 12 and 65 days from the anchor), it checks the
   file's shape, builds a workspace the way Reset builds one, and runs every scripted tool call
   for real against it: a refusal, a throw, an unresolved template, an unknown tool or a schema
   mismatch is an error naming the scenario, the turn and the tool. It also drives one script
   engine over every scenario forwards and backwards, with nothing pinned, to prove `reset()`
   leaves no binding behind. Then the sequence pass: for each of four orders it builds one
   workspace, routes every scenario's opening through an unpinned engine (a real system prompt
   with the `## Skill now in force:` line for S3 and S4) and runs every tool call, with no reset
   between scenarios; a wrong binding or a call that fails because an earlier scenario changed
   the workspace is an error naming the order. Fix until it prints `OK`.
5. `QALE_DEMO=1 QALE_DEMO_TODAY=2026-10-01 pnpm desktop`, Reset, run the scenario once cold on a
   day nobody drafted against, and look at the cards. Commit, with `draft: true` removed.

**Decision:** build (Erik, 2026-09-05); steps 2 to 5 replaced by the script/lint workflow (Erik,
2026-09-09, `docs/plan-demo-replay.md`).

**Notes:** Built: `demo-draft.ts` (`pnpm demo:draft`), `lint-scenarios.ts` (`pnpm demo:lint
[--scenario s1] [--offsets 0,12,65]`). Not wired into CI; run it by hand before a demo day, and
again after any merge from `main` that touches `packages/agent/src/tools.ts` or the proposals
use case (`docs/demo-runbook.md`). The five scripts are `s1.json` "The meeting produced actions"
through `s5.json` "The Friday update"; each carries the `do` line shown on its Settings row
(DM-9) and its own off-script line (DM-6). The recordings under `demo/recordings/` are removed
once the lint is green on all five; `_fallback.json` stays.

---

## F. Branch hygiene

### DM-11. The `demo` branch

**What:** 178 files are uncommitted on `main` right now. A branch cut now would carry them
untracked.

**Change:** Commit `main` first (or stash), then `git checkout -b demo`. Merges go one way:
`main` into `demo`. A fix found while building the demo that belongs in the product is
cherry-picked back to `main` on its own. The `demo/` folder (recordings, fixture) and
`apps/desktop/src/main/demo/` exist only on `demo`. Everything else the branch touches is a
small `isDemoBuild()` branch at a seam, so a merge from `main` rarely conflicts.

**Decision:** build (Erik, 2026-09-05)

**Notes:** Done: `main` committed first (da950b2), `demo` cut from it.

---

## What is deliberately not in this draft

- **A live fallback.** No real key, no network. See DM-6 for the alternative.
- **Google Calendar.** Not mocked, not connected. The meetings are notes.
- **`ask_codebase`.** Needs Claude Code installed. Off in the demo build.
- **A demo badge in the UI.** He demos to customers. The app should look like the app. The
  Settings section is the only visible difference.
- **Recording the tick.** The librarian, summaries and meeting prep stay off unless DM-7 says
  otherwise.
- **Multiple scripts.** One walkthrough, one set of recordings. A second scenario is a second
  vault and a second recordings folder, later.

## Open questions

0. What the scenario is. The vault, the drops, the prompts and the cards the audience should
   see are stage 2 and undecided. Stage 1 assumes only that the scenario is a vault folder plus
   a set of files to drop plus a set of prompts, which is what `vault-dev/` and `demo-samples/`
   already are. If the real scenario needs something else (a second tracker, calendar events),
   DM-8's "not mocked" list is where that shows up.

1. How far off-script does he need to go? If he will take audience questions in the chat, DM-6
   needs the live fallback and he needs a key. If he runs the script, the fixed answer is
   enough.
2. Should approving a card do anything model-shaped after approval that we have not recorded?
   Reactions to approved decisions fire a session (`fireSession` "a reaction to an approved
   decision"). Those need recording too, or they fall into DM-6.
3. Does he need Windows? `electron-builder.yml` has a `win` target. The replay server and fake
   are platform-free, but nobody has run the shift logic on Windows paths.
4. Where does "today" come from during a demo that runs past midnight? Reset dates to the day
   it ran. A demo the next morning reads one day stale. Acceptable, or re-run Reset first.
