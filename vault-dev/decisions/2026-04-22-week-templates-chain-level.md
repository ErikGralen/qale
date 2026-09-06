---
type: 'decision'
summary: 'Week templates can be shared chain-wide, with per-location edits on top'
tags: ['week-templates']
standing: 'active'
date: '2026-04-22'
deciders: ['Åsa Lindgren', 'me']
sources: []
supersedes: '[[decisions/2026-03-03-week-templates-per-location]]'
---

Reversing myself from March. A chain admin can now publish a template to a group of locations,
and each location manager gets a copy they can edit. The shared version is a starting point, not
a lock.

What changed my mind was watching what [[customers/cafe-nord]] actually does. Lena's regional
managers build one autumn template and then recreate it, by hand, in every location they cover.
Across 120 locations that is a week of work to produce a hundred near-identical schedules.

The role-mapping problem from March is real but smaller than I made it: we match on role name,
leave anything unmatched as an empty slot, and show the manager what didn't map. An empty slot is
honest.

One thing we are not repeating: [[customers/kaffekopp]] asked for this in spring 2025, we shipped
it in August, and nobody told them. CS hears about this one on release day.

Supersedes [[decisions/2026-03-03-week-templates-per-location]].
