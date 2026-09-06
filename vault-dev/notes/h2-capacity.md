---
type: 'note'
title: 'H2 capacity'
summary: 'Scheduling capacity Jul–Dec: both H2 epics on one team, so one moving slips the other'
tags: ['payroll-export', 'shift-swaps']
sources: ['[[meetings/2026-07-09-steering]]']
---

# H2 capacity

[[people/asa-lindgren]] asked for this in numbers at steering on 2026-07-09 rather than the
usual "it's tight". Sent 2026-07-15 ([[todos/send-asa-h2-numbers]]).

Scheduling is five engineers plus [[people/rebecca-holm]], who is not counted as build capacity
because she is on-call rotation and review. Two of the five are on the payroll epic today. July
through December is roughly 22 usable weeks after holidays, and August is half-strength — three
of the five are out for most of it.

Both H2 epics live on that one team: payroll export ([[tickets/jira/SCH-118]]) and shift swaps
([[tickets/jira/SCH-231]]). That is the whole point of this note. They are not two workstreams
that can be resequenced independently; they are one team doing one thing and then the other. The
order is set ([[decisions/2026-05-18-h2-order-payroll-first]]).

## The number that matters

Payroll export through Fortnox, at current shape, is most of Q3. Swaps as scoped is around six
to seven weeks, plus whatever [[tickets/jira/SCH-240]] comes back at after the re-estimate.
There is no version of the quarter where both finish before September.

So: if the order changes, the second one moves by a full quarter. Not by a few weeks, and not
"partly in parallel". Anyone who wants swaps earlier is choosing payroll export in Q1, and
[[customers/fjord-sports]] is standing under that date
([[insights/fjord-sports-expects-payroll-q4]]).

Not modelled here: the Fortnox connector is blocked on [[tickets/jira/PLT-77]] in Platform,
which is someone else's team and therefore not capacity I can spend.
