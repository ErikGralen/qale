---
type: "theme"
summary: "On-prem and self-hosted deployment: asked for twice, declined both times"
tags: ["compliance"]
stance: "wont-do"
evidence: ["[[insights/on-prem-asks-are-security-asks]]", "[[meetings/2026-06-16-fenno-energi-intro]]", "[[meetings/2026-07-02-bergman-falk-security-review]]"]
---

# On-prem deployment

Two enterprise conversations have asked for self-hosting. Fenno Energi stated it as policy, and
Bergman & Falk's questionnaire has a deployment-model section pointing the same way. We decided
against it ([[decisions/2026-06-18-no-on-prem]]) because a team our size can't support
customer-managed installs without it swallowing the roadmap.

Both times the real concern turned out to be narrower than the policy: where the data sits, who
can reach it, and whether that's auditable ([[insights/on-prem-asks-are-security-asks]]). The
EU-only region, the audit log and ISO 27001 answer most of that.

Keep filing evidence here. If a deal we can't afford to lose ever turns on a genuinely immovable
on-prem policy, this is the file to reopen.
