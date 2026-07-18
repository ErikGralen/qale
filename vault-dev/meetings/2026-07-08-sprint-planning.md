---
type: meeting
summary: Sprint 14 planning — SSO on track for 2026-07-28, exports v1 pilot with Kranelund greenlit, no mobile work in Q3
date: 2026-07-08
time: "09:30"
duration_minutes: 60
participants:
  - me
  - Tom Devlin
---

## Summary
SSO rollout holds for 2026-07-28 — behind a flag, Nordkap first tenant. Greenlit scheduled
exports v1 with Kranelund as design partner: existing dashboard → PDF → email schedule, no
report builder, CSV as fast follow; target end of August
([[decisions/2026-07-08-pilot-scheduled-exports]]). Decided against any mobile work this quarter
([[decisions/2026-07-08-hold-mobile-until-q4]]).

## Notes
- SSO: staging complete, prod rollout 2026-07-28 behind a feature flag. Nordkap first, general
  availability in August. Full status at Friday's auth review.
- Exports v1 scope agreed: schedule + recipient list on an existing dashboard, rendered to PDF.
  Explicitly out: report builder, CSV (fast follow), per-recipient filtering.
- Kranelund pilot kickoff w/c 2026-07-20 — Johanna coordinates, Tom sends the render prototype
  before kickoff.
- Mobile: nothing this quarter. Before Q4 planning, pull mobile-web usage and support-ticket
  counts so the discussion starts from data.
- SCIM scoping starts August, after SSO settles. Tom flagged capacity: exports + SCIM in the
  same sprint window will be tight; exports v1 scope is the release valve if something must give.
