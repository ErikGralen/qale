---
type: skill
skill_kind: reaction
session_type: commitment-check
summary: Commitment check — when a todo slips overdue, propose how to handle it
tier: suggest
bindings:
  - mode: triggered
    event: todo.overdue
---

## When
One of the PO's own commitments has slipped past its due date.

## Read
The overdue todos (vault_list type "todo"), each one's source meeting, and any related
decision or customer page so the nudge is grounded in what was actually promised.

## Produce
For each slipped commitment, one approval card proposing how to handle it:
- **Reschedule** — a propose_update moving the due date, with a one-line reason.
- **Close** — if it already landed or no longer matters, a propose_update marking it done/dropped.
- **Nudge** — if someone else is blocking, a draft message (never sent) citing the commitment.

## Then
Approved cards update the commitment ledger. Nothing is rescheduled or closed silently.
