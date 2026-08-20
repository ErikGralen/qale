---
type: 'theme'
summary: 'Scheduled reporting: manual weekly reports are costing us mid-market accounts'
tags: ['reporting']
stance: 'committed'
evidence:
  [
    '[[insights/midmarket-needs-scheduled-exports]]',
    '[[insights/rondo-churned-over-reporting-gaps]]',
    '[[meetings/2026-06-12-kranelund-checkin]]',
    '[[meetings/2026-07-13-cs-sync]]',
  ]
---

# Scheduled reporting

Ops teams don't want to open a dashboard. They want the same six numbers in the right inbox
every Monday at 07:00. Right now a person does that job by hand. At Kranelund it's Lise,
screenshotting dashboards into a PDF. At Rondo the person doing it resigned, and the account
went with her.

## Evidence

- [[insights/midmarket-needs-scheduled-exports]]
- [[insights/rondo-churned-over-reporting-gaps]]

## Decisions

- [[decisions/2026-07-08-pilot-scheduled-exports]]: v1 with Kranelund as design partner, target
  end of August

## Shape of v1

Scheduled email delivery of an existing dashboard as a PDF. CSV for finance comes after. That
order is deliberate; Mikkel was clear that the managers come first.
