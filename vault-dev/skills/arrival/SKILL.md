---
type: skill
starts: [you-run-it, model-picks-it-up]
title: Handle new material
summary: Reads something you just dropped in and pulls out what needs doing.
---

## When
Something landed in the workspace: a transcript of a meeting the PM was in, a transcript of one
they were not, a link, a screenshot, a pasted thread. The capture pipeline starts this session the
moment the material arrives. One skill handles every kind; the differences are handled under
Produce.

Your job is extraction, not analysis. Record what is literally in the document: commitments,
dates, decisions, people, and anything that contradicts what the memory already holds. Do not look
for patterns. You are reading one document with nothing to compare it against, so any pattern you
see here is a guess. Patterns are the synthesis skill's job; it reads many documents against a
question.

Outbound drafting is only unlocked when the material is a transcript of the PM's own meeting. The
pipeline enforces that through the tool set; nothing written here changes it.

## Read
The document first. For a meeting, follow the `transcript` frontmatter ref to the source note.
Then only the memory it touches: the customer page, the theme hubs it names, live decisions it
might contradict (search_vault), and the mirror notes (tickets/) of any ticket it mentions.
Anything you say about delivery comes from mirror state, never from memory of it.

For a link, work from the URL and whatever the PM pasted with it; do not guess what the page says.
For a screenshot, work from the caption; the image is evidence on disk, not something you can
read.

## Produce
The smallest set of approval cards that captures what the document requires. What you may propose
depends on what the document is, not on how the session was opened.

**A meeting the PM was in** (origin: po):
- **Decisions** made in the meeting, with the decider and the reason (propose_decision). Set
  `supersedes` when it reverses an earlier decision. If there is no clear decider or date, ask
  before drafting; a line someone said out loud is not a decision record yet.
- **Commitments**: every "I'll do X" becomes a todo (propose_todo) citing the meeting with the
  verbatim quote. The PM's own commitments get no `owner`; for anyone else's, set `owner` to that
  person. Set `due` only if a date was named or clearly implied. Check existing todos first
  (vault_list type "todo") so you do not file a duplicate.
- **A meeting summary** on the meeting page (propose_update), plus the hub updates it implies:
  actions, open questions, things explicitly not being done, and `last_told` entries on the people
  pages.
- **External consequences**, only where the meeting forces one: a comment on a linked ticket the
  meeting settles or dates (draft_jira_comment), a ticket for agreed work nothing covers
  (draft_jira_issue), a follow-up that was actually booked with a real time (draft_calendar_event).
  "We should meet again" is not a booking. Most meetings force none of these; skip them rather
  than manufacture them. Every outbound draft cites its evidence, ends with a source line
  ("Source: <meeting>, <date>"), sets linkBack to the meeting page, and follows the voice guides.
  Outbound is always draft-and-approve; nothing sends itself.

**A meeting the PM was not in** (origin: external), such as a colleague's sales call:
- Commitments anyone made, as todos with `owner` set and the verbatim quote.
- Customer signals worth keeping, onto the customer hub (propose_update).
- Who was told what, onto the `last_told` ledger, attributing the speaker.
- Never a decision. A meeting the PM was not in cannot create product truth. If someone promised
  something on the product's behalf ("we told them SCIM lands in Q3"), make that its own card
  marked "commitment made externally, confirm or correct". Do not file it silently.

**A link, screenshot, or pasted thread**: the source body is immutable, so never propose edits to
it. Instead:
- Add links to it from the hubs it concerns (propose_update), where it genuinely adds signal.
- File any commitment or date hiding in it as a todo.
- If it names a person or customer with no page yet, ask before creating one.
- If you cannot tell what it is for, ask one concrete question instead of guessing.

Tag every proposed note with 1-2 contexts (`tags`) drawn from tags already in use; name any
brand-new tag in the card's rationale.

For every card, in every branch:
- Every claim quotes the document or cites existing memory. Nothing uncited.
- A claim that contradicts a live decision or insight becomes its own flag card, never a rewrite.
  Contradictions are the most valuable thing this session can find.
- If the document is empty, or nothing in it needs to happen and nothing contradicts the memory,
  say so and propose nothing. An empty result is correct when the document forces nothing.

## Then
Approved cards land the changes: the decision spine, the commitment ledger, the hubs, the meeting
page. Approved outbound executes upstream and files its link back. The source stays in sources/ as
verbatim evidence and flips new → processed when an approved card cites it. What the document
means, weighed against everything else, is a later synthesis session's question.
