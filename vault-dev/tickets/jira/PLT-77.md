---
type: ticket
summary: 'PLT-77, OAuth token store for integrations: in progress, blocks the Fortnox connector'
title: PLT-77 · OAuth token store for integrations
tags:
  - platform
processing: new
provider: jira
external_id: PLT-77
container: PLT
state: In Progress
state_category: in_progress
assignee: Nils Ek
links:
  - type: blocks
    key: SCH-125
remote_updated: '2026-07-14T15:10:00Z'
url: https://rota.atlassian.net/browse/PLT-77
---

One encrypted store for third-party OAuth tokens — Fortnox first, Visma next — with refresh
handling and per-tenant isolation, so every integration does not invent its own.

## Recent comments

- **Nils Ek · 2026-07-14**: Encryption and per-tenant isolation are in. Refresh-on-expiry is the
  piece left, and SCH-125 needs it before it can talk to a real Fortnox account.
