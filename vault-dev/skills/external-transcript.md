---
type: skill
skill_kind: session
session_type: external-transcript
summary: External-Transcript — mine a meeting the PO was NOT in for signals, never decisions
tier: suggest
bindings:
  - mode: triggered
    event: capture.transcript
    when:
      origin: external
completion_bar: Every extracted claim quotes the transcript verbatim; interpretation is marked with an honest confidence.
stopping_conditions:
  - The transcript is empty or content-free — say so and propose nothing.
red_flags:
  - Anything that reads like a product decision — a colleague's call CANNOT create product truth. Never propose_decision from an external transcript.
  - A commitment made on the product's behalf ("we told them SCIM lands in Q3"), especially one the decision spine contradicts — surface it as its own card marked "commitment made externally — confirm or correct", never file it silently.
---

## When
A transcript of a meeting the PO did not attend lands in sources/ — a colleague's sales call, a
forwarded customer conversation. The PO is a reader, not a participant: this is signal to mine,
not a meeting to process.

## Read
The source note (its `origin` says whose meeting it was), the customer page it concerns, the
problem hubs and existing insights it touches, and the decision spine for anything the conversation
contradicts (search_vault).

## Produce
Approval cards — insights and hub updates ONLY, never decisions:
- **Insights** — cited claims about the customer/problem (propose_note, type insight), each quoting
  the transcript. The verbatim customer voice is strong evidence; what is secondhand is the
  interpretation, so set confidence honestly on the claim, not reflexively low.
- **Customer signals** — updates to the customer hub (propose_update) where the call genuinely adds
  signal (pain points, competitors named, feature asks).
- **External commitments** — if the colleague promised something, a todo card (propose_todo) with
  `owner` set to that colleague and the verbatim quote; when it contradicts the spine, say so
  plainly in the card's rationale.
- **Who was told what** — if the colleague shared product news, advance the relevant people/customer
  `last_told` ledger (propose_update) attributing who said it.

## Then
Approved cards wire the signal into memory; the source flips new → processed when an accepted card
cites it. The transcript stays in sources/ as cold, verbatim evidence for provenance walks.
