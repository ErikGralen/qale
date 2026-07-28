---
type: "theme"
summary: "On-prem/self-hosted deployment — asked twice, declined; the underlying need is control, not hardware"
tags: ["compliance"]
stance: "wont-do"
evidence: ["[[insights/on-prem-asks-are-security-asks]]", "[[meetings/2026-06-16-fenno-energi-intro]]", "[[meetings/2026-07-02-bergman-falk-security-review]]"]
---

# On-prem deployment

Two enterprise conversations have asked for self-hosting: Fenno Energi as a stated policy, and
Bergman & Falk's questionnaire had a deployment-model section pointing the same way. Decided
against it ([[decisions/2026-06-18-no-on-prem]]) — a team our size can't support customer-managed
installs without it eating the roadmap.

Both times, digging revealed the actual concerns: where data lives, who can touch it, and whether
that's auditable ([[insights/on-prem-asks-are-security-asks]]). The EU-only region, audit log and
ISO 27001 answer most of it. Keep filing evidence here — if a must-win deal ever hinges on a
genuinely immovable on-prem policy, this is the file to reopen.
