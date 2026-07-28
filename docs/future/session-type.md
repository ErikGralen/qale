# `sessionType` — where it stands after Sessions v2

**Status: open, nothing decided. 2026-07-28.** Written to brainstorm against, not as a plan.

## What it was

Before Sessions v2, `sessionType` was a mode. You opened a session *as* After-Meeting or *as*
Ask, and that choice fixed everything for its whole life: which skill file it read, which tools it
got, whether output was gated, what the tab said, how its cards grouped in the Inbox.

## What Sessions v2 did to it

Phase 4 dissolved session types. Every session now opens on the same base skill (`chat`), and the
requested type is applied as the *first invocation* — the same path the agent's own `use_skill`
and the composer picker use. A second skill can arrive after it, and each arrival brings its own
tier, checkpoints and gate.

We kept the field name because renaming it would have touched persisted data in three places and
the phase was already large. So `sessionType` survived with its meaning changed underneath it.

## What it is doing right now

It carries two jobs that have nothing to do with each other.

**Job 1 — which skill to invoke.** `AgentRunInput.sessionType` (the first invocation),
`schedules[].sessionType` (the scheduler), `AgentPingDTO.sessionType` (which skill opens when you
take a ping's conversation), `ViewBody.sessionType` (the tab's opening skill). All of these are
naming a skill to run.

**Job 2 — what a past session was about.** `ChatRef.sessionType` (the chats list and sidebar rail,
read back from a marker stamped into the pi JSONL at creation), `ProposalDTO.sessionType` (which
skill produced a card, used to group the Inbox), `SessionStatus.sessionType` (the OS notification
title). All of these are a label on something that already happened.

Phase 4 added `harness.primarySkillName` — the first skill that arrived, memoized so a later
arrival can't rename an already-filed receipt — and the session receipt uses it. Nothing else does;
job 2 is still served by the marker stamped at creation.

## Where the confusion shows

- The word says "type", the thing is an invocation. A session has no type any more.
- One field means "run this" in some places and "this is what it was" in others, and those can
  differ: a session opened as `chat` that pulls in `synthesis` still reads as `chat` everywhere
  except its receipt.
- `SessionType` (`dtos.ts:468`) is a union of four names — one of which, `after-meeting`, is no
  longer a shipped skill — ending in `| (string & {})`, so it constrains nothing. One call site.
- `ChatSessionType` (`app-state.tsx:52`) is the same union again, exported, referenced nowhere.

## What's in the way of changing it

`sessionType` is persisted in three stores, so a rename either reads both keys for a while or
accepts that existing records lose their label:

- the `pm.session` marker in every pi JSONL transcript (`runtime.ts`, stamped once at creation),
- the tab state in localStorage (`ViewBody`),
- the proposal rows in the app DB (`ProposalDTO.sessionType`).

Pre-alpha, with two vaults that both belong to us, losing old labels is cheap.

## Deliberately not tangled with this

How permissions get declared — the skill `tier`, and the per-binding `tier` Phase 5 added — is
parked separately and likely to move. It doesn't overlap with the naming question.
