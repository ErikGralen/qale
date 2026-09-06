---
type: 'customer'
summary: 'Kaffekopp: 18 cafés, churned 2025-11 over a feature we had already shipped'
tags: ['churn']
relationship: 'churned'
segment: 'smb'
---

# Kaffekopp

Small café chain, 18 sites, one central office. Churned at the end of November 2025.

The story is short and it is ours. In the spring of 2025 they asked, more than once, for week
templates: their sites run the same shape of week most of the year and their managers were
rebuilding it from scratch every Monday. We built it. It shipped in August 2025. Nobody told
them.

By the time [[people/malin-sjoberg]] ran the exit call in November they had spent three months
believing the answer was still no, and had started moving their scheduling into a spreadsheet
they already trusted. Malin demoed the feature during that call. They were polite about it.
Their ops lead said the thing that still gets repeated here: "we asked, you said you'd look at
it, and then we stopped hearing from you."

Nothing was broken. The feature existed, worked, and was in the release notes nobody outside
this building reads. What was missing was the list of accounts that had asked, and one person
whose job it was to call them.

Week templates have kept growing since — per location at first, then shareable across a whole
chain ([[decisions/2026-04-22-week-templates-chain-level]], superseding
[[decisions/2026-03-03-week-templates-per-location]]). Kaffekopp would have been the ideal
account for that second version.

## Why it stays in the vault

Because it is the cheapest lesson we own, and it keeps applying: a request that arrives through
support and never becomes a note is a request that cannot be answered when the answer finally
exists ([[themes/shift-swaps]], [[people/jonas-berg]], [[people/ulrika-nystrom]]).
