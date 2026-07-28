---
type: "meeting"
summary: "Auth review — SAML verified against Okta and Entra in staging, prod 2026-07-28 behind a flag, Firebase retired, eu-central-1 confirmed incl. backups"
tags: ["enterprise-auth"]
date: "2026-07-10"
time: "16:00"
duration_minutes: 45
participants: ["me", "Tom Devlin"]
transcript: "[[sources/2026-07-10-internal-auth-review-transcript]]"
---

## Summary
WorkOS SAML is done in staging, tested against Okta and Entra. Production rollout holds for
2026-07-28 behind a feature flag, Nordkap as first tenant, general availability in August.
Firebase is fully retired — last dependency removed 2026-07-07, so
[[decisions/2026-02-10-use-firebase-auth]] is closed out for good. Tom confirmed everything
including backups sits in eu-central-1, which answers Sara's legal question precisely
([[insights/eu-data-residency-required]]). SCIM scoping starts August.

