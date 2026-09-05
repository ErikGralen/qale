# Demo mode: a build that answers the same way every time

First draft, 2026-09-05. Not decided.

The cofounder needs a Qale he can install and demo without a key, a network, or a good day at
the model. He drops a transcript, the app waits a few seconds, and the same answer comes out
every time. The rest of the product works as it does today. He can reset the demo, and the
reset puts the files back and moves every date to today. Jira and Confluence are mocked.

The work lives on a branch (`demo`). Nothing here lands on `main`.

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

**Decision:**

**Notes:**

---

### DM-2. First launch lands in the demo, no onboarding

**What:** The 7-screen opening asks for a workspace, a key, a name and connections. In the demo
build all of that is known.

**Change:** On first launch of a demo build, before the window opens: run Reset (DM-8), then
write settings: `vaultPath` = the demo workspace (`<userData>/workspace`), provider
`anthropic` with key `demo`, the Atlassian connection with site `tavla.atlassian.net`, email
and token `demo`, onboarding `finishedAt` set, telemetry off, the PM's identity set to the
scenario's PM. The Home page opens on the Tavla vault.

**Decision:**

**Notes:** Telemetry stays off in demo, always. A demo in front of a customer must not send
events under the cofounder's install id.

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

**Decision:**

**Notes:** The server also has to answer `/v1/models` so `verifyProviderKey` passes if it
ever runs. Bind to `127.0.0.1` only.

---

### DM-4. Matching: the same prefix gets the next recorded turn

**What:** The hard part. Requests are not byte-identical between runs: session ids, dates,
timestamps and byte counts change. Matching on a hash of the request would never hit.

**Change:** Each recording is one conversation: `{ turns: [{ request, response }] }`. To
answer a request:

1. Normalise every `user`-role message in it (user text and tool results): replace UUIDs,
   `YYYY-MM-DD` dates, ISO timestamps and long digit runs with placeholders.
2. Do the same to every recording's requests once at load.
3. Pick the recording whose normalised user-side prefix matches the request's best (longest
   common prefix over user messages, then over the system prompt).
4. Return the recorded turn at index = number of assistant messages already in the request.

Assistant messages are not compared. That is what makes hand edits possible: after you change
a recorded answer, the app sends the changed text back in the next request, and the matcher
still finds the conversation because it only reads the user side.

Recorded responses are stored anchored to 2026-07-17 like the vault. At replay, every date
token in a response is slid by the same offset Reset used. A recorded todo due "2026-07-25"
comes out due eight days from the demo day, the same day the vault says.

**Decision:**

**Notes:** A single-turn `completeSimple` call (naming, a summary, a claim check) is a
conversation of length one. Same mechanism. One recording file per conversation under
`demo/recordings/<short-key>.json`, where the key is the first user line, slugged, so the
folder reads like the demo script.

---

### DM-5. Pacing

**What:** A recorded answer that arrives in 30 ms looks fake. "It waits 5 seconds" was the
ask.

**Change:** Three constants in the replay server: `FIRST_TURN_DELAY_MS = 5000` before the first
byte of a conversation's first turn, `TURN_DELAY_MS = 1200` before every later turn, and a
text stream rate of roughly 400 characters per second. Tool-call turns get the turn delay and
then emit whole. The recording carries no timing.

**Decision:**

**Notes:**

---

### DM-6. When nothing matches

**What:** The cofounder types a question nobody recorded. The matcher scores every recording
low.

**Change:** Below a match threshold the server returns one fixed text turn, itself in a
recording file (`demo/recordings/_fallback.json`) so it can be edited like the rest:

> I'm the demo build, so I only know the walkthrough. Try one of the three prompts on the
> Home page, or drop one of the two transcripts.

Alternative: if the demo build also has a real key on file, forward unmatched requests live.
Costs a key on his machine and a network. Not in this draft.

**Decision:**

**Notes:**

---

### DM-7. The clocks stop

**What:** The 5-minute tick would call the model for the librarian, the summary pass and
meeting prep. None of those requests match a recording unless we record the tick too, and
the fallback text would then be filed as a summary.

**Change:** In demo mode `SchedulerService.start()` does not start the interval and does not
run the launch catch-up. "Run now" still works, so a librarian run can be demoed if we record
one. Connector sync runs once at launch and once after any Jira/Confluence write, called
directly, so the fake tracker's changes still show up.

**Decision:**

**Notes:** If we want the "Qale tidied up while you were away" moment in the demo, record one
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

**Decision:**

**Notes:** The static mirrors already carry `tavla.atlassian.net` and the `PAY-*` keys, so no
reconcile step is needed. That is the whole reason to fake the API instead of pointing at the
live demo site. Google Calendar is not mocked: the demo build has no Google client baked in,
and the scenario's meetings are already notes in the vault.

---

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
   reach. Also the vault's `.git`, which step 3 already removed.
5. Reset the fake Atlassian store to the fixture.
6. Reset the replay server's state (it holds none beyond the loaded recordings).
7. Reopen the workspace.

The same routine runs on first launch (DM-2). A confirm dialog first, since it throws away
whatever he did in the last demo.

**Decision:**

**Notes:** The demo files he drags in have to be somewhere he can find them. Reset also copies
`demo-samples/` to `~/Desktop/Qale demo files/`, and the Demo section has an "Open demo
files" button.

---

## E. The recording workflow

### DM-10. Record once, tweak, commit

**What:** How the recordings get made, and how they stay honest.

**Change:** A runbook, in this doc once decided:

1. `git checkout demo`, `pnpm refresh-demo`.
2. `QALE_DEMO=1 QALE_DEMO_RECORD=1 pnpm desktop` with a real Anthropic key in Settings. The
   replay server proxies and records into `demo/recordings/`.
3. Walk the script in order: drop the Nordkap transcript, approve the cards; drop the
   Kranelund transcript, approve; paste the standup note; the three chat prompts; one Jira
   write (create the SCIM ticket) and one Confluence write; one librarian "Run now" if DM-7
   wants it.
4. Read the recordings. Fix wording, cut a weak insight, sharpen a headline. Only edit
   `response` content. Do not touch the `request` side: that is what the matcher reads.
5. `pnpm test`, then a full replay run with the clock pinned to another day to prove the date
   shift holds: `QALE_DEMO=1 QALE_DEMO_TODAY=2026-10-01 pnpm desktop`.
6. Commit recordings + fixture on `demo`. Build the dmg.

**Decision:**

**Notes:** Recordings contain the system prompt, which contains the skill files. When a skill
changes on `main` and `demo` takes the merge, the prefix match still holds (the system prompt
is the tiebreaker, not the key), but the recorded answers may no longer fit the new
instructions. Re-record after any merge that touches `skills/` or `prompts.ts`. Budget a
re-record as a one-hour job.

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

**Decision:**

**Notes:**

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
