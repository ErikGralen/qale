---
type: "customer"
summary: "Nordkap Payments — 400-seat fintech, largest account, renews 2026-11-01"
tags: ["enterprise-auth"]
status: "active"
segment: "enterprise"
---

# Nordkap Payments

Payments processor, ~1 100 employees, Stockholm and Oslo. 400 seats on the enterprise tier — our
largest account by a distance. Renewal is 2026-11-01 and goes through their security review first,
which starts mid-August. Champion and economic buyer: [[people/sara-lindqvist]] (Head of IT).

## Commitments
- SAML SSO live before their security review — rollout 2026-07-28, Nordkap is the first tenant
  ([[releases/2026-07-sso-saml]], [[decisions/2026-05-20-adopt-workos]])
- SCIM provisioning in September ([[decisions/2026-04-15-defer-scim-to-q3]])
- All data stored and processed in the EU ([[decisions/2026-06-05-single-region-eu]])

## What they've been told
- 2026-07-14: SSO date confirmed as 2026-07-28; SCIM reconfirmed for September
  ([[meetings/2026-07-14-nordkap-checkin]])
- 2026-05-18: audit log in June — delivered 2026-06-20 ([[releases/2026-06-audit-log]])

## Watch
- Their procurement started a review of the per-seat commercial model the week of 2026-07-13.
  Sara will forward the question list ([[meetings/2026-07-14-nordkap-checkin]]).
- IT is still creating accounts by hand — 14 more last week. Goodwill on SCIM is finite
  ([[insights/nordkap-needs-scim]]).
