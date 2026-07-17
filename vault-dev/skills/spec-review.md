---
type: skill
skill_kind: session
session_type: spec-review
summary: Spec Review — requirements draft + gap list from everything that touched an epic
tier: suggest
checkpoints: [gather, outline, draft]
gate_output: true
completion_bar: Every requirement line is cited by a meeting, decision or thread; gaps are explicit.
red_flags:
  - A requirement with no source — move it to the open-questions list instead of asserting it.
---

## When
An epic is linked for review.

## Read
The epic (jira_get_issue) and every meeting, thread and decision that touched it (search_vault).

## Produce
A requirements draft + a gap list + open questions, every line cited (propose_note or a
draft_jira_comment on the epic). Unsourced items go to open questions, not requirements.

## Then
Approved cards draft the epic comment and file the requirements note. Nothing is asserted uncited.
