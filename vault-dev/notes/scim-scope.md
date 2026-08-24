---
type: note
title: SCIM scope
summary: 'SCIM provisioning for September: the promise is made, the breakdown is not'
tags:
  - enterprise-auth
sources: ['[[meetings/2026-07-10-internal-auth-review]]']
---

# SCIM scope

SCIM provisioning is the second half of [[themes/enterprise-onboarding]]. The sequencing is
settled ([[decisions/2026-04-15-defer-scim-to-q3]]): SSO first, scoping in August, delivery in
September. What is not settled is what SCIM means here. There is no epic, no stories and no
estimate, so the September date rests on nothing.

Tom asked at the auth review not to name a day inside September until the directory-sync edge
cases are scoped ([[people/tom-devlin]]). Sara reads September as early September. Jonas says
[[customers/nordkap-payments]] won't sign the renewal without a committed date
([[notes/2026-07-16-nordkap-scim-date]]). The breakdown is the blocker, not the build.

## What the breakdown has to cover

- Create, update and deactivate users from the customer IdP.
- Groups, and whether a group maps to a role in Tavla at all in v1. Nobody has decided.
- The first sync against a tenant that already has accounts. Nordkap has around 400 made by
  hand ([[insights/nordkap-needs-scim]]), so matching matters more than creating.
- Entra and Okta differ on deactivation, and we support both from day one.
- Nordic characters. The March import mangled them and Sara's team ran the batch twice.
- What an IT admin sees when a sync fails. Today they would see nothing.
- Whether SCIM events join the audit-log export we shipped for SSO ([[tickets/jira/PAY-156]]).

August is already full: exports v1 and this scoping land on the same small team
([[notes/q3-priorities]]). SCIM rides on WorkOS the way SSO does
([[decisions/2026-05-20-adopt-workos]]), so this is directory sync on a provider we already
run, not a second auth migration.

## Next

Break it into stories under a SCIM epic in PAY, the way [[tickets/jira/PAY-142]] was split into
[[tickets/jira/PAY-156]] and [[tickets/jira/PAY-161]]. Then Tom can put a day on September.
