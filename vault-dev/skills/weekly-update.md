---
type: skill
skill_kind: session
session_type: weekly-update
summary: Weekly Update — the week's deltas as per-audience update drafts
tier: outbound
checkpoints: [scan, outline, draft]
gate_output: true
completion_bar: Every line in every update is cited by a wikilink or a deep link.
stopping_conditions:
  - Nothing material changed this week — say so and produce nothing.
red_flags:
  - An update that restates old news — only include this week's genuine deltas.
  - A shipped/slipped/blocked claim no ticket mirror backs — delivery lines come from ticket state, not recall.
---

## When
Scheduled (Friday 15:00), or on demand. Also runs as a dry-run against last week before enabling.

## Read
The week's deltas across memory — recent meetings, new/superseded decisions, new insights — and the
week's delivery facts: ticket mirror notes (vault_list type "ticket") whose `remote_updated` falls
in the week. Their state transitions are what actually shipped, slipped or got blocked; report what
the mirrors show, never remembered status. Use search_vault and the "This week" lens as your scope.

## Produce
A per-audience update draft (exec, CS, team), every claim cited:
- Exec: outcomes and decisions, three lines (draft_message audience: exec) — apply the exec voice.
- CS: what changes for customers and when (draft_message audience: cs) — apply the CS voice.
- Team: shipped / slipped / why — grounded in the week's actual ticket transitions (what went done,
  what went blocked), linking the decisions and ticket mirrors (draft_confluence_update
  or a note).
Where the update has a wikipage home — a status or update page mirrored in wikipages/ and linked
from the memory — offer publishing there as its own card: a draft_confluence_update against that
page, ending with a provenance line ("Source: weekly update, <date>").

## Then
Everything is held in the Inbox for approval — nothing is sent. Approved message drafts file under
the relevant people/customers; approved wikipage updates push upstream with the deep link filed back
and the mirror re-syncs on the next pull.
