# Meetings page: week calendar default

**Decision (2026-07-22):** the meetings folder page opens as a Monday-start week
calendar; the existing list is one click away (Week | List toggle, persisted in
`pm.meetings-view`). Other folders keep the list-only browse page.

## Why

A PO's recall cue for meetings is temporal ("Thursday's check-in", "what's left
this week") — unlike decisions/insights, which are recalled by topic. The list
answered "find that meeting from June"; it didn't answer "what does my week look
like", which is the between-meetings glance the product is built around.

## What the week view shows

- **Grid:** Mon–Fri always; Sat/Sun columns only appear when they actually hold
  meetings that week. Hours default to 08–18, stretching to fit outliers.
  Events are placed by frontmatter `date` + `time` and sized by
  `duration_minutes` (30-min default when absent); untimed meetings sit in a
  "no time" lane under the day headers. Overlaps split side-by-side.
- **Lifecycle as tone (no color-alone):** upcoming meetings on card white, past
  ones receded onto the wash, past-but-unreviewed ones (status `new`/`stale`,
  via `needsReview`) in amber with an icon **and** the word "review" — the
  After-Meeting backlog is visible at a glance.
- **Today:** terracotta date badge plus a terracotta now-line (updates every
  minute).
- **Navigation:** ‹ › / Today buttons, ←/→/T keyboard on the focused grid,
  week label with ISO week number (Nordic habit). Context chips filter the
  calendar the same way they facet the list. Click opens the meeting note
  (double-click pins), same as list rows.
- **Empty week:** shows jump chips to the nearest meeting before/after instead
  of a dead "nothing here".

## Deliberate omissions (for now)

- No month view — the memory horizon that matters is a week or two.
- No drag-to-reschedule / click-slot-to-create; meetings enter via transcripts
  and capture, not calendar authoring. A slot-click → CaptureDialog prefill is
  the natural next step if authoring demand shows up.
- Native tooltips, not hovercards; prep affordances stay on the meeting page
  itself (see docs/commitment-check-redesign.md for the owning-view rule).

Implementation: `apps/desktop/src/renderer/src/app/MeetingWeek.tsx`, wired in
`FolderView.tsx`.
