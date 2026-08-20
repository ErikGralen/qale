---
type: note
title: Rollout runbook
summary: 'SSO rollout runbook: staged flag rollout, comms, and rollback steps'
sources: []
---

# Rollout runbook

Staged rollout for SSO/SAML behind the `enterprise-auth` flag. Gated on
[[blocked-by::PAY-142|the SSO epic]] clearing security sign-off; the staging IdP
matrix lives in [[PAY-161]].

1. Enable for the internal workspace, soak 48h, watch auth error rates.
2. Enable for Nordkap staging. Sara's team runs their IdP test matrix, so we're
   [[waiting on::people/sara-lindqvist]] for the Entra slot.
3. Joint go/no-go call, then enable the production tenant.
4. Rollback: flip the flag off. Sessions fall back to password auth and there's no data
   migration to undo.

Comms: status update in the shared Slack channel at each stage. CS gets the FAQ before stage 3.
