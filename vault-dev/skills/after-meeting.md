---
type: skill
skill_kind: session
session_type: after-meeting
summary: After-Meeting — turn a meeting into the truth delta as approval cards
tier: outbound
checkpoints: [digest, outline, draft]
gate_output: true
bindings:
  - mode: triggered
    event: capture.transcript
    when:
      origin: po
completion_bar: Every truth-delta item cites the transcript or prior memory; nothing asserted uncited.
red_flags:
  - A decision with no decider or date — ask before drafting it.
  - A claim that contradicts an existing decision or insight — flag it, do not overwrite.
  - An outbound card the meeting does not force — draft tracker changes only when the meeting settles, dates or creates tracked work; never reflexively.
---

## When
A meeting transcript is dropped, or the PM gives a 60-second typed debrief. The meeting isn't over
until the systems are updated.

## Read
The meeting note and its transcript — follow the `transcript` frontmatter ref to the source note
(older meetings carry it inline under `## Transcript`) — plus the memory it touches: the customer
page, the relevant theme hub, and prior decisions (via search_vault). Follow superseded decisions
to their live head. If the meeting has a `## Prep` section, note which prep questions got answered.
When the meeting, its series or its hubs link tickets, read their mirror notes (tickets/) so
anything you say about delivery rests on current state, not memory of it.

## Produce
The truth delta, each item as one approval card citing its evidence:
- **Decisions** — what was decided, by whom, why (propose_decision). If it reverses an earlier
  decision, set `supersedes` to that decision's slug.
- **Insights** — cited claims about customers/themes with a confidence level (propose_note, type insight).
- **Actions / open questions / not-doings** — as updates to the meeting page and the relevant hub
  (propose_update). Tickets mirrored in the workspace (tickets/) are wikilinked to their mirror
  notes; keys with no mirror note stay plain text. Never invent keys or links.
- **Commitments** — every "I'll …" becomes a todo card (propose_todo) citing the meeting, with the
  verbatim quote. The PM's own commitments get no owner; someone else's ("Jonas: I'll update the
  docs") set `owner` to that person. Date only if one was named or clearly implied. Check existing
  todos first (vault_list type "todo") and skip anything already tracked.
- **Who-needs-to-know** — update the relevant people pages' last_told ledger (propose_update).
- A **meeting summary** on the meeting page (propose_update) linking the decisions and insights.

Tag every proposed note with 1–2 contexts (`tags`) drawn from tags already in use in the workspace;
a brand-new context must be named in the card's rationale ("new context: #x") per the filing rules.

Then draft the external consequences — ONLY where the meeting actually implies a tracker change;
most meetings imply none, and a card nobody needed is noise:
- **A comment on a linked ticket** (draft_jira_comment) — when the meeting settles, dates or changes
  something an existing ticket tracks. Read the ticket's mirror note first so the comment lands on
  its current state, not a stale memory of it.
- **A new ticket** (draft_jira_issue) — when the meeting produced tracked work no ticket covers.
- **A follow-up on the calendar** (draft_calendar_event) — ONLY when the meeting names a concrete
  next session ("let's reconvene next week", "book 30 with Tom"): draft the event with a real start
  time (RFC3339 with offset), the people it names as attendees, and a body that says what it's for.
  linkBack the meeting page so the created event files back. A vague "we should meet again" is not a
  booking — don't draft one.
- **Per-audience** — who-needs-to-know items become draft_message cards per audience (CS/sales/exec),
  filed under the person/customer; a meeting summary can become a wikipage update (draft_confluence_update).
Every outbound body ends with a provenance line — "Source: <meeting>, <date>" — and every card cites
its evidence (the meeting, the decision it rests on). Set linkBack to the meeting page so the created
key / deep link files back on approval. Apply the voice guides when drafting outbound. Outbound is
draft-and-approve, forever.

## Then
Approved internal cards write the decision spine and insights and update the customer/theme/meeting
hubs; approved outbound cards execute upstream — the ticket comment, the new ticket, the wikipage
update — and file the deterministic link back, and the mirror re-syncs on the next pull.
Who-needs-to-know updates the people last_told ledger.
