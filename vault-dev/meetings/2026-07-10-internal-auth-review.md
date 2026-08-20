---
type: 'meeting'
summary: 'Auth review: SAML verified against Okta and Entra in staging, prod 2026-07-28 behind a flag, Firebase retired, eu-central-1 confirmed including backups, audit log has no export'
tags: ['enterprise-auth']
date: '2026-07-10'
time: '16:00'
duration_minutes: 45
participants: ['me', 'Tom Devlin']
transcript: '[[sources/2026-07-10-internal-auth-review-transcript]]'
---

## Summary

WorkOS SAML is done in staging and tested against both Okta and Entra. Production rollout holds
for 2026-07-28 behind a feature flag, Nordkap as first tenant, general availability in August.
Firebase is gone; the last dependency came out on 2026-07-07, which closes out
[[decisions/2026-02-10-use-firebase-auth]] for good. Tom confirmed everything sits in
eu-central-1, backups included, which is exactly the question Sara's legal team asked
([[insights/eu-data-residency-required]]). One gap came out of it: the audit log we shipped in
June can only be read in the app, with no export and no API, so a customer can't pull it into
their own system. That will land in Sara's August review, so it goes in as a ticket now. SCIM
scoping starts in August, and Tom asked us not
to promise a specific date inside September until he's scoped the directory-sync edge cases.
