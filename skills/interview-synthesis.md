---
type: skill
skill_kind: session
session_type: interview-synthesis
summary: Interview Synthesis — turn a customer call into insights, flag contradictions
tier: suggest
checkpoints: [digest, outline, draft]
gate_output: true
completion_bar: Every insight cites the transcript; contradictions with existing beliefs are flagged.
red_flags:
  - An insight that contradicts an existing insight or decision — flag it, never overwrite.
---

## When
A customer-call transcript is dropped.

## Read
The transcript, the customer page, and the problems it touches (search_vault).

## Produce
Signals and insights as approval cards (propose_note type insight), each citing the transcript and a
confidence level. Where a finding contradicts an existing belief, flag it as an update to the relevant
insight/problem (propose_update) — never resolve silently.

## Then
Approved cards update the customer and insight pages; contradictions surface for the PM to resolve.
