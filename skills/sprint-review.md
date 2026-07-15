---
type: skill
skill_kind: session
session_type: sprint-review
summary: Sprint Review — walk shipped/slipped/why, draft release notes per audience
tier: outbound
checkpoints: [scan, outline, draft]
gate_output: true
completion_bar: Every shipped/slipped item links its decision or release; nothing uncited.
red_flags:
  - "Slipped" with no reason — find the why before drafting.
---

## When
End of sprint, or on demand.

## Read
The sprint's Jira delta (jira_search), the sprint's meetings and the decisions that touched them.

## Produce
A walkthrough of shipped / slipped / why, and release notes per audience — as approval cards
(propose_note for a release, draft_confluence_update for the release page, draft_message per audience).

## Then
Approved cards update the release page and file per-audience notes. Nothing is sent.
