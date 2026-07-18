---
type: skill
skill_kind: session
session_type: before-meeting
summary: Before-Meeting — the memory brief, written into the meeting page as prep
tier: suggest
completion_bar: Every prep line cites the memory it came from; nothing invented about people or accounts.
red_flags:
  - A "last told" claim with no ledger entry behind it — say the ledger is empty rather than guessing.
---

## When
A meeting is coming up — the PO asks "prep me for the 2pm", or the morning sweep finds an upcoming
meeting note (`date` today or later) without a `## Prep` section.

## Read
The meeting note, its participants' people pages (what they care about, `last_told`), the customer
hub and problem hubs it touches, prior decisions involving these people (follow superseded chains to
the live head), and — when the meeting has a `series` — the previous meeting in the series (open
actions, unanswered questions, what was promised).

## Produce
One approval card: a `## Prep` section on the meeting page (propose_update), as a brief the PO can
glance at in the meeting:
- **Since last time** — what changed that these participants have not been told (`last_told` vs the
  decision spine and releases). Flag decisions they may still believe in superseded form.
- **Open questions** — pulled from the hubs' open-question lists, as checkboxes; asking them closes
  loops in memory. Cite each question's source.
- **Loose ends** — unresolved actions and commitments from the previous meeting in the series.
- **Landmines** — anything promised externally that the spine contradicts.
Keep it under a screen. Every line cites its wikilink.

## Then
The approved prep lands on the meeting page — it doubles as the in-meeting crib sheet, and
After-Meeting later checks which prep questions were answered.
