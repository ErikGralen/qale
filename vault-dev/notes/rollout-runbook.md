---
type: note
title: Rollout runbook
summary: SSO rollout runbook — staged flag rollout, comms, and rollback steps
sources: []
---

# Rollout runbook

Staged rollout for SSO/SAML behind the `enterprise-auth` flag.

1. Enable for internal workspace, soak 48h, watch auth error rates.
2. Enable for Nordkap staging; Sara's team runs their IdP test matrix.
3. Joint go/no-go call; enable production tenant.
4. Rollback: flip the flag off — sessions fall back to password auth, no data migration involved.

Comms: status updates in the shared Slack channel at each stage; CS gets the FAQ before stage 3.
