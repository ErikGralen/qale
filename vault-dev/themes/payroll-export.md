---
type: 'theme'
summary: 'Payroll export: approved hours out of Rota and into Fortnox and Visma without retyping'
tags: ['payroll-export']
stance: 'committed'
evidence:
  [
    '[[insights/fjord-sports-expects-payroll-q4]]',
    '[[meetings/2026-05-26-fjord-sports-payroll-call]]',
  ]
---

# Payroll export

At the end of a pay period a manager approves the hours actually worked. Those hours then get
into a payroll system, and today that means somebody exports a spreadsheet and retypes it, per
location, every second week. It is the most boring problem we have and the one customers bring
up unprompted.

Committed and first in the H2 order ([[decisions/2026-05-18-h2-order-payroll-first]]), because
two accounts asked for it in the same month. Epic is [[tickets/jira/SCH-118]]. Fortnox is the
first connector ([[decisions/2026-05-20-fortnox-first-payroll-target]]) — it is the common one
in Swedish restaurant chains and the API is the friendlier of the two. Visma follows, which is
the one [[customers/fjord-sports]] is actually waiting for.

The CSV export of approved hours is done ([[tickets/jira/SCH-121]]). The Fortnox connector
([[tickets/jira/SCH-125]]) is blocked on the platform OAuth token store
([[tickets/jira/PLT-77]]), which is the risk to the quarter nobody outside the team is tracking.

Both epics sit on Rebecca's team, so this and swaps trade a quarter with each other
([[notes/h2-capacity]]).
