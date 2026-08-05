# Capture nudge and the coach agent

Status: Parts 1 and 2 built 2026-08-02 (CN-1..4). Part 3, the coach agent, is
not built and is still a plan.

Three things came out differently from the sketch below, all of them small:

- **`endMs` is derived, not stored.** A meeting ref already carries `date`,
  `time` and `durationMin`, so `meetingEnd` in `lib/note-status.ts` computes the
  end rather than the index carrying a fourth field that could disagree with the
  other three. An all-day entry ends when its day does, so a bare date is asked
  about the next morning instead of an hour after midnight. `captured` did need
  the index: `has_body` is a new column, because the lists never carry a body.
- **The row's right-hand line is `add a transcript`.** "Drop the transcript or
  jot three lines" is the block on the meeting page; on Home that column is a
  short fact beside a truncating label, and the longer sentence squeezed it.
- **Only a named row can be waved off.** The door standing for several meetings
  has no dismiss, because it is not about any one of them. The series mute is
  still reachable the way it actually happens: instances turn up one at a time,
  and the second dismissal silences the series.

## The problem

The product gets better the more the user feeds it: transcripts, meeting notes, dropped material. But nothing in the app ever asks for any of it. Worse, the one moment where asking would feel natural is currently invisible:

- Calendar sync creates a meeting note from every qualifying event (`sync-service.ts:497-560`), with no body and no `processing` state.
- `needsReview` only fires on `processing: new | stale` (`lib/note-status.ts:56-59`), and only a transcript attach sets that (`use-cases/notes.ts:163-166`).
- So a meeting that happened yesterday and got nothing captured never shows up anywhere. The app knows the meeting happened, knows it has no transcript (`zMeeting.transcript`, `frontmatter.ts:138-142`), and says nothing.

The user opens the app, sees an empty-ish Home, and leaves. The habit never forms.

## Principles

1. **A row, not an interruption.** The nudge is a line in "Waiting on you" that exists while it is true and vanishes when it stops being true. No OS notification, no dock badge, no modal, no sound. Same doctrine as the librarian's maintenance rows (`refreshDockBadge` in `handlers.ts`).
2. **Anchored to a real thing, not an interval.** We nudge about *this meeting*, never "you haven't added anything in a while". The overdue-todo interval sweep was deleted for exactly this reason: interval sweeps pile up duplicate, un-actioned nags (`scheduler-service.ts:74-78`).
3. **Lives where its subject lives.** The primary home is the meeting note itself; Home gets one summary row. Never the Inbox's maintenance section, which is the librarian's and is for workspace upkeep only.
4. **Dismissal is respected and remembered.** Dismiss a meeting's nudge once and it never comes back. Dismiss the same recurring series twice and the whole series goes quiet.
5. **The ask carries the payoff.** Where we can, the copy says what the user gets, not what they owe: "Thursday's prep will be thin without this" beats "you forgot to upload".
6. **Old guilt expires.** A meeting nobody captured within a few days is a lost cause. The nudge disappears on its own instead of accumulating.

## Part 1: the capture row on Home

### Trigger

A meeting note qualifies for a nudge when all of these hold:

- It is calendar-synced (`external_id` set) and not cancelled.
- The event ended at least 1 hour ago and less than 4 days ago.
- It has no `transcript` ref and an empty body (nothing below the frontmatter).
- It is not dismissed, and its `series` is not muted.

The 1 hour delay matters: nudging while the meeting is still fresh-but-busy feels naggy. The sweet spot is the next time they naturally open the app.

### Surface

A new `AttentionKind: 'capture'` in `attention.ts`, ranked between `review` and `todo`:

- One meeting: `Yesterday's Nordkap sync has nothing in it yet` with meta `Drop the transcript or jot three lines`. Tone `muted`, not `warning`. Nothing is wrong; something is possible.
- Two or more: collapse to a door row via the existing `door()` mechanism (`attention.ts:339-382`): `3 meetings this week have nothing in them yet`, opening the meetings folder.
- Hard cap: `capture` occupies at most one of the four Home rows, and real work (questions, cards, reviews) always outranks it.

Clicking the single-meeting row opens capture with the meeting preselected: `requestCapture()` already exists (`lib/capture-event.ts`) and the arrival pipeline already supports attaching to a meeting (`ArrivalItemInputDTO.attachTo`, `ArrivalPlanDTO.match`). This is wiring, not new machinery.

### Dismiss

Hover X on the row, like notices. Two levels:

- Per meeting: gone forever. Stored as a check-ledger row `capture-nudge:<notePath>` (the ledger is the app's existing durable per-key store, `packages/vault/src/check-ledger.ts`; localStorage would not survive a vault move and the state is really about the note, not the window).
- Per series: when the user dismisses two meetings from the same `series` (frontmatter already carries it), store `capture-mute:<series>` and stop nudging that series. Show a one-line undo in the row's place the moment it happens: `Okay, no more reminders for this series.` A weekly internal sync they never capture stops costing attention after two clicks, without any settings screen.

### Plumbing

The attention list derives in the renderer from `vault:tree()`, but `NoteRefDTO` (`dto.ts:57-92`) exposes neither `transcript` nor body-emptiness. Two options:

- **A (preferred): enrich the DTO.** Add `captured: boolean` (transcript set or body non-empty) and `endMs` to meeting refs at index time. Attention logic stays where all of it already lives, in `buildAttention`.
- B: a main-side IPC `meetings:uncaptured()` walking `syncService.agenda()`. Rejected: splits the attention derivation across two processes.

Dismissed/muted keys come over on the same tree payload or a tiny `captureNudge:state` IPC.

## Part 2: the nudge on the meeting note itself

The owning-view half. An empty, ended, synced meeting note renders a quiet inline block above the body:

> This meeting has nothing in it yet.
> [Add transcript] [Write what happened]

- "Add transcript" opens capture attached to this meeting (same `attachTo` path).
- "Write what happened" just focuses the editor. Three typed lines are worth more than a guilt trip about a missing transcript.
- The block disappears the moment there is any body content. No dismiss needed here; it is part of the empty state, like the day-one Home pitch (`Home.tsx:706-724`).

This also fixes a real dead end: today a user who opens an auto-created meeting note sees machine frontmatter and a blank page, with no hint that dropping a transcript here is the whole point of the product.

## Part 3: the coach agent (on/off)

An optional roster agent that looks at how the workspace is actually being used and suggests one improvement a week. Deliberately small.

### Fit with the existing model

- File: `agents/coach/AGENT.md`, seeded via `DEFAULT_AGENTS` (`packages/sessions/src/defaults.ts:742-745`) like librarian and meeting-prep. Toggle is frontmatter `enabled`, flipped from the agents page like the others (`setAgentFileEnabled`). **Default: off.** It earns its place by being asked for; an agent that watches usage should be opted into, not discovered running.
- Clock: a weekly `ScheduleEntry` (the `weekly-update` shape, `settings-service.ts:69`), Monday morning. Declared in `CODE_RUN_FACTS` so the agents page shows when it runs.
- It runs `scheduled: true`, so the whole quiet machinery applies (`packages/agent/src/quiet.ts`): if it finds nothing worth saying, it ends quietly. No receipt, no row, nothing. Most weeks this should be the outcome.

### What it reads

No new telemetry. The approval-stats surface was removed on purpose (`89a79c6`); we do not rebuild it. The agent reads what already exists, at run time:

- Meetings last week from `syncService.agenda()` vs. which have `transcript`/content: the capture rate.
- `runnable-used:<name>` ledger stamps: skills and agents that have never run.
- Proposal records (created/resolved/status): cards piling up unreviewed.
- The todo store: commitments untouched for weeks.

### What it produces

> **Note, 2026-08-05.** This part was written against the ping queue, which no longer exists (see `docs/librarian-agentic.md`). The drawer it wanted is now the Librarian section at the bottom of the Inbox, and the way into it is an `ask_user` question from a run the clock started, which is quiet by the same rule. The per-topic cooldown needs its own check-ledger row (`coach:<topic>`) the way the librarian's findings do; there is no ping dedupe left to lean on.

At most **one** suggestion per run, in the Inbox's quiet maintenance section, plus a per-topic cooldown of a month so the same advice cannot recur monthly-nagging style. Examples of the register:

> You added notes to 2 of 6 meetings last week. The four empty ones are in the meetings folder if any are worth three lines.

> The weekly update skill has never run. If Friday summaries would help, turn it on in Settings.

One observation, one concrete next step, no score, no streak, no chart.

## What we deliberately do not build

- **No notifications or badges** for any of this, ever.
- **No streaks, scores, or completion percentages.** The removed telemetry surface taught us these read as trivia and pressure ("N edited" counted a typo fix and a rewrite identically).
- **No blanket reminder** ("you haven't opened the app in 3 days"). That is what the OS calendar and every abandoned app in the world already do.
- **No nudging meetings the user merely declined or that had no real attendees**: `eventQualifies` (`event-mirror.ts:56`) already filters these before a note exists.

## Open questions for Erik

1. Coach default off (proposed) or on-with-first-run-notice?
2. The 4-day expiry window for capture rows: right length? Shorter (2 days) is humbler, longer catches Monday-after-Friday.
3. Should the series mute have any visible list (Settings row: "Muted series") or is undo-at-mute-time enough for v1?
4. Name "coach": keep, or plainer ("check-in"?). Copy above is draft register, not final.

## Tickets

- ~~CN-1: expose `captured` + `endMs` on meeting `NoteRefDTO` at index time.~~ Done.
- ~~CN-2: `capture` attention kind + door collapse + Home row wiring to `requestCapture(attachTo)`.~~ Done.
- ~~CN-3: dismiss/mute check-ledger keys + undo row.~~ Done.
- ~~CN-4: empty-meeting inline block on the note view.~~ Done.
- CN-5: coach agent file + weekly schedule entry + `CODE_RUN_FACTS` clock.
- CN-6: coach run prompt + how much it may raise (1 suggestion per run, month cooldown per topic).

Phase 1 was CN-1..4 (the actual ask); CN-5..6 ship separately and only if Phase 1 feels right.

## Where it lives

- `packages/vault/src/sqlite-index.ts` — `has_body` (schema v4, so the next open
  rebuilds the index).
- `apps/desktop/src/main/dto.ts` — `synced` / `captured` / `series` on meeting refs.
- `packages/application/src/use-cases/capture-nudge.ts` — the dismiss/mute
  ledger, plus `captureNudge:state|dismiss|undo` in `handlers.ts`.
- `apps/desktop/src/renderer/src/lib/note-status.ts` — `meetingEnd`, `needsCapture`.
- `apps/desktop/src/renderer/src/lib/attention.ts` — the `capture` kind and its door.
- `Home.tsx` (row, dismiss, undo line), `AddMaterial.tsx` (preset meeting),
  `NoteView.tsx` (the empty-meeting block).
- `apps/desktop/test/attention.test.ts` — the trigger, the window, the mute.
