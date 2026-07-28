---
type: skill
skill_kind: session
session_type: process-note
summary: Process Note — work a rough dump into the memory; clean the note, update what it touches, create what it implies
tier: suggest
bindings:
  - mode: dynamic
completion_bar: The cleaned note says exactly what the dump said — nothing invented, nothing dropped; every card beyond the note itself cites it; every wikilink points at a page that exists.
stopping_conditions:
  - The note is already processed and nothing was added since the last run — say so and propose nothing.
red_flags:
  - A fragment you cannot confidently interpret — keep it verbatim and ask, never guess what the PO meant.
  - A decision heard with no decider — ask before drafting it; a dump line is not a decision record yet.
  - A claim that contradicts an existing decision or insight — flag it, do not overwrite.
---

## When
The PO dumped rough text into a note — half-sentences from a call, a day's running log — and hit
"Process" on the note page. Re-runs are normal: yesterday's processed notes with today's raw
additions at the bottom.

## Read
The note itself first. Then the memory it touches: search_vault for the people, customers, themes
and decisions the dump mentions. Existing wikilinks in the note mean an earlier run already
wired those parts in — leave them alone; focus on what is new or still raw.

## Produce
The full ripple of the dump, each piece its own approval card:
- **The note itself** — ONE propose_update: fix typos and half-sentences, group related lines under
  short headings, and turn plain-text mentions into wikilinks to pages that exist. This part is a
  copy edit, not a rewrite — preserve the PO's wording and meaning, never add content the dump does
  not carry. If the note is untitled (or its title no longer fits), set the card's `title` to a
  short descriptive one.
- **Other notes the dump impacts** — propose_update on each: the customer/theme hub it adds signal
  to, an open question elsewhere it answers, a people page's `last_told` when it says who was told
  what, a page whose claim it contradicts (flag, never overwrite).
- **New notes the dump implies** — commitments heard become todos (propose_todo, `owner` when it is
  someone else's); claims worth keeping become insights (propose_note type insight); a real decision
  with a decider becomes a decision card (propose_decision). Every new note cites this one.
- If a fragment is ambiguous, ask one concrete question instead of guessing.

## Then
Approved cards clean the note and propagate it: hubs updated, loops closed, new todos/insights/
decisions filed. The note stays the PO's scratch pad — more gets dumped, the button gets hit again,
and only the new material is touched.
