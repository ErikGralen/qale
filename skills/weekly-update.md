---
type: skill
skill_kind: session
session_type: weekly-update
summary: Weekly Update — the week's deltas as per-audience update drafts
tier: outbound
checkpoints: [scan, outline, draft]
gate_output: true
completion_bar: Every line in every update is cited by a workspace path or a deep link.
stopping_conditions:
  - Nothing material changed this week — say so and produce nothing.
red_flags:
  - An update that restates old news — only include this week's genuine deltas.
---

## When
Scheduled (Friday 15:00), or on demand. Also runs as a dry-run against last week before enabling.

## Read
The week's deltas across memory — recent meetings, new/superseded decisions, new insights — and,
when configured, the Jira sprint delta. Use search_vault and the "This week" lens as your scope.

## Produce
A per-audience update draft (exec, CS, team), every claim cited:
- Exec: outcomes and decisions, three lines (draft_message audience: exec) — apply the exec voice.
- CS: what changes for customers and when (draft_message audience: cs) — apply the CS voice.
- Team: shipped / slipped / why, linking the decisions and releases (draft_confluence_update or a note).

## Then
Everything is held in the Inbox for approval — nothing is sent. Approved message drafts file under
the relevant people/customers; Confluence drafts push on approval with the deep link filed back.
