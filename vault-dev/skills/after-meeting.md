---
type: skill
skill_kind: session
session_type: after-meeting
summary: After-Meeting — turn a meeting into the truth delta as approval cards
tier: suggest
checkpoints: [digest, outline, draft]
gate_output: true
completion_bar: Every truth-delta item cites the transcript or prior memory; nothing asserted uncited.
stopping_conditions:
  - The meeting is flagged safe_space — do nothing, say the meeting was private.
red_flags:
  - A decision with no decider or date — ask before drafting it.
  - A claim that contradicts an existing decision or insight — flag it, do not overwrite.
---

## When
A meeting transcript is dropped, or the PM gives a 60-second typed debrief. The meeting isn't over
until the systems are updated.

## Read
The meeting note and its transcript — follow the `transcript` frontmatter ref to the source note
(older meetings carry it inline under `## Transcript`) — plus the memory it touches: the customer
page, the relevant problem hub, and prior decisions (via search_vault). Follow superseded decisions
to their live head. If the meeting has a `## Prep` section, note which prep questions got answered.

## Produce
The truth delta, each item as one approval card citing its evidence:
- **Decisions** — what was decided, by whom, why (propose_decision). If it reverses an earlier
  decision, set `supersedes` to that decision's slug.
- **Insights** — cited claims about customers/problems with a confidence level (propose_note, type insight).
- **Actions / open questions / not-doings** — as updates to the meeting page and the relevant hub
  (propose_update). Existing tracker keys (e.g. ENG-214) appear as plain text; never invent links.
- **Commitments** — every "I'll …" becomes a todo card (propose_todo) citing the meeting, with the
  verbatim quote. The PM's own commitments get no owner; someone else's ("Jonas: I'll update the
  docs") set `owner` to that person. Date only if one was named or clearly implied. Check existing
  todos first (vault_list type "todo") and skip anything already tracked.
- **Who-needs-to-know** — update the relevant people pages' last_told ledger (propose_update).
- A **meeting summary** on the meeting page (propose_update) linking the decisions and insights.

Tag every proposed note with 1–2 contexts (`tags`) drawn from tags already in use in the workspace;
a brand-new context must be named in the card's rationale ("new context: #x") per the filing rules.

## Then
Approved cards write the decision spine and insights, update the customer/problem/meeting hubs, and
advance the people last_told ledgers. Nothing reaches Jira/Confluence here — that is the outbound tier.
