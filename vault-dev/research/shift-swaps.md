---
type: research
summary: "Shift swaps: staff trade shifts themselves, the manager approves, the schedule updates"
tags:
  - shift-swaps
sources:
  - "[[insights/cafe-nord-september-turnover]]"
  - "[[insights/swap-notifications-show-personal-data]]"
  - "[[meetings/2026-06-05-cafe-nord-qbr]]"
  - "[[meetings/2026-07-02-support-sync]]"
---

# Shift swaps

Stance: committed.

A staff member who can't work a shift proposes a swap in the app, a colleague accepts, the
manager approves, and the schedule updates for everyone. Today that whole exchange happens over
text messages and ends with a manager editing the schedule by hand, usually twice.

Committed, and in build as [[tickets/jira/SCH-231]]. Manager approval is settled and not
negotiable ([[decisions/2026-04-08-swap-approval-by-manager]]) — the rules are written up in
[[notes/swap-rules]]. Two of the three stories are done
([[tickets/jira/SCH-232]], [[tickets/jira/SCH-236]]); the approval flow
([[tickets/jira/SCH-240]]) needs a re-estimate because the overtime check is bigger than we
scoped.

Sequencing is the live question. H2 puts payroll export first
([[decisions/2026-05-18-h2-order-payroll-first]]), which lands swaps in Q4 — after the September
that [[customers/cafe-nord]] keeps describing, and after the date
[[people/marcus-ek]] said out loud at the QBR.

Open: the swap request shows the affected colleague's name and phone number, and Legal hasn't
looked at it ([[todos/henrik-review-swap-notifications]]).
