# The demo, in one page

Orientation for someone picking this up cold. Written 2026-09-05, updated 2026-09-10. The
detail is in `docs/demo-mode.md` (the machinery), `docs/demo-runbook.md` (how to run or author a
scenario), and `docs/plan-demo-bookings.md` (why the six scenarios are what they are).
`docs/demo-flows.md`, `docs/demo-scenarios.md` and `docs/plan-demo-scenarios.md` describe the
earlier demo, kept for their reasoning and marked as replaced where they are.

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
  `Model` gets its `baseUrl` pointed at it. Six scenario scripts, `demo/scenarios/s1.json` to
  `s6.json`, say what the assistant says and which tools it calls, turn by turn. A script engine
  classifies what starts a session (a skill kickoff by its skill name, something typed by the
  skill in force when it was typed plus a word the `do` line makes the presenter type, a
  spawned child), binds it to the first free matching conversation across the six scenarios,
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

**Bord**, a Nordic company of about 250 people making table-booking software for restaurants.
A guest books on the restaurant's website or through Google, and a text reminder goes out the
day before. You are the PO for two teams, Bookings (`BOK`) and Guest (`GST`); Payments (`PAY`)
is another team. The cast, the tickets, the Confluence space (`PROD`) and the customers are in
`vault-dev/`; the names and facts are in the plan, `docs/plan-demo-bookings.md`. Six scenarios
in `demo/scenarios/`, and the first two always run first, in order: drop yesterday's customer
review and get the date you gave and the bug you missed onto Jira, Confluence and the record
(S1); refine the epic into stories in two rounds of chips (S2). Then any of the rest, in any
order, each once: who should know a fix shipped (S3); an urgent sales ask checked against the
record (S4); the Friday update for one channel and the public Changelog (S5); the brief for
Thursday's steering (S6). One Reset before the demo, none between: the engine picks the scenario
from what the presenter does. The five pains behind them are in the plan's header.

## What we are trying to do now

**Running the Bord recut in front of a room.** The recut is built: the vault, the two fixtures,
the six scripts, the pins and the lint's sequence pass (`docs/plan-demo-bookings.md`). The
presenter's card is `demo-samples/README.md` and the turn-by-turn is `docs/demo-runbook.md`.
What is left is a cold run of the packaged demo build on a day nobody drafted against, and
whatever that run turns up. The old per-conversation recordings under `demo/recordings/`
(everything but `_fallback.json`) were only ever a way to draft scripts and can go.

## Where things stand (2026-09-10)

- **Branch `demo`.** Merges go one way, `main` into `demo`.
- **The Bord recut is built.** `vault-dev/` is Bord (people, customers, research, decisions,
  insights, meetings, todos, notes, ticket mirrors, the two Confluence pages, three voices), the
  Atlassian and Google fixtures are rebuilt from the new casts, `demo-samples/` holds the
  Brasserie Lund transcript and the Marcus message, and `DEFAULT_PINS` is the six Bord paths.
- **Six scripts, `s1.json` to `s6.json`.** S1 and S2 always first, in order; S3 to S6 in any
  order, each once. Every script's text may assume S1 and S2 ran; no tool call does.
- **The lint is green**: every script alone at three date offsets, and the sequence pass in four
  orders (S1, S2, then S3 to S6 forwards; backwards; S4 then S3; S6 alone) on one workspace with
  no reset between. The desktop tests pass.
- **Settings has one Reset button and the six scenarios as a reminder** (`DemoSettings.tsx`).
  The first two rows say they run first, in order. There is no Start button and no pin.
- **Not yet done:** a cold run of the packaged demo build on a day nobody drafted against.

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
