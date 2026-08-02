---
type: skill
starts: [you-run-it, model-picks-it-up]
title: Write the weekly update
summary: Drafts this week's update for each audience, from what actually changed.
can: [draft-outbound]
---

## When
Scheduled (Friday 15:00), or on demand. Before it is enabled it also runs as a dry run against
last week.

## Read
What actually changed this week: recent meetings, new or superseded decisions, new insights, and
the week's delivery facts from ticket mirror notes (vault_list type "ticket") whose
`remote_updated` falls in the week. The mirrors' state transitions are what shipped, slipped, or
got blocked; report what they show, never remembered status. Use search_vault and the "This week"
lens as your scope.

## Produce
One draft per audience, every claim cited by a wikilink or deep link:
- **Exec** (draft_message audience: exec): outcomes and decisions, three lines, in the exec
  voice.
- **CS** (draft_message audience: cs): what changes for customers and when, in the CS voice.
- **Team** (draft_confluence_update or a note): shipped, slipped, and why, grounded in the week's
  ticket transitions and linking the decisions and mirrors.

When a status or update page mirrored in wikipages/ is the update's home, offer publishing there
as its own card: a draft_confluence_update against that page, ending with a source line
("Source: weekly update, <date>").

Hold every draft to two rules:
- Only this week's genuine changes. An update that restates old news teaches people to skip it.
- No shipped, slipped, or blocked claim without a ticket mirror behind it. Delivery lines come
  from ticket state, not recall.

If nothing material changed this week, say so and produce nothing.

## Then
Everything waits in the Inbox for approval; nothing is sent. Approved message drafts file under
the relevant people and customers. Approved wikipage updates push upstream, file the deep link
back, and the mirror re-syncs on the next pull.
