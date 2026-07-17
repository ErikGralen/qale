---
type: "problem"
summary: "Enterprise onboarding — SSO, SCIM, audit and residency gate every deal over ~200 seats"
tags: ["enterprise-auth", "compliance"]
stance: "committed"
evidence: ["[[insights/enterprise-buyers-gate-on-sso]]", "[[insights/nordkap-needs-scim]]", "[[insights/eu-data-residency-required]]", "[[insights/security-reviews-run-six-weeks]]", "[[meetings/2026-05-18-nordkap-qbr]]", "[[meetings/2026-07-02-bergman-falk-security-review]]"]
---

# Enterprise onboarding

Enterprise buyers can't get us through their own security and IT processes: SSO through their
IdP, SCIM for joiners/leavers, an audit trail, and EU residency. Every deal above ~200 seats hits
some subset of this — the Nordkap renewal hangs on it, and Bergman & Falk's review board treats
missing SSO as an automatic no.

## Evidence
- [[insights/enterprise-buyers-gate-on-sso]]
- [[insights/nordkap-needs-scim]]
- [[insights/eu-data-residency-required]]
- [[insights/security-reviews-run-six-weeks]]

## Decisions
- [[decisions/2026-05-20-adopt-workos]] (supersedes [[decisions/2026-02-10-use-firebase-auth]])
- [[decisions/2026-04-15-defer-scim-to-q3]]
- [[decisions/2026-06-05-single-region-eu]]
- [[decisions/2026-05-19-commit-audit-log-june]] — shipped ([[releases/2026-06-audit-log]])

## State
SSO rolls out 2026-07-28 (Nordkap first). SCIM scoping starts August, delivery September. After
that the remaining gap is mostly paperwork speed, not product.
