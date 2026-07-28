---
type: wikipage
summary: "Enterprise Onboarding — the Confluence runbook for enterprise tenants; still describes the pre-deferral SCIM plan"
title: Enterprise Onboarding
status: active
provider: confluence
external_id: "910231"
container: Product
version: 12
remote_updated: "2026-04-02T09:40:00Z"
url: https://tavla.atlassian.net/wiki/spaces/PRODUCT/pages/910231
---

## Provisioning

Enterprise tenants authenticate via SAML SSO (WorkOS). Group and role assignment is manual during onboarding.

SCIM provisioning ships in Q2 alongside the SSO rollout, so group mapping is automatic from day one.

## Rollout checklist

- IdP metadata exchanged and verified in staging
- First-tenant flag enabled the week before go-live
- Written go-live confirmation to the customer security contact
