---
type: "meeting"
summary: "Auth review — SAML verified against Okta and Entra in staging, prod 2026-07-28 behind a flag, Firebase retired, eu-central-1 confirmed incl. backups"
tags: ["enterprise-auth"]
date: "2026-07-10"
time: "16:00"
duration_minutes: 45
participants: ["me", "Tom Devlin"]
---

## Summary
WorkOS SAML is done in staging, tested against Okta and Entra. Production rollout holds for
2026-07-28 behind a feature flag, Nordkap as first tenant, general availability in August.
Firebase is fully retired — last dependency removed 2026-07-07, so
[[decisions/2026-02-10-use-firebase-auth]] is closed out for good. Tom confirmed everything
including backups sits in eu-central-1, which answers Sara's legal question precisely
([[insights/eu-data-residency-required]]). SCIM scoping starts August.

## Transcript
Tom: Staging's done. SAML works against Okta and Entra — session handling took longer than I
wanted, the logout flows are fiddly, but it's solid now.

me: Still good for the 28th?

Tom: Yes. Behind a flag, and I want Nordkap as the first tenant — Sara's team is responsive and
they run Entra, which we've tested hardest. If their rollout is clean we open it up in August.

me: I'm seeing Sara Tuesday, I'll give her the date. Firebase?

Tom: Gone. Removed the last dependency on Tuesday. Feels good, honestly.

me: And for Sara's legal people — the residency question. Storage and processing?

Tom: Everything is eu-central-1. Compute, data, and as of last month backups too, that was the
missing piece. You can put it in writing.

me: SCIM — when does scoping start?

Tom: August, once the rollout settles. Don't let anyone promise a specific September date yet —
"September" is fine, a date isn't, not until I've scoped the directory-sync edge cases.
