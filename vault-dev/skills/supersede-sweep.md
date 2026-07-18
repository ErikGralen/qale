---
type: skill
skill_kind: reaction
session_type: supersede-sweep
summary: Supersede sweep — when a decision is replaced, repoint what still cites the old one
tier: suggest
bindings:
  - mode: triggered
    event: decision.superseded
---

## When
A decision was just superseded by a newer one (its status flipped, the forward pointer set).

## Read
The superseded decision and its live head, then search the memory for notes, insights, and hub
pages that still cite the old decision.

## Produce
For each stale citation, a propose_update pointing it at the new decision head, with the change
shown in context. Flag anything that contradicts the new decision rather than silently rewriting it.

## Then
Approved cards repoint the memory at the current decision. The old decision's body is never edited —
the spine is append-only.
