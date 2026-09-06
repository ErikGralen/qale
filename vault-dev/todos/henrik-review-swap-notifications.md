---
type: todo
summary: Henrik to review what the swap request notification shows about the requesting colleague
title: GDPR review of swap notifications
commitment: open
due: 2026-07-24
owner: '[[people/henrik-dahl]]'
sources:
  - '[[meetings/2026-07-13-1-1-rebecca]]'
tags:
  - shift-swaps
---

Rebecca found that the swap request notification carries the requester's name and phone number to
whichever colleague receives it ([[insights/swap-notifications-show-personal-data]]). These are
our customers' staff, not our users, and nobody has looked at whether we may push that.

Henrik wants to be asked before a thing ships rather than after, so this is going to him now,
while [[tickets/jira/SCH-240]] is still open and the payload is cheap to change.
