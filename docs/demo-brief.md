# The demo, in one page

Orientation for someone picking this up cold. Written 2026-09-05, updated 2026-09-09. The
detail is in `docs/demo-mode.md` (the machinery), `docs/demo-runbook.md` (how to run or author a
scenario), and `docs/plan-demo-scenarios.md` (why the five scenarios are what they are).
`docs/demo-flows.md` and `docs/demo-scenarios.md` are earlier drafts, kept for their reasoning
and marked as replaced where they are.

## What Qale is

A desktop app for a product owner. It reads the material a PM already produces (meeting
transcripts, chat threads, tickets) and keeps a markdown workspace of decisions, todos, people,
customers and themes. It writes to Jira and Confluence through approval cards. `apps/desktop/PRODUCT.md`
says what it refuses to be.

## What demo mode is

A separate build, "Qale Demo", that answers every model call from a script instead of from
Anthropic. It needs no API key, no network and no accounts. The product code is unchanged:
tools run for real against a real workspace, so every card, diff and Activity row is produced
the way it is in production. Four things are swapped underneath:

- **The model.** A replay server on `127.0.0.1` speaks the Anthropic Messages API. Every pi
  `Model` gets its `baseUrl` pointed at it. Five scenario scripts, `demo/scenarios/s1.json` to
  `s5.json`, say what the assistant says and which tools it calls, turn by turn. A script engine
  classifies what starts a session (a skill kickoff by its skill name, something typed by the
  skill in force when it was typed plus a word the `do` line makes the presenter type, a
  spawned child), binds it to the first free matching conversation across the five scenarios,
  and serves the turn at that position. Beyond those words nothing typed is read, so a typo or
  a paraphrase changes nothing. Off script, one fixed line answers and nothing advances.
- **Jira and Confluence.** An in-memory fake behind the connector's `fetchImpl`, fed from
  `demo/atlassian-fixture.json`.
- **Google Calendar.** The same trick, from `demo/google-fixture.json`.
- **The workspace.** Reset deletes it, copies the bundled `vault-dev/` back, and slides every
  date so the demo reads as today. The 5-minute scheduler is off, and the post-open maintenance
  sweep runs only its sync step, so nothing calls the model unattended.

Record mode (`QALE_DEMO_RECORD=1`, dev only, with a real key) forwards to Anthropic and saves
what comes back, as a draft to build a script from. A recording is never the thing that ships.

## Why it exists

Erik's cofounder needs a Qale he can install and demo to customers without a key, a network, or a
good day at the model. Same input, same answer, every time.

## The dataset

**Rota**, a Nordic company of about 250 people making staff-scheduling software for restaurant
and retail chains. You are the PO for two teams. The cast, the tickets (`SCH`, `APP`, `PLT`),
the Confluence space (`PROD`) and the customers are in `vault-dev/`. Five independent scenarios,
in `demo/scenarios/`: drop a steering transcript and get decisions and todos; ask who needs to
know that something shipped; decode an inbound ask that contradicts a live decision; break a
committed theme into Jira stories; write the Friday update in three voices. One Reset before
the demo, then any subset of them in any order, each once, with no reset between: the engine
picks the scenario from what the presenter does.

## What we are trying to do now

**Getting `pnpm demo:lint` green on all five scripts and cutting over from recordings to
scripts as the source of truth.** The scripts, the engine, the Settings tab and the seed recut
are built (`docs/plan-demo-replay.md`, `docs/plan-demo-scenarios.md`). What is still in flight:
two product gaps the reset routine had (it followed the calendar on Reset but not the Jira
projects or the Confluence space, and a voice file needed a matching patch) are being fixed
alongside this. Once the lint is clean at three date offsets, the old per-conversation
recordings under `demo/recordings/` (everything but `_fallback.json`) come out, because they
were only ever a way to draft the scripts.

## Where things stand (2026-09-09)

- **Branch `demo`.** Merges go one way, `main` into `demo`.
- **The script engine replaces the text matcher.** `replay-matcher.ts` is deleted.
  `scenario.ts`, `script-engine.ts`, `script-templates.ts` and `cheap-answers.ts` serve the five
  scripts; `script-from-recording.ts` and `pnpm demo:draft` turn a recording into one;
  `pnpm demo:lint` runs every script headlessly, at three date offsets, against a real
  workspace and the real tools.
- **The seed is recut per scenario.** `APP-54` Done, a second `SCH-121` comment, the Fjord
  Sports/Jonas/Marcus lines, the trimmed steering transcript, the Marcus Slack message in the
  samples README, the Bruno's support thread removed, the `--done` fixture overlay removed.
- **Settings has one Reset button and the five scenarios as a reminder** (`DemoSettings.tsx`).
  There is no Start button and no pin: after one Reset the engine picks the scenario from what
  the presenter does (a drop, a bare skill pick, or the skill in force when he typed), and
  `pnpm demo:lint` runs the five in four orders with no reset between to prove it.
- **The old recordings are still on disk**, kept until the lint is green on the finished
  scripts; they are drafts now, not the thing that ships.

## Things that will bite you

- **A recording is a draft, not truth.** It only feeds `pnpm demo:draft`. What ships is the
  file under `demo/scenarios/`, and any field in it may be hand-edited; there is no "request
  side" left to protect.
- **A script goes stale when a tool's name, its arguments, or its approve-versus-apply policy
  changes**, not when a skill's wording does. Run `pnpm demo:lint` after any merge from `main`
  that touches `packages/agent/src/tools.ts` or `packages/application/src/use-cases/proposals.ts`,
  and one cold run of the affected scenario.
- `pnpm build-demo-fixture` must be re-run after a change to the Jira/Confluence cast or the
  mirrors. Nothing runs it for you.
- `turbo.json`'s `globalEnv` lists `QALE_DEMO`, `QALE_DEMO_RECORD` and `QALE_DEMO_TODAY`. Any
  other `QALE_*` variable is stripped, so use `pnpm --filter @qale/desktop dev` for those.
- The demo workspace has no `.git`, so there is no undo during a demo.
- Read `CLAUDE.md` before writing anything. Plain words, short sentences, no em dashes, and that
  applies to product copy as much as to replies.
