---
type: "problem"
summary: "Reports have to arrive, not be visited — manual weekly reporting is costing us mid-market accounts"
tags: ["reporting"]
stance: "committed"
evidence: ["[[insights/midmarket-needs-scheduled-exports]]", "[[insights/rondo-churned-over-reporting-gaps]]", "[[meetings/2026-06-12-kranelund-checkin]]", "[[meetings/2026-07-13-cs-sync]]"]
---

# Scheduled reporting

Ops teams don't want to open dashboards; they want the same six numbers in the right inbox every
Monday at 07:00. Today that gap is bridged by a person — Kranelund has Lise screenshotting
dashboards into a PDF, and at Rondo the person doing it resigned and the account churned with her.

## Evidence
- [[insights/midmarket-needs-scheduled-exports]]
- [[insights/rondo-churned-over-reporting-gaps]]

## Decisions
- [[decisions/2026-07-08-pilot-scheduled-exports]] — v1 with Kranelund as design partner,
  target end of August ([[releases/2026-08-scheduled-exports]])

## Shape of v1
Scheduled email delivery of an existing dashboard as PDF. CSV (for finance) follows — deliberate
sequencing, managers first.
