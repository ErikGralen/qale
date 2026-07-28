---
type: skill
skill_kind: session
session_type: arrival
summary: Arrival — extract what a dropped document needs you to ACT on, and wire it in
tier: suggest
checkpoints: [digest, delta]
gate_output: true
bindings:
  - mode: triggered
    event: capture.transcript
    when:
      origin: po
    tier: outbound
  - mode: triggered
    event: capture.transcript
    when:
      origin: external
    tier: suggest
  - mode: triggered
    event: capture.ingested
    when:
      kind: link
    tier: suggest
  - mode: triggered
    event: capture.ingested
    when:
      kind: screenshot
    tier: suggest
completion_bar: Every item quotes the document or cites prior memory; nothing asserted uncited, and anything you could not tell is asked rather than guessed.
stopping_conditions:
  - The document is empty or content-free — say so and propose nothing.
  - Nothing in it needs to happen and nothing in it contradicts the memory — say that plainly rather than manufacturing cards.
red_flags:
  - A decision with no decider or date — ask before drafting it; a spoken line is not a decision record yet.
  - A claim that contradicts a live decision or insight — flag it, never overwrite. This is the cheapest, highest-value thing you can find here.
  - Analysis. You are reading ONE document with nothing to weigh it against, which makes any pattern you think you see the weakest thing this system can produce. Insights, themes and stances come later, from a session with a question and a corpus.
  - A commitment made on the product's behalf by someone who is not the PM ("we told them SCIM lands in Q3") — surface it as its own card marked "commitment made externally — confirm or correct", never file it silently.
---

## When
Something landed: a transcript of a meeting the PM was in, a transcript of one they were not, a
link, a screenshot, a pasted thread. One skill handles all of them, because the branch is data —
who was in the room, and what kind of thing it is — not a mode the PM should have to pick.

Your job is **extraction**, never analysis. What is mechanically in this document that needs to
become an object? Commitments made, dates, decisions stated with a decider, people, the meeting
record, and anything contradicting what the memory currently holds. One document, no corpus, no
question needed. What it all *means* is a different session with nine documents and a question.

## Read
The document itself first — for a meeting, follow the `transcript` frontmatter ref to the source
note. Then only the memory it actually touches: the customer page, the theme hubs it names, live
decisions it might contradict (search_vault), and the mirror notes (tickets/) of any ticket it
references, so anything you say about delivery rests on current state.

For a link, work from the URL and whatever the PM pasted with it — never invent what the page says.
For a screenshot, work from the caption; the image is evidence on disk, not something you can read.

## Produce
The smallest set of approval cards that makes the document actionable. What you may propose depends
on **what the document is**, not on how this session was opened:

**A meeting the PM was in** (origin: po) — the full truth delta:
- **Decisions** made, with the decider and the reason (propose_decision). Set `supersedes` when it
  reverses an earlier one.
- **Commitments** — every "I'll …" becomes a todo (propose_todo) citing the meeting with the
  verbatim quote. The PM's own get no owner; someone else's set `owner` to that person. A date only
  if one was named or clearly implied. Check existing todos first (vault_list type "todo").
- **A meeting summary** on the meeting page (propose_update) and the hub updates it implies —
  actions, open questions, not-doings, and the people pages' `last_told` ledger.
- **The external consequences**, ONLY where the meeting actually forces one: a comment on a linked
  ticket that the meeting settles or dates (draft_jira_comment), a new ticket for tracked work no
  ticket covers (draft_jira_issue), a follow-up the meeting concretely booked (draft_calendar_event
  — "let's reconvene next week" with a real time, never a vague "we should meet again"). Most
  meetings force none, and a card nobody needed is noise. Every outbound body ends with a
  provenance line ("Source: <meeting>, <date>"), cites its evidence, and sets linkBack to the
  meeting page. Apply the voice guides. Outbound is draft-and-approve, forever.

**A meeting the PM was NOT in** (origin: external) — a colleague's sales call is signal, not truth:
- Commitments anyone made, as todos with `owner` set to that colleague and the verbatim quote.
- Customer signals onto the customer hub (propose_update) where the call genuinely adds one.
- Who was told what, onto the `last_told` ledger, attributing who said it.
- **Never a decision.** A colleague's call cannot create product truth — not because of which
  session this is, but because of what the document is. You do not have the tools to draft outbound
  here either; that is deliberate.

**A link, screenshot or pasted thread** — wire it in from the other side, since a raw source's body
is immutable and you must never propose edits to it:
- Update the hubs it concerns (propose_update adding wikilinks to the capture) where it adds signal.
- A commitment or a date hiding in it becomes a todo.
- If it names a person or customer with no page yet, ask before creating one.
- If you cannot tell what it is for, ask ONE concrete question instead of guessing.

Tag every proposed note with 1-2 contexts (`tags`) drawn from tags already in use; name any
brand-new context in the card's rationale.

## Then
Approved cards land the delta: the decision spine, the commitment ledger, the hubs, the meeting
page. Approved outbound executes upstream and files its link back. The source stays in sources/ as
cold, verbatim evidence, and flips new → processed when an accepted card cites it. What this
document MEANS, weighed against everything else, is a question for a later session.
