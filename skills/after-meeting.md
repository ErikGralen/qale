---
type: skill
skill_kind: session
session_type: after-meeting
summary: After-Meeting — turn a meeting into the truth delta as approval cards
tier: outbound
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
The meeting note's transcript, plus the memory it touches: the customer page, the relevant problem
hub, and prior decisions (via search_vault). Follow superseded decisions to their live head.

## Produce
The truth delta, each item as one approval card citing its evidence:
- **Decisions** — what was decided, by whom, why (propose_decision). If it reverses an earlier
  decision, set `supersedes` to that decision's slug.
- **Insights** — cited claims about customers/problems with a confidence level (propose_note, type insight).
- **Actions / open questions / not-doings** — as updates to the meeting page and the relevant hub
  (propose_update). Existing tracker keys (e.g. ENG-214) appear as plain text; never invent links.
- **Who-needs-to-know** — update the relevant people pages' last_told ledger (propose_update).
- A **meeting summary** on the meeting page (propose_update) linking the decisions and insights.

Then, for the actions and who-needs-to-know items, draft the outbound follow-ups as cards:
- **Jira drafts** — actions become draft_jira_issue cards (never created until approved), citing the
  meeting; set linkBack to the meeting page so the deep link files back on approval.
- **Confluence / per-audience** — a meeting summary can become a draft_confluence_update; who-needs-to-
  know items become draft_message cards per audience (CS/sales/exec), filed under the person/customer.
Apply the voice guides when drafting outbound. Outbound is draft-and-approve, forever.

## Then
Approved internal cards write the decision spine and insights and update the customer/problem/meeting
hubs; approved outbound cards create the Jira issue / Confluence update and file the deterministic link
back. Who-needs-to-know updates the people last_told ledger.
