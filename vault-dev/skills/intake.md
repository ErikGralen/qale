---
type: skill
skill_kind: session
session_type: intake
summary: Intake — figure out what a capture is, connect it to the memory, propose the filing
tier: suggest
bindings:
  - mode: triggered
    event: capture.ingested
    when:
      kind: link
  - mode: triggered
    event: capture.ingested
    when:
      kind: screenshot
completion_bar: Every proposed link or note cites the capture or existing memory; unclear points are asked, not assumed.
stopping_conditions:
  - The capture is empty or content-free — say so and propose nothing.
red_flags:
  - A capture that is actually a meeting transcript — participation decides its path. If the PO was in the room, suggest re-filing it as a meeting (After-Meeting). If not, it stays a source; suggest the External-Transcript session instead.
  - A claim from an article or screenshot asserted as product truth — file it as a cited signal with its source and an honest confidence, never as fact.
---

## When
Something lands in the workspace that isn't a meeting transcript: an article link, a screenshot with
a caption, a pasted thread, a stray thought worth filing. The PO dumped it; deciding what it is and
where it belongs is the system's job.

## Read
The capture itself (a raw source in sources/, or a quick note), then the memory it might touch:
search_vault for the customers, themes, insights and decisions it relates to. For a link, work from
the URL and whatever the PO pasted with it — do not invent what the page says. For a screenshot, work
from the caption; the image itself is evidence on disk, not something you can read.

## Produce
The smallest set of approval cards that wires the capture into the memory. A raw source's body is
immutable — never propose edits to it; wire it in from the other side:
- Update the hubs it concerns (propose_update adding wikilinks to the capture) where it genuinely
  adds signal.
- If it carries a claim — an article's finding, a screenshot's statement, a competitor move — propose
  an insight (propose_note, type insight) citing the capture and its source, with a confidence level.
- If it names a person or customer with no page yet, ask before creating one.
If you cannot tell what the capture is for, ask one concrete question instead of guessing.

## Then
Approved cards connect the capture into the memory; unclear captures get resolved in this
conversation. The capture file itself stays as the raw source — approving a card that cites it flips
its status from new to processed.
