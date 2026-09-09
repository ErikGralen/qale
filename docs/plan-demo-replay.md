# Demo replay: scripts instead of recordings

**Implemented 2026-09-09.** `docs/demo-mode.md` is now the reference; read that first. What
shipped differently from this plan:

- Templates resolve as part of the date slide, not before it: `script-templates.ts` computes a
  template's value, hides it behind a marker, runs the ordinary slide over the rest of the
  text, then restores the value, all in one pass, rather than as a separate step ahead of the
  slide.
- The naming call for a kickoff session does not read the conversation's own `title`. It has
  nothing on the kickoff's first message to key on, so it falls back to the page the skill was
  pointed at, then the skill's own name. Only a typed session's `First message:` text resolves
  to a bound conversation's title.
- The Start button and the pin it set (section 4.3, step 7) were built and then removed the
  same day. The presenter presses Reset once before a demo and never opens Settings again; the
  engine picks the scenario from what he does. A typed opening carries the skill in force
  (`## Skill now in force: <name>` in the system prompt, `ask` for none) and a `typed` trigger
  may name that skill (`trigger.skill`) and a few words the first message must contain
  (`trigger.any`). S2 is `ask` plus `SCH-121` or "who needs to know", S3 is `commitment-check`
  plus `offline`, S4 is `iterate` plus `Visma` or `stories`. Any subset of the five runs in any
  order with no reset between, and `pnpm demo:lint` proves it in four orders on one workspace.
- `ScriptEngine.pin()` stays for the lint, which runs one scenario alone with it. Given an
  unknown scenario id it logs an error and keeps whatever was pinned before. Nothing in the app
  calls it, and `DemoInfoDTO` has no `pinned` field.
- `validateScenario()` returns `{ errors: string[] }`, not a boolean or a thrown error.
- `pnpm demo:lint` is not wired into CI; it runs by hand.

Plan, 2026-09-09. Replaces the matching half of `docs/demo-mode.md` (DM-4, DM-6, DM-10). Assumes the outcome of `docs/plan-demo-scenarios.md`: five independent scenarios, a Start button each, 3 to 5 turns each.

The short version: keep the local replay server, throw away the matcher and the recordings as the source of truth, and drive each scenario from a hand-editable script that says, per turn, what the assistant says and which tools it calls. The real tool runtime still runs every call, so every card is real. Recording stays, as a way to draft a script.

## 1. What runs today

Every model call goes over HTTP to a server on `127.0.0.1`. `DemoService.start()` starts it (`apps/desktop/src/main/demo/demo-service.ts:165-203`) and `reconfigureAgent` passes its address as `baseUrl` to the agent runtime (`apps/desktop/src/main/handlers.ts:749-758`). The runtime spreads that `baseUrl` over every pi `Model` it resolves (`packages/agent/src/runtime.ts:1153-1156`), so chat sessions, spawned children (`runtime.ts:2543`) and the cheap `completeSimple` jobs (`runtime.ts:1231`) all land on the same server. Nothing in `packages/agent` knows.

The server answers `POST /v1/messages` in `answer()` (`apps/desktop/src/main/demo/replay-server.ts:117-157`). For each request it:

1. Counts the assistant messages in the request. That number is the turn to serve (`replay-matcher.ts:98-100`, used at `replay-server.ts:125`).
2. Builds the "user side": every `user`-role message, typed text and tool results alike, flattened to one string and normalised (`replay-matcher.ts:88-95`). Normalising replaces UUIDs, ISO timestamps, `YYYY-MM-DD` dates and any digit run of four or more with placeholders, then collapses whitespace (`replay-matcher.ts:61-78`).
3. Does the same to every recording's last request, once, and takes the longest common prefix of user messages (`replay-matcher.ts:103-108, 137-138`). A recording is eligible when it has a turn at that index and `closeEnough` holds (`replay-matcher.ts:166-172`): the prefix must be at least 1, and if the first mismatch is a typed message the recording is out; if it is a tool result, half the user side must match (`MIN_PREFIX_RATIO`, line 59).
4. Breaks ties on how much of the system prompt the two share from the start (`replay-matcher.ts:111-121, 161-164`).
5. On a miss, serves `_fallback.json` (`replay-server.ts:127, 172-186`).
6. Slides every date token in the answer by (today's offset minus the recording's `offsetDays`), except inside paths and wikilinks (`replay-dates.ts:27-30, 87-91`; `replay-server.ts:131-132`), then streams it as SSE with a 5 s lead on turn 0, 1.2 s on later turns, text at 400 chars/s in 24-char deltas, tool calls whole (`replay-server.ts:58-62`, `replay-sse.ts:33-70, 110-121`).

Record mode (`QALE_DEMO_RECORD=1`) forwards the same request upstream and appends `{request, response}` to a recording file whose user side it continues (`replay-recorder.ts:164-189, 210-221, 242-285`). The file key is the slugged first user line (`replay-recordings.ts:125-136`).

What runs for real: every tool (`vault_read`, `propose_*`, `draft_*`, `file_source`, `check_claims`), the proposal store, git commits, the fake Jira and Calendar behind `fetchImplFor` (`demo-service.ts:123-135`), and the sync tick after each accepted card (`handlers.ts:2592-2593`). Reset (`demo-service.ts:274-340`) rebuilds the workspace from `vault-dev/`, slides dates by (today minus 2026-07-17), clears app state, resets both fakes and re-reads the recordings.

What the matcher actually sees per request, so the reader knows the size of it:

- A chat or skill session: a system prompt of 39 to 53 k characters (preamble, house rules, skill index, vault map, tags, then the invoked skill's brief appended by `state.invoke`, `runtime.ts:1636-1650, 1872-1877`). The first user message is either the typed sentence or a kickoff `Run the <skill> skill[ on <path>]: <instruction>` (`packages/sessions/src/kickoff.ts:29-33`). From the second turn on, every typed message is wrapped in a card-state block (`packages/agent/src/card-state.ts:165-179`). Tool results follow as `tool_result` blocks, several per message.
- The 36 recordings from 2026-09-08 are: 5 sessions (13, 17, 10, 16 and 13 turns), 20 one-turn claim lookups on `claude-haiku-4-5-20251001`, 7 one-turn document summaries, 3 one-turn session-naming calls, and `_fallback.json`.

## 2. Why it fails

Each complaint, with the line that causes it.

**"We forgot one space or letter and it fails."** A typed message is compared as exact normalised text (`replay-matcher.ts:106`), and a typed mismatch is never tolerated (`replay-matcher.ts:170`). Any character outside the four normalised classes is a miss, and a miss on turn 0 means the whole scenario goes to the fallback.

**"Inconsistencies between runs."** Three causes. (a) The user side includes tool results, so anything the vault reports differently between runs (a file count, a line the normaliser does not cover, a proposal id like `p_mtt42q11_hhd38z` which has only three digits in a row) changes the prefix and drops a run onto the ratio rule mid-conversation. (b) The recorded tool inputs carry the record day's state: a `withdraw_proposal` with a proposal id, a `propose_update` patch whose `search` text has to be byte-exact in today's vault. (c) The post-open sweep runs `runMaintenance()` on every workspace open, demo build included (`handlers.ts:695`), and the key `demo` is truthy, so the summary pass (`handlers.ts:556-568`) and possibly a librarian session (`handlers.ts:465-523`) call the model at every Reset. That is where the seven `summarise-this-document` recordings came from. On a day with no matching recording, the fallback sentence is written into notes as their summary.

**"Recordings go stale when a skill or prompt changes."** The system prompt is only a tiebreak, so a prompt change does not by itself miss. What goes stale is the kickoff text and the tool results: `nameList` changed the arrival kickoff (`handlers.ts:2365`), and any skill change alters what `vault_read skills/jira/SKILL.md` returns, which is on the user side. And a recorded answer written under old instructions can contradict the new skill on screen.

**"Two conversations that open the same way collide."** Turn 0 has one user message, so two recordings that share it tie and the system-prompt score picks one (`replay-matcher.ts:161-164`). The fix on 2026-09-08 was to change the product's kickoff text to make the openings differ, which is the product bending to the matcher.

**"The date shift broke paths."** Fixed for seed paths, but not for calendar mirrors. The vault shift renames no files, so `replay-dates.ts` masks every path. Calendar meeting pages are written by the sync at runtime with slid dates (`meetings/2026-09-07-steering.md` in the recordings; the seed only has `meetings/2026-07-09-steering.md`). A masked path to a calendar mirror stays pinned to the record day and misses on any other day. 40 of the recorded tool calls in the commitment-check recording alone cite `meetings/2026-09-07-steering`.

**"Recording is a judgement job needing retakes."** The recording is the source of truth and the request side may not be edited (`docs/demo-runbook.md`, Part 2). A weak card cannot be fixed without a re-record, because the tool result it produced is on the user side of every later turn.

**"Ingest takes minutes."** The arrival recording is 17 turns: `files_list`, `files_read` x2, `vault_read` x10, `vault_list` x4, `vault_grep` x2, one `check_claims` (which itself makes 4 to 8 cheap calls, `claims.ts:74, 549`), and only then the writes. Replay pays 1.2 s lead per turn plus 24-char pacing over every thinking block and every read, so a replay of the exploration costs about a minute and the record run costs five.

## 3. Three approaches, and a fourth

Judged for this codebase on: build cost, typos and paraphrase, prompt or skill drift after merges, the ~7 s ingest target, whether streaming still looks live, and sub-agent or multi-request turns.

### a. Keep recordings, match on scenario and turn index

Pin a scenario at Start; route each request to a recording by trigger kind and serve the turn at the assistant count; stop comparing text and the system prompt.

- Cost: small. `matchRequest` becomes a router (a day). The `docs/demo-scenarios.md` DS-3/DS-4 plan is this.
- Typos: solved. The typed text is never read.
- Drift: not solved. The recorded tool inputs still carry byte-exact `search` text, proposal ids and record-day paths. A skill change on `main` still makes the recorded answer contradict what the new skill says.
- Ingest speed: not solved. The recording still has 17 turns of reads. Cutting turns out of a recording by hand is possible but each cut changes the tool results the next turn was recorded against, which nobody can check without running it.
- Streaming: unchanged, looks live.
- Sub-agents: works by trigger kind (a child's first message is the child prompt), but every child needs its own recording.

### b. Scenario scripts as data (recommended)

A per-scenario JSON file lists, per conversation and per turn, the assistant text and the tool calls to emit. The replay server serves the script; pi's loop executes the tools for real; the results come back and the next turn is served by index. Recording becomes a way to draft a script.

- Cost: medium. A script engine (routing plus templates) replaces the matcher; a converter drafts a script from a recording; a lint runs every script against a reset workspace headless. About four days plus authoring the five scripts.
- Typos: solved. Typed text never matters.
- Drift: mostly solved. A script names tools and arguments, not prompts or reads. A merge that renames a tool or changes an argument schema fails the lint before demo day, and fixing is an edit, not a re-record. A merge that changes a skill's wording changes nothing on screen, because the script says what is on screen.
- Ingest: solved. The script emits `file_source` and the writes directly. The arrival becomes 4 turns and lands in about 6 to 7 s (timing in section 4).
- Streaming: unchanged, and better paced because tool-only turns can be fast.
- Sub-agents: a child conversation is a script conversation with `trigger.kind: "child"`. None of the five scenarios spawn.
- Cheap calls (naming, claims, summaries) do not go away: `check_claims` calls the model 4 to 8 times per use. The engine answers them by rule with per-scenario overrides.

### c. Snapshot plus pre-baked diff per turn

Start installs a workspace snapshot; each turn applies a stored diff and streams a canned message; the tool runtime only draws cards.

- Cost: high. There is no "apply a diff and draw the cards" path in the product. Cards are rows in the proposal store (`ctx.proposals`, `vault-service.ts:74`) written by the tools; a diff to the vault does not create them, and a card written directly into the store is a second code path the product does not have. The "product code is unchanged, cards are real" property breaks: an approval would apply a proposal the tool never validated, outbound cards would need the fake Jira mutated by hand, Activity rows and receipts would be forged.
- Typos: solved. Drift: worse. A diff is byte-exact against the seed and breaks on any content change on `main`. Ingest: fastest. Streaming: text only, no tool rows in the trail. Sub-agents: irrelevant.
- Rejected.

### d. Hybrid: scripts behind the server, recordings as drafts, rules for the cheap calls

This is (b) with two additions that (b) needs anyway: the routing state machine from (a) so the script engine never reads typed text, and rule-based answers for the single-turn cheap calls so `check_claims` and naming never need a script line. It is the recommendation. From here on "the script engine" means this.

Why not register an in-process provider instead of HTTP: pi-ai exposes `registerApiProvider` and `registerFauxProvider` (`node_modules/@earendil-works/pi-ai/dist/compat.d.ts:41-55`). Using it would drop the SSE layer, but it puts demo code inside `packages/agent`, which `main` owns, and the runtime builds its own `ModelRuntime` (`runtime.ts:1082-1099`). The HTTP seam keeps the demo entirely on the `demo` branch. Keep HTTP.

## 4. The design

### 4.1 Scenario file

One file per scenario, `demo/scenarios/<id>.json`, bundled with the rest of `demo/` (already in `electron-builder.demo.yml` `extraResources`). JSON, because the recordings are JSON and the loader exists; `text` may be a string or an array of strings joined with `\n`, so a paragraph is one line per array entry when edited by hand.

```json
{
  "version": 1,
  "id": "s1",
  "title": "The meeting produced actions",
  "do": "Drag steering-h2-priorities.vtt onto the window.",
  "offScript": "I only know this scenario in the demo build. Press Start on another scenario in Settings to switch.",
  "lookups": {
    "claims": {
      "Åsa reverses H2 order": "CONFLICT | decisions/2026-05-18-h2-order-payroll-first.md | H2 order: payroll export ships first in Q3, shift swaps follow in Q4",
      "Offline mode remains declined": "KNOWN | decisions/2026-02-12-decline-offline-mode.md | Decline offline mode; the staff app already caches the current week"
    },
    "summaries": {
      "sources/{{today}}-steering-transcript.md": "Steering call where Åsa moved shift swaps ahead of payroll export and pushed payroll export to Q1."
    }
  },
  "conversations": [
    {
      "id": "drop",
      "trigger": { "kind": "skill", "skill": "arrival" },
      "title": "Steering: H2 priorities",
      "turns": [ "...see below..." ]
    }
  ]
}
```

Fields:

- `trigger.kind` is `skill` (a kickoff, matched by the skill name `parseKickoff` returns, `kickoff.ts:44`), `typed` (any first message that is not a kickoff), or `child` (a spawn child). Nothing else about the message is read.
- `title` answers the naming call for this conversation.
- `lookups.claims` is keyed by a prefix of the claim text; the value is the one line `MATCH_SYSTEM_PROMPT` asks for (`claims.ts:367-399`). A claim with no entry gets `NEW | - | -`, which files quietly and earns no question.
- `lookups.summaries` is keyed by the `origin=` path in the summary material (`summaries.ts:100-127`). No entry: the first sentence of the material, cut at 160 characters, `tags: none`.
- Every date in a script is written in anchor time (the `vault-dev/` frame, 2026-07-17 is "today"). At serve time the engine slides every date token by today's offset except inside paths and wikilinks, which is the rule `replay-dates.ts` already has. A path that carries a demo-day date (a calendar mirror, a `sources/` page `file_source` wrote today) is written with a template: `{{today}}`, `{{today-1}}`, `{{today+7}}`, `{{date:2026-07-16}}`. Templates are replaced before the date slide runs. One rule, one escape hatch.

The last two turns of S1, with a tool call, an approval card and the closing text. Turn 0 (`file_source`) and turn 1 (the meeting summary, the decision, the todos) are omitted here for length; they are the same shape.

```json
{
  "pause": 700,
  "tools": [
    { "name": "get_voice", "input": { "voice": "cs" } },
    { "name": "vault_read", "input": { "path": "customers/fjord-sports.md" } }
  ]
},
{
  "pause": 700,
  "text": "Payroll export moving to Q1 changes what Fjord Sports and Café Nord were told, so both hubs get the new signal, and the roadmap page and SCH-118 need the flip. The two outbound ones wait for you.",
  "tools": [
    {
      "name": "propose_update",
      "input": {
        "path": "customers/fjord-sports.md",
        "patch": [
          {
            "search": "- Oskar has scheduled his own migration around that quarter.",
            "replace": "- Oskar has scheduled his own migration around Q4. Payroll export moved to Q1 on {{today-1}} ([[decisions/{{date:2026-07-16}}-h2-order-swaps-first]]), so he has to hear before he plans the Visma cutover."
          }
        ],
        "sources": ["[[meetings/{{date:2026-07-16}}-steering]]"],
        "rationale": "The steering decision changes the timeline Fjord Sports was given in May."
      }
    },
    {
      "name": "draft_ticket_comment",
      "input": {
        "ticket": "tickets/jira/SCH-118",
        "body": "Payroll export moves from Q3 to Q1 2027. Shift swaps (SCH-231) ships first: three chain accounts asked for swaps ahead of the September staff turnover, and Åsa flipped the order at steering on {{today-1}}. Rebecca re-estimates SCH-240 by {{today+10}}.\n\nSource: Steering, {{today-1}}",
        "voice": "cs",
        "sources": ["[[meetings/{{date:2026-07-16}}-steering]]", "[[tickets/jira/SCH-118]]"],
        "rationale": "The ticket still says Q3 and the team reads it daily."
      }
    }
  ]
},
{
  "pause": 1000,
  "text": [
    "Steering flipped the H2 order: shift swaps ships first, payroll export moves to Q1 2027.",
    "",
    "Filed: the meeting page, a decision that supersedes the May order, and three todos (Rebecca re-scopes SCH-240 by {{today+10}}, Henrik reviews swap notifications, you tell Fjord Sports the new timeline).",
    "",
    "Waiting for you: a comment on SCH-118 and a patch to the Roadmap H2 page. The customer hubs are already updated."
  ]
}
```

`get_voice` stays in the script because a draft that names a voice the session has not read is refused (`tools.ts:2881, 2918`). `vault_read` of a page before a `patch` is not enforced by code, but the lint runs the patch, so a `search` that no longer matches fails before demo day. `propose_update` here lands as applied (the arrival policy, receipt at `tools.ts:1170-1181`); `draft_ticket_comment` is the approval card, and its result text (`Drafted a comment proposal (p_...) on SCH-118. Awaiting approval.`) comes back as a tool result the engine ignores.

### 4.2 Runtime components

New, all under `apps/desktop/src/main/demo/`:

- `scenario.ts`: the `Scenario`, `Conversation`, `Turn` types, `loadScenarios(dir)`, and `validateScenario()` (shape only).
- `script-engine.ts`: replaces `replay-matcher.ts`. `answerFor(request, state)` returns a `WireResponse` (the shape `replay-sse.ts` already streams) plus the `pause`. Holds the per-run state: the pinned scenario id and the bindings (below).
- `script-templates.ts`: `{{today}}`, `{{today±n}}`, `{{date:X}}` expansion, then `shiftResponseDates` from `replay-dates.ts` unchanged.
- `cheap-answers.ts`: the rule answers for naming, claims, summaries and folder purpose, classified by the first line of the system prompt (`namingSystemPrompt`, `MATCH_SYSTEM_PROMPT`, `SUMMARY_SYSTEM_PROMPT`, `FOLDER_PURPOSE_SYSTEM_PROMPT` are all exported from `packages/agent`, so the engine imports the constants rather than copying text).
- `script-from-recording.ts`: the converter (section 4.7).

Changed:

- `replay-server.ts`: `answer()` calls the engine instead of `matchRequest`; new `pin(scenarioId | null)` on the returned handle; `reset()` clears bindings and re-reads `demo/scenarios/`. Record mode unchanged.
- `replay-sse.ts`: `leadMs` comes from the turn's `pause`; add ±25% jitter per text delta so the cadence is not metronomic.
- `demo-service.ts`: `startScenario(id)` = `reset()` then `replay.pin(id)`; `info()` returns the scenario list (`id`, `title`, `do`) and the pinned id.
- `handlers.ts`: `demo:startScenario` channel; the post-open `runMaintenance()` at line 695 is skipped in the demo build, keeping `syncService.tick()`, which is what DM-7 said and did not do for the open path.
- `packages/ipc/src/index.ts:460-468` and `dtos.ts:1414-1424`: the channel and `DemoInfoDTO.scenarios` plus `pinned`.
- `DemoSettings.tsx`: five rows, title, the `do` line, a Start button each; Reset underneath as now.

Deleted: section 5.

### 4.3 Start, Reset, dates and the fakes

Start scenario N does exactly what Reset does today, then pins N. Reset already replaces the workspace, slides its dates, clears the proposal store, the index and the pi session files, resets the fake Jira and Calendar to their fixtures, reconnects them, and reloads the window (`demo-service.ts:274-340`). `afterDemoReset` follows the calendar and runs one sync (`handlers.ts:857-870`), which writes the calendar mirrors with demo-day dates. So after Start, the workspace, the fakes and the mirrors are the known state every script was linted against. The scenarios plan says none of the five needs a tracker state the base fixture lacks; if one ever does, it becomes a `fixture` field on the scenario that Start applies after the fake resets, and never a button.

Dates: the vault is anchor-dated and slid by `dateOffsetDays()` (`demo-service.ts:110-112`). The scripts are anchor-dated and slid by the same number at serve time. Recordings carried `offsetDays` because they were made on some other day; scripts do not need it.

### 4.4 Routing, the cursor, and going off script

Per request:

1. If the request has one user message and its system prompt starts with one of the four cheap-call prompts, answer from `cheap-answers.ts`. The naming call carries `First message:\n<text>` (`naming.ts:96-107`); the engine finds the conversation bound to that text and answers its `title`, else the first six words.
2. Otherwise it is a session turn. Take the first user message, drop a card-state envelope if one is there (`card-state.ts:186-189` has the regex), and classify: `parseKickoff` succeeds → `skill`; a system prompt beginning with the child preamble → `child`; else `typed`.
3. Look up a binding. The engine keeps `bindings: Map<fingerprint, conversationId>` where the fingerprint is the normalised first user message (the existing `normalise`). Bound → that conversation.
4. Not bound: take the first unbound conversation in the pinned scenario whose trigger matches (kind, and skill name for `skill`), in file order, and bind it. With nothing pinned, search S1 to S5 in order. No candidate → off script.
5. Serve `turns[assistantCount]`. Past the end → off script.

So the cursor is the assistant count, read off the request, exactly as today. The scenario pin and the bindings are the only state, and Reset clears both. Nothing is compared after the first message, and the first message is only classified.

Off script: the engine answers with the scenario's `offScript` text (or `_fallback.json` if absent) as a one-block `end_turn`. It binds nothing and advances nothing. If Erik types a question in S4 before pressing Start, S4's typed conversation binds to whatever he typed, which is the intended behaviour: the typed words never matter. If he types a second question in the same session after the script ended, he gets the off-script line and the session ends the turn cleanly. If he opens a second typed session in a scenario that has one typed conversation, that is also off script. Scripts should end on a text turn so a session never runs a tool call into the fallback.

`ask_user` in a script: allowed. The answer arrives as a tool result and the next turn is served by index whichever option was picked, so the following turn has to read well for every option. The lint warns on `ask_user` turns. The five scenarios should avoid it.

### 4.5 Streaming

Unchanged mechanism (`replay-sse.ts`), new numbers:

- `pause` per turn, default 700 ms for a turn with tools only, 1200 ms for a turn with text, 1500 ms for turn 0. Replaces the 5 s first-turn lead.
- Text at 400 chars/s in 24-char deltas with ±25% jitter per delta.
- Tool inputs emitted whole after the text, as now.
- Thinking blocks are never scripted. The trail shows the text and the tool rows, which is what a live run shows when thinking is low.

S1 ingest budget on a warm machine: turn 0 (1.5 s lead, `file_source` copies the transcript and commits, ~0.4 s), turn 1 (0.7 s, six proposals applied and committed, ~0.6 s), turn 2 (0.7 s, `get_voice`, one read, two updates, two drafts, ~0.5 s), turn 3 (1.2 s lead, 330 characters at 400/s, ~0.8 s). About 6.4 s from drop to closing line, against five minutes recorded and about a minute replayed.

### 4.6 Fast ingest

Two things make it fast. The script skips the exploration: no `files_list`, `input.md`, `vault_list` x4, `vault_read` x10, `vault_grep`, and no `check_claims`, so an arrival is 4 turns instead of 17. And the cheap calls that remain are answered in-process by rule with no pause. The receipt will list fewer reads than a real run. That is a visible difference only on the session receipt page, and a script may keep one or two reads if the receipt matters for a scenario.

`check_claims` is still worth one call in a script when a scenario's beat is "it noticed a contradiction", because the tool's own result text is what the model reads and the CONFLICT line comes from `lookups.claims`. Section 4.1 shows the entry.

### 4.7 Authoring: a recording becomes a script

1. Press Start on the scenario, run it once in record mode as today (`QALE_DEMO=1 QALE_DEMO_RECORD=1 pnpm desktop`). The recorder is unchanged.
2. `pnpm demo:draft --scenario s1 --from demo/recordings/<file>.json` runs `script-from-recording.ts`: keeps every assistant turn's text and tool calls, drops reads (`vault_read`, `vault_list`, `vault_grep`, `search_vault`, `vault_backlinks`, `files_*`, `jira_*`, `confluence_*`) unless `--keep-reads`, drops `check_claims` unless `--keep-claims`, drops thinking blocks, merges turns that became empty, un-slides every date by the recording's `offsetDays` so the script is anchor-dated, rewrites paths that match a calendar mirror or a `sources/<record-day>-` page into `{{date:...}}` and `{{today}}` templates, and flags anything it cannot make stable: a proposal id in an argument, a Jira page id, a `withdraw_proposal`. It writes `demo/scenarios/s1.json` and prints the flags.
3. Edit the file. Sharpen the text, cut a card, fix a `search` block. Nothing on a "request side" exists any more, so any field may change.
4. `pnpm demo:lint` (section 4.8). Fix until green.
5. `QALE_DEMO=1 QALE_DEMO_TODAY=2026-10-01 pnpm desktop`, Start, run it, look at the cards. Commit.

A skill change on `main` after this: run the lint; if it is green, nothing to do; if a tool schema moved, edit the argument the lint names.

### 4.8 The lint

`pnpm demo:lint [--scenario s1]`, a node script under `apps/desktop/test/` tooling or `scripts/lint-demo-scenarios.ts`, run in CI on the `demo` branch and by hand before a demo day. Headless, no Electron, no model.

For each scenario:

1. Shape: the file parses, every `trigger` is one of the three kinds, every tool name is in the registry the session builds (`runtime.ts:1686-1704` exports the name lists), every `input` validates against that tool's TypeBox schema (`packages/agent/src/tools.ts` `parameters`), every template resolves.
2. Workspace: build a temp workspace the way Reset does (`copyVault`, `shiftVaultDates` from `@qale/domain/demo`), open it with the same `UseCaseContext` shape `VaultService.open` builds (`vault-service.ts:57-80`: `FsVault`, `SqliteIndex`, `AppDb`, `GitAdapter`), start the fake Atlassian and Calendar from the fixtures, and run one sync so the calendar mirrors exist.
3. Run: for each conversation, build the tool set the way `createSession` does (`createVaultTools`, proposal tools, drafting tools, filing tools, with a `SessionHarness`) and execute each turn's tool calls in order against that context, feeding nothing to any model. A tool result that starts with `Rejected:`, `Not withdrawn:`, `cannot read` or throws is a lint error naming the scenario, turn, tool and the result text. A `patch` whose `search` is not found is caught here. A drafting tool's result is checked for `Awaiting approval`.
4. Dates: run step 3 at offsets 0, 12 and 65, the three the date-shift fix used, so a template that only works today is caught.
5. Warnings: `ask_user` turns, a script that does not end on a text turn, a `lookups.claims` key that no `check_claims` call in the scenario mentions.

The test helpers in `packages/agent/test/tools.test.ts` and `apps/desktop/test/demo-service.test.ts` already build contexts and temp workspaces; the lint reuses those patterns rather than the Electron `VaultService`.

## 5. What gets deleted

- `apps/desktop/src/main/demo/replay-matcher.ts` and `apps/desktop/test/replay-matcher.test.ts` (the date tests in it move to a `replay-dates.test.ts`).
- `demo/recordings/*.json` except `_fallback.json`. The five session recordings are converted to scripts first, then removed. The 20 claim, 7 summary and 3 naming recordings are replaced by rules.
- `Recording.offsetDays` and the `slide` arithmetic in `replay-server.ts:131-132` (scripts are anchor-dated; the offset is today's).
- `MIN_PREFIX_RATIO`, `systemSimilarity`, `closeEnough`, and the `nameList` justification comment at `handlers.ts:2361-2364` (the kickoff change itself can stay; it is a product improvement).
- DM-4, DM-6 and DM-10 in `docs/demo-mode.md` are rewritten to point here; DS-2, DS-3, DS-4 and DS-7 in `docs/demo-scenarios.md` are superseded.
- The runbook's "nothing is typed" rule and the "three answers this take needs" table.

Kept: the server, `replay-sse.ts`, `replay-dates.ts`, the recorder and `forwardAndRecord`, both fakes, Reset, `_fallback.json`.

## 6. Implementation sequence

Each step is one commit and leaves `pnpm test`, `check-types` and `lint` green.

1. **Gate the post-open sweep in demo.** `handlers.ts:695` runs only `syncService.tick()` when `demo` is set. Verify: launch the demo build, watch the console, no `summarise` request reaches the replay server.
2. **Scenario types and loader.** `scenario.ts`, `loadScenarios`, shape validation, a unit test over a fixture file. Bundle `demo/scenarios/` (already inside `demo/`).
3. **Templates.** `script-templates.ts` with `{{today}}`, `{{today±n}}`, `{{date:X}}` and the hand-off to `shiftResponseDates`. Unit test at offsets 0, 12, 65 including a path inside a wikilink.
4. **Cheap answers.** `cheap-answers.ts` for the four single-turn prompts, with lookups and defaults. Unit test: a claim with an entry gets its line, one without gets `NEW | - | -`, the naming call gets the bound title.
5. **Script engine.** `script-engine.ts`: classification, bindings, pin, off script. Unit tests: a kickoff binds by skill name, two typed openings in one scenario bind in order, a typo in the typed text changes nothing, a request past the last turn gets the off-script line, Reset clears bindings.
6. **Server switch.** `replay-server.ts` calls the engine; `pin()`; per-turn `pause`; jitter in `replay-sse.ts`. Update `replay-server.test.ts` to serve from a scenario file. Delete `replay-matcher.ts` and its test (dates test moved).
7. **Start button.** `DemoService.startScenario`, `DemoInfoDTO.scenarios` and `pinned`, the `demo:startScenario` channel, `DemoSettings.tsx` rows. `demo-service.test.ts` gets a test that Start pins after reset. Verify in a live window: press Start on S3, paste the thread, see the cards.
8. **Converter.** `script-from-recording.ts` and `pnpm demo:draft`. Run it over the five 2026-09-08 session recordings and commit the drafts as `demo/scenarios/s1..s5.json` with a `draft: true` flag until edited.
9. **Lint.** `pnpm demo:lint` as in 4.8, wired into the `demo` branch's CI. First run will fail on the drafts; that is the point.
10. **Author the five scripts.** Edit until the lint is green at three offsets, then a full cold run of each scenario on a pinned other day. Remove the recordings, remove `draft: true`.
11. **Docs.** `demo-mode.md`, `demo-scenarios.md`, `demo-runbook.md` and `demo-brief.md` updated; the runbook becomes "Start, do the one thing, approve".

Steps 1 to 6 do not need the scenario content decisions. Steps 8 to 10 do.

## 7. Risks and open questions

**Tool results carry ids the next turn may need** (proposal ids for `withdraw_proposal`, Jira page ids). Recommended: v1 has no result capture. The converter flags these and the author removes the call. `withdraw_proposal` in the recording was the model correcting itself; a script has nothing to correct.

**A script that skips reads makes a thinner receipt.** The session receipt lists reads and writes. Recommended: accept it. A scenario whose beat is the receipt keeps two or three reads in its script.

**`file_source` names the source page by today's date, and later citations must match.** Recommended: `{{today}}` in the citation, and the lint runs the whole conversation so a mismatch fails.

**Two sessions live at once** (an arrival still running while a question is typed). Bindings are per first message, so both route correctly. Cheap calls from both are stateless. No risk found.

**Skill or prompt drift after a merge from `main`.** A renamed tool or a changed schema fails the lint; a changed skill body changes nothing on screen. What the lint cannot see is a policy change in the tools, such as `propose_update` starting to wait for approval where it used to apply, which changes the card count on screen. Recommended: the cold run in step 10 is repeated after any merge that touches `packages/agent/src/tools.ts` or `packages/application/src/use-cases/proposals.ts`, and that rule goes in `demo-brief.md`.

**Calendar mirror paths depend on the fake calendar's slug rule.** A change in how the sync names meeting pages moves every `{{date:...}}-steering` path. The lint's sync step catches it.

**The sweep gate hides the librarian from the demo.** Run now still fires it and gets the off-script line. Recommended: acceptable; a "Qale tidied up while you were away" beat, if wanted, is a sixth scenario with a `skill: librarian` conversation.

**Should typed text be matched at all, even loosely, to catch a wrong Start?** Recommended: no. The Start button is the scenario selector, and any text matching is the thing this plan removes. The `do` line on the Settings row tells the presenter what to type.

**JSON or Markdown for scripts.** Recommended: JSON with `text` arrays, for v1. If editing is painful after the five are written, a Markdown front-matter form with fenced tool blocks is a converter away and the engine does not change.

**Windows.** The engine is path-free; templates produce forward-slash vault paths as the tools expect. Untested there, as before.

## Files to touch first

- `apps/desktop/src/main/demo/replay-server.ts`: the seam that swaps matcher for engine; pin, pause, reset.
- `apps/desktop/src/main/demo/replay-matcher.ts`: what is deleted; its `normalise` and classification are the only parts carried into the engine.
- `apps/desktop/src/main/demo/demo-service.ts`: Start = reset + pin; scenario list in `info()`.
- `apps/desktop/src/main/handlers.ts`: post-open sweep gate at line 695, `demo:startScenario`, the kickoff at 2358-2373 that defines the `skill` trigger.
- `packages/agent/src/claims.ts` and `packages/agent/src/summaries.ts`: the cheap-call prompts the rule engine classifies on.
