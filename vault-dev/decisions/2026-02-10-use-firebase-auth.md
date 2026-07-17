---
type: "decision"
summary: "Use Firebase Auth for authentication"
tags: ["enterprise-auth"]
status: "superseded"
date: "2026-02-10"
deciders: ["Tom Devlin"]
sources: []
superseded_by: "[[decisions/2026-05-20-adopt-workos]]"
problem: "[[problems/enterprise-onboarding]]"
---

Chose Firebase Auth to get email and Google login shipped in a week rather than a month. Known
trade-off at the time: no SAML, no SCIM — acceptable while every customer was under 100 seats.

That trade-off is what caught up with us at the Nordkap QBR. Replaced by
[[decisions/2026-05-20-adopt-workos]].
