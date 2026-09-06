---
type: ticket
summary: 'PLT-80, nightly schedule backup job: done 2026-06-12'
title: PLT-80 · Nightly schedule backup job
tags:
  - platform
processing: new
provider: jira
external_id: PLT-80
container: PLT
state: Done
state_category: done
remote_updated: '2026-06-12T07:40:00Z'
url: https://rota.atlassian.net/browse/PLT-80
---

Nightly snapshot of every published schedule to object storage with 30-day retention, so a bad
bulk edit on a chain's week can be rolled back instead of rebuilt by hand.
