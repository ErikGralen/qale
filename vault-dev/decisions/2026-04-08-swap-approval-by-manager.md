---
type: 'decision'
summary: 'Every shift swap goes through manager approval; no auto-approve path in v1'
tags: ['shift-swaps']
standing: 'active'
date: '2026-04-08'
deciders: ['Rebecca Holm', 'me']
sources: ['[[notes/swap-rules]]']
theme: '[[themes/shift-swaps]]'
---

Staff propose a swap in the app, the manager approves it, and only then does the schedule change.
No auto-approval, not even for the easy case of same role and same location.

I wanted the easy case. Rebecca talked me out of it in ten minutes: auto-approval means the
system, not a human, has to be right about overtime, contracted hours and the collective
agreement, and being wrong there is a payroll error rather than an annoyed manager. It also
doubles the state machine, because an auto-approved swap still needs a path back when someone
disputes it.

Managers we spoke to did not ask for automation either. They asked to stop being the person who
retypes the schedule. Approving a swap in two taps is fine.

Rules live in [[notes/swap-rules]]; the epic is [[tickets/jira/SCH-231]].
